#!/usr/bin/env bash
# Локальная проверка schema.sql + RLS на чистом Postgres (нужен postgresql и sudo). Не трогает Supabase.
set -e
cd "$(dirname "$0")/.."
P="sudo -n -u postgres psql -q -v ON_ERROR_STOP=1 -d gc_test"
sudo -n -u postgres psql -q -c "drop database if exists gc_test with (force)" -c "create database gc_test"
$P -f "$PWD/tests/mock_supabase_env.sql" 2>&1 | { grep -v -i "wal_level\|HINT" || true; }
$P -f "$PWD/supabase/schema.sql" 2>&1 | grep -v "NOTICE.*does not exist, skipping" || true
$P -f "$PWD/tests/rls.test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed "s/^psql:[^ ]* //"; exit ${PIPESTATUS[0]}
