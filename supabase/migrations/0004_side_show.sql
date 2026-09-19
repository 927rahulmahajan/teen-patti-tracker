-- Side-show support. A SIDE_SHOW action needs two extra facts to be replayable
-- on edit: who it was requested against, and how it resolved (the recorder's
-- input, since the app can't see the cards). Nullable — only side-show rows use them.
alter table actions
  add column target_player_id uuid references players(id) on delete cascade,
  add column resolution text check (resolution in ('DECLINE', 'TARGET_FOLDS', 'REQUESTER_FOLDS'));

-- Re-create save_round to also persist the two side-show fields.
create or replace function save_round(
  p_game_id       uuid,
  p_round_number  int,
  p_pot           bigint,
  p_chaal         bigint,
  p_round_players jsonb,
  p_actions       jsonb  -- [{player_id, action_type, amount, resulting_chaal, sequence, target_player_id?, resolution?}]
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

  insert into actions (round_id, player_id, action_type, amount, resulting_chaal, sequence, target_player_id, resolution)
    select v_round_id, a.player_id, a.action_type, a.amount, a.resulting_chaal, a.sequence, a.target_player_id, a.resolution
    from jsonb_to_recordset(p_actions)
      as a(player_id uuid, action_type text, amount bigint, resulting_chaal bigint, sequence int,
           target_player_id uuid, resolution text);

  return v_round_id;
end;
$$;
