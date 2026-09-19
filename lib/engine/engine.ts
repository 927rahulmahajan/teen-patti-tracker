// Teen Patti offline cash-game engine.
// Pure TypeScript. No React, no I/O. All money is integer minor units (paise).
//
// Design decisions locked in Phase 1 (see spec review):
//  - Money is integer minor units everywhere. Fractional results throw.
//  - `amount` on an action = money added to the pot by THAT action.
//  - MVP has NO raise: blind = chaal x blindMultiplier, seen = chaal x seenMultiplier,
//    and chaal is CONSTANT for the round (nextChaal is the pluggable hook for variants).
//  - Betting cycles through active players in laps until fold-to-one or a SHOW.
//  - SEEN is sticky: once seen, a player can no longer play BLIND.
//  - Boots are atomic round setup, not individually undoable.
//  - Undo = drop the last player action and replay (single source of truth = action log).

export type PlayerId = string;
export type ActionType = "BOOT" | "BLIND" | "SEEN" | "FOLD" | "SHOW" | "SIDE_SHOW";
export type PlayerStatus = "ACTIVE" | "FOLDED" | "WINNER";
export type Phase = "BETTING" | "AWAITING_WINNER" | "COMPLETE";
export type PlayInput = "BLIND" | "SEEN" | "FOLD" | "SHOW" | "SIDE_SHOW";

// Resolution of a requested side-show, entered by the recorder (the app can't
// see the cards). The requester always pays the request cost regardless.
export type SideShowOutcome =
  | "DECLINE" // target refuses; both stay in, play continues
  | "TARGET_FOLDS" // compared, target had the weaker hand
  | "REQUESTER_FOLDS"; // compared, requester had the weaker hand

export interface Rules {
  bootAmount: number; // minor units, per player, paid at round start
  blindMultiplier: number;
  seenMultiplier: number;
  maxBet: number; // inert in MVP (no raise can trigger it); kept for variants
  sideshowEnabled: boolean; // a seen player may request a side-show vs the previous seen player
  showEnabled: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  status: PlayerStatus;
  hasSeen: boolean;
  contribution: number; // cache: sum of this player's action amounts this round
}

export interface RoundAction {
  seq: number;
  playerId: PlayerId;
  type: ActionType;
  amount: number; // money added to pot by this action
  resultingChaal: number;
  targetId?: PlayerId; // side-show only: the player asked to compare
  outcome?: SideShowOutcome; // side-show only
}

export interface RoundState {
  players: PlayerState[]; // seating order; index 0 acts first
  chaal: number;
  pot: number;
  currentPlayerId: PlayerId | null; // whose turn; null once betting is over
  actions: RoundAction[];
  winners: PlayerId[];
  phase: Phase;
}

// The persisted, replayable shape of a decision. Boots are implicit (regenerated on replay).
export interface PlayLog {
  playerId: PlayerId;
  type: PlayInput;
  outcome?: SideShowOutcome; // side-show only (the target is recomputed on replay)
}

export interface PlayerSeat {
  id: PlayerId;
  name: string;
}

// ---- amount / chaal rules (the only place these formulas live) ----

function assertInt(n: number, label: string): number {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer minor-unit amount, got ${n}`);
  return n;
}

export function blindAmount(chaal: number, rules: Rules): number {
  return assertInt(chaal * rules.blindMultiplier, "blind amount");
}

export function seenAmount(chaal: number, rules: Rules): number {
  return assertInt(chaal * rules.seenMultiplier, "seen amount");
}

// SHOW cost = a seen bet. Pluggable target for variants.
export function showAmount(chaal: number, rules: Rules): number {
  return seenAmount(chaal, rules);
}

// Requesting a side-show costs a seen bet (the requester is seen). Pluggable.
export function sideShowAmount(chaal: number, rules: Rules): number {
  return seenAmount(chaal, rules);
}

// MVP: chaal never changes mid-round. Variants (raises) replace this.
// ponytail: constant chaal, swap this fn when raise support lands.
export function nextChaal(chaal: number, _action: ActionType): number {
  return chaal;
}

// ---- selectors ----

export function activePlayers(state: RoundState): PlayerState[] {
  return state.players.filter((p) => p.status === "ACTIVE");
}

export function currentPlayer(state: RoundState): PlayerState | null {
  if (!state.currentPlayerId) return null;
  return state.players.find((p) => p.id === state.currentPlayerId) ?? null;
}

export function canShow(state: RoundState, rules: Rules): boolean {
  return rules.showEnabled && activePlayers(state).length === 2;
}

// The player a side-show would be requested against: the immediately preceding
// active player, but only if they have seen their cards (you can't side-show a
// blind player). null if not eligible.
export function sideShowTarget(state: RoundState): PlayerId | null {
  const cur = currentPlayer(state);
  if (!cur) return null;
  const prevId = previousActiveId(state, cur.id);
  if (!prevId) return null;
  const prev = state.players.find((p) => p.id === prevId)!;
  return prev.hasSeen ? prevId : null;
}

// A seen player may request a side-show vs the previous seen player, only while
// more than 2 players remain (with exactly 2, it's a SHOW).
export function canSideShow(state: RoundState, rules: Rules): boolean {
  const p = currentPlayer(state);
  return (
    rules.sideshowEnabled &&
    !!p &&
    p.hasSeen &&
    activePlayers(state).length > 2 &&
    sideShowTarget(state) !== null
  );
}

// Options the UI should render for the current player.
export function availableActions(state: RoundState, rules: Rules): PlayInput[] {
  const p = currentPlayer(state);
  if (!p || state.phase !== "BETTING") return [];
  const opts: PlayInput[] = [];
  if (!p.hasSeen) opts.push("BLIND");
  opts.push("SEEN");
  if (canSideShow(state, rules)) opts.push("SIDE_SHOW");
  if (canShow(state, rules)) opts.push("SHOW");
  opts.push("FOLD");
  return opts;
}

// ---- construction & transitions ----

export function startRound(seats: PlayerSeat[], rules: Rules): RoundState {
  if (seats.length < 2) throw new Error("A round needs at least 2 players");
  if (!Number.isInteger(rules.bootAmount) || rules.bootAmount <= 0) {
    throw new Error("bootAmount must be a positive integer minor-unit amount");
  }
  const players: PlayerState[] = seats.map((s) => ({
    id: s.id,
    name: s.name,
    status: "ACTIVE",
    hasSeen: false,
    contribution: rules.bootAmount,
  }));
  const actions: RoundAction[] = seats.map((s, i) => ({
    seq: i,
    playerId: s.id,
    type: "BOOT",
    amount: rules.bootAmount,
    resultingChaal: rules.bootAmount,
  }));
  return {
    players,
    chaal: rules.bootAmount,
    pot: rules.bootAmount * seats.length,
    currentPlayerId: players[0].id,
    actions,
    winners: [],
    phase: "BETTING",
  };
}

function nextActiveId(state: RoundState, fromId: PlayerId): PlayerId | null {
  const n = state.players.length;
  const start = state.players.findIndex((p) => p.id === fromId);
  for (let step = 1; step <= n; step++) {
    const p = state.players[(start + step) % n];
    if (p.status === "ACTIVE") return p.id;
  }
  return null;
}

function previousActiveId(state: RoundState, fromId: PlayerId): PlayerId | null {
  const n = state.players.length;
  const start = state.players.findIndex((p) => p.id === fromId);
  for (let step = 1; step <= n; step++) {
    const p = state.players[(start - step + n) % n];
    if (p.status === "ACTIVE") return p.id;
  }
  return null;
}

// Apply one player decision to the CURRENT player. Pure: returns a new state.
// `detail.outcome` is required for SIDE_SHOW (the recorder enters the result).
export function applyPlay(
  state: RoundState,
  rules: Rules,
  type: PlayInput,
  detail?: { outcome?: SideShowOutcome },
): RoundState {
  if (state.phase !== "BETTING") throw new Error(`Cannot play in phase ${state.phase}`);
  const player = currentPlayer(state);
  if (!player) throw new Error("No current player");
  if (type === "BLIND" && player.hasSeen) throw new Error("A player who has seen cannot play blind");
  if (type === "SHOW" && !canShow(state, rules)) {
    throw new Error("SHOW is only allowed with exactly 2 active players and show enabled");
  }

  if (type === "SIDE_SHOW") return applySideShow(state, rules, player.id, detail?.outcome);

  let amount = 0;
  if (type === "BLIND") amount = blindAmount(state.chaal, rules);
  else if (type === "SEEN") amount = seenAmount(state.chaal, rules);
  else if (type === "SHOW") amount = showAmount(state.chaal, rules);
  // FOLD: amount stays 0

  const chaal = type === "FOLD" ? state.chaal : nextChaal(state.chaal, type);

  const players = state.players.map((p) => {
    if (p.id !== player.id) return p;
    return {
      ...p,
      status: (type === "FOLD" ? "FOLDED" : "ACTIVE") as PlayerStatus,
      hasSeen: p.hasSeen || type === "SEEN" || type === "SHOW",
      contribution: p.contribution + amount,
    };
  });

  const action: RoundAction = {
    seq: state.actions.length,
    playerId: player.id,
    type,
    amount,
    resultingChaal: chaal,
  };

  const next: RoundState = {
    ...state,
    players,
    chaal,
    pot: state.pot + amount,
    actions: [...state.actions, action],
  };

  const active = activePlayers(next);
  if (type === "SHOW" || active.length <= 1) {
    // Betting is over: go to winner selection.
    return { ...next, phase: "AWAITING_WINNER", currentPlayerId: null };
  }
  return { ...next, currentPlayerId: nextActiveId(next, player.id) };
}

// Side-show: the requester (current player) pays the request cost regardless of
// outcome; on a compare the loser folds. Play then continues after the requester.
function applySideShow(
  state: RoundState,
  rules: Rules,
  requesterId: PlayerId,
  outcome: SideShowOutcome | undefined,
): RoundState {
  if (!canSideShow(state, rules)) {
    throw new Error("Side-show not allowed here (needs a seen requester, a seen previous player, and >2 active)");
  }
  if (!outcome) throw new Error("Side-show requires an outcome");
  const targetId = sideShowTarget(state)!;
  const amount = sideShowAmount(state.chaal, rules);
  const folderId =
    outcome === "TARGET_FOLDS" ? targetId : outcome === "REQUESTER_FOLDS" ? requesterId : null;

  const players = state.players.map((p) => {
    if (p.id === requesterId) return { ...p, contribution: p.contribution + amount };
    return p;
  }).map((p) => (p.id === folderId ? { ...p, status: "FOLDED" as PlayerStatus } : p));

  const action: RoundAction = {
    seq: state.actions.length,
    playerId: requesterId,
    type: "SIDE_SHOW",
    amount,
    resultingChaal: state.chaal, // side-show never changes the chaal
    targetId,
    outcome,
  };

  const next: RoundState = { ...state, players, pot: state.pot + amount, actions: [...state.actions, action] };
  if (activePlayers(next).length <= 1) {
    return { ...next, phase: "AWAITING_WINNER", currentPlayerId: null };
  }
  return { ...next, currentPlayerId: nextActiveId(next, requesterId) };
}

// Replay a full log from scratch (used by play() and undo() so there is one code path).
export function buildState(seats: PlayerSeat[], rules: Rules, log: PlayLog[]): RoundState {
  let state = startRound(seats, rules);
  for (const entry of log) {
    if (state.currentPlayerId !== entry.playerId) {
      throw new Error(`Log out of order: expected ${state.currentPlayerId}, got ${entry.playerId}`);
    }
    state = applyPlay(state, rules, entry.type, { outcome: entry.outcome });
  }
  return state;
}

// Extract the replayable player-decision log (boots excluded — they are implicit setup).
export function playLog(state: RoundState): PlayLog[] {
  return state.actions
    .filter((a) => a.type !== "BOOT")
    .map((a) => ({ playerId: a.playerId, type: a.type as PlayInput, outcome: a.outcome }));
}

// Undo the last player decision. Boots are never undone; no-op safe when nothing to undo.
export function undo(seats: PlayerSeat[], rules: Rules, state: RoundState): RoundState {
  const log = playLog(state);
  if (log.length === 0) return state;
  return buildState(seats, rules, log.slice(0, -1));
}

export function setWinners(state: RoundState, winnerIds: PlayerId[]): RoundState {
  if (state.phase !== "AWAITING_WINNER") throw new Error(`Cannot set winners in phase ${state.phase}`);
  if (winnerIds.length === 0) throw new Error("At least one winner required");
  const eligible = new Set(activePlayers(state).map((p) => p.id));
  const seen = new Set<PlayerId>();
  for (const id of winnerIds) {
    if (!eligible.has(id)) throw new Error(`Winner ${id} is not an active player`);
    if (seen.has(id)) throw new Error(`Duplicate winner ${id}`);
    seen.add(id);
  }
  const players = state.players.map((p) =>
    seen.has(p.id) ? { ...p, status: "WINNER" as PlayerStatus } : p,
  );
  return { ...state, players, winners: [...winnerIds], phase: "COMPLETE", currentPlayerId: null };
}

// ---- ledger (derivable entirely from completed rounds) ----

export interface RoundResult {
  contributions: Record<PlayerId, number>; // per player, this round (incl. boot)
  winners: PlayerId[];
  pot: number;
}

export function finalizeRound(state: RoundState): RoundResult {
  if (state.phase !== "COMPLETE") throw new Error("Round is not complete");
  const contributions: Record<PlayerId, number> = {};
  for (const p of state.players) contributions[p.id] = p.contribution;
  return { contributions, winners: [...state.winners], pot: state.pot };
}

// Split a pot among winners in integer minor units; remainder goes to earliest winner(s)
// so the total paid out always equals the pot exactly (protects zero-sum).
export function splitPot(pot: number, winners: PlayerId[]): Record<PlayerId, number> {
  if (winners.length === 0) throw new Error("No winners to split pot");
  const base = Math.floor(pot / winners.length);
  let remainder = pot - base * winners.length;
  const out: Record<PlayerId, number> = {};
  for (const id of winners) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return out;
}

export function netBalances(playerIds: PlayerId[], rounds: RoundResult[]): Record<PlayerId, number> {
  const net: Record<PlayerId, number> = {};
  for (const id of playerIds) net[id] = 0;
  for (const r of rounds) {
    for (const id of Object.keys(r.contributions)) {
      if (!(id in net)) net[id] = 0;
      net[id] -= r.contributions[id];
    }
    const payouts = splitPot(r.pot, r.winners);
    for (const id of Object.keys(payouts)) {
      if (!(id in net)) net[id] = 0;
      net[id] += payouts[id];
    }
  }
  return net;
}

export function assertZeroSum(net: Record<PlayerId, number>): void {
  const sum = Object.values(net).reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`Balances do not sum to zero (got ${sum})`);
}

// ---- settlement ----

export interface Transfer {
  from: PlayerId;
  to: PlayerId;
  amount: number;
}

// Greedy largest-debtor -> largest-creditor. Bounded at <= n-1 transfers; near-minimal.
// ponytail: true minimum is subset-sum (NP-hard); greedy is the right call here.
export function settlement(net: Record<PlayerId, number>): Transfer[] {
  assertZeroSum(net);
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amt: -v }));
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amt: v }));
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}
