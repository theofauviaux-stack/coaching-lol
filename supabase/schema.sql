-- Coaching LoL : base en ligne (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase › SQL Editor (le script peut être relancé sans risque).
--
-- Principe
--   * L'app du coach (seule à parler à l'API Riot) envoie un instantané complet des données
--     avec la clé secrète du projet : fonction admin_push, interdite aux autres.
--   * L'app d'un joueur se connecte avec son code à 4 chiffres (fonction login), reçoit un jeton,
--     puis lit uniquement ses données (fonction get_data). Le code coach donne accès à tous les joueurs.
--   * Les tables ne sont pas lisibles directement (RLS activée, aucune règle d'accès) :
--     tout passe par ces fonctions.
--   * Contre les essais au hasard : 8 codes faux par adresse IP et 60 au total en 15 minutes, puis blocage.

create table if not exists public.app_secret (
  id int primary key default 1 check (id = 1),
  pepper text not null
);
insert into public.app_secret (id, pepper)
values (1, encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex'))
on conflict (id) do nothing;

create table if not exists public.coach (
  id int primary key default 1 check (id = 1),
  code_hash text
);

create table if not exists public.players (
  id text primary key,
  riot_id text not null,
  code_hash text unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  date bigint,
  data jsonb not null,
  primary key (player_id, match_id)
);

create table if not exists public.ranks (
  player_id text not null references public.players(id) on delete cascade,
  date bigint not null,
  data jsonb not null,
  primary key (player_id, date)
);

create table if not exists public.sessions (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  data jsonb not null
);

create table if not exists public.auth_tokens (
  token_hash text primary key,
  role text not null,
  player_id text,
  expires_at timestamptz not null
);

create table if not exists public.login_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_at on public.login_attempts (at);

create table if not exists public.meta (
  id int primary key default 1 check (id = 1),
  pushed_at timestamptz,
  settings jsonb not null default '{}'::jsonb
);
alter table public.meta add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.app_secret enable row level security;
alter table public.coach enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.ranks enable row level security;
alter table public.sessions enable row level security;
alter table public.auth_tokens enable row level security;
alter table public.login_attempts enable row level security;
alter table public.meta enable row level security;

-- empreinte d'un code (le « poivre » est secret et propre à ce projet)
create or replace function public.hash_code(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256((pepper || ':' || p_code)::bytea), 'hex') from public.app_secret where id = 1
$$;

-- Envoi complet des données par l'app du coach (clé secrète uniquement)
create or replace function public.admin_push(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p->>'coachCode', '') ~ '^[0-9]{4}$' then
    insert into coach (id, code_hash) values (1, hash_code(p->>'coachCode'))
    on conflict (id) do update set code_hash = excluded.code_hash;
  end if;

  delete from sessions where true;
  delete from ranks where true;
  delete from games where true;
  delete from players where true;

  insert into players (id, riot_id, code_hash, data, updated_at)
  select x->>'id', x->>'riotId',
         case when coalesce(x->>'code', '') ~ '^[0-9]{4}$' then hash_code(x->>'code') end,
         x - 'code', now()
  from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) x;

  insert into games (player_id, match_id, date, data)
  select x->>'playerId', x->>'matchId', (x->>'date')::bigint, x
  from jsonb_array_elements(coalesce(p->'games', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into ranks (player_id, date, data)
  select x->>'playerId', (x->>'date')::bigint, x
  from jsonb_array_elements(coalesce(p->'ranks', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into sessions (id, player_id, data)
  select x->>'id', x->>'playerId', x
  from jsonb_array_elements(coalesce(p->'sessions', '[]'::jsonb)) x
  where x->>'playerId' in (select id from players)
  on conflict do nothing;

  insert into meta (id, pushed_at, settings) values (1, now(), coalesce(p->'settings', '{}'::jsonb))
  on conflict (id) do update set pushed_at = now(), settings = excluded.settings;
  return jsonb_build_object('ok', true, 'players', (select count(*) from players), 'games', (select count(*) from games));
end $$;

-- Connexion avec un code à 4 chiffres
create or replace function public.login(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ip text;
  v_fails_ip int;
  v_fails_all int;
  v_hash text;
  v_role text;
  v_player text;
  v_token text;
begin
  v_ip := trim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1));
  if v_ip = '' then v_ip := 'inconnue'; end if;

  select count(*) into v_fails_ip from login_attempts where ip = v_ip and not ok and at > now() - interval '15 minutes';
  select count(*) into v_fails_all from login_attempts where not ok and at > now() - interval '15 minutes';
  if v_fails_ip >= 8 or v_fails_all >= 60 then
    return jsonb_build_object('error', 'trop_essais');
  end if;

  if coalesce(p_code, '') ~ '^[0-9]{4}$' then
    v_hash := hash_code(p_code);
    if exists (select 1 from coach where id = 1 and code_hash = v_hash) then
      v_role := 'coach';
    else
      select id into v_player from players where code_hash = v_hash;
      if v_player is not null then v_role := 'joueur'; end if;
    end if;
  end if;

  insert into login_attempts (ip, ok) values (v_ip, v_role is not null);
  delete from login_attempts where at < now() - interval '1 day';
  if v_role is null then
    return jsonb_build_object('error', 'code_inconnu');
  end if;

  v_token := encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'hex');
  delete from auth_tokens where expires_at < now();
  insert into auth_tokens (token_hash, role, player_id, expires_at)
  values (encode(sha256(v_token::bytea), 'hex'), v_role, v_player, now() + interval '30 days');
  return jsonb_build_object('token', v_token, 'role', v_role, 'playerId', v_player);
end $$;

-- Lecture des données autorisées pour ce jeton
create or replace function public.get_data(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_player text;
begin
  select role, player_id into v_role, v_player
  from auth_tokens where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex') and expires_at > now();
  if v_role is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  return jsonb_build_object(
    'role', v_role,
    'playerId', v_player,
    'pushedAt', (select pushed_at from meta where id = 1),
    'settings', (select settings from meta where id = 1),
    'players', (select coalesce(jsonb_agg(data || jsonb_build_object('id', id, 'riotId', riot_id)), '[]'::jsonb) from players where v_role = 'coach' or id = v_player),
    'games', (select coalesce(jsonb_agg(data order by date), '[]'::jsonb) from games where v_role = 'coach' or player_id = v_player),
    'ranks', (select coalesce(jsonb_agg(data order by date), '[]'::jsonb) from ranks where v_role = 'coach' or player_id = v_player),
    'sessions', (select coalesce(jsonb_agg(data), '[]'::jsonb) from sessions where v_role = 'coach' or player_id = v_player)
  );
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from auth_tokens where token_hash = encode(sha256(coalesce(p_token, '')::bytea), 'hex')
$$;

-- Envoi par l'app du coach sans clé secrète : l'app génère elle-même un jeton aléatoire (256 bits)
-- et seule son empreinte est enregistrée ici (table push_keys, remplie depuis le SQL Editor).
create table if not exists public.push_keys (
  hash text primary key,
  label text,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;

create or replace function public.coach_push(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_keys where hash = encode(sha256(coalesce(p_key, '')::bytea), 'hex')) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return admin_push(p);
end $$;

-- Droits : login / get_data / logout / coach_push sont ouvertes au public (coach_push exige un jeton enregistré) ;
-- admin_push est réservée à la clé secrète.
revoke all on function public.hash_code(text) from public, anon, authenticated;
revoke all on function public.admin_push(jsonb) from public, anon, authenticated;
grant execute on function public.admin_push(jsonb) to service_role;
grant execute on function public.login(text) to anon, authenticated;
grant execute on function public.get_data(text) to anon, authenticated;
grant execute on function public.logout(text) to anon, authenticated;
revoke all on function public.coach_push(text, jsonb) from public;
grant execute on function public.coach_push(text, jsonb) to anon, authenticated;
