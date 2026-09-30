-- Проверка RLS на локальном Postgres (эмуляция ролей Supabase). Запуск: tests/run_rls.sh
\set ON_ERROR_STOP on
\set QUIET on
-- тестовые пользователи (триггер создаёт профили)
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','a@x','{"nick":"Alice"}'),
 ('00000000-0000-0000-0000-00000000000b','b@x','{"nick":"Bob"}'),
 ('00000000-0000-0000-0000-00000000000c','c@x','{"nick":"Carol"}');
do $$ begin
  begin insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'d@x','{"nick":"<script>"}'); raise exception 'FAIL: bad nick accepted'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'e@x','{"nick":"alice"}'); raise exception 'FAIL: dup nick accepted'; exception when unique_violation then null; end;
  raise notice 'PASS nick validation + uniqueness';
end $$;

create schema gct;
create table gct.t_ctx(k text primary key, v text);
grant all on gct.t_ctx to authenticated;
create or replace function gct.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create or replace function gct.check(name text, ok boolean) returns void language plpgsql as $$
begin if ok then raise notice 'PASS %', name; else raise exception 'FAIL %', name; end if; end $$;
grant execute on function gct.check(text, boolean) to authenticated;
grant usage on schema gct to authenticated;

-- Alice открывает ЛС с Bob и пишет
select gct.as_user('00000000-0000-0000-0000-00000000000a');

insert into gct.t_ctx select 'dm', public.open_dm('00000000-0000-0000-0000-00000000000b')::text;
insert into public.messages (chat_id, body) select v::uuid, 'секрет Alice→Bob' from gct.t_ctx where k='dm';
select gct.check('Alice видит своё сообщение', (select count(*) from public.messages)=1);
select gct.check('open_dm идемпотентен', (select public.open_dm('00000000-0000-0000-0000-00000000000b')::text)=(select v from gct.t_ctx where k='dm'));
do $$ begin
  begin insert into public.messages (chat_id, body, sender_id) select v::uuid,'fake','00000000-0000-0000-0000-00000000000b' from gct.t_ctx where k='dm'; raise exception 'FAIL: sender_id spoof allowed'; exception when insufficient_privilege then raise notice 'PASS нельзя задать sender_id'; end;
end $$;

-- Bob видит
select gct.as_user('00000000-0000-0000-0000-00000000000b');
select gct.check('Bob видит сообщение в ЛС', (select count(*) from public.messages)=1);
select gct.check('Bob видит чат в list_my_chats', (select count(*) from public.list_my_chats())=1);

-- Carol — посторонняя
select gct.as_user('00000000-0000-0000-0000-00000000000c');
select gct.check('Carol НЕ видит чужие сообщения', (select count(*) from public.messages)=0);
select gct.check('Carol НЕ видит чужие чаты', (select count(*) from public.chats)=0);
select gct.check('Carol НЕ видит чужих участников чата', (select count(*) from public.chat_members)=0);
select gct.check('Carol: list_my_chats пуст', (select count(*) from public.list_my_chats())=0);
do $$ declare c uuid; begin
  select v::uuid into c from gct.t_ctx where k='dm';
  begin insert into public.messages (chat_id, body) values (c,'взлом'); raise exception 'FAIL: outsider inserted into DM'; exception when insufficient_privilege or check_violation then raise notice 'PASS Carol НЕ может писать в чужое ЛС'; end;
  begin perform public.create_poll(c,'q',array['a','b']); raise exception 'FAIL: outsider poll'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS Carol НЕ может создать опрос в чужом ЛС'; end;
  begin insert into public.chat_members (chat_id,user_id) values (c,'00000000-0000-0000-0000-00000000000c'); raise exception 'FAIL: self-join'; exception when insufficient_privilege then raise notice 'PASS нельзя добавить себя в чужой чат напрямую'; end;
end $$;
do $$ begin
  begin update public.profiles set nick='Hacker' where id='00000000-0000-0000-0000-00000000000a'; end;
  if (select nick from public.profiles where id='00000000-0000-0000-0000-00000000000a')<>'Alice' then raise exception 'FAIL: foreign profile updated'; end if;
  raise notice 'PASS чужой профиль не изменяется';
end $$;

-- сервер
select gct.as_user('00000000-0000-0000-0000-00000000000a');
insert into gct.t_ctx select 'srv', public.create_server('Тест Гильдия','🛡️')::text;
select gct.check('create_server создаёт 2 канала', (select count(*) from public.chats where kind='channel')=2);
insert into gct.t_ctx select 'code', invite_code from public.servers limit 1;
insert into public.messages (chat_id, body) select id, 'в канале' from public.chats where kind='channel' limit 1;
select gct.as_user('00000000-0000-0000-0000-00000000000c');
select gct.check('Carol НЕ видит сервер до вступления', (select count(*) from public.servers)=0 and (select count(*) from public.messages)=0);
do $$ begin begin perform public.join_server('WRONGCODE'); raise exception 'FAIL: wrong code'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS неверный код отвергнут'; end; end $$;
select public.join_server((select v from gct.t_ctx where k='code'));
select gct.check('Carol видит сервер после вступления', (select count(*) from public.servers)=1 and (select count(*) from public.messages)=1);
insert into public.messages (chat_id, body) select id, 'привет от Carol' from public.chats where kind='channel' limit 1;
select gct.check('Carol пишет в канал после вступления', (select count(*) from public.messages where body='привет от Carol')=1);
do $$ begin begin perform public.create_channel((select id from public.servers limit 1),'x'); raise exception 'FAIL: non-owner channel'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS не-владелец не создаёт канал'; end; end $$;
select gct.as_user('00000000-0000-0000-0000-00000000000b');
select gct.check('Bob (не в сервере) не видит канал', (select count(*) from public.messages where kind='text' and chat_id in (select id from public.chats where kind='channel'))=0);

-- голосование
select gct.as_user('00000000-0000-0000-0000-00000000000a');
insert into gct.t_ctx select 'poll', public.create_poll((select v::uuid from gct.t_ctx where k='dm'),'Когда играем?',array['Сегодня 20:00','Завтра 20:00'])::text;
select gct.check('опрос создан с 2 вариантами и сообщением', (select count(*) from public.poll_options)=2 and (select count(*) from public.messages where kind='poll')=1);
insert into public.poll_votes (poll_id, option_id) select v::uuid, (select id from public.poll_options limit 1) from gct.t_ctx where k='poll';
select gct.as_user('00000000-0000-0000-0000-00000000000c');
select gct.check('Carol не видит чужой опрос и голоса', (select count(*) from public.polls)=0 and (select count(*) from public.poll_votes)=0);
do $$ begin begin insert into public.poll_votes (poll_id, option_id) select poll_id, id from (select po.id, po.poll_id from public.poll_options po) s; exception when others then null; end; end $$;
select gct.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.poll_votes (poll_id, option_id) select v::uuid, (select id from public.poll_options order by position desc limit 1) from gct.t_ctx where k='poll';
select gct.check('Bob проголосовал', (select count(*) from public.poll_votes)=2);
do $$ begin begin insert into public.poll_votes (poll_id, user_id, option_id) select v::uuid,'00000000-0000-0000-0000-00000000000a',(select id from public.poll_options limit 1) from gct.t_ctx where k='poll'; raise exception 'FAIL vote as other'; exception when insufficient_privilege or check_violation or unique_violation then raise notice 'PASS нельзя голосовать за другого'; end; end $$;

-- LFG
select gct.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.lfg_posts (game, rank, role, play_time, slots, note) values ('Valorant','Gold','Дуэлянт','вечером',2,'ищу пати');
select gct.as_user('00000000-0000-0000-0000-00000000000c');
select gct.check('LFG публичны для авторизованных', (select count(*) from public.lfg_posts)=1);
do $$ begin begin update public.lfg_posts set note='pwn'; end;
  if (select note from public.lfg_posts limit 1)<>'ищу пати' then raise exception 'FAIL foreign lfg edit'; end if; raise notice 'PASS чужое объявление не меняется';
  begin insert into public.lfg_posts (game, slots) values ('X', 99); raise exception 'FAIL slots'; exception when check_violation then raise notice 'PASS лимит слотов'; end;
  begin insert into public.messages (chat_id, body) select id, repeat('x',2001) from public.chats where kind='channel' limit 1; raise exception 'FAIL long msg'; exception when check_violation then raise notice 'PASS лимит длины сообщения'; end;
end $$;

-- anon ничего не видит
reset role; set role anon;
do $$ begin begin perform count(*) from public.messages; raise exception 'FAIL anon read'; exception when insufficient_privilege then raise notice 'PASS anon не читает messages'; end;
 begin perform count(*) from public.profiles; raise exception 'FAIL anon profiles'; exception when insufficient_privilege then raise notice 'PASS anon не читает profiles'; end;
 begin perform public.open_dm(gen_random_uuid()); raise exception 'FAIL anon rpc'; exception when insufficient_privilege then raise notice 'PASS anon не вызывает open_dm'; end; end $$;
reset role;
