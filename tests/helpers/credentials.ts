/**
 * Generated per test process unless the runner supplies a deterministic test-only value.
 * The database seed and the test process must use the same value when the PostgreSQL
 * suites run; otherwise every authenticated test fails with 423 account_locked.
 * Tests must never contain a real or published credential.
 */
export const TEST_ADMIN_PASSWORD =
  process.env.ICONCRETE_TEST_ADMIN_PASSWORD?.trim() || `test-${crypto.randomUUID()}`;
export const TEST_DEMO_LIKE_PASSWORD = `demo-${crypto.randomUUID()}`;
