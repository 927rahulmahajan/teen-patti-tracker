"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { Button } from "./ui";

type GameRow = { id: string; name: string; status: string; created_at: string };

export default function Home() {
  const [games, setGames] = useState<GameRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase
      .from("games")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setGames(data ?? []);
      });
  }, []);

  return (
    <main className="space-y-6 pt-10">
      <h1 className="text-3xl font-bold">Teen Patti</h1>

      {!supabaseConfigured && (
        <p className="rounded-2xl bg-neutral-900 p-4 text-sm text-amber-400">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then run the migrations in
          supabase/migrations.
        </p>
      )}

      <Link href="/new" className="block">
        <Button className="w-full">+ New Game</Button>
      </Link>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {games.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-400">Recent games</h2>
          {games.map((g) => (
            <Link
              key={g.id}
              href={`/game/${g.id}`}
              className="flex items-center justify-between rounded-2xl bg-neutral-900 p-4"
            >
              <span className="text-lg font-medium">{g.name}</span>
              <span className="text-xs uppercase text-neutral-500">{g.status}</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
