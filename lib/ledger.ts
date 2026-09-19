import { supabase } from "./supabase";
import { netBalances, type RoundResult } from "./engine/engine";

export type PlayerRow = { id: string; name: string; seat_order: number };
export type RoundRow = { id: string; round_number: number; pot_amount: number; status: string };

export interface Ledger {
  players: PlayerRow[];
  rounds: RoundRow[]; // all rounds, newest-first for display
  results: RoundResult[]; // COMPLETE rounds only, for balance math
  winnersByRound: Record<string, string[]>; // round_id -> winner player_ids
  balances: Record<string, number>; // player_id -> net (minor units), always sums to 0
  totalPot: number;
}

// Everything the dashboard/settlement need. Balances are derived purely from
// round_players + rounds (never a stored balance), so any round edit/delete
// automatically reflows here.
export async function loadLedger(gameId: string): Promise<Ledger> {
  const [pRes, rRes] = await Promise.all([
    supabase.from("players").select("id,name,seat_order").eq("game_id", gameId).order("seat_order"),
    supabase
      .from("rounds")
      .select("id,round_number,pot_amount,status")
      .eq("game_id", gameId)
      .order("round_number", { ascending: false }),
  ]);
  if (pRes.error) throw pRes.error;
  if (rRes.error) throw rRes.error;

  const players = (pRes.data ?? []) as PlayerRow[];
  const rounds = (rRes.data ?? []) as RoundRow[];
  const completeIds = rounds.filter((r) => r.status === "COMPLETE").map((r) => r.id);

  let rp: { round_id: string; player_id: string; status: string; contribution: number }[] = [];
  if (completeIds.length) {
    const rpRes = await supabase
      .from("round_players")
      .select("round_id,player_id,status,contribution")
      .in("round_id", completeIds);
    if (rpRes.error) throw rpRes.error;
    rp = rpRes.data ?? [];
  }

  const winnersByRound: Record<string, string[]> = {};
  const results: RoundResult[] = rounds
    .filter((r) => r.status === "COMPLETE")
    .map((r) => {
      const rows = rp.filter((x) => x.round_id === r.id);
      const contributions: Record<string, number> = {};
      const winners: string[] = [];
      for (const row of rows) {
        contributions[row.player_id] = row.contribution;
        if (row.status === "WINNER") winners.push(row.player_id);
      }
      winnersByRound[r.id] = winners;
      return { contributions, winners, pot: r.pot_amount };
    });

  const balances = netBalances(players.map((p) => p.id), results);
  const totalPot = results.reduce((sum, r) => sum + r.pot, 0);

  return { players, rounds, results, winnersByRound, balances, totalPot };
}
