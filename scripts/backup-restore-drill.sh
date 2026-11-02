#!/usr/bin/env bash
# ICONCRETE — executable PostgreSQL backup/restore drill (gap G4).
#
# Creates a throwaway cluster, migrates, seeds, adds representative durable auth,
# import, accounting and audit rows, dumps with `pg_dump -Fc`, restores into a fresh
# empty database with a re-created application role, re-applies grants, and then proves
# that schema, RLS, auth, staged imports, the ledger and audit survived — comparing row
# counts and checksums between source and restore.
#
# Nothing here is committed: the cluster, dump and logs live under .verify/ (gitignored).
# No password is written anywhere; the local cluster uses trust auth on loopback.
#
#   bash scripts/backup-restore-drill.sh
#   ICONCRETE_DRILL_PG_PORT=55441 ICONCRETE_DRILL_KEEP=1 bash scripts/backup-restore-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WORK="${ICONCRETE_DRILL_DIR:-$ROOT/.verify/drill}"
PORT="${ICONCRETE_DRILL_PG_PORT:-55441}"
DATA="$WORK/pgdata"
SOCK="$WORK/sock"
DUMP="$WORK/iconcrete.drill.dump"
LOG="$WORK/postgres.log"
SRC_DB="iconcrete_drill"
DST_DB="iconcrete_restore_drill"
APP_ROLE="iconcrete_app"
PG_BIN=""
STARTED=0

say() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'DRILL FAILED: %s\n' "$1" >&2; exit 1; }

stop_pg() {
  if [[ "$STARTED" == "1" && -n "$PG_BIN" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
  fi
}
trap stop_pg EXIT

say "locate PostgreSQL client binaries"
if command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v pg_dump)")"
else
  CANDIDATE="$(find "$ROOT/.verify" -path '*/pgserver/pginstall/bin/pg_dump' -print -quit 2>/dev/null || true)"
  [[ -n "$CANDIDATE" ]] || die "pg_dump/pg_restore are unavailable; the drill cannot run here"
  PG_BIN="$(dirname "$CANDIDATE")"
fi
for tool in initdb pg_ctl psql createdb pg_dump pg_restore; do
  [[ -x "$PG_BIN/$tool" ]] || die "$tool is unavailable in $PG_BIN"
done
printf 'binaries: %s\n' "$PG_BIN"
"$PG_BIN/pg_dump" --version

q() { # q <database> <sql>
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" -tAc "$2"
}

say "start a clean cluster"
rm -rf "$WORK"
mkdir -p "$DATA" "$SOCK"
"$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust >"$WORK/initdb.log" 2>&1 || die "initdb"
"$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" \
  -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" start >/dev/null || die "pg_ctl start"
STARTED=1
for _ in $(seq 1 30); do
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

say "migrate and seed the source database"
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$SRC_DB"
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/$SRC_DB"
bun run db:migrate >/dev/null || die "migrations"
bun run db:seed >/dev/null || die "seed"

say "insert representative auth, import, accounting and audit rows"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$SRC_DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into sessions (id, company_id, user_id, token_hash, ip_address, device_info,
                      created_at, last_seen_at, expires_at)
select 'SES-DRILL-1', u.company_id, u.id, repeat('a', 64), '127.0.0.1', 'drill',
       now(), now(), now() + interval '1 hour'
  from users u order by u.id limit 1;

insert into staged_imports (id, company_id, template_id, template_version, schema_version,
                            file_name, checksum, byte_size, result, created_by)
select 'STG-DRILL-1', u.company_id, 'customers', '1.1.0', '1.1.0', 'drill.xlsx',
       'sha256:drill-1', 128,
       '{"templateId":"customers","templateVersion":"1.1.0","rows":[],"summary":{"totalRows":0,"validRows":0,"errorRows":0,"errorCount":0,"warningCount":0,"duplicateIds":[]}}'::jsonb,
       'drill'
  from users u order by u.id limit 1;

insert into audit_log (company_id, user_id, username, action, table_name, record_id, request_id, details)
select u.company_id, u.id, 'drill', 'excel.staged_created', 'excel_imports', 'STG-DRILL-1',
       'REQ-DRILL-1', '{"checksum":"sha256:drill-1","stagedId":"STG-DRILL-1"}'::jsonb
  from users u order by u.id limit 1;
SQL

say "capture source facts (schema, RLS, counts, checksums)"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$SRC_DB" -tA \
  -c "select tablename from pg_tables where schemaname = 'public' order by tablename" \
  >"$WORK/tables.txt"
SRC_TABLES="$(wc -l <"$WORK/tables.txt")"
: >"$WORK/src-counts.txt"
while read -r t; do printf '%s:%s\n' "$t" "$(q "$SRC_DB" "select count(*) from \"$t\"")" >>"$WORK/src-counts.txt"; done <"$WORK/tables.txt"

SRC_RLS="$(q "$SRC_DB" "select count(*) from pg_tables where schemaname='public' and rowsecurity")"
SRC_FORCED="$(q "$SRC_DB" "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relforcerowsecurity")"
SRC_USERS="$(q "$SRC_DB" "select count(*) from users")"
SRC_AUDIT="$(q "$SRC_DB" "select count(*) from audit_log")"
SRC_INVOICE_SUM="$(q "$SRC_DB" "select coalesce(md5(string_agg(id || ':' || grand_total, ',' order by id)), 'empty') from invoices")"
SRC_LEDGER_SUM="$(q "$SRC_DB" "select coalesce(md5(string_agg(entry_id || ':' || debit || ':' || credit, ',' order by entry_id, line_no)), 'empty') from journal_entry_lines")"
SRC_STAGED="${SRC_STAGED:-}"
SRC_STAGED="$(q "$SRC_DB" "select checksum from staged_imports where id='STG-DRILL-1'")"
printf 'tables=%s rls=%s forced=%s users=%s audit=%s\n' "$SRC_TABLES" "$SRC_RLS" "$SRC_FORCED" "$SRC_USERS" "$SRC_AUDIT"

say "pg_dump (custom format, not plain SQL)"
"$PG_BIN/pg_dump" -h 127.0.0.1 -p "$PORT" -U postgres -Fc -f "$DUMP" "$SRC_DB" || die "pg_dump"
printf 'dump: %s (%s bytes)\n' "$DUMP" "$(wc -c <"$DUMP")"

say "create an empty database and the required role"
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$DST_DB"
# pg_dump never contains roles, so the application role must exist before restore.
q postgres "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$APP_ROLE') then create role $APP_ROLE login; end if; end \$\$"
# Deliberately no password: the local cluster uses trust auth on loopback.

say "pg_restore"
"$PG_BIN/pg_restore" -h 127.0.0.1 -p "$PORT" -U postgres -d "$DST_DB" --no-owner --exit-on-error "$DUMP" \
  || die "pg_restore"

say "re-apply grants and verify RLS configuration"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d "$DST_DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
grant usage on schema public to $APP_ROLE;
grant select, insert, update, delete on all tables in schema public to $APP_ROLE;
grant usage, select on all sequences in schema public to $APP_ROLE;
SQL

FAILURES=0
check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    printf 'ok   %-42s %s\n' "$1" "$3"
  else
    printf 'FAIL %-42s expected=%s actual=%s\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

DST_TABLES="$(q "$DST_DB" "select count(*) from pg_tables where schemaname='public'")"
DST_RLS="$(q "$DST_DB" "select count(*) from pg_tables where schemaname='public' and rowsecurity")"
DST_FORCED="$(q "$DST_DB" "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relforcerowsecurity")"
DST_USERS="$(q "$DST_DB" "select count(*) from users")"
DST_AUDIT="$(q "$DST_DB" "select count(*) from audit_log")"
DST_INVOICE_SUM="$(q "$DST_DB" "select coalesce(md5(string_agg(id || ':' || grand_total, ',' order by id)), 'empty') from invoices")"
DST_LEDGER_SUM="$(q "$DST_DB" "select coalesce(md5(string_agg(entry_id || ':' || debit || ':' || credit, ',' order by entry_id, line_no)), 'empty') from journal_entry_lines")"
DST_STAGED="$(q "$DST_DB" "select checksum from staged_imports where id='STG-DRILL-1'")"

check "schema: public tables" "$SRC_TABLES" "$DST_TABLES"
check "RLS: tables with rowsecurity" "$SRC_RLS" "$DST_RLS"
check "RLS: forced tables" "$SRC_FORCED" "$DST_FORCED"
check "auth: user rows" "$SRC_USERS" "$DST_USERS"
check "imports: staged checksum" "$SRC_STAGED" "$DST_STAGED"
check "audit: rows" "$SRC_AUDIT" "$DST_AUDIT"
check "accounting: invoice checksum" "$SRC_INVOICE_SUM" "$DST_INVOICE_SUM"
check "accounting: ledger line checksum" "$SRC_LEDGER_SUM" "$DST_LEDGER_SUM"

: >"$WORK/dst-counts.txt"
while read -r t; do printf '%s:%s\n' "$t" "$(q "$DST_DB" "select count(*) from \"$t\"")" >>"$WORK/dst-counts.txt"; done <"$WORK/tables.txt"
if diff -u "$WORK/src-counts.txt" "$WORK/dst-counts.txt" >"$WORK/counts.diff"; then
  printf 'ok   %-42s %s tables\n' "row counts: source vs restore" "$DST_TABLES"
else
  printf 'FAIL row counts differ\n'; head -20 "$WORK/counts.diff"; FAILURES=$((FAILURES + 1))
fi

AUTH_SESSION="$(q "$DST_DB" "select count(*) from auth_resolve_session(repeat('a',64), 60)")"
check "auth: session resolves after restore" "1" "$AUTH_SESSION"
UNBALANCED="$(q "$DST_DB" "select count(*) from (select entry_id from journal_entry_lines group by entry_id having sum(debit) <> sum(credit)) bad")"
check "ledger: unbalanced posted entries" "0" "$UNBALANCED"
DRILL_AUDIT="$(q "$DST_DB" "select count(*) from audit_log where request_id='REQ-DRILL-1'")"
check "audit: drill event survived" "1" "$DRILL_AUDIT"

say "RLS through the restricted application role"
COMPANY_A="$(q "$DST_DB" "select company_id from users order by id limit 1")"
OTHER_COMPANY="$(q "$DST_DB" "select id from companies where id <> '$COMPANY_A' order by id limit 1")"
APP_URL="postgres://$APP_ROLE@127.0.0.1:$PORT/$DST_DB"
# `-q` suppresses BEGIN/ROLLBACK command tags so only query output is parsed.
APP_COUNT_A="$("$PG_BIN/psql" "$APP_URL" -q -tAc "begin; select set_config('app.company_id','$COMPANY_A',true); select count(*) from customers; rollback;" | sed -n '2p')"
APP_COUNT_B="$("$PG_BIN/psql" "$APP_URL" -q -tAc "begin; select set_config('app.company_id','$OTHER_COMPANY',true); select count(*) from customers where company_id = '$COMPANY_A'; rollback;" | sed -n '2p')"
APP_NO_CONTEXT="$("$PG_BIN/psql" "$APP_URL" -q -tAc "select count(*) from customers")"
[[ "${APP_COUNT_A:-}" =~ ^[0-9]+$ ]] || APP_COUNT_A=0
check "RLS: app role sees own tenant rows" "1" "$([[ "$APP_COUNT_A" -gt 0 ]] && echo 1 || echo 0)"
check "RLS: app role cannot read another tenant" "0" "${APP_COUNT_B:-x}"
check "RLS: app role without context sees nothing" "0" "${APP_NO_CONTEXT:-x}"

if [[ "$FAILURES" -gt 0 ]]; then
  printf '\nDRILL FAILED: %s check(s)\n' "$FAILURES" >&2
  exit 1
fi

printf '\nDRILL PASSED: %s tables, %s RLS tables, %s users, %s audit rows restored and verified.\n' \
  "$DST_TABLES" "$DST_RLS" "$DST_USERS" "$DST_AUDIT"
printf 'dump and logs: %s (gitignored, never committed)\n' "$WORK"
