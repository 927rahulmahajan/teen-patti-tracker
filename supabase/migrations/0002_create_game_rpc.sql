-- Atomic game creation: game + rules + players in one transaction. Avoids orphan
-- rows if the client dies mid-setup, and gives the client a single round trip.
create or replace function create_game(
  p_name             text,
  p_currency         text,
  p_boot_amount      bigint,
  p_blind_multiplier numeric,
  p_seen_multiplier  numeric,
  p_max_bet          bigint,
  p_sideshow_enabled boolean,
  p_show_enabled     boolean,
  p_players          text[]
) returns uuid
language plpgsql
as $$
declare
  v_game_id uuid;
begin
  if array_length(p_players, 1) is null or array_length(p_players, 1) < 2 then
    raise exception 'A game needs at least 2 players';
  end if;

  insert into games (name, currency, boot_amount)
    values (p_name, p_currency, p_boot_amount)
    returning id into v_game_id;

  insert into game_rules (game_id, blind_multiplier, seen_multiplier, max_bet, sideshow_enabled, show_enabled)
    values (v_game_id, p_blind_multiplier, p_seen_multiplier, p_max_bet, p_sideshow_enabled, p_show_enabled);

  insert into players (game_id, name, seat_order)
    select v_game_id, trim(name), (ord - 1)::int
    from unnest(p_players) with ordinality as t(name, ord)
    where trim(name) <> '';

  return v_game_id;
end;
$$;
