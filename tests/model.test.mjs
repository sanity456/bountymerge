import assert from "node:assert/strict";
import test from "node:test";
import { cleanLines, selectedDistinctPair, validateRequest } from "../src/model.ts";

test("request validation preserves specific requirements", () => {
  assert.equal(validateRequest("CSV export", "Let me download history", ["Include dates", "Include amounts"], []), "");
  assert.match(validateRequest("CSV export", "Download", ["Include dates", "include dates"], []), /distinct/);
  assert.deepEqual(cleanLines(" Include dates \n\n Include amounts ", 4), ["Include dates", "Include amounts"]);
  assert.match(validateRequest("CSV export", "Download", cleanLines("one\ntwo\nthree\nfour\nfive", 4), []), /1–4/);
});

test("comparison needs two different requests", () => {
  assert.equal(selectedDistinctPair("one", "two"), true);
  assert.equal(selectedDistinctPair("one", "one"), false);
});
