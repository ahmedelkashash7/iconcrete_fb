/**
 * Tenant organisation read models (gap G1).
 *
 * `/api/plants` and `/api/users` used to read the in-memory demo dataset even in postgres
 * mode, which meant a real tenant got a 403 or another company's rows. These loaders run
 * inside `withTenant`, so RLS filters by company, and they additionally narrow to the
 * caller's assigned plants. The explicit `company_id = $1` predicate keeps the query
 * honest even when an owner role (which bypasses RLS) is used for diagnostics.
 */
import type { Db, TenantContext } from './client';

export interface TenantCompanyRead {
  id: string;
  name_ar: string;
  name_en: string;
  tax_id: string;
}

export interface TenantPlantRead {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string;
  city: string;
  capacity_m3_per_hour: number;
  is_active: boolean;
}

export interface TenantUserRead {
  id: string;
  company_id: string;
  username: string;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  phone: string;
  role_level: number;
  assigned_plant_ids: string[];
  is_active: boolean;
  last_login_at: string | null;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Bun returns text[] as an array; a raw string fixture may still look like `{a,b}`. */
const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    const inner = value.replace(/^\{/, '').replace(/\}$/, '').trim();
    return inner === '' ? [] : inner.split(',').map((item) => item.replace(/^"|"$/g, ''));
  }
  return [];
};

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Assigned plants are passed as a comma string: Bun cannot bind a JS array to text[]. */
const plantCsv = (ctx: TenantContext): string => ctx.plantIds.join(',');

export const loadCompanyForTenant = async (
  db: Db,
  ctx: TenantContext,
): Promise<TenantCompanyRead | null> => {
  const rows = await db.withTenant(ctx, (tx) =>
    tx.unsafe<Row>(
      `select id, name_ar, name_en, tax_id
         from companies
        where id = $1 and deleted_at is null`,
      [ctx.companyId],
    ),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: str(row.id),
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    tax_id: str(row.tax_id),
  };
};

export const loadPlantsForTenant = async (
  db: Db,
  ctx: TenantContext,
): Promise<TenantPlantRead[]> => {
  const rows = await db.withTenant(ctx, (tx) =>
    tx.unsafe<Row>(
      `select id, company_id, name_ar, name_en, city, capacity_m3_per_hour, is_active
         from plants
        where company_id = $1
          and deleted_at is null
          and ($2 = '' or id = any(string_to_array($2, ',')))
        order by id`,
      [ctx.companyId, plantCsv(ctx)],
    ),
  );
  return rows.map((row) => ({
    id: str(row.id),
    company_id: str(row.company_id),
    name_ar: str(row.name_ar),
    name_en: str(row.name_en),
    city: str(row.city),
    capacity_m3_per_hour: num(row.capacity_m3_per_hour),
    is_active: row.is_active !== false,
  }));
};

/**
 * Users visible to the caller. A company-wide role (empty plantIds) sees every user in the
 * company; a plant-scoped role only sees users assigned to at least one of its plants.
 * Password hashes never leave this layer.
 */
export const loadUsersForTenant = async (db: Db, ctx: TenantContext): Promise<TenantUserRead[]> => {
  const rows = await db.withTenant(ctx, (tx) =>
    tx.unsafe<Row>(
      `select id, company_id, username, full_name_ar, full_name_en, email, phone,
              role_level, assigned_plant_ids, is_active, last_login_at
         from users
        where company_id = $1
          and deleted_at is null
          and ($2 = '' or coalesce(assigned_plant_ids, '{}'::text[]) && string_to_array($2, ','))
        order by role_level desc, username`,
      [ctx.companyId, plantCsv(ctx)],
    ),
  );
  return rows.map((row) => ({
    id: str(row.id),
    company_id: str(row.company_id),
    username: str(row.username),
    full_name_ar: str(row.full_name_ar),
    full_name_en: str(row.full_name_en),
    email: str(row.email),
    phone: str(row.phone),
    role_level: num(row.role_level),
    assigned_plant_ids: toArray(row.assigned_plant_ids),
    is_active: row.is_active !== false,
    last_login_at: iso(row.last_login_at),
  }));
};
