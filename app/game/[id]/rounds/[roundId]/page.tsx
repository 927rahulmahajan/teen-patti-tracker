"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { Button } from "../../../../ui";

type Round = { round_number: number; pot_amount: number; currency?: string };
type ActionRow = {
  player_id: string;
  action_type: string;
  amount: number;
  sequence: number;
};
type RP = { player_id: string; status: string; contribution: number };

const LABEL: Record<string, string> = {
  BOOT: "Boot",
  BLIND: "Blind",
  SEEN: "Seen",
  SHOW: "Show",
  SIDE_SHOW: "Side-show",
  FOLD: "Fold",
};

export default function RoundDetail({ params }: { params: Promise<{ id: string; roundId: string }> }) {
  const { id: gameId, roundId } = use(params);
  const router = useRouter();
  const [round, setRound] = useState<Round | null>(null);
  const [currency, setCurrency] = useState("INR");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [players, setPlayers] = useState<RP[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    (async () => {
      try {
        const [r, a, rp, g] = await Promise.all([
          supabase.from("rounds").select("round_number,pot_amount,game_id").eq("id", roundId).single(),
          supabase.from("actions").select("player_id,action_type,amount,sequence").eq("round_id", roundId).order("sequence"),
          supabase.from("round_players").select("player_id,status,contribution").eq("round_id", roundId),
          supabase.from("games").select("currency").eq("id", gameId).single(),
        ]);
        if (r.error) throw r.error;
        const pl = await supabase.from("players").select("id,name").eq("game_id", gameId);
        setRound(r.data as Round);
        setCurrency((g.data?.currency as string) ?? "INR");
        setActions((a.data as ActionRow[]) ?? []);
        setPlayers((rp.data as RP[]) ?? []);
        setNameById(Object.fromEntries(((pl.data as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name])));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [gameId, roundId]);

  async function del() {
    setDeleting(true);
    const { error } = await supabase.from("rounds").delete().eq("id", roundId);
    setDeleting(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/game/${gameId}`);
  }

  if (error) return <main className="pt-10 text-red-400">{error}</main>;
  if (!round) return <main className="pt-10 text-neutral-500">Loading…</main>;

  const winners = players.filter((p) => p.status === "WINNER").map((p) => nameById[p.player_id]);
  // Show non-boot actions in play order (boots are just the ante).
  const plays = actions.filter((a) => a.action_type !== "BOOT");

  return (
    <main className="space-y-5 pt-6">
      <div className="flex items-center gap-3">
        <Link href={`/game/${gameId}`} className="text-neutral-400">
          ←
        </Link>
        <h1 className="text-2xl font-bold">Round {round.round_number}</h1>
      </div>

      <div className="space-y-1 rounded-2xl bg-neutral-900 p-4">
        {plays.map((a) => (
          <div key={a.sequence} className="flex justify-between text-neutral-300">
            <span>{nameById[a.player_id]}</span>
            <span>
              {LABEL[a.action_type]}
              {a.action_type !== "FOLD" && ` ${formatMoney(a.amount, currency)}`}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-between rounded-2xl bg-neutral-900 p-4 text-lg">
        <span className="text-neutral-500">Winner</span>
        <span className="font-bold text-amber-400">{winners.join(", ") || "—"}</span>
      </div>
      <div className="flex justify-between rounded-2xl bg-neutral-900 p-4 text-lg">
        <span className="text-neutral-500">Pot</span>
        <span className="font-bold">{formatMoney(round.pot_amount, currency)}</span>
      </div>

      <Link href={`/game/${gameId}/round?edit=${roundId}`} className="block">
        <Button className="w-full">Edit Round</Button>
      </Link>

      {confirmDelete ? (
        <div className="space-y-2">
          <p className="text-center text-sm text-neutral-400">
            Delete round {round.round_number}? Balances will recalculate.
          </p>
          <Button variant="danger" className="w-full" disabled={deleting} onClick={del}>
            {deleting ? "Deleting…" : "Confirm Delete"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)}>
          Delete Round
        </Button>
      )}
    </main>
  );
}
