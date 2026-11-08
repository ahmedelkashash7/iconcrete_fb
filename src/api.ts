/** Thin fetch wrapper for the Bun API with bearer sessions and typed errors. */

const TOKEN_KEY = 'iconcrete.token';

// Last-resort transport for sandboxed iframes where both storage APIs throw.
// It keeps the bearer usable for the current page even when the cookie is blocked.
let memoryToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const getToken = (): string | null => {
  try {
    const local = window.localStorage.getItem(TOKEN_KEY);
    if (local) {
      memoryToken = local;
      return local;
    }
    // Migrate a token written by the previous sessionStorage build.
    const legacy = window.sessionStorage.getItem(TOKEN_KEY);
    if (legacy) {
      window.localStorage.setItem(TOKEN_KEY, legacy);
      window.sessionStorage.removeItem(TOKEN_KEY);
      memoryToken = legacy;
      return legacy;
    }
  } catch {
    try {
      const legacy = window.sessionStorage.getItem(TOKEN_KEY);
      if (legacy) memoryToken = legacy;
      return legacy;
    } catch {
      return memoryToken;
    }
  }
  return memoryToken;
};

export const setToken = (token: string | null): void => {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
    // Never leave a second copy behind after the switch to localStorage.
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    try {
      if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  }
};

const handleUnauthorized = (): void => {
  window.dispatchEvent(new CustomEvent('iconcrete:session-expired'));
};

export const apiFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: init.credentials ?? 'include' });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  // Login and the persistence ping own their 401 handling: they must show the
  // exact code instead of a generic "session expired" banner.
  if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') {
    handleUnauthorized();
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    let code = `http_${response.status}`;
    let details: Record<string, unknown> = {};
    if (contentType.includes('application/json')) {
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      code = typeof payload.error === 'string' ? payload.error : code;
      details = payload;
    }
    throw new ApiError(response.status, code, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const apiDownload = async (path: string): Promise<Blob> => {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network_error');
  }
  if (response.status === 401) handleUnauthorized();
  if (!response.ok) {
    let code = `http_${response.status}`;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (typeof payload.error === 'string') code = payload.error;
    }
    throw new ApiError(response.status, code);
  }
  return response.blob();
};

export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const downloadFile = async (path: string, filename: string): Promise<void> => {
  const blob = await apiDownload(path);
  saveBlob(blob, filename);
};
