// Needs a real Postgres (DATABASE_URL, e.g. the Neon dev branch); skipped without one.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
const db = skip ? null : await import("./db.ts");

after(() => db?.repo.close());

test("saving the same finished game twice applies ratings once (safe to retry)", { skip }, async () => {
  const { migrate, repo } = db!;
  await migrate();
  const [w, b] = [randomUUID(), randomUUID()];
  await repo.createUser(w, `t_${w.slice(0, 8)}`, null);
  await repo.createUser(b, `t_${b.slice(0, 8)}`, null);
  const record = {
    id: `t-${randomUUID().slice(0, 12)}`, whiteId: w, blackId: b, whiteName: "", blackName: "",
    whiteRating: 1200, blackRating: 1200, whiteDelta: -20, blackDelta: 20, tc: "3+0",
    result: "0-1" as const, reason: "checkmate", pgn: "1. f3 e5 2. g4 Qh4#", moves: [], startedAt: 1, endedAt: 2,
  };
  try {
    assert.equal(await repo.saveFinishedGame(record), true);
    assert.equal(await repo.saveFinishedGame(record), false, "second save is a no-op");
    const [white, black] = await Promise.all([repo.findUserById(w), repo.findUserById(b)]);
    assert.deepEqual([white?.rating, white?.games, black?.rating, black?.wins], [1180, 1, 1220, 1]);
  } finally {
    await db!.pool.query("DELETE FROM games WHERE id = $1", [record.id]);
    await db!.pool.query("DELETE FROM users WHERE id = ANY($1)", [[w, b]]);
  }
});
