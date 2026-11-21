import test from "node:test";
import assert from "node:assert/strict";
import worker, { type Env } from "./index.ts";

class MockWebSocket {
  public readyState = 1; // OPEN
  public sent: any[] = [];
  public closed: { code?: number; reason?: string } | null = null;
  public listeners: Record<string, ((event: any) => void)[]> = {};

  accept() {}

  addEventListener(event: string, fn: (event: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  send(data: any) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closed = { code, reason };
    for (const fn of this.listeners["close"] || []) {
      fn({ code, reason });
    }
  }

  emitMessage(data: any) {
    for (const fn of this.listeners["message"] || []) {
      fn({ data });
    }
  }

  emitClose(code?: number, reason?: string) {
    this.readyState = 3;
    this.closed = { code, reason };
    for (const fn of this.listeners["close"] || []) {
      fn({ code, reason });
    }
  }

  emitError() {
    for (const fn of this.listeners["error"] || []) {
      fn({});
    }
  }
}

// Wire pair so [0] sends to [1] and [1] sends to [0]
class ConnectedMockWebSocketPair {
  0: MockWebSocket;
  1: MockWebSocket;
  constructor() {
    const a = new MockWebSocket();
    const b = new MockWebSocket();
    a.send = (data: any) => {
      a.sent.push(data);
      b.emitMessage(data);
    };
    b.send = (data: any) => {
      b.sent.push(data);
      a.emitMessage(data);
    };
    a.close = (code?: number, reason?: string) => {
      a.readyState = 3;
      a.closed = { code, reason };
      b.emitClose(code, reason);
    };
    b.close = (code?: number, reason?: string) => {
      b.readyState = 3;
      b.closed = { code, reason };
      a.emitClose(code, reason);
    };
    this[0] = a;
    this[1] = b;
  }
}

(globalThis as any).WebSocketPair = ConnectedMockWebSocketPair;

test("Worker: Edge CORS preflight handler returns 204 with allow-origin headers", async () => {
  const env: Env = {
    BACKEND_ORIGIN: "https://backend.gambitchess.internal",
    ALLOWED_ORIGINS: "https://gambitchess.vercel.app",
  };

  const req = new Request("https://api.gambitchess.com/api/auth/me", {
    method: "OPTIONS",
    headers: {
      Origin: "https://gambitchess.vercel.app",
      "Access-Control-Request-Method": "GET",
    },
  });

  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://gambitchess.vercel.app");
  assert.equal(res.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.ok(res.headers.get("Access-Control-Allow-Methods")?.includes("GET"));
});

test("Worker: Health probe /health returns 200 with service metadata", async () => {
  const env: Env = {
    BACKEND_ORIGIN: "https://backend.gambitchess.internal",
    ENVIRONMENT: "staging",
  };

  const req = new Request("https://api.gambitchess.com/health");
  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, "ok");
  assert.equal(data.service, "gambit-cloudflare-edge");
  assert.equal(data.environment, "staging");
  assert.equal(data.backendTargetConfigured, true);
});

test("Worker: Missing BACKEND_ORIGIN returns 502 with diagnostic hint", async () => {
  const env: Env = {
    BACKEND_ORIGIN: "",
  };

  const req = new Request("https://api.gambitchess.com/api/stats");
  const res = await worker.fetch(req, env, {} as any);
  assert.equal(res.status, 502);
  const data = (await res.json()) as any;
  assert.ok(data.error.includes("BACKEND_ORIGIN"));
});

test("Worker: WebSocket bidirectional relay via WebSocketPair forwards frames, close events and errors", async () => {
  const mockOriginWs = new MockWebSocket();

  const originalFetch = globalThis.fetch;
  const originalResponse = globalThis.Response;

  class WorkerResponse extends originalResponse {
    public webSocket?: any;
    constructor(body?: any, init?: any) {
      if (init?.status === 101) {
        super(null, { status: 200 });
        Object.defineProperty(this, "status", { value: 101 });
        this.webSocket = init.webSocket;
      } else {
        super(body, init);
        if (init?.webSocket) this.webSocket = init.webSocket;
      }
    }
  }
  (globalThis as any).Response = WorkerResponse;

  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    return new WorkerResponse(null, {
      status: 101,
      webSocket: mockOriginWs,
    });
  };

  try {
    const env: Env = {
      BACKEND_ORIGIN: "https://backend.gambitchess.internal",
    };

    const req = new Request("https://api.gambitchess.com/ws?ticket=test-ticket-123", {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "CF-Connecting-IP": "203.0.113.195",
      },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 101);
    assert.ok((res as any).webSocket, "Response must include client-side webSocket");

    const clientWs = (res as any).webSocket as MockWebSocket;
    const clientReceived: any[] = [];
    clientWs.addEventListener("message", (e: any) => clientReceived.push(e.data));

    // 1. Client -> Backend message relay
    clientWs.send(JSON.stringify({ type: "init_game" }));
    assert.equal(mockOriginWs.sent.length, 1);
    assert.equal(JSON.parse(mockOriginWs.sent[0]).type, "init_game");

    // 2. Backend -> Client message relay
    mockOriginWs.emitMessage(JSON.stringify({ type: "game_started", gameId: "g123" }));
    assert.equal(clientReceived.length, 1);
    assert.equal(JSON.parse(clientReceived[0]).gameId, "g123");

    // 3. Binary message relay (ArrayBuffer)
    const binaryData = new Uint8Array([1, 2, 3, 4]);
    clientWs.send(binaryData);
    assert.equal(mockOriginWs.sent.length, 2);
    assert.deepEqual(mockOriginWs.sent[1], binaryData);

    // 4. Backend close event propagation to Client
    mockOriginWs.emitClose(1000, "Game finished");
    assert.equal(clientWs.readyState, 3);
    assert.equal(clientWs.closed?.code, 1000);
    assert.equal(clientWs.closed?.reason, "Game finished");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Response = originalResponse;
  }
});

test("Worker: Upstream 401 Unauthorized is returned directly to client when upgrade rejected", async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env: Env = {
      BACKEND_ORIGIN: "https://backend.gambitchess.internal",
    };

    const req = new Request("https://api.gambitchess.com/ws?ticket=expired-ticket", {
      headers: { Upgrade: "websocket" },
    });

    const res = await worker.fetch(req, env, {} as any);
    assert.equal(res.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
