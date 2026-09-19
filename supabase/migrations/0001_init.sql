-- Teen Patti offline cash-game tracker — initial schema.
--
-- Money is ALWAYS integer minor units (paise). No numeric/float on money columns.
-- The `actions` rows are the source of truth: pot_amount, current_chaal,
-- round_players.contribution/status are caches the engine (lib/engine) recomputes
-- on every write by replaying the action log. Editing a round = rewrite its actions
-- and re-derive the caches; nothing stores a manually-editable balance.

-- ---- games ----
create table games (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  currency     text not null default 'INR',
  boot_amount  bigint not null check (boot_amount > 0), -- minor units
  status       text not null default 'ACTIVE'
                 check (status in ('ACTIVE', 'ENDED', 'CANCELLED')),
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

-- ---- players ----
create table players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  name       text not null,
  seat_order int not null, -- fixed acting order within the game
  unique (game_id, seat_order)
);
create index players_game_idx on players(game_id);

-- ---- game_rules (one row per game) ----
-- boot_amount lives on games; the rest of the rules layer lives here so variants
-- can be added without touching the UI. multipliers are numeric to allow e.g. 1.5x,
-- but the engine rejects any bet that isn't a whole number of minor units.
create table game_rules (
  game_id          uuid primary key references games(id) on delete cascade,
  blind_multiplier numeric(8,3) not null default 1,
  seen_multiplier  numeric(8,3) not null default 2,
  max_bet          bigint not null default 0, -- inert in MVP (no raise); 0 = no cap
  sideshow_enabled boolean not null default false, -- config only in MVP
  show_enabled     boolean not null default true
);

-- ---- rounds ----
create table rounds (
  round_number  int not null,
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  status        text not null default 'BETTING'
                  check (status in ('BETTING', 'AWAITING_WINNER', 'COMPLETE', 'CANCELLED')),
  pot_amount    bigint not null default 0,  -- cache, derived from actions
  current_chaal bigint not null default 0,  -- cache, derived from actions
  created_at    timestamptz not null default now(),
  unique (game_id, round_number)
);
create index rounds_game_idx on rounds(game_id, round_number);

-- ---- round_players ----
create table round_players (
  round_id     uuid not null references rounds(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  status       text not null default 'ACTIVE'
                 check (status in ('ACTIVE', 'FOLDED', 'WINNER')), -- multiple WINNER rows = split pot
  contribution bigint not null default 0, -- cache: sum of this player's action amounts
  primary key (round_id, player_id)
);

-- ---- actions (the ledger; single source of truth) ----
-- amount = money ADDED TO THE POT by this action (never incremental target/total ambiguity).
-- SIDE_SHOW is listed for forward-compat but the MVP engine never emits it. No RAISE.
create table actions (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references rounds(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  action_type    text not null
                   check (action_type in ('BOOT', 'BLIND', 'SEEN', 'FOLD', 'SHOW', 'SIDE_SHOW')),
  amount         bigint not null default 0 check (amount >= 0),
  resulting_chaal bigint not null,
  sequence       int not null, -- order within the round; boots occupy the first N
  created_at     timestamptz not null default now(),
  unique (round_id, sequence)
);
create index actions_round_idx on actions(round_id, sequence);

-- ---- access ----
-- The product has no user accounts (one shared phone). RLS is enabled with open
-- anon policies so the anon key can operate the whole flow.
-- ponytail: open anon access is deliberate for the shared-device MVP. If games ever
-- go multi-device/public, add a per-game access token column + policy instead of auth.
alter table games         enable row level security;
alter table players       enable row level security;
alter table game_rules    enable row level security;
alter table rounds        enable row level security;
alter table round_players enable row level security;
alter table actions       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['games','players','game_rules','rounds','round_players','actions']
  loop
    execute format('create policy %I_anon_all on %I for all using (true) with check (true)', t, t);
  end loop;
end $$;
