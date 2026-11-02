# Rollback

Three independent rollbacks: code, schema, data. Each one is verified by a command in this
repository; none of them is a claim about a deployment, because no deployment exists.

## 1. Code rollback

```bash
git log --oneline -5
git switch -c rollback/<date> <known-good-commit>   # or: git reset --hard <commit> on a private branch
bun install --frozen-lockfile
bun run build
bash scripts/verify.sh
```

Rules:
- Never `git push --force` to a shared branch; create a revert commit instead.
- A rollback commit must keep the verification gate green (`pass>0 fail=0 skip=0`).
- Last known-good tips: `66d6e1a` (B2 CSV staging) and the B3 tip on this branch (design
  system, accessibility audit, docs). Both passed `verify.sh` when they were written.

## 2. Schema rollback

Migrations are forward-only and checksum-guarded (`server/db/migrate.ts`). There is no
`down` migration, by design: dropping tenant tables would destroy audit evidence.

To undo a schema change:

1. Write a **new** migration that reverses it (`0012_…`), e.g. `drop table if exists …`.
2. Apply it with `bun run db:migrate` and re-run `bun run schema:docs`.
3. Never edit an applied migration: the runner refuses it (`checksum drift`), and the
   correct response is a new migration — exactly what B3 did when `0010` needed `version`.

`0010` (csv_staging) and `0011` (its `version` column) are additive. Rolling them back means
dropping `csv_staging` after exporting `csv_staging` rows for the retention period.

## 3. Data rollback

```bash
# create a dump (verified by the drill)
pg_dump --format=custom --file=backup.dump "$DATABASE_URL"
# restore into a fresh database, then verify counts/audit rows
bash scripts/backup-restore-drill.sh
```

The drill restores into a separate database, verifies table/RLS/user/audit counts and only
then reports `DRILL PASSED`. Last measured run: **49 tables, 45 RLS tables, 6 users,
1 audit row restored and verified**.

`audit_log` is append-only at the database level; a restore is the only supported way to
change history, and the drill proves the restored copy matches the source row counts.

## Rollback decision table

| Symptom | Action | Verify with |
|---|---|---|
| Bad UI release | redeploy the previous `dist/` + entry chunk set | load `/`, check console-free boot |
| Bad API release | previous build, same schema | `bash scripts/verify.sh` |
| Bad migration | new reversing migration | `bun run db:status`, `bun test` |
| Data corruption | restore dump into a new DB, switch `DATABASE_URL` | `scripts/backup-restore-drill.sh` |
| Lost secrets | rotate in the secret store, restart API | login + one authenticated read |

## What rollback cannot fix

- Uploaded Excel/CSV files already committed into business tables: reverse with a new
  compensating transaction, not a restore, if other tenants wrote data in the meantime.
- Deleting `audit_log` rows: blocked by the append-only trigger; use retention policy
  (documented gap G8), never a manual `delete`.
