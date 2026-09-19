-- Persist a completed round atomically: round + round_players + actions in one txn.
-- The engine (lib/engine) has already derived pot, chaal, per-player contribution
-- and status; this just writes those rows.
-- Idempotent on (game_id, round_number): re-saving the same number REPLACES the
-- round (cascade clears its children), so editing a round is just a re-save.
create or replace function save_round(
  p_game_id       uuid,
  p_round_number  int,
  p_pot           bigint,
  p_chaal         bigint,
  p_round_players jsonb,  -- [{player_id, status, contribution}]
  p_actions       jsonb   -- [{player_id, action_type, amount, resulting_chaal, sequence}]
) returns uuid
language plpgsql
as $$
declare
  v_round_id uuid;
begin
  delete from rounds where game_id = p_game_id and round_number = p_round_number;

  insert into rounds (game_id, round_number, status, pot_amount, current_chaal)
    values (p_game_id, p_round_number, 'COMPLETE', p_pot, p_chaal)
    returning id into v_round_id;

  insert into round_players (round_id, player_id, status, contribution)
    select v_round_id, x.player_id, x.status, x.contribution
    from jsonb_to_recordset(p_round_players)
      as x(player_id uuid, status text, contribution bigint);

  insert into actions (round_id, player_id, action_type, amount, resulting_chaal, sequence)
    select v_round_id, a.player_id, a.action_type, a.amount, a.resulting_chaal, a.sequence
    from jsonb_to_recordset(p_actions)
      as a(player_id uuid, action_type text, amount bigint, resulting_chaal bigint, sequence int);

  return v_round_id;
end;
$$;
