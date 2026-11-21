-- Journaux de tournage : quand « Filmer les moments » échoue chez un joueur, son app envoie le journal du tournage
-- (étapes, états du client LoL, capture, image) ; l'app du coach le montre dans « Analyses » puis l'efface d'ici.
-- À exécuter après schema.sql et analyses.sql ; relançable sans risque.

create table if not exists public.film_reports (
  id bigserial primary key,
  player_id text not null references public.players(id) on delete cascade,
  match_id text not null,
  error text not null,
  journal text not null,
  version text,
  created_at timestamptz not null default now()
);
alter table public.film_reports enable row level security;
create index if not exists film_reports_player on public.film_reports (player_id, id);

-- joueur : p = { matchId, error, journal, version } ; 20 journaux gardés au plus par joueur
create or replace function public.film_report_add(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or coalesce(p->>'matchId', '') !~ '^[A-Z0-9]{2,5}_[0-9]{5,15}$'
     or btrim(coalesce(p->>'error', '')) = '' or length(p->>'error') > 1000
     or coalesce(p->>'journal', '') = '' or length(p->>'journal') > 60000 or length(coalesce(p->>'version', '')) > 20 then
    return jsonb_build_object('error', 'journal_invalide');
  end if;
  insert into film_reports (player_id, match_id, error, journal, version)
  values (v_player, p->>'matchId', btrim(p->>'error'), p->>'journal', nullif(p->>'version', ''));
  delete from film_reports where player_id = v_player and id not in (
    select id from film_reports where player_id = v_player order by id desc limit 20);
  return jsonb_build_object('ok', true);
end $$;

-- coach : journaux reçus (du plus récent au plus ancien)
create or replace function public.coach_film_reports(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return jsonb_build_object('reports', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'playerId', r.player_id, 'matchId', r.match_id, 'error', r.error,
                                        'journal', r.journal, 'version', r.version, 'at', r.created_at) order by r.id desc)
    from film_reports r), '[]'::jsonb));
end $$;

-- coach : journaux lus, effacés d'ici (p_ids : identifiants)
create or replace function public.coach_film_reports_done(p_key text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  delete from film_reports where id = any(coalesce(p_ids, '{}'::bigint[]));
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['film_report_add(text, jsonb)', 'coach_film_reports(text)', 'coach_film_reports_done(text, bigint[])'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated';
  end loop;
end $$;
