# Environment audit (actual findings)

Captured by executing commands in the Cloud runner on 2026-10-30, at commit
`5f90ccc`. Nothing in this file is inferred; commands and their outcomes are listed.

## Host and runtimes

| Item | Actual value | Command |
|---|---|---|
| Kernel / arch | `Linux 6.1.102 x86_64` | `uname -srm` |
| Bun | `1.3.14` | `bun --version` |
| Node | `v24.21.0` (present, not used by the app) | `node --version` |
| Python (system) | `3.12.3` | `python3 --version` |
| Python (project) | `.venv/bin/python` exists, has `openpyxl` + `pytest` | `ls .venv/bin/python`, `pytest -q` |
| Project workspace | `/workspace/chats/3318fcb7638ea9fe2b6f40b8` | — |

## Tooling

| Tool | Status | Consequence |
|---|---|---|
| `git` | present (`/usr/bin/git`) | local commits work; no remote configured |
| `gh` | installed, **not authenticated** | repository creation/push BLOCKED |
| `docker` | installed, socket root-only in earlier runs | not used for PostgreSQL |
| `psql` / `postgres` / `initdb` | **absent from PATH** | no host database server |
| `curl` | present | API smoke tests possible |
| Chromium / Playwright | not installed by the project | no browser-level verification |
| `node_modules` | absent after each runner restart | `bun install` required before checks |

## Database availability

- No PostgreSQL server or client is installed on the host image.
- For verification I installed `pgserver` into **`/tmp/pgvenv` only** (test tooling,
  never a project dependency) and ran a real **PostgreSQL 16.2** on `127.0.0.1:55432`.
- `/tmp` is not durable: after the runner restarted, `/tmp/pgvenv` and the cluster were
  gone. The database must be re-provisioned before re-running integration tests.
- The application itself needs no npm database driver: it uses Bun's built-in `Bun.SQL`.

Re-provision command used (documented for reproduction, not part of the app):

```bash
python3 -m venv /tmp/pgvenv && /tmp/pgvenv/bin/pip install -q pgserver
PGBIN=/tmp/pgvenv/lib/python3.12/site-packages/pgserver/pginstall/bin
$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust
$PGBIN/pg_ctl -D /tmp/pgdata -l /tmp/pg.log -o "-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1" start
$PGBIN/createdb -h 127.0.0.1 -p 55432 -U postgres iconcrete
export DATABASE_URL="postgres://postgres@127.0.0.1:55432/iconcrete"
bun run db:migrate && bun run db:seed
```

## Commands that exist and were executed

| Command | Result at `5f90ccc` |
|---|---|
| `bun install` | 248 packages installed, exit 0 |
| `bun run typecheck` | exit 0 |
| `bun test` (with `DATABASE_URL`, `ICONCRETE_RLS_URL`) | 140 pass / 0 fail / 0 skip, 12 files, 1927 assertions |
| `bun test` (no database) | 107 pass / 19 skip / 0 fail |
| `bun run build` | exit 0 (pre-existing chunk-size warning) |
| `.venv/bin/python -m pytest excel_generator/tests -q` | 28 passed |
| `.venv/bin/python excel_generator/generate_workbook.py --output-dir …` | exit 0, 15 RTL sheets, 3 charts, 12/12 seeded scenarios |
| `bun run db:migrate` / `db:seed` (twice) | 7 migrations applied; re-seed exit 0 both times |
| `bun run api` + `curl` smoke | health durable, login 200, me 200, logout 200, me after logout 401 |

## Restrictions discovered

1. **No GitHub authentication** in this environment. No repository was created or pushed;
   the local history at `5f90ccc` is intact and no remote exists.
2. **No durable database process.** Integration tests skip themselves with an explicit
   reason when `DATABASE_URL` is unset — they never report as passes.
3. **No browser automation tooling** is provisioned, so UI behaviour is unverified at the
   browser level (HTTP/`createApp` and unit tests only).
4. The Cloud sandbox has **no system package installation persistence**; anything installed
   outside the workspace must be re-created.
