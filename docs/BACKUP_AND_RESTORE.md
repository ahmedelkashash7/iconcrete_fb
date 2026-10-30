# Backup and restore

There is no Git remote yet (`gh` is unauthenticated in this environment), so the repository
is backed up as two artifacts outside version control:

| Artifact | Purpose | Contents |
|---|---|---|
| `IConcrete-<commit>.bundle` | full history + branches | everything `git bundle create --all` records |
| `IConcrete-<commit>.tar.gz` | tracked working tree | `git archive` output of the commit |

Both are generated from a **committed** state, so a restore never depends on uncommitted
files. `node_modules`, `.venv`, `.verify`, `dist` and secrets are never included.

## Create

```bash
COMMIT="$(git rev-parse --short HEAD)"
mkdir -p artifacts
git bundle create "artifacts/IConcrete-$COMMIT.bundle" --all
git archive --format=tar.gz -o "artifacts/IConcrete-$COMMIT.tar.gz" HEAD
git bundle verify "artifacts/IConcrete-$COMMIT.bundle"
sha256sum artifacts/IConcrete-$COMMIT.* | tee "artifacts/IConcrete-$COMMIT.sha256"
```

## Restore from the bundle (preferred: keeps history)

```bash
mkdir -p /tmp/iconcrete-restore && cd /tmp/iconcrete-restore
git clone /path/to/IConcrete-<commit>.bundle repo
cd repo
git log --oneline -1          # must equal <commit>
bun install --frozen-lockfile
bash scripts/verify.sh        # provisions its own PostgreSQL; skip count must be 0
```

## Restore from the archive (tree only)

```bash
mkdir -p /tmp/iconcrete-tree && tar -xzf IConcrete-<commit>.tar.gz -C /tmp/iconcrete-tree
cd /tmp/iconcrete-tree
bun install --frozen-lockfile
bash scripts/verify.sh
```

A restore is only successful when `scripts/verify.sh` exits 0 in the new directory **and**
its output shows `skip=0` with the PostgreSQL suites present. A `git clone` of a bundle that
merely opens is not proof.

## Database backups (not yet implemented)

The repository backup does not contain PostgreSQL data. A production backup must add
`pg_dump --format=custom` on a schedule, a retention policy, and a **restore drill** with a
measured restore time. That drill does not exist yet and is tracked as G5 in
`docs/ISSUES_AND_GAPS.md`.

## Credentials

Never place `DATABASE_URL`, `ICONCRETE_DEMO_ADMIN_PASSWORD` or any token in an artifact,
commit, archive or shell history. The verification script generates a throwaway trust-auth
cluster under `.verify/` and passes URLs through environment variables only.
