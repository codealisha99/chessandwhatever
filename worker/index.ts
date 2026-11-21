/**
 * Cloudflare Worker Edge Gateway for Gambit Chess Backend
 * 
 * Responsibilities:
 * 1. Global Anycast Edge entry point (low-latency TLS termination, DDoS mitigation, WAF).
 * 2. Instant edge CORS handling (0ms preflight OPTIONS responses without hitting backend).
 * 3. Bidirectional WebSocket proxying via WebSocketPair to containerized Node.js backend.
 * 4. REST API proxying with client IP attribution (CF-Connecting-IP forwarding).
 * 5. Hyperdrive connection string binding for PostgreSQL acceleration.
 */

export interface Env {
  /** Target backend container origin (e.g., https://gambit-container.internal or https://backend.gambitchess.com) */
  BACKEND_ORIGIN: string;
  /** Permitted frontend origins, comma-separated (e.g., https://gambitchess.vercel.app,http://localhost:5173) */
  ALLOWED_ORIGINS?: string;
  /** Environment tag */
  ENVIRONMENT?: string;
  /** Cloudflare Hyperdrive binding for PostgreSQL connection pooling and query acceleration */
  HYPERDRIVE?: {
    connectionString: string;
  };
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://gambitchess.vercel.app",
];

function getAllowedOrigin(requestOrigin: string | null, env: Env): string | null {
  if (!requestOrigin) return null;
  const configured = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  // Direct match
  if (configured.includes(requestOrigin) || configured.includes("*")) {
    return requestOrigin;
  }
  // Allow Vercel preview deployments if configured or matching vercel.app
  if (requestOrigin.endsWith(".vercel.app")) {
    return requestOrigin;
  }
  return null;
}

function createCorsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Session-Id, X-Requested-With, Accept, Origin"
  );
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type");
  headers.set("Access-Control-Max-Age", "86400"); // 24 hours
  headers.set("Vary", "Origin");
  return headers;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const originHeader = request.headers.get("Origin");
    const allowedOrigin = getAllowedOrigin(originHeader, env);

    // 1. Edge CORS Preflight Handler (0ms latency, eliminates container wakeups)
    if (request.method === "OPTIONS") {
      const corsHeaders = createCorsHeaders(allowedOrigin);
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 2. Edge Health Probe
    if (url.pathname === "/health" || url.pathname === "/edge-health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "gambit-cloudflare-edge",
          environment: env.ENVIRONMENT || "production",
          timestamp: new Date().toISOString(),
          backendTargetConfigured: Boolean(env.BACKEND_ORIGIN),
          hyperdriveAttached: Boolean(env.HYPERDRIVE),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // 3. Fallback check for missing backend target configuration
    if (!env.BACKEND_ORIGIN) {
      return new Response(
        JSON.stringify({
          error: "BACKEND_ORIGIN environment variable is not configured in Cloudflare Worker.",
          hint: "Set BACKEND_ORIGIN in wrangler.jsonc or via 'wrangler secret put BACKEND_ORIGIN'",
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 4. Construct Target URL
    const targetOrigin = env.BACKEND_ORIGIN.replace(/\/+$/, "");
    const targetUrl = new URL(url.pathname + url.search, targetOrigin);

    // 5. Clone and decorate request headers
    const reqHeaders = new Headers(request.headers);
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    if (clientIp) {
      reqHeaders.set("X-Forwarded-For", clientIp);
      reqHeaders.set("CF-Connecting-IP", clientIp);
    }
    reqHeaders.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    reqHeaders.set("X-Forwarded-Host", url.host);

    // 6. Handle WebSocket Upgrade Request (Bidirectional Relay via WebSocketPair)
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      try {
        const originResponse = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: reqHeaders,
        });

        const originWs = originResponse.webSocket;
        if (!originWs) {
          // Upstream returned HTTP error (e.g. 401 Unauthorized or 404 Not Found)
          return originResponse;
        }

        // Accept connection from worker to backend
        originWs.accept();

        // Create client-facing WebSocket pair
        const pair = new WebSocketPair();
        const clientSocket = pair[0];
        const workerSocket = pair[1];

        // Accept connection between worker and client
        workerSocket.accept();

        // Relay: Client -> Backend
        workerSocket.addEventListener("message", (event: MessageEvent) => {
          try {
            originWs.send(event.data);
          } catch {
            try {
              workerSocket.close(1011, "Failed to relay message to upstream");
            } catch {}
          }
        });

        // Relay: Backend -> Client
        originWs.addEventListener("message", (event: MessageEvent) => {
          try {
            workerSocket.send(event.data);
          } catch {
            try {
              originWs.close(1011, "Failed to relay message to client");
            } catch {}
          }
        });

        // Close propagation: Client closed -> close Backend
        workerSocket.addEventListener("close", (event: CloseEvent) => {
          try {
            originWs.close(event.code, event.reason);
          } catch {}
        });

        // Close propagation: Backend closed -> close Client
        originWs.addEventListener("close", (event: CloseEvent) => {
          try {
            workerSocket.close(event.code, event.reason);
          } catch {}
        });

        // Clean error handling to prevent orphaned connections
        const onProxyError = () => {
          try {
            workerSocket.close(1011, "WebSocket proxy error");
          } catch {}
          try {
            originWs.close(1011, "WebSocket proxy error");
          } catch {}
        };
        workerSocket.addEventListener("error", onProxyError);
        originWs.addEventListener("error", onProxyError);

        // Return client-side socket to client with 101 Switching Protocols
        return new Response(null, {
          status: 101,
          webSocket: clientSocket,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return new Response(
          JSON.stringify({
            error: "Bad Gateway",
            message: "Failed to establish WebSocket connection with upstream backend container.",
            detail: errorMsg,
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
            },
          }
        );
      }
    }

    // 7. Proxy standard HTTP/REST Requests
    try {
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: reqHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });

      // Clone response to attach edge security & CORS headers
      const resHeaders = new Headers(response.headers);
      
      // Ensure CORS headers match client origin
      if (allowedOrigin) {
        resHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
        resHeaders.set("Access-Control-Allow-Credentials", "true");
        resHeaders.set("Vary", "Origin");
      }

      // Security hardening headers
      resHeaders.set("X-Content-Type-Options", "nosniff");
      resHeaders.set("X-Frame-Options", "DENY");
      resHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          error: "Bad Gateway",
          message: "Failed to connect to backend container upstream.",
          detail: errorMsg,
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
          },
        }
      );
    }
  },
};
