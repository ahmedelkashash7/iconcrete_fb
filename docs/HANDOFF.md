# HANDOFF — ICONCRETE

Updated: 2026-11-08
- State: M1–M9 delivered; migrations 0001–0022; 108 tables; PostgreSQL RLS; bilingual React UI.
- Tip at handoff: AUTH login-stack commit on this branch; archive `ICONCRETE-clean-delivery-c20bd14.tar.gz` predates it.
- Verification: fresh PostgreSQL database, migrate + seed, full `bun test`: 383 pass, 0 fail, 40 files (2026-11-08); typecheck and build pass.
- Blocker: login from a sandboxed iframe preview on Android returns generic Arabic error; direct API login is proven `200`.
- Hypothesis: the preview drops the session cookie; bearer in `localStorage` and magic link are both shipped as fallbacks.
- Login stack: explicit error codes, bearer+cookie transport, `/api/auth/me` persistence ping, magic login.
- Magic login is gated by `ICONCRETE_MAGIC_LOGIN=true`; **REMOVE BEFORE PRODUCTION**.
- Do not declare preview login fixed until the user confirms landing on HOME in their own words.
- If login still fails, collect one exact error code and make at most one small follow-up commit.
- After confirmation: M10 KPIs/dashboards/alerts/CSV and `kpi_daily_snapshots`; then Phase 3 closure report (§63, 20 items).
- Engineering values remain “not specified in the supplied reference”; configurable with no invented defaults (ECP 203-2007 file absent).
