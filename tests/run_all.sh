#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
node tests/logic.test.js
node tests/e2e_demo.js
tests/run_rls.sh
tests/run_e2e_remote.sh
