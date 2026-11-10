import assert from "node:assert/strict";
import { test } from "node:test";
import { retry } from "./retry.ts";

test("retry returns as soon as an attempt succeeds", async () => {
  let calls = 0;
  const result = await retry("flaky", async () => {
    if (++calls < 3) throw new Error("connection timeout");
    return "saved";
  }, { attempts: 5, baseMs: 1 });
  assert.equal(result, "saved");
  assert.equal(calls, 3);
});

test("retry gives up after the last attempt and surfaces the last error", async () => {
  let calls = 0;
  await assert.rejects(
    retry("down", async () => {
      calls++;
      throw new Error(`fail ${calls}`);
    }, { attempts: 3, baseMs: 1 }),
    /fail 3/,
  );
  assert.equal(calls, 3);
});
