/**
 * Rule tests for the engine. Run with: node test/engine.test.mjs
 *
 * These cover the parts that decide a winner, because a party game that can be
 * swayed by the model is not a party game.
 */

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  dealRoles,
  resolveVote,
  scoreGame,
  initials,
  MIN_PLAYERS,
  MAX_PLAYERS,
} = await import("../js/engine.js");

const seats = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log("engine");

test("deals exactly one culprit among the seated", () => {
  for (let run = 0; run < 200; run += 1) {
    const players = seats(6);
    const roles = dealRoles(players);
    assert.equal(roles.size, 6);
    assert.equal([...roles.values()].filter((r) => r === "culprit").length, 1);
  }
});

test("refuses to deal below the minimum table", () => {
  assert.throws(() => dealRoles(seats(MIN_PLAYERS - 1)), /at least/);
});

test("supports the full table range", () => {
  assert.equal(dealRoles(seats(MIN_PLAYERS)).size, MIN_PLAYERS);
  assert.equal(dealRoles(seats(MAX_PLAYERS)).size, MAX_PLAYERS);
});

test("a strict majority catches the culprit", () => {
  const players = seats(5);
  const roles = new Map(players.map((p) => [p.id, "innocent"]));
  roles.set("p1", "culprit");
  // 3 of 5 is a strict majority.
  const votes = { p1: "p1", p2: "p1", p3: "p1", p4: "p2", p5: "p2" };
  const verdict = resolveVote(players, votes, "p1");
  assert.equal(verdict.caught, true);
  assert.equal(verdict.culpritVotes, 3);
});

test("half the table is not enough", () => {
  const players = seats(4);
  const votes = { p1: "p1", p2: "p1", p3: "p2", p4: "p2" };
  const verdict = resolveVote(players, votes, "p1");
  assert.equal(verdict.caught, false, "2 of 4 is exactly half, not a majority");
  assert.equal(verdict.caught, false);
});

test("a tie at the top lets the culprit walk", () => {
  const players = seats(5);
  // p1 and p2 both collect 2 votes; p3 collects 1. Culprit is p1.
  const votes = { p1: "p2", p2: "p1", p3: "p2", p4: "p3", p5: "p1" };
  const verdict = resolveVote(players, votes, "p1");
  assert.equal(verdict.caught, false);
  assert.equal(verdict.tied, true);
  assert.equal(verdict.culpritVotes, 2, "the culprit led the tie and still survived it");
  assert.equal(verdict.ranked[0][1], 2);
});

test("a plurality short of a majority does not catch the culprit", () => {
  const players = seats(7);
  // Culprit leads with 3 of 7 — under the 3.5 needed.
  const votes = { p1: "p1", p2: "p1", p3: "p1", p4: "p2", p5: "p2", p6: "p3", p7: "p3" };
  const verdict = resolveVote(players, votes, "p1");
  assert.equal(verdict.caught, false);
  assert.equal(verdict.topAccused, "p1");
});

test("ignores ballots for players who are not seated", () => {
  const players = seats(5);
  const votes = { p1: "p1", p2: "p1", p3: "p1", p4: "ghost", p5: "p2" };
  const verdict = resolveVote(players, votes, "p1");
  assert.equal(verdict.counts.has("ghost"), false, "a phantom ballot is not counted");
  assert.equal(verdict.culpritVotes, 3);
  assert.equal(verdict.caught, true, "3 of 5 is a strict majority");
});

test("scores an innocent who names the culprit as a winner", () => {
  const players = seats(5);
  const roles = new Map(players.map((p) => [p.id, "innocent"]));
  roles.set("p3", "culprit");
  const votes = { p1: "p3", p2: "p3", p3: "p3", p4: "p1", p5: "p2" };
  const verdict = resolveVote(players, votes, "p3");
  const score = scoreGame(players, roles, votes, verdict);

  assert.equal(verdict.caught, true);
  const p1 = score.rows.find((r) => r.player.id === "p1");
  const p4 = score.rows.find((r) => r.player.id === "p4");
  const p3 = score.rows.find((r) => r.player.id === "p3");
  assert.equal(p1.won, true, "voting the culprit wins");
  assert.equal(p4.won, false, "voting wrong loses");
  assert.equal(p3.won, false, "the caught culprit does not win");
  assert.equal(score.innocents, 4);
});

test("the culprit wins by surviving the vote", () => {
  const players = seats(5);
  const roles = new Map(players.map((p) => [p.id, "innocent"]));
  roles.set("p3", "culprit");
  const votes = { p1: "p1", p2: "p2", p3: "p1", p4: "p2", p5: "p4" };
  const verdict = resolveVote(players, votes, "p3");
  const score = scoreGame(players, roles, votes, verdict);
  assert.equal(verdict.caught, false);
  assert.equal(score.rows.find((r) => r.player.id === "p3").won, true);
});

test("a player voting themselves is never a win", () => {
  const players = seats(4);
  const roles = new Map(players.map((p) => [p.id, "innocent"]));
  roles.set("p1", "culprit");
  const votes = { p1: "p1", p2: "p1", p3: "p1", p4: "p4" };
  const verdict = resolveVote(players, votes, "p1");
  const score = scoreGame(players, roles, votes, verdict);
  const p4 = score.rows.find((r) => r.player.id === "p4");
  assert.equal(p4.votedCorrectly, false);
  assert.equal(p4.won, false);
});

test("initials handle single names, pairs and empty input", () => {
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("Prince"), "PR");
  assert.equal(initials("  Jean  Luc  Picard "), "JP");
  assert.equal(initials(""), "??");
  assert.equal(initials("Ana María de la Cruz"), "AC");
});

console.log(`\n${passed} passing`);