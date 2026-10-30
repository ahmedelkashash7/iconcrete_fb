#!/usr/bin/env bash
# ICONCRETE — reproducible verification.
#
# Provisions a throwaway PostgreSQL with pgserver, applies migrations, seeds, then runs
# typecheck, the full test suite (asserting zero skips), the production build, the Python
# tests and the Excel generator. Every step's real exit status is preserved.
#
#   bash scripts/verify.sh
#   ICONCRETE_VERIFY_DATABASE_URL=postgres://... bash scripts/verify.sh   # reuse a server
#
# Never runs against a database it did not create unless that URL is passed explicitly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WORK="${ICONCRETE_VERIFY_DIR:-$ROOT/.verify}"
PGPORT="${ICONCRETE_VERIFY_PG_PORT:-55440}"
PGDATA="$WORK/pgdata"
PGSOCK="$WORK/pgsock"
PGBIN=""
PG_STARTED=0
STATUS=0

mkdir -p "$WORK"

cleanup() {
  if [[ "$PG_STARTED" == "1" && -n "$PGBIN" ]]; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

step() { printf '\n=== %s ===\n' "$1"; }
fail_step() { printf 'FAILED: %s\n' "$1"; STATUS=1; }

step "bun install"
bun install --frozen-lockfile || { fail_step "bun install"; exit 1; }

step "postgres"
if [[ -n "${ICONCRETE_VERIFY_DATABASE_URL:-}" ]]; then
  DATABASE_URL="$ICONCRETE_VERIFY_DATABASE_URL"
  echo "using caller-supplied database"
else
  if [[ ! -x "$WORK/pyvenv/bin/python" ]]; then
    python3 -m venv "$WORK/pyvenv"
    "$WORK/pyvenv/bin/pip" install --quiet --upgrade pip
    "$WORK/pyvenv/bin/pip" install --quiet "pgserver>=0.1"
  fi
  PGBIN="$(echo "$WORK"/pyvenv/lib/python*/site-packages/pgserver/pginstall/bin)"
  [[ -x "$PGBIN/pg_ctl" ]] || { echo "pgserver binaries not found in $PGBIN"; exit 1; }
  if [[ ! -d "$PGDATA" ]]; then
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >"$WORK/initdb.log" 2>&1
  fi
  mkdir -p "$PGSOCK"
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$WORK/postgres.log" \
    -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1" start >/dev/null
  PG_STARTED=1
  for _ in $(seq 1 60); do
    "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -c 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -c 'select 1' >/dev/null 2>&1 \
    || { echo "postgres did not become ready"; tail -20 "$WORK/postgres.log"; exit 1; }
  "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U postgres iconcrete 2>/dev/null || true
  DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/iconcrete"
fi
export DATABASE_URL
export ICONCRETE_RLS_URL="${ICONCRETE_VERIFY_RLS_URL:-postgres://iconcrete_app@$(echo "$DATABASE_URL" | sed -E 's#^postgres://[^@]*@##')}"
# ICONCRETE_STORAGE_MODE is intentionally left unset: the API tests construct the app with
# explicit settings, and the database tests read DATABASE_URL directly.

step "migrate"
bun run db:migrate || { fail_step "db:migrate"; exit 1; }

step "seed"
bun run db:seed || { fail_step "db:seed"; exit 1; }

step "typecheck"
if bun run typecheck; then echo "typecheck: PASS"; else fail_step "typecheck"; fi

step "tests"
TEST_LOG="$WORK/tests.log"
if bun test 2>&1 | tee "$TEST_LOG"; then :; else fail_step "bun test"; fi
PASS="$(sed -n 's/^ *\([0-9][0-9]*\) pass$/\1/p' "$TEST_LOG" | tail -1)"
FAIL="$(sed -n 's/^ *\([0-9][0-9]*\) fail$/\1/p' "$TEST_LOG" | tail -1)"
SKIP="$(sed -n 's/^ *\([0-9][0-9]*\) skip$/\1/p' "$TEST_LOG" | tail -1)"
# Bun omits the "skip" summary line when nothing was skipped, so empty means zero.
SKIP="${SKIP:-0}"
printf '\ntest counts: pass=%s fail=%s skip=%s\n' "${PASS:-?}" "${FAIL:-?}" "$SKIP"
[[ "$SKIP" == "0" ]] || { echo "FAILED: $SKIP tests were skipped; the PostgreSQL suite must run"; STATUS=1; }
[[ "${FAIL:-1}" == "0" ]] || STATUS=1
[[ -n "${PASS:-}" ]] || { echo "FAILED: could not read the pass count"; STATUS=1; }
# A zero skip count alone would also be true if a suite vanished, so require the evidence.
for marker in "durable staged imports" "database-backed read models" "postgres adapter"; do
  grep -q "$marker" "$TEST_LOG" || { echo "FAILED: database suite did not run ($marker missing)"; STATUS=1; }
done

step "build"
if bun run build; then echo "build: PASS"; else fail_step "build"; fi

step "python"
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/pip install --quiet -r excel_generator/requirements.txt
fi
PYTEST_LOG="$WORK/pytest.log"
if .venv/bin/python -m pytest excel_generator/tests -q 2>&1 | tee "$PYTEST_LOG"; then :; else fail_step "pytest"; fi
PY_PASS="$(sed -n 's/^\([0-9][0-9]*\) passed.*/\1/p' "$PYTEST_LOG" | tail -1)"
printf 'pytest count: %s passed\n' "${PY_PASS:-?}"

step "excel generator"
if .venv/bin/python excel_generator/generate_workbook.py --output-dir "$WORK/excel"; then
  ls -l "$WORK/excel" | tail -3
else
  fail_step "excel generator"
fi

printf '\n=== verify summary ===\n'
printf 'pass=%s fail=%s skip=%s typecheck/build/pytest/generator=%s\n' \
  "${PASS:-?}" "${FAIL:-?}" "${SKIP:-?}" "$([[ $STATUS == 0 ]] && echo ok || echo FAILED)"
exit "$STATUS"
