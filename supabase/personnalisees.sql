-- Parties personnalisées (scrims) importées par les joueurs depuis leur client LoL : Riot ne les donne pas par son
-- API. Le joueur envoie la partie (résumé + moments clés) ; l'app du coach la reprend dans ses parties puis
-- l'efface d'ici. À exécuter après schema.sql et analyses.sql ; relançable sans risque.

create table if not exists public.custom_games (
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  game jsonb not null,
  created_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
alter table public.custom_games enable row level security;

-- joueur : ajoute une partie (p_game : résumé de la partie ; p_moments : moments clés, ou null)
create or replace function public.custom_game_add(p_token text, p_match text, p_game jsonb, p_moments jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
  v_date bigint;
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if p_match is null or p_match !~ '^[A-Z0-9]{2,5}_[0-9]{5,15}$' or p_game is null or jsonb_typeof(p_game) <> 'object'
     or length(p_game::text) > 8000 then
    return jsonb_build_object('error', 'partie_invalide');
  end if;
  if p_moments is not null and jsonb_typeof(p_moments) <> 'null'
     and (jsonb_typeof(p_moments) <> 'object' or length(p_moments::text) > 200000) then
    return jsonb_build_object('error', 'partie_invalide');
  end if;
  if (select count(*) from custom_games where player_id = v_player and match_id <> p_match) >= 30 then
    return jsonb_build_object('error', 'trop_de_parties');
  end if;
  v_date := case when (p_game->>'date') ~ '^[0-9]{10,14}$' then (p_game->>'date')::bigint else (extract(epoch from now()) * 1000)::bigint end;
  insert into custom_games (player_id, match_id, game)
  values (v_player, p_match, p_game || jsonb_build_object('playerId', v_player, 'matchId', p_match, 'custom', true))
  on conflict (player_id, match_id) do update set game = excluded.game, created_at = now();
  if p_moments is not null and jsonb_typeof(p_moments) = 'object' then
    insert into moments (player_id, match_id, game_date, data, updated_at)
    values (v_player, p_match, to_timestamp(v_date / 1000.0), p_moments, now())
    on conflict (player_id, match_id) do update set data = excluded.data, game_date = excluded.game_date, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- coach : parties en attente, avec leurs moments clés
create or replace function public.coach_custom_games(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return jsonb_build_object('games', coalesce((
    select jsonb_agg(jsonb_build_object('game', c.game, 'moments', m.data) order by c.created_at)
    from custom_games c left join moments m on m.player_id = c.player_id and m.match_id = c.match_id), '[]'::jsonb));
end $$;

-- coach : parties reprises dans l'app, effacées d'ici (p : [{playerId, matchId}])
create or replace function public.coach_custom_games_done(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  if p is null or jsonb_typeof(p) <> 'array' then
    return jsonb_build_object('error', 'liste_invalide');
  end if;
  delete from custom_games c using jsonb_array_elements(p) x
  where c.player_id = x->>'playerId' and c.match_id = x->>'matchId';
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['custom_game_add(text, text, jsonb, jsonb)', 'coach_custom_games(text)', 'coach_custom_games_done(text, jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
