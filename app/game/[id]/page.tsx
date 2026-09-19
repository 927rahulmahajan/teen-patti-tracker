"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { loadLedger, type Ledger } from "@/lib/ledger";
import { Button } from "../../ui";

type Game = { name: string; currency: string; boot_amount: number; status: string };

export default function GameDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [game, setGame] = useState<Game | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    (async () => {
      try {
        const g = await supabase.from("games").select("*").eq("id", id).single();
        if (g.error) throw g.error;
        setGame(g.data as Game);
        setLedger(await loadLedger(id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error) return <main className="pt-10 text-red-400">{error}</main>;
  if (!game || !ledger) return <main className="pt-10 text-neutral-500">Loading…</main>;

  const currency = game.currency;
  const nameById = Object.fromEntries(ledger.players.map((p) => [p.id, p.name]));
  const completeCount = ledger.results.length;
  const ranked = [...ledger.players].sort(
    (a, b) => (ledger.balances[b.id] ?? 0) - (ledger.balances[a.id] ?? 0),
  );

  return (
    <main className="space-y-6 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-neutral-400">
            ←
          </Link>
          <h1 className="text-2xl font-bold">{game.name}</h1>
        </div>
        {game.status !== "ACTIVE" && (
          <span className="text-xs uppercase text-neutral-500">{game.status}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-2xl bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{completeCount}</div>
          <div className="text-xs uppercase text-neutral-500">Rounds</div>
        </div>
        <div className="rounded-2xl bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{formatMoney(ledger.totalPot, currency)}</div>
          <div className="text-xs uppercase text-neutral-500">Total pot</div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-400">Balances</h2>
        {ranked.map((p) => {
          const bal = ledger.balances[p.id] ?? 0;
          return (
            <div key={p.id} className="flex justify-between rounded-2xl bg-neutral-900 p-4 text-lg">
              <span>{p.name}</span>
              <span className={bal > 0 ? "text-green-400" : bal < 0 ? "text-red-400" : "text-neutral-400"}>
                {bal > 0 ? "+" : ""}
                {formatMoney(bal, currency)}
              </span>
            </div>
          );
        })}
      </section>

      {game.status === "ACTIVE" && (
        <Link href={`/game/${id}/round`} className="block">
          <Button className="w-full">Record Round →</Button>
        </Link>
      )}

      {completeCount > 0 && (
        <Link href={`/game/${id}/settle`} className="block">
          <Button variant="ghost" className="w-full">
            {game.status === "ACTIVE" ? "End Game & Settle" : "View Settlement"}
          </Button>
        </Link>
      )}

      {ledger.rounds.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-400">Rounds</h2>
          {ledger.rounds.map((r) => {
            const winnerIds = ledger.winnersByRound[r.id] ?? [];
            return (
              <Link
                key={r.id}
                href={`/game/${id}/rounds/${r.id}`}
                className="flex items-center justify-between rounded-2xl bg-neutral-900 p-4"
              >
                <span>
                  Round {r.round_number}
                  {winnerIds.length > 0 && (
                    <span className="text-neutral-500"> · {winnerIds.map((w) => nameById[w]).join(", ")}</span>
                  )}
                </span>
                <span className="text-neutral-400">{formatMoney(r.pot_amount, currency)}</span>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
