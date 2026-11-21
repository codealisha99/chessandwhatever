// Cloudflare entry: static SPA from Workers Assets, /api and /ws forwarded to the Node game server container.
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  GAME: DurableObjectNamespace<GameServer>;
  ASSETS: Fetcher;
  DATABASE_URL: string;
  AUTH_SECRET: string;
  FRONTEND_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

// Optional server settings, forwarded only when set (Google sign-in stays off without them).
const OPTIONAL_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

export class GameServer extends Container<Env> {
  defaultPort = 8080;
  // ponytail: one instance with in-container Redis; live games reset if it sleeps or redeploys. Move REDIS_URL to a managed Redis and add instances to scale.
  sleepAfter = "2h";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: "production",
      DATABASE_URL: env.DATABASE_URL,
      AUTH_SECRET: env.AUTH_SECRET,
      FRONTEND_URL: env.FRONTEND_URL,
      ...(env.GOOGLE_CLIENT_ID && { GOOGLE_REDIRECT_URI: `${env.FRONTEND_URL}/api/auth/google/callback` }),
      ...Object.fromEntries(OPTIONAL_VARS.filter((k) => env[k]).map((k) => [k, env[k] as string])),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/ws" && !pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Overwrite (never append) so clients can't spoof the IP the auth rate limiter sees.
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "unknown");
    return getContainer(env.GAME, "main").fetch(new Request(request, { headers }));
  },
};
