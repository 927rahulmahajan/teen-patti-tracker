"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { formatMoney } from "@/lib/money";
import { loadLedger, type Ledger } from "@/lib/ledger";
import { settlement, assertZeroSum, type Transfer } from "@/lib/engine/engine";
import { Button } from "../../../ui";

type Game = { name: string; currency: string; status: string };

export default function Settle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [game, setGame] = useState<Game | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    (async () => {
      try {
        const g = await supabase.from("games").select("name,currency,status").eq("id", id).single();
        if (g.error) throw g.error;
        setGame(g.data as Game);
        const l = await loadLedger(id);
        setLedger(l);
        assertZeroSum(l.balances); // never render an unbalanced settlement
        setTransfers(settlement(l.balances));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  async function endGame() {
    setEnding(true);
    const { error } = await supabase
      .from("games")
      .update({ status: "ENDED", ended_at: new Date().toISOString() })
      .eq("id", id);
    setEnding(false);
    if (error) {
      setError(error.message);
      return;
    }
    setGame((g) => (g ? { ...g, status: "ENDED" } : g));
  }

  if (error) return <main className="pt-10 text-red-400">{error}</main>;
  if (!game || !ledger || !transfers) return <main className="pt-10 text-neutral-500">Loading…</main>;

  const currency = game.currency;
  const nameById = Object.fromEntries(ledger.players.map((p) => [p.id, p.name]));
  const ranked = [...ledger.players].sort(
    (a, b) => (ledger.balances[b.id] ?? 0) - (ledger.balances[a.id] ?? 0),
  );

  return (
    <main className="space-y-6 pt-6">
      <div className="flex items-center gap-3">
        <Link href={`/game/${id}`} className="text-neutral-400">
          ←
        </Link>
        <h1 className="text-2xl font-bold">Settlement</h1>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-400">Net balances</h2>
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

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-400">Who pays whom</h2>
        {transfers.length === 0 ? (
          <p className="rounded-2xl bg-neutral-900 p-4 text-neutral-400">All square — nothing to settle.</p>
        ) : (
          transfers.map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl bg-neutral-900 p-4 text-lg">
              <span>
                <span className="text-red-400">{nameById[t.from]}</span>
                <span className="text-neutral-500"> → </span>
                <span className="text-green-400">{nameById[t.to]}</span>
              </span>
              <span className="font-bold">{formatMoney(t.amount, currency)}</span>
            </div>
          ))
        )}
      </section>

      {game.status === "ACTIVE" ? (
        <Button className="w-full" disabled={ending} onClick={endGame}>
          {ending ? "Ending…" : "End Game"}
        </Button>
      ) : (
        <p className="text-center text-sm text-neutral-500">Game ended.</p>
      )}
    </main>
  );
}
