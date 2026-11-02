# PostgreSQL backup and restore drill

Executable, local, throwaway. Run:

```bash
bash scripts/backup-restore-drill.sh
```

The script creates its own cluster on `127.0.0.1:55441` under `.verify/drill/` (gitignored),
migrates, seeds, inserts representative auth/import/accounting/audit rows, then:

1. `pg_dump -Fc` (custom format, not plain SQL) into `.verify/drill/`.
2. Creates a fresh empty database and re-creates the `iconcrete_app` role — `pg_dump` never
   contains roles, and the restore needs it for grants. **No password is written**; the local
   cluster uses trust auth on loopback only.
3. `pg_restore --no-owner --exit-on-error`.
4. Re-applies `USAGE`/`SELECT,INSERT,UPDATE,DELETE` grants and sequence usage.
5. Verifies: table count, RLS-enabled count, forced-RLS count, user rows, staged import checksum,
   audit rows, invoice checksum, journal-line checksum, per-table row counts (diff), session
   resolution through `auth_resolve_session`, zero unbalanced entries, and three RLS checks
   through the restricted role (own tenant visible, foreign tenant invisible, no context = none).

Result of the recorded run: **PASSED — 46 tables, 42 RLS tables, 6 users, 1 audit row restored**.

## Limitations (explicit)

- Logical backup/restore only. No WAL archiving, PITR, replication or recovery-time objective.
- No encryption at rest or in transit in this drill; production must supply both.
- Trust authentication on loopback is a drill convenience, never a deployment configuration.
- Dumps and logs are never committed; `.verify/` is gitignored.
- The drill does not prove application-level upgrade migrations; it restores into the same
  schema version it dumped.
