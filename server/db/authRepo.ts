/**
 * Durable authentication repository (PostgreSQL).
 *
 * The application role cannot read `users`, `sessions` or `audit_log` directly: those
 * tables are protected by RLS and no tenant context exists before login. Everything
 * goes through the SECURITY DEFINER functions in migration 0006, which pin their
 * search_path, validate their inputs and expose only the columns authentication needs.
 *
 * A raw session token never reaches this layer: callers pass the sha256 hash.
 */
import type { Db, TenantContext } from './client';

export interface PgCompanyRow {
  id: string;
  name_ar: string;
  name_en: string;
  tax_id: string;
}

export interface PgUserRow {
  id: string;
  company_id: string;
  username: string;
  password_hash: string;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  phone: string;
  role_level: number;
  assigned_plant_ids: string[] | null;
  is_active: boolean;
  last_login_at: string | Date | null;
  failed_login_attempts: number;
  locked_until: string | Date | null;
}

export interface PgSessionRow {
  session_id: string;
  user_id: string;
  company_id: string;
  expires_at: string | Date;
  user_data: Record<string, unknown>;
}

export interface PgRevokedSession {
  session_id: string;
  user_id: string;
  company_id: string;
  username: string;
}

/** Same field names as the Phase 1 audit entry so callers stay identical. */
export interface AuditEventInput {
  user_id: string | null;
  username: string | null;
  company_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  plant_id?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
  result?: 'success' | 'failure';
}

export interface CreateSessionInput {
  sessionId: string;
  companyId: string;
  userId: string;
  tokenHash: string;
  ip: string;
  device: string;
  idleMinutes: number;
}

export interface MagicIssueRow {
  user_id: string;
  company_id: string;
  username: string;
  expires_at: string | Date;
}

export interface MagicConsumeRow extends PgUserRow {
  session_id: string;
  expires_at: string | Date;
  company_name_ar: string;
  company_name_en: string;
}

const iso = (value: string | Date | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export class PgAuthRepository {
  constructor(private readonly db: Db) {}

  async findCompany(name: string): Promise<PgCompanyRow | null> {
    const rows = await this.db.unsafe<PgCompanyRow>(`select * from auth_find_company($1)`, [name]);
    return rows[0] ?? null;
  }

  async findUser(companyId: string, username: string): Promise<PgUserRow | null> {
    const rows = await this.db.unsafe<PgUserRow>(`select * from auth_find_user($1, $2)`, [
      companyId,
      username,
    ]);
    return rows[0] ?? null;
  }

  async issueMagicToken(
    username: string,
    tokenHash: string,
    companyHint: string,
    ttlMinutes: number,
  ): Promise<MagicIssueRow | null> {
    const rows = await this.db.unsafe<MagicIssueRow>(
      `select * from auth_magic_issue($1, $2, $3, $4)`,
      [username, tokenHash, companyHint, ttlMinutes],
    );
    return rows[0] ?? null;
  }

  async consumeMagicToken(input: {
    magicHash: string;
    sessionId: string;
    sessionHash: string;
    ip: string;
    device: string;
    idleMinutes: number;
  }): Promise<MagicConsumeRow | null> {
    const rows = await this.db.unsafe<MagicConsumeRow>(
      `select * from auth_magic_consume($1, $2, $3, $4, $5, $6)`,
      [
        input.magicHash,
        input.sessionId,
        input.sessionHash,
        input.ip,
        input.device,
        input.idleMinutes,
      ],
    );
    return rows[0] ?? null;
  }

  async recordFailure(
    userId: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<{ failedAttempts: number; lockedUntil: string | null }> {
    const rows = await this.db.unsafe<{ failed_attempts: number; locked_until: string | Date | null }>(
      `select * from auth_login_failed($1, $2, $3)`,
      [userId, maxAttempts, lockoutMinutes],
    );
    return {
      failedAttempts: Number(rows[0]?.failed_attempts ?? 0),
      lockedUntil: iso(rows[0]?.locked_until ?? null),
    };
  }

  async recordSuccess(userId: string): Promise<void> {
    await this.db.unsafe(`select auth_login_succeeded($1)`, [userId]);
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const rows = await this.db.unsafe<{ expires_at: string | Date }>(
      `select expires_at from auth_create_session($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.sessionId,
        input.companyId,
        input.userId,
        input.tokenHash,
        input.ip,
        input.device,
        input.idleMinutes,
      ],
    );
    return iso(rows[0]?.expires_at ?? new Date()) ?? new Date().toISOString();
  }

  async resolveSession(tokenHash: string, idleMinutes: number): Promise<PgSessionRow | null> {
    const rows = await this.db.unsafe<PgSessionRow>(`select * from auth_resolve_session($1, $2)`, [
      tokenHash,
      idleMinutes,
    ]);
    return rows[0] ?? null;
  }

  async revokeSession(tokenHash: string): Promise<PgRevokedSession | null> {
    const rows = await this.db.unsafe<PgRevokedSession>(`select * from auth_revoke_session($1)`, [tokenHash]);
    return rows[0] ?? null;
  }

  async expireSession(tokenHash: string): Promise<PgRevokedSession | null> {
    const rows = await this.db.unsafe<PgRevokedSession>(`select * from auth_expire_session($1)`, [tokenHash]);
    return rows[0] ?? null;
  }

  async audit(event: AuditEventInput): Promise<void> {
    await this.db.unsafe(
      // Cast through text first: a bound string cast straight to jsonb can be stored as a
      // JSON *string*, which then concatenates into an array instead of an object.
      `select auth_audit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,($12::text)::jsonb)`,
      [
        event.company_id,
        event.plant_id ?? null,
        event.user_id,
        event.username ?? '',
        event.action,
        event.table_name,
        event.record_id,
        event.ip_address,
        event.user_agent ?? null,
        event.request_id ?? null,
        event.result ?? 'success',
        JSON.stringify({ schema_version: 2, ...(event.details ?? {}) }),
      ],
    );
  }

  async listAudit(companyId: string, limit = 200): Promise<unknown[]> {
    return this.db.unsafe(
      `select * from auth_list_audit($1, $2)`,
      [companyId, Math.min(Math.max(limit, 1), 500)],
    );
  }

  /**
   * Excel audit feed (gap G2). Read through the tenant context so RLS applies; the
   * `company_id` predicate is explicit so an owner-role diagnostic cannot widen it.
   * Returns only the documented, non-secret columns.
   */
  async listExcelAudit(ctx: TenantContext, limit = 100): Promise<unknown[]> {
    const rows = await this.db.withTenant(ctx, (tx) =>
      tx.unsafe<Record<string, unknown>>(
        `select id, company_id, plant_id, user_id, username, action, table_name, record_id,
                ip_address, request_id, details, created_at
           from audit_log
          where company_id = $1 and action like 'excel.%'
          order by created_at desc, id desc
          limit $2`,
        [ctx.companyId, Math.min(Math.max(limit, 1), 500)],
      ),
    );
    // jsonb may arrive as text depending on the driver configuration; the feed must be JSON.
    return rows.map((row) => {
      const details = normalizeAuditDetails(row.details);
      return { ...row, details, schema_version: details.schema_version };
    });
  }
}


/**
 * Audit details have two historical shapes (gap A1):
 *   v1 — an array, because auth_audit concatenated a JSON *string* parameter with the
 *        result object before the cast was fixed;
 *   v2 — a plain object, written by the current code.
 * The reader normalises both so every consumer sees one shape, tagged with schema_version.
 * The audit table is append-only, so historical rows are interpreted, never rewritten.
 */
export const normalizeAuditDetails = (value: unknown): Record<string, unknown> => {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { schema_version: 1, unreadable: true };
    }
  }
  if (Array.isArray(parsed)) {
    let merged: Record<string, unknown> = {};
    for (const element of parsed) {
      let candidate: unknown = element;
      if (typeof candidate === 'string') {
        try {
          candidate = JSON.parse(candidate);
        } catch {
          continue;
        }
      }
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        merged = { ...merged, ...(candidate as Record<string, unknown>) };
      }
    }
    return { schema_version: 1, ...merged };
  }
  if (parsed && typeof parsed === 'object') {
    const object = parsed as Record<string, unknown>;
    return { schema_version: 2, ...object };
  }
  return { schema_version: 2 };
};

/** Maps a stored user row to the shape the HTTP layer already uses. */
export const safeUserFromRow = (row: PgUserRow | Record<string, unknown>) => {
  const source = row as Record<string, unknown>;
  return {
    id: String(source.id ?? ''),
    username: String(source.username ?? ''),
    full_name_ar: String(source.full_name_ar ?? ''),
    full_name_en: String(source.full_name_en ?? ''),
    email: String(source.email ?? ''),
    phone: String(source.phone ?? ''),
    role_level: Number(source.role_level ?? 1),
    company_id: String(source.company_id ?? ''),
    assigned_plant_ids: asStringArray(source.assigned_plant_ids),
    is_active: source.is_active !== false,
    last_login_at: iso((source.last_login_at as string | Date | null) ?? null),
  };
};
