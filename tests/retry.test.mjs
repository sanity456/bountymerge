import assert from "node:assert/strict";
import test from "node:test";
import { retryRead } from "../src/retry.ts";

test("transaction read resumes after a temporary RPC failure", async () => {
  let calls = 0;
  const retries = [];
  const value = await retryRead(async () => {
    calls++;
    if (calls < 3) throw Error("temporary RPC failure");
    return "FINALIZED";
  }, attempt => retries.push(attempt), async () => {});
  assert.equal(value, "FINALIZED");
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("transaction read preserves its resumable hash after repeated RPC failures", async () => {
  let calls = 0;
  await assert.rejects(retryRead(async () => {
    calls++;
    throw Error("offline");
  }, () => {}, async () => {}), /hash is saved; retry tracking/);
  assert.equal(calls, 5);
});
