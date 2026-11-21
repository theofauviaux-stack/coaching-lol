-- Cours : progression des joueurs (leçons vues, meilleur score au quiz, réponses gardées). Le joueur l'écrit
-- depuis son ordinateur ; l'app du coach la relit. Les cours assignés par le coach voyagent avec les données
-- du coach (coach_push), pas ici.
-- À exécuter après schema.sql ; relançable sans risque.

create table if not exists public.course_progress (
  player_id text not null references public.players(id) on delete cascade,
  course_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, course_id)
);
alter table public.course_progress enable row level security;

create or replace function public._course_save(p_player text, p_course text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
begin
  if p_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  if coalesce(p_course, '') !~ '^[a-z0-9-]{1,40}$' or p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 8000 then
    return jsonb_build_object('error', 'progression_invalide');
  end if;
  if (select count(*) from course_progress where player_id = p_player and course_id <> p_course) >= 100 then
    return jsonb_build_object('error', 'progression_invalide');
  end if;
  insert into course_progress (player_id, course_id, data, updated_at) values (p_player, p_course, p, now())
  on conflict (player_id, course_id) do update set data = excluded.data, updated_at = now()
  returning updated_at into v_at;
  return jsonb_build_object('ok', true, 'updatedAt', v_at);
end $$;

-- joueur : enregistre sa progression dans un cours (p : objet complet, remplace le précédent)
create or replace function public.course_save(p_token text, p_course text, p jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public._course_save(public._player_of(p_token), p_course, p)
$$;

-- joueur : sa progression dans tous les cours
create or replace function public.courses_mine(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_player text := public._player_of(p_token);
begin
  if v_player is null then
    return jsonb_build_object('error', 'session_expiree');
  end if;
  return jsonb_build_object('courses', coalesce((
    select jsonb_agg(jsonb_build_object('courseId', course_id, 'data', data, 'updatedAt', updated_at))
    from course_progress where player_id = v_player), '[]'::jsonb));
end $$;

-- coach : progression de tous ses joueurs
create or replace function public.coach_courses(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coach_ok(p_key) then
    return jsonb_build_object('error', 'jeton_inconnu');
  end if;
  return jsonb_build_object('courses', coalesce((
    select jsonb_agg(jsonb_build_object('playerId', player_id, 'courseId', course_id, 'data', data, 'updatedAt', updated_at))
    from course_progress), '[]'::jsonb));
end $$;

revoke all on function public._course_save(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.course_save(text, text, jsonb) from public;
revoke all on function public.courses_mine(text) from public;
revoke all on function public.coach_courses(text) from public;
grant execute on function public.course_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.courses_mine(text) to anon, authenticated;
grant execute on function public.coach_courses(text) to anon, authenticated;
