import { createDemoDataset } from '../src/seed/demo';
import type { AuditEntry, DemoDataset, SessionRecord, User } from '../src/types';
import type { ValidationResult } from '../src/core/validation';

export interface AuthedUser extends User {
  password_hash: string;
}

export interface StagedImport {
  id: string;
  templateId: string;
  templateVersion: string;
  fileName: string;
  checksum: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
  result: ValidationResult;
  committed: boolean;
  importedRows: number;
}

export interface ImportedRecord {
  id: string;
  templateId: string;
  values: Record<string, string>;
  importedBy: string;
  importedAt: string;
}

export interface AppStore {
  dataset: DemoDataset;
  users: AuthedUser[];
  sessions: Map<string, SessionRecord>;
  staged: Map<string, StagedImport>;
  /** Landing buffer for imported rows whose module tables arrive in later phases. */
  imports: ImportedRecord[];
}

export interface AppEnv {
  adminPassword: string;
  idleMinutes: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  maxUploadBytes: number;
}

export const readEnv = (): AppEnv => ({
  adminPassword: process.env.ICONCRETE_DEMO_ADMIN_PASSWORD ?? 'Demo@2026',
  idleMinutes: Number(process.env.ICONCRETE_SESSION_IDLE_MINUTES ?? 30),
  maxFailedLogins: Number(process.env.ICONCRETE_MAX_FAILED_LOGINS ?? 5),
  lockoutMinutes: Number(process.env.ICONCRETE_LOCKOUT_MINUTES ?? 15),
  maxUploadBytes: Number(process.env.ICONCRETE_MAX_UPLOAD_BYTES ?? 2_097_152),
});

/**
 * Phase 1 store: seeded in-memory demo data + hashed demo credentials.
 * Durable PostgreSQL storage with RLS is Phase 2 work (module M1).
 */
export const createStore = async (env: AppEnv = readEnv()): Promise<AppStore> => {
  const dataset = createDemoDataset();
  const users: AuthedUser[] = await Promise.all(
    dataset.users.map(async (user) => ({
      ...user,
      demo_password: '',
      password_hash: await Bun.password.hash(
        user.username === 'admin' ? env.adminPassword : user.demo_password || 'Demo@2026',
        { algorithm: 'argon2id' },
      ),
    })),
  );
  return { dataset, users, sessions: new Map(), staged: new Map(), imports: [] };
};

export const appendAudit = (
  store: AppStore,
  entry: Omit<AuditEntry, 'id' | 'created_at'>,
): AuditEntry => {
  const record: AuditEntry = {
    id: `AUD-${crypto.randomUUID().slice(0, 12)}`,
    created_at: new Date().toISOString(),
    ...entry,
  };
  store.dataset.auditLog.unshift(record);
  if (store.dataset.auditLog.length > 1000) store.dataset.auditLog.length = 1000;
  return record;
};
