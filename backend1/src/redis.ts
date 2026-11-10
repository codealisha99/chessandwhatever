import { randomInt } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.ts";
import type { GameSnapshot } from "./Game.ts";
import { log } from "./logger.ts";
import type { Color } from "./protocol.ts";

/**
 * Shared state for running several server instances behind a load balancer.
 *
 *   keys                                   channels
 *   instances / instance:{iid}             ch:user:{uid}       → every socket of that user, on any instance
 *   online:{iid}        users per instance ch:watch:{gid}      → spectators of a game
 *   queue:{tc}          matchmaking FIFO   ch:instance:{iid}   → commands for games that instance owns
 *   user:{uid}:queue|room|game
 *   room:{code}         invite rooms
 *   game:{gid}          GameSnapshot JSON
 *   game:{gid}:owner    lease: which instance runs the clock
 *   game:{gid}:watchers spectator user ids
 *   live                zset of active games
 */
const P = config.redisPrefix;
export const K = {
  instances: `${P}instances`,
  instance: (iid: string) => `${P}instance:${iid}`,
  online: (iid: string) => `${P}online:${iid}`,
  queue: (tc: string) => `${P}queue:${tc}`,
  userQueue: (uid: string) => `${P}user:${uid}:queue`,
  userRoom: (uid: string) => `${P}user:${uid}:room`,
  userGame: (uid: string) => `${P}user:${uid}:game`,
  room: (code: string) => `${P}room:${code}`,
  game: (gid: string) => `${P}game:${gid}`,
  owner: (gid: string) => `${P}game:${gid}:owner`,
  watchers: (gid: string) => `${P}game:${gid}:watchers`,
  live: `${P}live`,
  rate: (bucket: string, id: string) => `${P}rl:${bucket}:${id}`,
};
export const CH = {
  user: (uid: string) => `${P}ch:user:${uid}`,
  watch: (gid: string) => `${P}ch:watch:${gid}`,
  instance: (iid: string) => `${P}ch:instance:${iid}`,
};

const ACTIVE_GAME_TTL_MS = 6 * 3600_000;
const FINISHED_GAME_TTL_MS = 15 * 60_000;
const ROOM_TTL_MS = 3600_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface Scripts {
  /** remove self from queue, pop an opponent if one waits, else enqueue self */
  matchPop(queueKey: string, uid: string): Promise<string | null>;
  /** extend a key's TTL only if we still hold it */
  renewIfEquals(key: string, value: string, ms: number): Promise<number>;
  delIfEquals(key: string, value: string): Promise<number>;
  /** compare-and-swap */
  swapIfEquals(key: string, expected: string, value: string, ms: number): Promise<number>;
}

function connect(name: string): Redis {
  const r = new Redis(config.redisUrl, {
    connectionName: `gambit-${name}-${config.instanceId}`,
    maxRetriesPerRequest: 3,
    // Railway's private network (*.railway.internal) is IPv6-only; 0 = resolve both v4 and v6
    family: 0,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  r.on("error", (err) => log.warn(`redis ${name}: ${err.message}`));
  return r;
}

export const redis = connect("cmd") as Redis & Scripts;
const sub = connect("sub");

redis.defineCommand("matchPop", {
  numberOfKeys: 1,
  lua: `
    redis.call('LREM', KEYS[1], 0, ARGV[1])
    local opp = redis.call('LPOP', KEYS[1])
    if opp then return opp end
    redis.call('RPUSH', KEYS[1], ARGV[1])
    return false`,
});
redis.defineCommand("renewIfEquals", {
  numberOfKeys: 1,
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`,
});
redis.defineCommand("delIfEquals", {
  numberOfKeys: 1,
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
});

redis.defineCommand("swapIfEquals", {
  numberOfKeys: 1,
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) return 1 end return 0`,
});

export async function waitForRedis(): Promise<void> {
  try {
    await Promise.all([redis.ping(), sub.ping()]);
  } catch (err) {
    throw new Error(`Cannot reach Redis at ${config.redisUrl} — start it (e.g. \`redis-server\` or \`docker compose up redis\`) or set REDIS_URL. (${(err as Error).message})`);
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), sub.quit()]);
}

// ---------- pub/sub bus with per-channel ref counting ----------

type Handler = (raw: string) => void;
const handlers = new Map<string, Set<Handler>>();

sub.on("message", (channel: string, raw: string) => {
  for (const h of handlers.get(channel) ?? []) {
    try {
      h(raw);
    } catch (err) {
      log.error(`handler for ${channel} failed`, err);
    }
  }
});

export const bus = {
  /** Resolves once Redis has confirmed the subscription, so nothing published afterwards is missed. */
  async on(channel: string, h: Handler): Promise<void> {
    const set = handlers.get(channel) ?? new Set();
    set.add(h);
    if (!handlers.has(channel)) {
      handlers.set(channel, set);
      await sub.subscribe(channel);
    }
  },
  async off(channel: string, h: Handler): Promise<void> {
    const set = handlers.get(channel);
    if (!set) return;
    set.delete(h);
    if (set.size === 0) {
      handlers.delete(channel);
      await sub.unsubscribe(channel);
    }
  },
  /** Resolves with how many subscribers received it — 0 means nobody is listening on that channel. */
  deliver(channel: string, msg: object): Promise<number> {
    return redis.publish(channel, JSON.stringify(msg));
  },
  publish(channel: string, msg: string | object): void {
    redis.publish(channel, typeof msg === "string" ? msg : JSON.stringify(msg)).catch((err: Error) => log.warn(`publish ${channel}: ${err.message}`));
  },
};

// ---------- instances & presence ----------

let aliveCache: { at: number; ids: string[] } | null = null;

export const presence = {
  async heartbeat(): Promise<void> {
    await redis.multi().set(K.instance(config.instanceId), Date.now(), "PX", config.leaseMs).sadd(K.instances, config.instanceId).exec();
  },
  async aliveInstances(): Promise<string[]> {
    if (aliveCache && Date.now() - aliveCache.at < 2000) return aliveCache.ids;
    const all = await redis.smembers(K.instances);
    const exists = await Promise.all(all.map((iid) => redis.exists(K.instance(iid))));
    const ids = all.filter((_, i) => exists[i]);
    const dead = all.filter((_, i) => !exists[i]);
    if (dead.length) {
      // a crashed instance never cleaned up after itself
      await redis.multi().srem(K.instances, ...dead).del(...dead.map(K.online)).exec();
    }
    aliveCache = { at: Date.now(), ids };
    return ids;
  },
  add: (uid: string) => redis.sadd(K.online(config.instanceId), uid),
  remove: (uid: string) => redis.srem(K.online(config.instanceId), uid),
  async isOnline(uid: string): Promise<boolean> {
    const check = async () => {
      const ids = await presence.aliveInstances();
      const hits = await Promise.all(ids.map((iid) => redis.sismember(K.online(iid), uid)));
      return hits.some(Boolean);
    };
    if (await check()) return true;
    // the cached instance list may predate a newly started instance — confirm a "no" with fresh data
    aliveCache = null;
    return check();
  },
  async onlineCount(): Promise<number> {
    const ids = await presence.aliveInstances();
    // ponytail: SUNION over all instance sets is fine for thousands of users; switch to HyperLogLog beyond that
    return ids.length ? (await redis.sunion(...ids.map(K.online))).length : 0;
  },
  async leave(): Promise<void> {
    await redis.multi().srem(K.instances, config.instanceId).del(K.instance(config.instanceId), K.online(config.instanceId)).exec();
  },
};

// ---------- matchmaking ----------

export const queue = {
  /** Atomically pairs with the oldest waiting player, or enqueues. Returns the opponent's id. */
  async match(uid: string, tc: string): Promise<string | null> {
    const opp = await redis.matchPop(K.queue(tc), uid);
    if (opp) await redis.del(K.userQueue(opp));
    else await redis.set(K.userQueue(uid), tc, "PX", ACTIVE_GAME_TTL_MS);
    return opp;
  },
  async leave(uid: string): Promise<void> {
    const tc = await redis.get(K.userQueue(uid));
    if (tc) await redis.multi().lrem(K.queue(tc), 0, uid).del(K.userQueue(uid)).exec();
  },
  of: (uid: string) => redis.get(K.userQueue(uid)),
  /** players waiting per time control, e.g. { "5+3": 1 } (only non-empty queues) */
  async waiting(tcs: readonly string[]): Promise<Record<string, number>> {
    const lens = await Promise.all(tcs.map((tc) => redis.llen(K.queue(tc))));
    return Object.fromEntries(tcs.map((tc, i) => [tc, lens[i]!] as const).filter(([, n]) => n > 0));
  },
};

// ---------- invite rooms ----------

export interface Room {
  code: string;
  hostId: string;
  tc: string;
  color: Color | "random";
}

export const rooms = {
  async create(hostId: string, tc: string, color: Color | "random"): Promise<Room> {
    for (;;) {
      const code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
      const room: Room = { code, hostId, tc, color };
      const ok = await redis.set(K.room(code), JSON.stringify(room), "PX", ROOM_TTL_MS, "NX");
      if (ok) {
        await redis.set(K.userRoom(hostId), code, "PX", ROOM_TTL_MS);
        return room;
      }
    }
  },
  /** Removes and returns the room — only one joiner can ever win it. */
  async take(code: string): Promise<Room | null> {
    const raw = await redis.getdel(K.room(code));
    if (!raw) return null;
    const room = JSON.parse(raw) as Room;
    await redis.del(K.userRoom(room.hostId));
    return room;
  },
  async peek(code: string): Promise<Room | null> {
    const raw = await redis.get(K.room(code));
    return raw ? (JSON.parse(raw) as Room) : null;
  },
  async of(uid: string): Promise<Room | null> {
    const code = await redis.get(K.userRoom(uid));
    return code ? rooms.peek(code) : null;
  },
  async closeFor(uid: string): Promise<void> {
    const code = await redis.get(K.userRoom(uid));
    if (code) await redis.del(K.room(code), K.userRoom(uid));
  },
};

// ---------- games ----------

export const games = {
  activeOf: (uid: string) => redis.get(K.userGame(uid)),

  async load(gid: string): Promise<GameSnapshot | null> {
    const raw = await redis.get(K.game(gid));
    return raw ? (JSON.parse(raw) as GameSnapshot) : null;
  },

  async loadMany(gids: string[]): Promise<GameSnapshot[]> {
    if (!gids.length) return [];
    const raws = await redis.mget(...gids.map(K.game));
    return raws.filter((r): r is string => !!r).map((r) => JSON.parse(r) as GameSnapshot);
  },

  /**
   * Persist the snapshot and fan the event out in one MULTI, so any instance reading the
   * snapshot after receiving the event sees the state that produced it.
   */
  async commit(s: GameSnapshot, publishes: [channel: string, payload: string][]): Promise<void> {
    const ttl = s.status === "active" ? ACTIVE_GAME_TTL_MS : FINISHED_GAME_TTL_MS;
    const m = redis.multi().set(K.game(s.id), JSON.stringify(s), "PX", ttl);
    if (s.status === "active") {
      m.zadd(K.live, s.white.rating + s.black.rating, s.id);
      m.set(K.userGame(s.white.id), s.id, "PX", ttl).set(K.userGame(s.black.id), s.id, "PX", ttl);
    } else {
      m.zrem(K.live, s.id);
      m.pexpire(K.watchers(s.id), FINISHED_GAME_TTL_MS);
    }
    for (const [ch, payload] of publishes) m.publish(ch, payload);
    await m.exec();
    if (s.status !== "active") {
      await Promise.all([redis.delIfEquals(K.userGame(s.white.id), s.id), redis.delIfEquals(K.userGame(s.black.id), s.id)]);
    }
  },

  liveIds: (limit = 60) => redis.zrevrange(K.live, 0, limit - 1),
  liveCount: () => redis.zcard(K.live),
  dropLive: (gid: string) => redis.zrem(K.live, gid),

  // ownership lease
  claim: async (gid: string) => (await redis.set(K.owner(gid), config.instanceId, "PX", config.leaseMs, "NX")) === "OK",
  ownerOf: (gid: string) => redis.get(K.owner(gid)),
  renew: async (gid: string) => (await redis.renewIfEquals(K.owner(gid), config.instanceId, config.leaseMs)) === 1,
  release: (gid: string) => redis.delIfEquals(K.owner(gid), config.instanceId),
  /** take over from an owner known to be dead, without waiting for its lease to run out */
  steal: async (gid: string, deadOwner: string) =>
    (await redis.swapIfEquals(K.owner(gid), deadOwner, config.instanceId, config.leaseMs)) === 1,

  // spectators
  async watch(gid: string, uid: string): Promise<number> {
    const [, count] = (await redis.multi().sadd(K.watchers(gid), uid).scard(K.watchers(gid)).exec()) ?? [];
    await redis.pexpire(K.watchers(gid), ACTIVE_GAME_TTL_MS);
    return Number(count?.[1] ?? 0);
  },
  async unwatch(gid: string, uid: string): Promise<number> {
    const [, count] = (await redis.multi().srem(K.watchers(gid), uid).scard(K.watchers(gid)).exec()) ?? [];
    return Number(count?.[1] ?? 0);
  },
  watcherCount: (gid: string) => redis.scard(K.watchers(gid)),
};

// ---------- cluster-wide fixed-window rate limit ----------

export async function rateLimited(bucket: string, id: string, max: number, windowMs: number): Promise<boolean> {
  const key = K.rate(bucket, id);
  const [[, count]] = ((await redis.multi().incr(key).pexpire(key, windowMs, "NX").exec()) ?? [[null, 0]]) as [[unknown, number]];
  return Number(count) > max;
}
