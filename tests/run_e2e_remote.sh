#!/usr/bin/env bash
# Поднимает чистую БД gc_test со schema.sql, роль authenticator для PostgREST и запускает e2e клиента против локального стенда.
# Нужны: postgresql, sudo, бинарник PostgREST (/workspace/gc-tools/postgrest), puppeteer-core, Chrome.
set -e
cd "$(dirname "$0")/.."
PSQL="sudo -n -u postgres psql -q -v ON_ERROR_STOP=1"
$PSQL -c "drop database if exists gc_test with (force)" -c "create database gc_test"
$PSQL -d gc_test -f "$PWD/tests/mock_supabase_env.sql" 2>&1 | { grep -v -i "wal_level\|HINT" || true; }
$PSQL -d gc_test -f "$PWD/supabase/schema.sql" 2>&1 | { grep -v "does not exist, skipping" || true; }
$PSQL -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpw'; end if; end \$\$" -c "grant anon, authenticated to authenticator"
$PSQL -d gc_test -c "grant usage on schema public to authenticator" -c "grant connect on database gc_test to authenticator"
node tests/e2e_remote.js
