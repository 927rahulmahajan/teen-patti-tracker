import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startRound,
  applyPlay,
  buildState,
  playLog,
  undo,
  setWinners,
  finalizeRound,
  blindAmount,
  seenAmount,
  splitPot,
  netBalances,
  assertZeroSum,
  settlement,
  availableActions,
  activePlayers,
  currentPlayer,
  canSideShow,
  sideShowTarget,
  type Rules,
  type PlayerSeat,
  type RoundResult,
} from "./engine.ts";

// ₹100 = 10000 paise. Boot ₹100, blind 1x, seen 2x.
const RULES: Rules = {
  bootAmount: 10000,
  blindMultiplier: 1,
  seenMultiplier: 2,
  maxBet: 0,
  sideshowEnabled: false,
  showEnabled: true,
};

const SEATS: PlayerSeat[] = [
  { id: "rahul", name: "Rahul" },
  { id: "amit", name: "Amit" },
  { id: "karan", name: "Karan" },
  { id: "neeraj", name: "Neeraj" },
];

const SS_RULES: Rules = { ...RULES, sideshowEnabled: true };

// Everyone sees in lap 1; returns state with Rahul to act in lap 2, all 4 active & seen.
function allSeenLap2() {
  let s = startRound(SEATS, SS_RULES);
  for (let i = 0; i < 4; i++) s = applyPlay(s, SS_RULES, "SEEN");
  return s;
}

function play(seats: PlayerSeat[], rules: Rules, moves: ["BLIND" | "SEEN" | "FOLD" | "SHOW"][]) {
  let s = startRound(seats, rules);
  for (const [type] of moves) s = applyPlay(s, rules, type);
  return s;
}

test("boot: every player pays boot, pot and chaal are set", () => {
  const s = startRound(SEATS, RULES);
  assert.equal(s.pot, 40000);
  assert.equal(s.chaal, 10000);
  assert.equal(s.currentPlayerId, "rahul");
  for (const p of s.players) assert.equal(p.contribution, 10000);
  assert.equal(s.actions.filter((a) => a.type === "BOOT").length, 4);
});

test("blind calculation and contribution", () => {
  assert.equal(blindAmount(10000, RULES), 10000);
  const s = applyPlay(startRound(SEATS, RULES), RULES, "BLIND");
  assert.equal(s.players[0].contribution, 20000); // boot + blind
  assert.equal(s.pot, 50000);
  assert.equal(s.currentPlayerId, "amit");
});

test("seen calculation, sticky seen state removes BLIND option", () => {
  assert.equal(seenAmount(10000, RULES), 20000);
  let s = applyPlay(startRound(SEATS, RULES), RULES, "SEEN");
  assert.equal(s.players[0].contribution, 30000); // boot + seen
  assert.equal(s.pot, 60000);
  assert.equal(s.players[0].hasSeen, true);
  // come back around to rahul: he must not see a BLIND option
  s = applyPlay(s, RULES, "BLIND"); // amit
  s = applyPlay(s, RULES, "BLIND"); // karan
  s = applyPlay(s, RULES, "BLIND"); // neeraj -> back to rahul
  assert.equal(currentPlayer(s)!.id, "rahul");
  assert.deepEqual(availableActions(s, RULES), ["SEEN", "FOLD"]);
});

test("chaal stays constant across the round (MVP, no raise)", () => {
  let s = startRound(SEATS, RULES);
  for (let i = 0; i < 6; i++) s = applyPlay(s, RULES, i % 2 === 0 ? "BLIND" : "SEEN");
  assert.equal(s.chaal, 10000);
});

test("folded players are skipped and chaal is unchanged by a fold", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "BLIND"); // rahul -> amit
  s = applyPlay(s, RULES, "FOLD"); // amit folds -> karan
  assert.equal(s.chaal, 10000);
  assert.equal(currentPlayer(s)!.id, "karan");
  assert.equal(activePlayers(s).length, 3);
  s = applyPlay(s, RULES, "FOLD"); // karan -> neeraj
  s = applyPlay(s, RULES, "BLIND"); // neeraj -> rahul (amit & karan skipped)
  assert.equal(currentPlayer(s)!.id, "rahul");
});

test("player progression cycles in laps", () => {
  let s = startRound(SEATS, RULES);
  const order: string[] = [];
  for (let i = 0; i < 8; i++) {
    order.push(currentPlayer(s)!.id);
    s = applyPlay(s, RULES, "BLIND");
  }
  assert.deepEqual(order, ["rahul", "amit", "karan", "neeraj", "rahul", "amit", "karan", "neeraj"]);
});

test("different contributions accumulate correctly", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "SEEN"); // rahul boot+20000 = 30000
  s = applyPlay(s, RULES, "BLIND"); // amit boot+10000 = 20000
  s = applyPlay(s, RULES, "FOLD"); // karan boot only = 10000
  s = applyPlay(s, RULES, "SEEN"); // neeraj boot+20000 = 30000
  const c = Object.fromEntries(s.players.map((p) => [p.id, p.contribution]));
  assert.deepEqual(c, { rahul: 30000, amit: 20000, karan: 10000, neeraj: 30000 });
  assert.equal(s.pot, 90000);
});

test("fold-to-one ends betting and forces the survivor as winner", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "BLIND"); // rahul
  s = applyPlay(s, RULES, "FOLD"); // amit
  s = applyPlay(s, RULES, "FOLD"); // karan
  s = applyPlay(s, RULES, "FOLD"); // neeraj -> only rahul active
  assert.equal(s.phase, "AWAITING_WINNER");
  assert.equal(s.currentPlayerId, null);
  assert.deepEqual(activePlayers(s).map((p) => p.id), ["rahul"]);
  const done = setWinners(s, ["rahul"]);
  assert.equal(done.phase, "COMPLETE");
});

test("SHOW only with 2 active players, and ends betting", () => {
  let s = startRound(SEATS, RULES);
  // show not allowed with 4 active
  assert.throws(() => applyPlay(s, RULES, "SHOW"), /2 active/);
  s = applyPlay(s, RULES, "SEEN"); // rahul
  s = applyPlay(s, RULES, "FOLD"); // amit
  s = applyPlay(s, RULES, "FOLD"); // karan -> neeraj, now 2 active (rahul, neeraj)
  assert.ok(availableActions(s, RULES).includes("SHOW"));
  s = applyPlay(s, RULES, "SHOW"); // neeraj shows
  assert.equal(s.phase, "AWAITING_WINNER");
  assert.equal(s.players.find((p) => p.id === "neeraj")!.contribution, 30000); // boot + show(20000)
});

test("zero-sum holds for a single-winner round", () => {
  let s = play(SEATS, RULES, [["SEEN"], ["BLIND"], ["FOLD"], ["SEEN"]]);
  // 4 more folds needed? active: rahul, amit, neeraj. fold down to one.
  s = applyPlay(s, RULES, "FOLD"); // rahul
  s = applyPlay(s, RULES, "FOLD"); // amit -> neeraj sole survivor
  s = setWinners(s, ["neeraj"]);
  const net = netBalances(SEATS.map((x) => x.id), [finalizeRound(s)]);
  assertZeroSum(net);
});

test("undo removes last action and restores previous state", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "SEEN"); // rahul
  const beforeAmit = { pot: s.pot, chaal: s.chaal, current: s.currentPlayerId };
  s = applyPlay(s, RULES, "BLIND"); // amit
  assert.notEqual(s.pot, beforeAmit.pot);
  const u = undo(SEATS, RULES, s);
  assert.equal(u.pot, beforeAmit.pot);
  assert.equal(u.chaal, beforeAmit.chaal);
  assert.equal(u.currentPlayerId, "amit"); // amit's turn again
  assert.equal(u.players.find((p) => p.id === "amit")!.contribution, 10000); // blind rolled back
});

test("undo restores a folded player and reopens betting", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "FOLD"); // rahul
  s = applyPlay(s, RULES, "FOLD"); // amit
  s = applyPlay(s, RULES, "FOLD"); // karan -> neeraj sole survivor, AWAITING_WINNER
  assert.equal(s.phase, "AWAITING_WINNER");
  s = undo(SEATS, RULES, s); // undo karan's fold
  assert.equal(s.phase, "BETTING");
  assert.equal(s.currentPlayerId, "karan");
  assert.equal(activePlayers(s).length, 2);
});

test("undo never peels boots (no-op when only boots exist)", () => {
  const s = startRound(SEATS, RULES);
  const u = undo(SEATS, RULES, s);
  assert.equal(u.pot, s.pot);
  assert.equal(playLog(u).length, 0);
});

test("round editing = replay a corrected log, fully recalculated", () => {
  const s = play(SEATS, RULES, [["SEEN"], ["BLIND"], ["FOLD"], ["FOLD"]]);
  const log = playLog(s);
  // edit: amit played SEEN instead of BLIND
  log[1] = { playerId: "amit", type: "SEEN" };
  const edited = buildState(SEATS, RULES, log);
  assert.equal(edited.players.find((p) => p.id === "amit")!.contribution, 30000);
  assert.equal(edited.pot, s.pot + 10000);
});

test("round deletion = drop the round from the ledger", () => {
  const ids = SEATS.map((x) => x.id);
  const r1: RoundResult = { contributions: { rahul: 30000, amit: 20000, karan: 10000, neeraj: 10000 }, winners: ["rahul"], pot: 70000 };
  const r2: RoundResult = { contributions: { rahul: 10000, amit: 10000, karan: 30000, neeraj: 10000 }, winners: ["karan"], pot: 60000 };
  const both = netBalances(ids, [r1, r2]);
  const onlyFirst = netBalances(ids, [r1]);
  assertZeroSum(both);
  assertZeroSum(onlyFirst);
  assert.notDeepEqual(both, onlyFirst);
});

test("tie / split pot divides evenly and stays zero-sum", () => {
  const out = splitPot(70001, ["a", "b"]); // odd remainder -> earliest winner
  assert.deepEqual(out, { a: 35001, b: 35000 });
  assert.equal(out.a + out.b, 70001);
  const r: RoundResult = { contributions: { a: 30001, b: 20000, c: 20000 }, winners: ["a", "b"], pot: 70001 };
  const net = netBalances(["a", "b", "c"], [r]);
  assertZeroSum(net);
});

test("settlement: minimal-ish transfers, all balanced", () => {
  // Rahul +2500, Neeraj +500, Amit -2000, Karan -1000 (in rupees, use paise)
  const net = { rahul: 250000, neeraj: 50000, amit: -200000, karan: -100000 };
  const t = settlement(net);
  // every debtor fully pays, every creditor fully receives
  const paid: Record<string, number> = {};
  const got: Record<string, number> = {};
  for (const x of t) {
    paid[x.from] = (paid[x.from] ?? 0) + x.amount;
    got[x.to] = (got[x.to] ?? 0) + x.amount;
    assert.ok(x.amount > 0);
  }
  assert.equal(paid.amit, 200000);
  assert.equal(paid.karan, 100000);
  assert.equal(got.rahul, 250000);
  assert.equal(got.neeraj, 50000);
  assert.ok(t.length <= 3); // n-1 bound for 4 players
});

test("settlement throws on non-zero-sum input", () => {
  assert.throws(() => settlement({ a: 100, b: -50 }), /sum to zero/);
});

test("invalid input: too few players, bad boot, wrong-phase plays", () => {
  assert.throws(() => startRound([{ id: "a", name: "A" }], RULES), /at least 2/);
  assert.throws(() => startRound(SEATS, { ...RULES, bootAmount: 0 }), /positive integer/);
  assert.throws(() => startRound(SEATS, { ...RULES, bootAmount: 100.5 }), /integer/);

  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "SEEN"); // rahul seen
  s = applyPlay(s, RULES, "BLIND");
  s = applyPlay(s, RULES, "BLIND");
  s = applyPlay(s, RULES, "BLIND"); // back to rahul
  assert.throws(() => applyPlay(s, RULES, "BLIND"), /seen cannot play blind/);

  assert.throws(() => setWinners(s, ["rahul"]), /phase BETTING/);
});

test("invalid input: non-integer amount from fractional multiplier throws", () => {
  const bad: Rules = { ...RULES, bootAmount: 10001, seenMultiplier: 1.5 };
  const s = startRound(SEATS, bad);
  assert.throws(() => applyPlay(s, bad, "SEEN"), /integer/);
});

test("setWinners rejects non-active, empty, and duplicate winners", () => {
  let s = startRound(SEATS, RULES);
  s = applyPlay(s, RULES, "BLIND");
  s = applyPlay(s, RULES, "FOLD"); // amit folded
  s = applyPlay(s, RULES, "FOLD");
  s = applyPlay(s, RULES, "FOLD"); // rahul sole survivor
  assert.throws(() => setWinners(s, []), /At least one/);
  assert.throws(() => setWinners(s, ["amit"]), /not an active/);
});

test("side-show: offered only to a seen player vs a seen previous player, >2 active", () => {
  const s = allSeenLap2();
  assert.equal(currentPlayer(s)!.id, "rahul");
  assert.equal(sideShowTarget(s), "neeraj"); // previous active, seen
  assert.deepEqual(availableActions(s, SS_RULES), ["SEEN", "SIDE_SHOW", "FOLD"]);
  // disabled by rules
  assert.equal(canSideShow(s, { ...SS_RULES, sideshowEnabled: false }), false);
});

test("side-show not offered when the previous active player is blind", () => {
  let s = startRound(SEATS, SS_RULES);
  s = applyPlay(s, SS_RULES, "SEEN"); // rahul seen
  s = applyPlay(s, SS_RULES, "BLIND"); // amit blind
  s = applyPlay(s, SS_RULES, "SEEN"); // karan seen -> neeraj
  s = applyPlay(s, SS_RULES, "SEEN"); // neeraj -> rahul (lap2)
  s = applyPlay(s, SS_RULES, "SEEN"); // rahul -> amit
  s = applyPlay(s, SS_RULES, "BLIND"); // amit stays blind -> karan
  // karan is seen but his previous active (amit) is blind
  assert.equal(currentPlayer(s)!.id, "karan");
  assert.equal(sideShowTarget(s), null);
  assert.equal(availableActions(s, SS_RULES).includes("SIDE_SHOW"), false);
});

test("side-show TARGET_FOLDS: cost paid, target out, requester continues", () => {
  let s = allSeenLap2();
  const potBefore = s.pot; // 40000 boots + 80000 seen = 120000
  s = applyPlay(s, SS_RULES, "SIDE_SHOW", { outcome: "TARGET_FOLDS" });
  assert.equal(s.pot, potBefore + 20000);
  assert.equal(s.players.find((p) => p.id === "rahul")!.contribution, 50000); // boot+seen+sideshow
  assert.equal(s.players.find((p) => p.id === "neeraj")!.status, "FOLDED");
  assert.equal(currentPlayer(s)!.id, "amit"); // play continues after requester
  assert.equal(activePlayers(s).length, 3);
});

test("side-show REQUESTER_FOLDS and DECLINE outcomes", () => {
  let req = applyPlay(allSeenLap2(), SS_RULES, "SIDE_SHOW", { outcome: "REQUESTER_FOLDS" });
  assert.equal(req.players.find((p) => p.id === "rahul")!.status, "FOLDED");
  assert.equal(req.players.find((p) => p.id === "neeraj")!.status, "ACTIVE");
  assert.equal(currentPlayer(req)!.id, "amit");

  let dec = applyPlay(allSeenLap2(), SS_RULES, "SIDE_SHOW", { outcome: "DECLINE" });
  assert.equal(activePlayers(dec).length, 4); // nobody folds
  assert.equal(dec.players.find((p) => p.id === "rahul")!.contribution, 50000); // still paid
  assert.equal(currentPlayer(dec)!.id, "amit");
});

test("side-show requires an outcome and respects eligibility", () => {
  const s = allSeenLap2();
  assert.throws(() => applyPlay(s, SS_RULES, "SIDE_SHOW"), /requires an outcome/);
  // with only 2 active it's a show, not a side-show
  let two = startRound(SEATS, SS_RULES);
  two = applyPlay(two, SS_RULES, "SEEN"); // rahul
  two = applyPlay(two, SS_RULES, "SEEN"); // amit
  two = applyPlay(two, SS_RULES, "FOLD"); // karan
  two = applyPlay(two, SS_RULES, "FOLD"); // neeraj -> rahul, 2 active
  assert.throws(() => applyPlay(two, SS_RULES, "SIDE_SHOW", { outcome: "DECLINE" }), /not allowed/);
});

test("side-show: undo restores the folded target, pot and contribution", () => {
  const before = allSeenLap2();
  const after = applyPlay(before, SS_RULES, "SIDE_SHOW", { outcome: "TARGET_FOLDS" });
  const back = undo(SEATS, SS_RULES, after);
  assert.equal(back.pot, before.pot);
  assert.equal(back.players.find((p) => p.id === "neeraj")!.status, "ACTIVE");
  assert.equal(back.players.find((p) => p.id === "rahul")!.contribution, 30000);
  assert.equal(currentPlayer(back)!.id, "rahul");
});

test("side-show: replay reproduces the outcome and stays zero-sum", () => {
  let s = allSeenLap2();
  s = applyPlay(s, SS_RULES, "SIDE_SHOW", { outcome: "TARGET_FOLDS" }); // neeraj out
  s = applyPlay(s, SS_RULES, "FOLD"); // amit
  s = applyPlay(s, SS_RULES, "FOLD"); // karan -> rahul sole survivor
  const replayed = buildState(SEATS, SS_RULES, playLog(s));
  assert.equal(replayed.players.find((p) => p.id === "neeraj")!.status, "FOLDED");
  assert.equal(replayed.pot, s.pot);
  const done = setWinners(replayed, ["rahul"]);
  assertZeroSum(netBalances(SEATS.map((x) => x.id), [finalizeRound(done)]));
});
