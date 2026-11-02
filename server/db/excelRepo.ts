/**
 * Tenant-scoped Excel validation context (gap G6).
 *
 * The browser preview uses the demo fixture; the server must validate against the rows
 * that actually belong to the caller's company. Reading inside `withTenant` means RLS
 * cannot leak another tenant's ids, and broken references are caught before staging.
 */
import type { Db, TenantContext } from './client';
import type { ReferenceIndex, ValidationContext } from '../../src/core/validation';

type Row = { id?: string; code?: string; cheque_no?: string };

const strings = (rows: readonly Row[], key: 'id' | 'code' | 'cheque_no'): string[] =>
  rows
    .map((row) => (row[key] === undefined ? '' : String(row[key])))
    .filter((value) => value !== '');

export const loadExcelContext = async (
  db: Db,
  ctx: TenantContext,
  templateId: string,
): Promise<ValidationContext> =>
  db.withTenant(ctx, async (tx) => {
    const company = ctx.companyId;
    const customers = strings(
      await tx.unsafe<Row>(
        `select id from customers where company_id = $1 and deleted_at is null`,
        [company],
      ),
      'id',
    );
    const suppliers = strings(
      await tx.unsafe<Row>(
        `select id from suppliers where company_id = $1 and deleted_at is null`,
        [company],
      ),
      'id',
    );
    const plants = strings(
      await tx.unsafe<Row>(
        `select id from plants where company_id = $1 and deleted_at is null`,
        [company],
      ),
      'id',
    );
    const accounts = await tx.unsafe<Row>(
      `select id, code from gl_accounts where company_id = $1 and deleted_at is null`,
      [company],
    );
    const accountCodes = strings(accounts, 'code');
    const invoices = strings(
      await tx.unsafe<Row>(
        `select id from invoices where company_id = $1 and deleted_at is null`,
        [company],
      ),
      'id',
    );

    const references: ReferenceIndex = {
      customers,
      suppliers,
      materials: [],
      plants,
      mix_designs: [],
      employees: [],
      trucks: [],
      gl_accounts: accountCodes,
      invoices,
    };

    const existing = async (): Promise<string[]> => {
      switch (templateId) {
        case 'customers':
          return customers;
        case 'suppliers':
          return suppliers;
        case 'chart_of_accounts':
          return accountCodes;
        case 'invoices':
          return invoices;
        case 'invoice_items': {
          const rows = await tx.unsafe<{ line_key: string }>(
            `select invoice_id || ':' || line_no as line_key
               from invoice_items where company_id = $1`,
            [company],
          );
          return rows.map((row) => String(row.line_key));
        }
        case 'payments':
          return strings(
            await tx.unsafe<Row>(`select id from payments where company_id = $1`, [company]),
            'id',
          );
        case 'expenses':
          return strings(
            await tx.unsafe<Row>(`select id from expenses where company_id = $1`, [company]),
            'id',
          );
        case 'cheques':
          return strings(
            await tx.unsafe<Row>(
              `select cheque_no from cheques where company_id = $1 and deleted_at is null`,
              [company],
            ),
            'cheque_no',
          );
        case 'fixed_assets':
          return strings(
            await tx.unsafe<Row>(
              `select code from fixed_assets where company_id = $1 and deleted_at is null`,
              [company],
            ),
            'code',
          );
        case 'loans':
          return strings(
            await tx.unsafe<Row>(
              `select id from loans where company_id = $1 and deleted_at is null`,
              [company],
            ),
            'id',
          );
        default:
          return [];
      }
    };

    return { references, existingIds: await existing() };
  });
