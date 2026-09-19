"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { CURRENCIES, toMinor } from "@/lib/money";
import { Button, Input, Field, Toggle } from "../ui";

export default function NewGame() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [boot, setBoot] = useState("100");
  const [blindMult, setBlindMult] = useState("1");
  const [seenMult, setSeenMult] = useState("2");
  const [maxBet, setMaxBet] = useState(""); // blank = no cap
  const [sideshow, setSideshow] = useState(false);
  const [show, setShow] = useState(true);
  const [players, setPlayers] = useState<string[]>(["", ""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namedPlayers = players.map((p) => p.trim()).filter(Boolean);
  const bootMinor = toMinor(boot);
  const valid =
    name.trim().length > 0 &&
    bootMinor !== null &&
    bootMinor > 0 &&
    Number(blindMult) > 0 &&
    Number(seenMult) > 0 &&
    namedPlayers.length >= 2;

  function setPlayer(i: number, v: string) {
    setPlayers((ps) => ps.map((p, j) => (j === i ? v : p)));
  }

  async function create() {
    setError(null);
    if (!supabaseConfigured) {
      setError("Supabase is not configured.");
      return;
    }
    const maxBetMinor = maxBet.trim() === "" ? 0 : toMinor(maxBet);
    if (maxBetMinor === null) {
      setError("Max bet is not a valid amount.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("create_game", {
      p_name: name.trim(),
      p_currency: currency,
      p_boot_amount: bootMinor,
      p_blind_multiplier: Number(blindMult),
      p_seen_multiplier: Number(seenMult),
      p_max_bet: maxBetMinor,
      p_sideshow_enabled: sideshow,
      p_show_enabled: show,
      p_players: namedPlayers,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/game/${data}`);
  }

  return (
    <main className="space-y-6 pt-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-neutral-400">
          ←
        </Link>
        <h1 className="text-2xl font-bold">New Game</h1>
      </div>

      <Field label="Game name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday night" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="min-h-14 w-full rounded-2xl bg-neutral-800 px-4 text-lg text-neutral-100 outline-none focus:ring-2 focus:ring-amber-400"
          >
            {Object.keys(CURRENCIES).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Boot amount">
          <Input
            inputMode="decimal"
            value={boot}
            onChange={(e) => setBoot(e.target.value)}
            placeholder="100"
          />
        </Field>
      </div>

      <section className="space-y-3 rounded-2xl bg-neutral-900 p-4">
        <h2 className="text-sm font-medium text-neutral-400">Rules</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Blind ×chaal">
            <Input inputMode="decimal" value={blindMult} onChange={(e) => setBlindMult(e.target.value)} />
          </Field>
          <Field label="Seen ×chaal">
            <Input inputMode="decimal" value={seenMult} onChange={(e) => setSeenMult(e.target.value)} />
          </Field>
        </div>
        <Field label="Max bet (blank = none)">
          <Input inputMode="decimal" value={maxBet} onChange={(e) => setMaxBet(e.target.value)} placeholder="none" />
        </Field>
        <Toggle checked={show} onChange={setShow} label="Show enabled" />
        <Toggle checked={sideshow} onChange={setSideshow} label="Side-show enabled" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-400">
          Players ({namedPlayers.length})
        </h2>
        {players.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={p}
              onChange={(e) => setPlayer(i, e.target.value)}
              placeholder={`Player ${i + 1}`}
            />
            {players.length > 2 && (
              <Button
                variant="danger"
                className="w-14 px-0"
                onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            )}
          </div>
        ))}
        <Button variant="ghost" className="w-full" onClick={() => setPlayers((ps) => [...ps, ""])}>
          + Add player
        </Button>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button className="w-full" disabled={!valid || saving} onClick={create}>
        {saving ? "Creating…" : "Start Game"}
      </Button>
    </main>
  );
}
