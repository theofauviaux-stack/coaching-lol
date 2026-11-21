-- ============================================================ Analyses de parties (joueur ↔ coach) et vidéos
-- À exécuter dans Supabase › SQL Editor (le script peut être relancé sans risque). Aussi inclus dans schema.sql.
--
--   * moments : l'app du coach (seule à parler à l'API Riot) envoie les moments clés des parties récentes
--     (45 jours au plus) ; le joueur les lit avec son jeton pour les voir et les filmer chez lui.
--   * analyses : le joueur envoie une partie à analyser (extraits filmés choisis + commentaires) ; le coach
--     et le joueur en discutent moment par moment (analysis_comments). Le coach termine l'analyse.
--   * Vidéos : dossier public « clips » du stockage Supabase, une vidéo = clips/<analyse>/<fichier>.webm.
--     L'adresse contient l'identifiant aléatoire de l'analyse (impossible à deviner) ; personne ne peut lister
--     le dossier. Envoi permis seulement pendant 3 h après la création de l'analyse, pour les fichiers annoncés.
--     Quand le coach termine l'analyse, les vidéos restent pour que le joueur exporte « vidéos + débrief » sur son
--     ordinateur ; l'export supprime ensuite l'analyse du serveur. Sans export : vidéos effacées 7 jours après la fin
--     (30 jours après l'envoi au plus). Effacement permis seulement pour les vidéos marquées « à effacer ».
--   * Limites : 3 analyses avec vidéos par joueur, 900 Mo de vidéos en tout (plan gratuit : 1 Go).

create table if not exists public.moments (
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  game_date timestamptz not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, match_id)
);
alter table public.moments enable row level security;

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  status text not null default 'envoi',            -- envoi → ouverte → terminee → exportee (puis supprimée)
  clips jsonb not null default '[]'::jsonb,        -- [{file, start, end, times, bytes}]
  clips_state text not null default 'envoi',       -- envoi → en_ligne → a_effacer → effacees
  bytes bigint not null default 0,
  moments jsonb not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.analyses enable row level security;
create index if not exists analyses_player on public.analyses (player_id, created_at desc);

create table if not exists public.analysis_comments (
  id bigserial primary key,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  t int,                                           -- moment (ms depuis le début) ; null = discussion générale
  author text not null check (author in ('joueur', 'coach')),
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.analysis_comments enable row level security;
create index if not exists analysis_comments_a on public.analysis_comments (analysis_id, id);
-- 1.6.17 : dessin joint à un message (flèches, cercles, traits sur une image de la vidéo)
-- { file, v (seconde de la vidéo), g (temps de jeu), w, h, shapes: [{ k: 'fleche'|'cercle'|'trait', c, p: [x1, y1, x2, y2] | pts }] }
alter table public.analysis_comments add column if not exists drawing jsonb;

-- ---------------------------------------------------------------- outils internes
create or replace function public._analysis_json(a public.analyses, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'playerId', a.player_id, 'matchId', a.match_id, 'status', a.status,
    'clips', a.clips, 'clipsState', a.clips_state, 'bytes', a.bytes, 'note', a.note,
    'createdAt', a.created_at, 'updatedAt', a.updated_at, 'closedAt', a.closed_at,
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 't', c.t, 'author', c.author, 'text', c.text, 'at', c.created_at)
                                            || case when c.drawing is null then '{}'::jsonb else jsonb_build_object('drawing', c.drawing) end order by c.id)
                          from analysis_comments c where c.analysis_id = a.id), '[]'::jsonb))
    || case when p_full then jsonb_build_object('moments', a.moments) else '{}'::jsonb end
$$;

drop function if exists public._comment_add(uuid, text, int, text);
create or replace function public._comment_add(p_id uuid, p_author text, p_t int, p_text text, p_drawing jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
begin
  if p_drawing is not null and (jsonb_typeof(p_drawing) <> 'object' or jsonb_typeof(p_drawing->'shapes') <> 'array'
     or jsonb_array_length(p_drawing->'shapes') < 1 or jsonb_array_length(p_drawing->'shapes') > 30 or length(p_drawing::text) > 8000) then
    return jsonb_build_object('error', 'commentaire_invalide');
  end if;
  if (v_text = '' and p_drawing is null) or length(v_text) > 2000 then
    return jsonb_build_object('error', 'commentaire_invalide');
  end if;
  if (select count(*) from analysis_comments where analysis_id = p_id) >= 300 then
    return jsonb_build_object('error', 'commentaire_invalide');
  end if;
  insert into analysis_comments (analysis_id, t, author, text, drawing) values (p_id, p_t, p_author, v_text, p_drawing);
  update analyses set updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'analysis', (select _analysis_json(a, false) from analyses a where a.id = p_id));
end $$;

-- nom d'un fichier vidéo : « 03_13m40.webm »
create or replace function public._clip_name_ok(p_file text) returns boolean
language sql immutable as $$ select coalesce(p_file, '') ~ '^[0-9]{2}_[0-9]{1,3}m[0-9]{2}\.webm$' $$;

-- règle d'envoi d'une vidéo : analyse en cours d'envoi (moins de 3 h) et fichier annoncé à la création
create or replace function public._clip_upload_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_id uuid;
begin
  if array_length(v_parts, 1) <> 2 or v_parts[1] !~ '^[0-9a-f-]{36}$' or not _clip_name_ok(v_parts[2]) then
    return false;
  end if;
  v_id := v_parts[1]::uuid;
  return exists (select 1 from analyses where id = v_id and status = 'envoi' and clips_state = 'envoi'
                 and created_at > now() - interval '3 hours'
                 and clips @> jsonb_build_array(jsonb_build_object('file', v_parts[2])));
end $$;

-- règle d'effacement : seulement les vidéos d'une analyse marquée « à effacer »
create or replace function public._clip_delete_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if array_length(v_parts, 1) <> 2 or v_parts[1] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (select 1 from analyses where id = v_parts[1]::uuid and clips_state = 'a_effacer');
end $$;

-- ---------------------------------------------------------------- app du coach (jeton d'envoi)
-- moments des parties récentes : [{playerId, matchId, date (ms), data}]
create or replace function public.coach_moments_push(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_n int := 0;
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 50 then
    return jsonb_build_object('error', 'moments_invalides');
  end if;
  for v_item in select * from jsonb_array_elements(p) loop
    if not exists (select 1 from players where id = v_item->>'playerId') then continue; end if;
    if jsonb_typeof(v_item->'data') <> 'object' or length((v_item->'data')::text) > 200000 then continue; end if;
    insert into moments (player_id, match_id, game_date, data, updated_at)
    values (v_item->>'playerId', v_item->>'matchId', to_timestamp((v_item->>'date')::bigint / 1000.0), v_item->'data', now())
    on conflict (player_id, match_id) do update set data = excluded.data, game_date = excluded.game_date, updated_at = now();
    v_n := v_n + 1;
  end loop;
  delete from moments where game_date < now() - interval '45 days';
  return jsonb_build_object('ok', true, 'saved', v_n,
    'have', (select coalesce(jsonb_agg(player_id || '/' || match_id), '[]'::jsonb) from moments));
end $$;

create or replace function public.coach_analyses(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return jsonb_build_object('analyses', coalesce((
    select jsonb_agg(_analysis_json(a, false) order by a.created_at desc) from analyses a where a.status not in ('envoi', 'exportee')), '[]'::jsonb));
end $$;

create or replace function public.coach_analysis_get(p_key text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  if not exists (select 1 from analyses where id = p_id) then
    return jsonb_build_object('error', 'analyse_inconnue');
  end if;
  return jsonb_build_object('analysis', (select _analysis_json(a, true) from analyses a where a.id = p_id));
end $$;

drop function if exists public.coach_analysis_comment(text, uuid, int, text);
create or replace function public.coach_analysis_comment(p_key text, p_id uuid, p_t int, p_text text, p_drawing jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  if not exists (select 1 from analyses where id = p_id and status = 'ouverte') then
    return jsonb_build_object('error', 'analyse_fermee');
  end if;
  return _comment_add(p_id, 'coach', p_t, p_text, p_drawing);
end $$;

-- fin de l'analyse : discussion close ; les vidéos restent 7 jours pour l'export par le joueur
create or replace function public.coach_analysis_close(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  update analyses set status = 'terminee', closed_at = now(), updated_at = now()
  where id = p_id and status = 'ouverte';
  if not found then
    return jsonb_build_object('error', 'analyse_fermee');
  end if;
  return jsonb_build_object('ok', true, 'analysis', (select _analysis_json(a, false) from analyses a where a.id = p_id));
end $$;

-- suppression par le coach : l'analyse quitte les deux apps (même état qu'après un export), ses messages sont
-- effacés tout de suite, ses vidéos par la purge de l'app du coach, puis la ligne elle-même (coach_clips_gone)
create or replace function public.coach_analysis_delete(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a analyses;
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  update analyses set status = 'exportee', updated_at = now(),
    clips_state = case when clips_state in ('envoi', 'en_ligne') then 'a_effacer' else clips_state end
  where id = p_id
  returning * into v_a;
  if v_a.id is null then
    return jsonb_build_object('error', 'analyse_inconnue');
  end if;
  delete from analysis_comments where analysis_id = p_id;
  if v_a.clips_state = 'effacees' then
    delete from analyses where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'clipsState', v_a.clips_state,
    'files', case when v_a.clips_state = 'a_effacer' then (select coalesce(jsonb_agg(c->>'file'), '[]'::jsonb) from jsonb_array_elements(v_a.clips) c) else '[]'::jsonb end);
end $$;

-- vidéos à effacer : analyses terminées depuis 7 jours sans export, de plus de 30 jours, exportées, ou envois abandonnés
create or replace function public.coach_clips_purge(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  update analyses set clips_state = 'a_effacer'
  where (clips_state = 'en_ligne' and created_at < now() - interval '30 days')
     or (clips_state = 'en_ligne' and status = 'terminee' and closed_at < now() - interval '7 days')
     or (clips_state = 'envoi' and created_at < now() - interval '1 day');
  delete from analyses where status in ('envoi', 'exportee') and clips_state = 'effacees';
  return jsonb_build_object('purge', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'files', (select coalesce(jsonb_agg(c->>'file'), '[]'::jsonb) from jsonb_array_elements(clips) c)))
    from analyses where clips_state = 'a_effacer'), '[]'::jsonb));
end $$;

create or replace function public.coach_clips_gone(p_key text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  update analyses set clips_state = 'effacees', bytes = 0 where id = p_id and clips_state = 'a_effacer';
  delete from analyses where id = p_id and status in ('envoi', 'exportee');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- app d'un joueur (jeton de session)
create or replace function public.moments_get(p_token text, p_match text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
  v_data jsonb;
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  select data into v_data from moments where player_id = v_player and match_id = p_match;
  if v_data is null then
    return jsonb_build_object('error', 'moments_absents');
  end if;
  return jsonb_build_object('moments', v_data);
end $$;

-- p : {matchId, clips:[{file, start, end, times, bytes}], note, comments:[{t, text}]}
create or replace function public.analysis_create(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
  v_moments jsonb;
  v_clips jsonb := coalesce(p->'clips', '[]'::jsonb);
  v_bytes bigint;
  v_id uuid;
  v_c jsonb;
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  select data into v_moments from moments where player_id = v_player and match_id = p->>'matchId';
  if v_moments is null then
    return jsonb_build_object('error', 'moments_absents');
  end if;
  if jsonb_typeof(v_clips) <> 'array' or jsonb_array_length(v_clips) < 1 or jsonb_array_length(v_clips) > 10
     or exists (select 1 from jsonb_array_elements(v_clips) c where not _clip_name_ok(c->>'file')
                or coalesce((c->>'bytes')::bigint, 0) <= 0 or (c->>'bytes')::bigint > 31457280)
     or (select count(distinct c->>'file') from jsonb_array_elements(v_clips) c) <> jsonb_array_length(v_clips)
     or length(coalesce(p->>'note', '')) > 2000
     or jsonb_array_length(coalesce(p->'comments', '[]'::jsonb)) > 40 then
    return jsonb_build_object('error', 'analyse_invalide');
  end if;
  v_bytes := (select sum((c->>'bytes')::bigint) from jsonb_array_elements(v_clips) c);
  if (select count(*) from analyses where player_id = v_player and status <> 'terminee'
        and (clips_state = 'en_ligne' or (clips_state = 'envoi' and created_at > now() - interval '3 hours'))) >= 3 then
    return jsonb_build_object('error', 'trop_d_analyses');
  end if;
  if coalesce((select sum(bytes) from analyses where clips_state in ('envoi', 'en_ligne', 'a_effacer')), 0) + v_bytes > 900 * 1048576 then
    return jsonb_build_object('error', 'stockage_plein');
  end if;
  insert into analyses (player_id, match_id, clips, bytes, moments, note)
  values (v_player, p->>'matchId', v_clips, v_bytes, v_moments, btrim(coalesce(p->>'note', '')))
  returning id into v_id;
  for v_c in select * from jsonb_array_elements(coalesce(p->'comments', '[]'::jsonb)) loop
    if btrim(coalesce(v_c->>'text', '')) <> '' then
      insert into analysis_comments (analysis_id, t, author, text) values (v_id, (v_c->>'t')::int, 'joueur', left(btrim(v_c->>'text'), 2000));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- toutes les vidéos sont envoyées : l'analyse apparaît chez le coach
create or replace function public.analysis_ready(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  update analyses set status = 'ouverte', clips_state = 'en_ligne', updated_at = now()
  where id = p_id and player_id = v_player and status = 'envoi' and clips_state = 'envoi';
  if not found then
    return jsonb_build_object('error', 'analyse_inconnue');
  end if;
  return jsonb_build_object('ok', true, 'analysis', (select _analysis_json(a, false) from analyses a where a.id = p_id));
end $$;

create or replace function public.analyses_mine(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  return jsonb_build_object('analyses', coalesce((
    select jsonb_agg(_analysis_json(a, false) order by a.created_at desc) from analyses a
    where a.player_id = v_player and a.status not in ('envoi', 'exportee')), '[]'::jsonb));
end $$;

create or replace function public.analysis_get(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if not exists (select 1 from analyses where id = p_id and player_id = v_player) then
    return jsonb_build_object('error', 'analyse_inconnue');
  end if;
  return jsonb_build_object('analysis', (select _analysis_json(a, true) from analyses a where a.id = p_id));
end $$;

drop function if exists public.analysis_comment(text, uuid, int, text);
create or replace function public.analysis_comment(p_token text, p_id uuid, p_t int, p_text text, p_drawing jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if not exists (select 1 from analyses where id = p_id and player_id = v_player and status = 'ouverte') then
    return jsonb_build_object('error', 'analyse_fermee');
  end if;
  return _comment_add(p_id, 'joueur', p_t, p_text, p_drawing);
end $$;

-- export par le joueur (vidéos + débrief enregistrés sur son ordinateur) : l'analyse quitte le serveur.
-- 1) analysis_export_done : vidéos marquées « à effacer » (le joueur les efface aussitôt avec la clé publique) ;
-- 2) analysis_forget : suppression de l'analyse et de ses messages, une fois les vidéos parties.
create or replace function public.analysis_export_done(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
  v_a analyses;
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  update analyses set status = 'exportee', updated_at = now(),
    clips_state = case when clips_state in ('envoi', 'en_ligne') then 'a_effacer' else clips_state end
  where id = p_id and player_id = v_player and status = 'terminee'
  returning * into v_a;
  if v_a.id is null then
    return jsonb_build_object('error', 'export_impossible');
  end if;
  return jsonb_build_object('ok', true, 'clipsState', v_a.clips_state,
    'files', case when v_a.clips_state = 'a_effacer' then (select coalesce(jsonb_agg(c->>'file'), '[]'::jsonb) from jsonb_array_elements(v_a.clips) c) else '[]'::jsonb end);
end $$;

create or replace function public.analysis_forget(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'clips' and name like p_id::text || '/%') then
    return jsonb_build_object('error', 'videos_restantes');
  end if;
  delete from analyses where id = p_id and player_id = v_player and status = 'exportee';
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- stockage des vidéos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 31457280, array['video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clips : envoi par le joueur" on storage.objects;
create policy "clips : envoi par le joueur" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'clips' and public._clip_upload_ok(name));
drop policy if exists "clips : lecture pendant envoi ou effacement" on storage.objects;
create policy "clips : lecture pendant envoi ou effacement" on storage.objects for select to anon, authenticated
  using (bucket_id = 'clips' and (public._clip_upload_ok(name) or public._clip_delete_ok(name)));
drop policy if exists "clips : effacement" on storage.objects;
create policy "clips : effacement" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'clips' and public._clip_delete_ok(name));

-- ---------------------------------------------------------------- droits
revoke all on function public._analysis_json(public.analyses, boolean) from public, anon, authenticated;
revoke all on function public._comment_add(uuid, text, int, text, jsonb) from public, anon, authenticated;
revoke all on function public._clip_upload_ok(text) from public;
revoke all on function public._clip_delete_ok(text) from public;
grant execute on function public._clip_upload_ok(text) to anon, authenticated;   -- utilisées par les règles du stockage
grant execute on function public._clip_delete_ok(text) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'coach_moments_push(text, jsonb)', 'coach_analyses(text)', 'coach_analysis_get(text, uuid)',
    'coach_analysis_comment(text, uuid, int, text, jsonb)', 'coach_analysis_close(text, uuid)', 'coach_analysis_delete(text, uuid)', 'coach_clips_purge(text)',
    'coach_clips_gone(text, uuid)', 'moments_get(text, text)', 'analysis_create(text, jsonb)', 'analysis_ready(text, uuid)',
    'analyses_mine(text)', 'analysis_get(text, uuid)', 'analysis_comment(text, uuid, int, text, jsonb)',
    'analysis_export_done(text, uuid)', 'analysis_forget(text, uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
