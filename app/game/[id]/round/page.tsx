"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { Button } from "../../../ui";
import {
  startRound,
  applyPlay,
  undo,
  setWinners,
  buildState,
  playLog,
  availableActions,
  activePlayers,
  currentPlayer,
  blindAmount,
  seenAmount,
  showAmount,
  type Rules,
  type PlayerSeat,
  type RoundState,
  type PlayInput,
  type RoundAction,
} from "@/lib/engine/engine";

type GameRow = { boot_amount: number; currency: string; name: string };
type RulesRow = {
  blind_multiplier: number;
  seen_multiplier: number;
  max_bet: number;
  sideshow_enabled: boolean;
  show_enabled: boolean;
};
type PlayerRow = { id: string; name: string; seat_order: number };

const ACTION_LABEL: Record<PlayInput, string> = {
  BLIND: "Blind",
  SEEN: "Seen",
  SHOW: "Show",
  FOLD: "Fold",
};

export default function RoundRecorder({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="pt-10 text-neutral-500">Loading…</main>}>
      <RoundRecorderInner params={params} />
    </Suspense>
  );
}

function RoundRecorderInner({ params }: { params: Promise<{ id: string }> }) {
  const { id: gameId } = use(params);
  const router = useRouter();
  const editRoundId = useSearchParams().get("edit");

  const [game, setGame] = useState<GameRow | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [seats, setSeats] = useState<PlayerSeat[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [roundNumber, setRoundNumber] = useState<number>(0);

  const [state, setState] = useState<RoundState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = game?.currency ?? "INR";

  // Load game config and start the first round.
  useEffect(() => {
    if (!supabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    (async () => {
      const [g, r, p, last] = await Promise.all([
        supabase.from("games").select("boot_amount,currency,name").eq("id", gameId).single(),
        supabase.from("game_rules").select("*").eq("game_id", gameId).single(),
        supabase.from("players").select("id,name,seat_order").eq("game_id", gameId).order("seat_order"),
        supabase
          .from("rounds")
          .select("round_number")
          .eq("game_id", gameId)
          .order("round_number", { ascending: false })
          .limit(1),
      ]);
      if (g.error || r.error || p.error) {
        setError((g.error || r.error || p.error)!.message);
        return;
      }
      const gr = r.data as RulesRow;
      const engineRules: Rules = {
        bootAmount: (g.data as GameRow).boot_amount,
        blindMultiplier: Number(gr.blind_multiplier),
        seenMultiplier: Number(gr.seen_multiplier),
        maxBet: gr.max_bet,
        sideshowEnabled: gr.sideshow_enabled,
        showEnabled: gr.show_enabled,
      };
      const seatList: PlayerSeat[] = (p.data as PlayerRow[]).map((x) => ({ id: x.id, name: x.name }));

      setGame(g.data as GameRow);
      setRules(engineRules);
      setSeats(seatList);
      setNameById(Object.fromEntries(seatList.map((s) => [s.id, s.name])));

      try {
        if (editRoundId) {
          // Reconstruct an existing round for editing: replay its action log, then
          // re-apply the saved winner(s). Saving keeps the same round_number, so the
          // idempotent save_round RPC replaces it.
          const [rd, ar, wr] = await Promise.all([
            supabase.from("rounds").select("round_number").eq("id", editRoundId).single(),
            supabase
              .from("actions")
              .select("player_id,action_type,sequence")
              .eq("round_id", editRoundId)
              .order("sequence"),
            supabase.from("round_players").select("player_id,status").eq("round_id", editRoundId),
          ]);
          if (rd.error) throw rd.error;
          const log = ((ar.data as { player_id: string; action_type: string }[]) ?? [])
            .filter((a) => a.action_type !== "BOOT")
            .map((a) => ({ playerId: a.player_id, type: a.action_type as PlayInput }));
          let st = buildState(seatList, engineRules, log);
          const winnerIds = ((wr.data as { player_id: string; status: string }[]) ?? [])
            .filter((x) => x.status === "WINNER")
            .map((x) => x.player_id);
          if (winnerIds.length && st.phase === "AWAITING_WINNER") st = setWinners(st, winnerIds);
          setRoundNumber(rd.data!.round_number as number);
          setState(st);
        } else {
          setRoundNumber(((last.data?.[0]?.round_number as number) ?? 0) + 1);
          setState(startRound(seatList, engineRules));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [gameId, editRoundId]);

  function play(type: PlayInput) {
    if (!state || !rules) return;
    setState(applyPlay(state, rules, type));
  }
  function doUndo() {
    if (!state || !rules) return;
    setState(undo(seats, rules, state));
  }
  function chooseWinner(playerIds: string[]) {
    if (!state) return;
    setState(setWinners(state, playerIds));
  }
  function editRound() {
    // Rebuild the pre-winner (AWAITING_WINNER) state from the action log.
    if (!state || !rules) return;
    setState(buildState(seats, rules, playLog(state)));
  }

  async function saveRound() {
    if (!state) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("save_round", {
      p_game_id: gameId,
      p_round_number: roundNumber,
      p_pot: state.pot,
      p_chaal: state.chaal,
      p_round_players: state.players.map((p) => ({
        player_id: p.id,
        status: p.status,
        contribution: p.contribution,
      })),
      p_actions: state.actions.map((a) => ({
        player_id: a.playerId,
        action_type: a.type,
        amount: a.amount,
        resulting_chaal: a.resultingChaal,
        sequence: a.seq,
      })),
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (editRoundId) router.push(`/game/${gameId}`);
    else setSaved(true);
  }

  function nextRound() {
    if (!rules) return;
    setSaved(false);
    setRoundNumber((n) => n + 1);
    setState(startRound(seats, rules));
  }

  if (error) {
    return (
      <main className="space-y-4 pt-10">
        <p className="text-red-400">{error}</p>
        <Link href={`/game/${gameId}`} className="text-neutral-400">
          ← Back to game
        </Link>
      </main>
    );
  }
  if (!state || !rules || !game) return <main className="pt-10 text-neutral-500">Loading…</main>;

  if (saved) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
        <div className="text-2xl font-bold text-amber-400">Round {roundNumber} saved ✓</div>
        <Button className="w-64" onClick={nextRound}>
          Next Round →
        </Button>
        <Link href={`/game/${gameId}`} className="text-neutral-400">
          Back to game
        </Link>
      </main>
    );
  }

  if (state.phase === "AWAITING_WINNER") {
    return (
      <WinnerSelect
        state={state}
        currency={currency}
        onPick={chooseWinner}
        onUndo={doUndo}
      />
    );
  }

  if (state.phase === "COMPLETE") {
    return (
      <RoundSummary
        state={state}
        roundNumber={roundNumber}
        currency={currency}
        nameById={nameById}
        rules={rules}
        saving={saving}
        onSave={saveRound}
        onEdit={editRound}
      />
    );
  }

  // BETTING
  return (
    <GuidedBetting
      state={state}
      rules={rules}
      roundNumber={roundNumber}
      currency={currency}
      nameById={nameById}
      gameId={gameId}
      onPlay={play}
      onUndo={doUndo}
    />
  );
}

function actionSummary(a: RoundAction, currency: string): string {
  if (a.type === "FOLD") return "Fold";
  if (a.type === "BOOT") return `Boot ${formatMoney(a.amount, currency)}`;
  return `${ACTION_LABEL[a.type as PlayInput]} ${formatMoney(a.amount, currency)}`;
}

function GuidedBetting({
  state,
  rules,
  roundNumber,
  currency,
  nameById,
  gameId,
  onPlay,
  onUndo,
}: {
  state: RoundState;
  rules: Rules;
  roundNumber: number;
  currency: string;
  nameById: Record<string, string>;
  gameId: string;
  onPlay: (t: PlayInput) => void;
  onUndo: () => void;
}) {
  const player = currentPlayer(state)!;
  const options = availableActions(state, rules);
  const amount: Record<PlayInput, number> = {
    BLIND: blindAmount(state.chaal, rules),
    SEEN: seenAmount(state.chaal, rules),
    SHOW: showAmount(state.chaal, rules),
    FOLD: 0,
  };
  const history = state.actions.filter((a) => a.type !== "BOOT").slice(-6).reverse();
  const canUndo = playLog(state).length > 0;

  // Brief confirmation of the just-recorded action (fires only when the log grows,
  // so undo doesn't flash). Auto-clears after ~1.1s.
  const [flash, setFlash] = useState<string | null>(null);
  const prevLen = useRef(state.actions.length);
  useEffect(() => {
    const len = state.actions.length;
    if (len > prevLen.current) {
      const a = state.actions[len - 1];
      setFlash(`✓ ${nameById[a.playerId]} — ${actionSummary(a, currency)}`);
      const t = setTimeout(() => setFlash(null), 1100);
      prevLen.current = len;
      return () => clearTimeout(t);
    }
    prevLen.current = len;
  }, [state.actions, nameById, currency]);

  return (
    <main className="flex min-h-dvh flex-col pt-4">
      {flash && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-10 flex justify-center">
          <div className="rounded-full bg-green-500/90 px-5 py-2 text-sm font-semibold text-black shadow-lg">
            {flash}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-neutral-500">
        <Link href={`/game/${gameId}`}>← Game</Link>
        <span>Round {roundNumber}</span>
        <span>{activePlayers(state).length} in the hand</span>
      </div>

      <div className="mt-6 text-center">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Current chaal</div>
        <div className="text-4xl font-bold">{formatMoney(state.chaal, currency)}</div>
      </div>

      <div className="mt-8 text-center">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Player</div>
        <div className="text-5xl font-extrabold text-amber-400">{player.name}</div>
        <div className="mt-1 text-neutral-400">What does {player.name} play?</div>
      </div>

      <div className="mt-6 grid gap-3">
        {options.map((opt) => (
          <Button
            key={opt}
            variant={opt === "FOLD" ? "ghost" : "primary"}
            className="flex w-full items-center justify-between !text-2xl"
            onClick={() => onPlay(opt)}
          >
            <span>{ACTION_LABEL[opt]}</span>
            {opt !== "FOLD" && <span>{formatMoney(amount[opt], currency)}</span>}
          </Button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-lg">
          <span className="text-neutral-500">Pot: </span>
          <span className="font-bold">{formatMoney(state.pot, currency)}</span>
        </div>
        <Button variant="ghost" className="!min-h-12 !text-base" disabled={!canUndo} onClick={onUndo}>
          ↶ Undo
        </Button>
      </div>

      {history.length > 0 && (
        <div className="mt-6 space-y-1 border-t border-neutral-800 pt-4 text-sm text-neutral-400">
          <div className="text-xs uppercase text-neutral-600">Played</div>
          {history.map((a) => (
            <div key={a.seq} className="flex justify-between">
              <span>{nameById[a.playerId]}</span>
              <span>{actionSummary(a, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function WinnerSelect({
  state,
  currency,
  onPick,
  onUndo,
}: {
  state: RoundState;
  currency: string;
  onPick: (ids: string[]) => void;
  onUndo: () => void;
}) {
  const eligible = activePlayers(state);
  const [selected, setSelected] = useState<string[]>([]);
  // Only one active player left (fold-to-one): auto-select them, no tapping needed.
  const forced = eligible.length === 1 ? [eligible[0].id] : selected;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const split = forced.length >= 2;
  const share = split ? Math.floor(state.pot / forced.length) : state.pot;

  return (
    <main className="flex min-h-dvh flex-col pt-10">
      <div className="text-center">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Round complete</div>
        <div className="mt-1 text-xs uppercase text-neutral-500">Pot</div>
        <div className="text-4xl font-bold">{formatMoney(state.pot, currency)}</div>
      </div>
      <div className="mt-8 text-center text-neutral-400">
        Who won? <span className="text-neutral-600">(tap more than one to split)</span>
      </div>
      <div className="mt-4 grid gap-3">
        {eligible.map((p) => {
          const on = forced.includes(p.id);
          return (
            <Button
              key={p.id}
              variant={on ? "primary" : "ghost"}
              className="flex w-full items-center justify-between !text-2xl"
              onClick={() => eligible.length > 1 && toggle(p.id)}
            >
              <span>{p.name}</span>
              {on && <span className="text-base">{split ? "split" : "✓"}</span>}
            </Button>
          );
        })}
      </div>

      <Button
        className="mt-6 w-full"
        disabled={forced.length === 0}
        onClick={() => onPick(forced)}
      >
        {forced.length >= 2
          ? `Split — ${formatMoney(share, currency)} each`
          : "Declare Winner"}
      </Button>
      <Button variant="ghost" className="mt-3 !min-h-12 !text-base" onClick={onUndo}>
        ↶ Undo last action
      </Button>
    </main>
  );
}

function RoundSummary({
  state,
  roundNumber,
  currency,
  nameById,
  rules,
  saving,
  onSave,
  onEdit,
}: {
  state: RoundState;
  roundNumber: number;
  currency: string;
  nameById: Record<string, string>;
  rules: Rules;
  saving: boolean;
  onSave: () => void;
  onEdit: () => void;
}) {
  const winners = state.players.filter((p) => p.status === "WINNER");
  function tag(pid: string): string {
    const p = state.players.find((x) => x.id === pid)!;
    if (p.status === "WINNER") return "Won";
    if (p.status === "FOLDED") return "Folded";
    return p.hasSeen ? "Seen" : "Blind";
  }
  return (
    <main className="space-y-5 pt-8">
      <div className="text-center">
        <div className="text-xs uppercase text-neutral-500">Round {roundNumber}</div>
        <div className="mt-2 text-xs uppercase text-neutral-500">Winner</div>
        <div className="text-3xl font-bold text-amber-400">
          {winners.map((w) => w.name).join(", ")}
        </div>
        <div className="mt-2 text-xs uppercase text-neutral-500">Pot</div>
        <div className="text-3xl font-bold">{formatMoney(state.pot, currency)}</div>
      </div>

      <div className="space-y-1 rounded-2xl bg-neutral-900 p-4">
        {state.players.map((p) => (
          <div key={p.id} className="flex justify-between text-neutral-300">
            <span>
              {nameById[p.id]} <span className="text-neutral-500">({tag(p.id)})</span>
            </span>
            <span>{formatMoney(p.contribution, currency)} in</span>
          </div>
        ))}
      </div>

      <Button className="w-full" disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : "Save Round"}
      </Button>
      <Button variant="ghost" className="w-full" disabled={saving} onClick={onEdit}>
        Edit
      </Button>
    </main>
  );
}
