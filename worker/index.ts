// Cloudflare entry: static SPA from Workers Assets, /api and /ws forwarded to the Node game server container.
import { DurableObject } from "cloudflare:workers";

interface Env {
  GAME: DurableObjectNamespace<GameServer>;
  ASSETS: Fetcher;
  DATABASE_URL: string;
  AUTH_SECRET: string;
  FRONTEND_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const PORT = 8080;
// 2 hours inactivity timeout before sleeping (live state is preserved in Redis while container is running)
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class GameServer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      // Restore the timeout and exit monitoring after a DO restart.
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Share startup across concurrent requests, including after a failed attempt.
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";

    const headers = new Headers(request.headers);
    // Overwrite (never append) so clients can't spoof the IP the auth rate limiter sees.
    headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "unknown");

    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    const forwarded = new Request(url, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      ...(hasBody ? { duplex: "half" as const } : {}),
    });

    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: true,
        env: {
          NODE_ENV: "production",
          PORT: String(PORT),
          DATABASE_URL: this.env.DATABASE_URL,
          AUTH_SECRET: this.env.AUTH_SECRET,
          FRONTEND_URL: this.env.FRONTEND_URL,
          ...(this.env.GOOGLE_CLIENT_ID && { GOOGLE_REDIRECT_URI: `${this.env.FRONTEND_URL}/api/auth/google/callback` }),
          ...(this.env.GOOGLE_CLIENT_ID && { GOOGLE_CLIENT_ID: this.env.GOOGLE_CLIENT_ID }),
          ...(this.env.GOOGLE_CLIENT_SECRET && { GOOGLE_CLIENT_SECRET: this.env.GOOGLE_CLIENT_SECRET }),
        },
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    // running means startup was requested, not that the HTTP server is ready.
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // The port may not be listening yet. Retry the readiness probe only.
      }
      await scheduler.wait(200);
    }
    throw new Error("Container did not become ready on port 8080");
  }

  private observeExit(): void {
    if (this.monitoring) return;
    this.monitoring = this.ctx
      .container!.monitor()
      .then(() => console.log("Container exited successfully"))
      .catch((error: unknown) => console.error("Container failed:", error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/ws" && !pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    const id = env.GAME.idFromName("main");
    return env.GAME.get(id).fetch(request);
  },
};
