-- =====================================================================
-- GAMER CHAT — схема Supabase (Postgres + RLS + Realtime)
-- Применить целиком в Supabase Dashboard → SQL Editor → Run
-- (или: supabase db query / psql). Скрипт идемпотентен там, где это возможно.
-- В клиенте используется ТОЛЬКО anon key. service_role нигде не нужен.
-- ВАЖНО: Authentication → Providers → Email → отключить "Confirm email",
-- иначе вход по нику+паролю (синтетический email) не заработает.
-- =====================================================================

-- ---------- Таблицы ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nick          text not null check (nick ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_emoji  text not null default '🎮' check (char_length(avatar_emoji) between 1 and 8),
  avatar_color  text not null default '#7c4dff' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  status_game   text check (status_game is null or char_length(status_game) <= 40),
  bio           text check (bio is null or char_length(bio) <= 140),
  games         jsonb not null default '[]'::jsonb
                check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 12 and octet_length(games::text) <= 2000),
  created_at    timestamptz not null default now()
);
create unique index if not exists profiles_nick_lower_uq on public.profiles (lower(nick));

create table if not exists public.match_results (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  game       text not null check (char_length(game) between 1 and 40),
  result     text not null check (result in ('win','loss')),
  created_at timestamptz not null default now()
);
create index if not exists match_results_user_idx on public.match_results (user_id, created_at desc);

create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  emoji       text not null default '🛡️' check (char_length(emoji) between 1 and 8),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  created_at  timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index if not exists server_members_user_idx on public.server_members (user_id);

-- chats: личные (dm), групповые (group) и каналы серверов (channel)
create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('dm','group','channel')),
  title      text check (title is null or char_length(title) between 1 and 40),
  owner_id   uuid references public.profiles(id) on delete set null,
  server_id  uuid references public.servers(id) on delete cascade,
  dm_key     text unique,
  created_at timestamptz not null default now(),
  check ((kind = 'channel') = (server_id is not null)),
  check ((kind = 'dm') = (dm_key is not null))
);
create index if not exists chats_server_idx on public.chats (server_id);

create table if not exists public.chat_members (
  chat_id   uuid not null references public.chats(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  question   text not null check (char_length(question) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists polls_chat_idx on public.polls (chat_id);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls(id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 60),
  position int  not null default 0,
  unique (id, poll_id)
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id);

create table if not exists public.poll_votes (
  poll_id   uuid not null,
  user_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  option_id uuid not null,
  voted_at  timestamptz not null default now(),
  primary key (poll_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options(id, poll_id) on delete cascade
);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  sender_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind       text not null default 'text' check (kind in ('text','poll')),
  body       text not null check (char_length(body) between 1 and 2000),
  poll_id    uuid references public.polls(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat_idx on public.messages (chat_id, id desc);

create table if not exists public.lfg_posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  game       text not null check (char_length(game) between 1 and 40),
  rank       text check (rank is null or char_length(rank) <= 40),
  role       text check (role is null or char_length(role) <= 40),
  play_time  text check (play_time is null or char_length(play_time) <= 60),
  slots      int  not null default 1 check (slots between 0 and 9),
  note       text check (note is null or char_length(note) <= 200),
  status     text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);
create index if not exists lfg_game_idx on public.lfg_posts (game, created_at desc);

-- ---------- Вспомогательные функции (security definer, чтобы не было рекурсии RLS) ----------
create or replace function public.is_server_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.server_members where server_id = sid and user_id = auth.uid());
$$;

create or replace function public.can_access_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid())
      or exists (select 1 from public.chats c
                 join public.server_members sm on sm.server_id = c.server_id
                 where c.id = cid and c.kind = 'channel' and sm.user_id = auth.uid());
$$;

create or replace function public.can_access_poll(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.polls p where p.id = pid and public.can_access_chat(p.chat_id));
$$;

-- ---------- Триггеры ----------
-- профиль создаётся автоматически при регистрации (ник берётся из user_metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nick text := new.raw_user_meta_data->>'nick';
begin
  if v_nick is null or v_nick !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'invalid nick';
  end if;
  insert into public.profiles (id, nick) values (new.id, v_nick);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- не больше 5 открытых объявлений «ищу пати» на пользователя
create or replace function public.lfg_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (select count(*) from public.lfg_posts
       where user_id = new.user_id and status = 'open' and id <> new.id) >= 5 then
    raise exception 'too many open lfg posts';
  end if;
  return new;
end $$;
drop trigger if exists lfg_limit_trg on public.lfg_posts;
create trigger lfg_limit_trg before insert or update on public.lfg_posts
  for each row execute function public.lfg_limit();

-- ---------- RPC ----------
-- личный чат (идемпотентно)
create or replace function public.open_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other is null or other = me then raise exception 'bad peer'; end if;
  if not exists (select 1 from public.profiles where id = other) then raise exception 'no such user'; end if;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into cid from public.chats where dm_key = k;
  if cid is null then
    insert into public.chats (kind, dm_key, owner_id) values ('dm', k, me)
      on conflict (dm_key) do nothing returning id into cid;
    if cid is null then select id into cid from public.chats where dm_key = k; end if;
    insert into public.chat_members (chat_id, user_id) values (cid, me), (cid, other) on conflict do nothing;
  end if;
  return cid;
end $$;

-- группа: название + ники участников
create or replace function public.create_group(p_title text, p_nicks text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  p_title := btrim(coalesce(p_title,''));
  if char_length(p_title) not between 1 and 40 then raise exception 'bad title'; end if;
  if coalesce(array_length(p_nicks,1),0) > 30 then raise exception 'too many members'; end if;
  insert into public.chats (kind, title, owner_id) values ('group', p_title, me) returning id into cid;
  insert into public.chat_members (chat_id, user_id) values (cid, me);
  insert into public.chat_members (chat_id, user_id)
    select cid, p.id from public.profiles p
    where lower(p.nick) in (select lower(btrim(x)) from unnest(coalesce(p_nicks,'{}')) x)
    on conflict do nothing;
  return cid;
end $$;

create or replace function public.nick_available(p_nick text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_nick ~ '^[A-Za-z0-9_]{3,20}$' and not exists (select 1 from public.profiles where lower(nick) = lower(p_nick));
$$;

create or replace function public.add_group_member(p_chat uuid, p_nick text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); uid uuid;
begin
  if not exists (select 1 from public.chats where id = p_chat and kind = 'group' and owner_id = me) then
    raise exception 'only group owner can add members';
  end if;
  if (select count(*) from public.chat_members where chat_id = p_chat) >= 50 then raise exception 'group is full'; end if;
  select id into uid from public.profiles where lower(nick) = lower(btrim(p_nick));
  if uid is null then raise exception 'no such user'; end if;
  insert into public.chat_members (chat_id, user_id) values (p_chat, uid) on conflict do nothing;
  return uid;
end $$;

create or replace function public.leave_group(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.chat_members
   where chat_id = p_chat and user_id = auth.uid()
     and exists (select 1 from public.chats where id = p_chat and kind = 'group');
end $$;

-- сервер: создаёт сервер, членство владельца и каналы по умолчанию
create or replace function public.create_server(p_name text, p_emoji text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  p_name := btrim(coalesce(p_name,''));
  if char_length(p_name) not between 2 and 40 then raise exception 'bad name'; end if;
  if (select count(*) from public.servers where owner_id = me) >= 10 then raise exception 'too many servers'; end if;
  insert into public.servers (name, emoji, owner_id) values (p_name, coalesce(nullif(p_emoji,''),'🛡️'), me) returning id into sid;
  insert into public.server_members (server_id, user_id, role) values (sid, me, 'owner');
  insert into public.chats (kind, title, server_id, owner_id) values ('channel','общий',sid,me), ('channel','игры',sid,me);
  return sid;
end $$;

create or replace function public.join_server(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into sid from public.servers where invite_code = upper(btrim(coalesce(p_code,'')));
  if sid is null then raise exception 'invalid invite code'; end if;
  insert into public.server_members (server_id, user_id) values (sid, me) on conflict do nothing;
  return sid;
end $$;

create or replace function public.create_channel(p_server uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if not exists (select 1 from public.servers where id = p_server and owner_id = me) then
    raise exception 'only server owner can create channels';
  end if;
  p_name := lower(btrim(coalesce(p_name,'')));
  if char_length(p_name) not between 1 and 30 then raise exception 'bad name'; end if;
  if (select count(*) from public.chats where server_id = p_server) >= 20 then raise exception 'too many channels'; end if;
  insert into public.chats (kind, title, server_id, owner_id) values ('channel', p_name, p_server, me) returning id into cid;
  return cid;
end $$;

-- голосование «когда играем»: опрос + сообщение в чате атомарно
create or replace function public.create_poll(p_chat uuid, p_question text, p_options text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pid uuid; o text; i int := 0; n int;
begin
  if me is null or not public.can_access_chat(p_chat) then raise exception 'no access'; end if;
  p_question := btrim(coalesce(p_question,''));
  if char_length(p_question) not between 1 and 120 then raise exception 'bad question'; end if;
  n := coalesce(array_length(p_options,1),0);
  if n < 2 or n > 6 then raise exception 'need 2..6 options'; end if;
  insert into public.polls (chat_id, creator_id, question) values (p_chat, me, p_question) returning id into pid;
  foreach o in array p_options loop
    o := btrim(coalesce(o,''));
    if char_length(o) not between 1 and 60 then raise exception 'bad option'; end if;
    insert into public.poll_options (poll_id, label, position) values (pid, o, i);
    i := i + 1;
  end loop;
  insert into public.messages (chat_id, sender_id, kind, body, poll_id) values (p_chat, me, 'poll', p_question, pid);
  return pid;
end $$;

-- список моих ЛС и групп с последним сообщением (выполняется с правами вызывающего → RLS работает)
create or replace function public.list_my_chats()
returns table (id uuid, kind text, title text, peer_id uuid, last_body text, last_kind text, last_sender uuid, last_at timestamptz, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select c.id, c.kind, c.title,
         (select cm.user_id from public.chat_members cm where cm.chat_id = c.id and cm.user_id <> auth.uid() limit 1) as peer_id,
         lm.body, lm.kind, lm.sender_id, lm.created_at, c.created_at
  from public.chats c
  join public.chat_members me on me.chat_id = c.id and me.user_id = auth.uid()
  left join lateral (select m.body, m.kind, m.sender_id, m.created_at from public.messages m
                     where m.chat_id = c.id order by m.id desc limit 1) lm on true
  where c.kind in ('dm','group')
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------- RLS ----------
alter table public.profiles       enable row level security;
alter table public.match_results  enable row level security;
alter table public.servers        enable row level security;
alter table public.server_members enable row level security;
alter table public.chats          enable row level security;
alter table public.chat_members   enable row level security;
alter table public.polls          enable row level security;
alter table public.poll_options   enable row level security;
alter table public.poll_votes     enable row level security;
alter table public.messages       enable row level security;
alter table public.lfg_posts      enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists results_select on public.match_results;
create policy results_select on public.match_results for select to authenticated using (true);
drop policy if exists results_insert on public.match_results;
create policy results_insert on public.match_results for insert to authenticated with check (user_id = auth.uid());
drop policy if exists results_delete on public.match_results;
create policy results_delete on public.match_results for delete to authenticated using (user_id = auth.uid());

drop policy if exists servers_select on public.servers;
create policy servers_select on public.servers for select to authenticated using (public.is_server_member(id));
drop policy if exists servers_update on public.servers;
create policy servers_update on public.servers for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists servers_delete on public.servers;
create policy servers_delete on public.servers for delete to authenticated using (owner_id = auth.uid());

drop policy if exists sm_select on public.server_members;
create policy sm_select on public.server_members for select to authenticated using (public.is_server_member(server_id));
drop policy if exists sm_leave on public.server_members;
create policy sm_leave on public.server_members for delete to authenticated using (user_id = auth.uid() and role <> 'owner');

drop policy if exists chats_select on public.chats;
create policy chats_select on public.chats for select to authenticated using (public.can_access_chat(id));

drop policy if exists cm_select on public.chat_members;
create policy cm_select on public.chat_members for select to authenticated using (public.can_access_chat(chat_id));

drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls for select to authenticated using (public.can_access_chat(chat_id));
drop policy if exists po_select on public.poll_options;
create policy po_select on public.poll_options for select to authenticated using (public.can_access_poll(poll_id));

drop policy if exists pv_select on public.poll_votes;
create policy pv_select on public.poll_votes for select to authenticated using (public.can_access_poll(poll_id));
drop policy if exists pv_insert on public.poll_votes;
create policy pv_insert on public.poll_votes for insert to authenticated with check (user_id = auth.uid() and public.can_access_poll(poll_id));
drop policy if exists pv_update on public.poll_votes;
create policy pv_update on public.poll_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_access_poll(poll_id));
drop policy if exists pv_delete on public.poll_votes;
create policy pv_delete on public.poll_votes for delete to authenticated using (user_id = auth.uid());

drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select to authenticated using (public.can_access_chat(chat_id));
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and kind = 'text' and poll_id is null and public.can_access_chat(chat_id));
drop policy if exists msg_delete on public.messages;
create policy msg_delete on public.messages for delete to authenticated using (sender_id = auth.uid());

drop policy if exists lfg_select on public.lfg_posts;
create policy lfg_select on public.lfg_posts for select to authenticated using (true);
drop policy if exists lfg_insert on public.lfg_posts;
create policy lfg_insert on public.lfg_posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists lfg_update on public.lfg_posts;
create policy lfg_update on public.lfg_posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists lfg_delete on public.lfg_posts;
create policy lfg_delete on public.lfg_posts for delete to authenticated using (user_id = auth.uid());

-- ---------- Права (anon не получает ничего) ----------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from public;
revoke all on all tables    in schema public from authenticated;

grant select on public.profiles, public.match_results, public.servers, public.server_members,
                public.chats, public.chat_members, public.polls, public.poll_options,
                public.poll_votes, public.messages, public.lfg_posts to authenticated;
-- колонки профиля, доступные для изменения
grant update (nick, avatar_emoji, avatar_color, status_game, bio, games) on public.profiles to authenticated;
grant insert (game, result) on public.match_results to authenticated;
grant delete on public.match_results to authenticated;
grant update (name, emoji) on public.servers to authenticated;
grant delete on public.servers to authenticated;
grant delete on public.server_members to authenticated;
grant insert (chat_id, body) on public.messages to authenticated;
grant delete on public.messages to authenticated;
grant insert, update, delete on public.poll_votes to authenticated;
grant insert (game, rank, role, play_time, slots, note) on public.lfg_posts to authenticated;
grant update (game, rank, role, play_time, slots, note, status) on public.lfg_posts to authenticated;
grant delete on public.lfg_posts to authenticated;

grant execute on function
  public.is_server_member(uuid), public.can_access_chat(uuid), public.can_access_poll(uuid),
  public.open_dm(uuid), public.create_group(text, text[]), public.add_group_member(uuid, text),
  public.leave_group(uuid), public.create_server(text, text), public.join_server(text),
  public.create_channel(uuid, text), public.create_poll(uuid, text, text[]), public.list_my_chats()
  to authenticated;

grant execute on function public.nick_available(text) to anon, authenticated;

-- ---------- Realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages;       exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.poll_votes;     exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_members;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.server_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.lfg_posts;      exception when duplicate_object then null; end;
  end if;
end $$;
