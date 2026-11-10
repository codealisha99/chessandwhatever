// Wire protocol shared by GameManager and Game. The frontend mirrors these shapes in src/lib/types.ts.

export type Color = "white" | "black";

export interface TimeControl {
  id: string;
  initialMs: number;
  incrementMs: number;
}

// "minutes+increment" keys, same list the frontend offers.
export const TIME_CONTROLS: readonly string[] = [
  "1+0", "2+1", "3+0", "3+2", "5+0", "5+3", "10+0", "10+5", "15+10", "30+0", "30+20",
];

export function parseTimeControl(id: unknown): TimeControl | null {
  if (typeof id !== "string" || !TIME_CONTROLS.includes(id)) return null;
  const [min, inc] = id.split("+").map(Number) as [number, number];
  return { id, initialMs: min * 60_000, incrementMs: inc * 1000 };
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export type ClientMessage =
  | { type: "queue"; tc: string }
  | { type: "cancel_queue" }
  | { type: "create_room"; tc: string; color: Color | "random" }
  | { type: "join_room"; code: string }
  | { type: "cancel_room" }
  | { type: "move"; gameId: string; move: MoveInput }
  | { type: "resign"; gameId: string }
  | { type: "abort"; gameId: string }
  | { type: "draw_offer"; gameId: string }
  | { type: "draw_respond"; gameId: string; accept: boolean }
  | { type: "rematch_offer"; gameId: string }
  | { type: "rematch_decline"; gameId: string }
  | { type: "chat"; gameId: string; text: string }
  | { type: "spectate"; gameId: string }
  | { type: "unspectate"; gameId: string }
  | { type: "ping"; t: number };

const SQUARE = /^[a-h][1-8]$/;
const ROOM_CODE = /^[A-Z0-9]{6}$/;
const MAX_CHAT = 200;

const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Validates untrusted socket input. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const gameId = m.gameId;
  const needsGame = () => str(gameId);

  switch (m.type) {
    case "queue":
      return parseTimeControl(m.tc) ? { type: "queue", tc: m.tc as string } : null;
    case "cancel_queue":
    case "cancel_room":
      return { type: m.type };
    case "create_room": {
      const color = m.color ?? "random";
      if (!parseTimeControl(m.tc) || !["white", "black", "random"].includes(color as string)) return null;
      return { type: "create_room", tc: m.tc as string, color: color as Color | "random" };
    }
    case "join_room": {
      const code = typeof m.code === "string" ? m.code.trim().toUpperCase() : "";
      return ROOM_CODE.test(code) ? { type: "join_room", code } : null;
    }
    case "move": {
      const mv = m.move as Record<string, unknown> | undefined;
      if (!needsGame() || !mv || typeof mv !== "object") return null;
      if (typeof mv.from !== "string" || !SQUARE.test(mv.from)) return null;
      if (typeof mv.to !== "string" || !SQUARE.test(mv.to)) return null;
      const promo = mv.promotion;
      if (promo !== undefined && !["q", "r", "b", "n"].includes(promo as string)) return null;
      const move: MoveInput = { from: mv.from, to: mv.to };
      if (promo) move.promotion = promo as MoveInput["promotion"] & string;
      return { type: "move", gameId: gameId as string, move };
    }
    case "resign":
    case "abort":
    case "draw_offer":
    case "rematch_offer":
    case "rematch_decline":
    case "spectate":
    case "unspectate":
      return needsGame() ? { type: m.type, gameId: gameId as string } : null;
    case "draw_respond":
      return needsGame() && typeof m.accept === "boolean"
        ? { type: "draw_respond", gameId: gameId as string, accept: m.accept }
        : null;
    case "chat": {
      const text = typeof m.text === "string" ? m.text.trim().slice(0, MAX_CHAT) : "";
      return needsGame() && text ? { type: "chat", gameId: gameId as string, text } : null;
    }
    case "ping":
      return typeof m.t === "number" ? { type: "ping", t: m.t } : null;
    default:
      return null;
  }
}
