/**
 * skid users, for a signed-in user: /v1/skid/* (see docs/skid-users.md in
 * skid). These routes are not Management API routes: they take the session a
 * magic link gives, never the management key, so they bypass apiClient.
 */
import {
  normalizeKey,
  normalizeModels,
  normalizeSeries,
  normalizeUser,
  serializeKeyPatch,
  type KeyPatch,
  type SkidKey,
  type SkidUser,
  type UsageRange,
} from '@/features/users/model';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { detectApiBaseFromLocation } from '@/utils/connection';

const SESSION_STORAGE_KEY = 'skidAccountSession';

/** A request the server refused because the session is gone. */
export class AccountSignedOutError extends Error {
  constructor() {
    super('signed out');
    this.name = 'AccountSignedOutError';
  }
}

/** Any other refusal, with the server's message. */
export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'AccountApiError';
  }
}

export const accountSession = {
  get: (): string => obfuscatedStorage.getItem<string>(SESSION_STORAGE_KEY) ?? '',
  set: (session: string) => obfuscatedStorage.setItem(SESSION_STORAGE_KEY, session),
  clear: () => obfuscatedStorage.removeItem(SESSION_STORAGE_KEY),
};

async function call(
  method: string,
  path: string,
  body?: unknown,
  auth: boolean = true
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const session = auth ? accountSession.get() : '';
  if (auth) {
    if (!session) throw new AccountSignedOutError();
    headers.Authorization = `Bearer ${session}`;
  }
  const response = await fetch(`${detectApiBaseFromLocation()}/v1/skid${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && auth) {
    // Only the session this request sent: a newer sign-in must survive an
    // older request's refusal.
    if (accountSession.get() === session) accountSession.clear();
    throw new AccountSignedOutError();
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new AccountApiError(
      typeof message === 'string' ? message : `HTTP ${response.status}`,
      response.status
    );
  }
  return data;
}

const keyOf = (data: unknown): SkidKey => {
  const key = normalizeKey((data as { key?: unknown } | null)?.key);
  if (!key) throw new AccountApiError('invalid key response', 500);
  return key;
};

export const skidAccountApi = {
  /** Always resolves with the server's neutral message, whether or not the address is a user's. */
  async requestSignIn(email: string): Promise<string> {
    const data = await call('POST', '/auth/email', { email }, false);
    const status = (data as { status?: unknown } | null)?.status;
    return typeof status === 'string' ? status : '';
  },

  /**
   * Redeems a magic link. The caller stores the session (accountSession.set)
   * only if the sign-in is still the newest one, so an older link finishing
   * last cannot swap the account under the page.
   */
  async verify(token: string): Promise<{ session: string; user: SkidUser }> {
    const data = await call('POST', '/auth/verify', { token }, false);
    const session = (data as { session?: unknown } | null)?.session;
    const user = normalizeUser((data as { user?: unknown } | null)?.user);
    if (typeof session !== 'string' || !session || !user) {
      throw new AccountApiError('invalid sign-in response', 500);
    }
    return { session, user };
  },

  /** Signs out the stored session, and forgets it unless a newer one replaced it. */
  async logout(): Promise<void> {
    const session = accountSession.get();
    try {
      await call('POST', '/auth/logout');
    } finally {
      if (accountSession.get() === session) accountSession.clear();
    }
  },

  async me(): Promise<SkidUser> {
    const user = normalizeUser(((await call('GET', '/me')) as { user?: unknown } | null)?.user);
    if (!user) throw new AccountApiError('invalid user response', 500);
    return user;
  },

  async models() {
    return normalizeModels(await call('GET', '/models'));
  },

  async createKey(patch: KeyPatch): Promise<{ key: SkidKey; secret: string }> {
    const data = await call('POST', '/keys', serializeKeyPatch(patch));
    const secret = (data as { secret?: unknown } | null)?.secret;
    return { key: keyOf(data), secret: typeof secret === 'string' ? secret : '' };
  },

  async updateKey(id: string, patch: KeyPatch): Promise<SkidKey> {
    return keyOf(await call('PATCH', `/keys/${encodeURIComponent(id)}`, serializeKeyPatch(patch)));
  },

  removeKey: (id: string) => call('DELETE', `/keys/${encodeURIComponent(id)}`),

  async usage(range: UsageRange, keyId?: string) {
    const params = new URLSearchParams({ range });
    if (keyId) params.set('key', keyId);
    return normalizeSeries(await call('GET', `/usage?${params.toString()}`));
  },
};
