import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageRoom,
  deriveReviewState,
  makeSlug,
  planZipParts,
  safeFileName,
  safeHex,
  sanitizeText,
  uniqueFileName,
} from "./room-logic.ts";

test("slug is at least 10 url-safe characters", () => {
  const slug = makeSlug();
  assert.equal(slug.length, 12);
  assert.match(slug, /^[a-z0-9]+$/);
});

test("review state derives from file statuses", () => {
  assert.equal(deriveReviewState([]), "pending");
  assert.equal(deriveReviewState(["pending", "approved"]), "pending");
  assert.equal(deriveReviewState(["approved", "approved"]), "approved");
  assert.equal(deriveReviewState(["approved", "changes_requested"]), "changes");
});

test("sanitize strips markup and trims", () => {
  assert.equal(sanitizeText("  <script>alert(1)</script>  ", 100), "scriptalert(1)/script");
  assert.equal(sanitizeText("abcdef", 3), "abc");
  assert.equal(sanitizeText("  cześć  ", 20), "cześć");
});

test("file names lose paths and stay unique", () => {
  assert.equal(safeFileName("../../foo bar.jpg"), "foo bar.jpg");
  const used = new Set<string>();
  assert.equal(uniqueFileName("a.jpg", used), "a.jpg");
  assert.equal(uniqueFileName("a.jpg", used), "a-2.jpg");
});

test("zip planner splits when a part would exceed the budget", () => {
  const parts = planZipParts([3, 3, 3, 10], 8);
  assert.deepEqual(parts, [[0, 1], [2], [3]]);
});

test("hex and ownership guards", () => {
  assert.equal(safeHex("#2F6FEB"), "#2F6FEB");
  assert.equal(safeHex("red"), "#E07A3D");
  assert.equal(canManageRoom("creator", "a", "a"), true);
  assert.equal(canManageRoom("creator", "a", "b"), false);
  assert.equal(canManageRoom("admin", "a", "b"), true);
});
