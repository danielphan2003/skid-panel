/** skid users, for the admin: /v8/management/skid/* (see docs/skid-users.md in skid). */
import {
  normalizeKey,
  normalizeModels,
  normalizeSeries,
  normalizeUser,
  serializeKeyPatch,
  serializeUserPatch,
  type KeyPatch,
  type SkidKey,
  type SkidUser,
  type UsageRange,
  type UserPatch,
} from '@/features/users/model';
import { apiClient } from './client';

const userOf = (data: unknown): SkidUser => {
  const user = normalizeUser((data as { user?: unknown } | null)?.user);
  if (!user) throw new Error('invalid user response');
  return user;
};

const keyOf = (data: unknown): SkidKey => {
  const key = normalizeKey((data as { key?: unknown } | null)?.key);
  if (!key) throw new Error('invalid key response');
  return key;
};

const secretOf = (data: unknown): string => {
  const secret = (data as { secret?: unknown } | null)?.secret;
  return typeof secret === 'string' ? secret : '';
};

const enc = encodeURIComponent;

export const skidUsersApi = {
  async list(): Promise<SkidUser[]> {
    const data = await apiClient.get<{ users?: unknown }>('/skid/users');
    const users = Array.isArray(data?.users) ? data.users : [];
    return users.map(normalizeUser).filter((u): u is SkidUser => u !== null);
  },

  async create(patch: UserPatch): Promise<SkidUser> {
    return userOf(await apiClient.post('/skid/users', serializeUserPatch(patch)));
  },

  async update(id: string, patch: UserPatch): Promise<SkidUser> {
    return userOf(await apiClient.patch(`/skid/users/${enc(id)}`, serializeUserPatch(patch)));
  },

  remove: (id: string) => apiClient.delete(`/skid/users/${enc(id)}`),

  async signInLink(id: string): Promise<string> {
    const data = await apiClient.post<{ url?: unknown }>(`/skid/users/${enc(id)}/sign-in-link`);
    return typeof data?.url === 'string' ? data.url : '';
  },

  async createKey(userId: string, patch: KeyPatch): Promise<{ key: SkidKey; secret: string }> {
    const data = await apiClient.post(`/skid/users/${enc(userId)}/keys`, serializeKeyPatch(patch));
    return { key: keyOf(data), secret: secretOf(data) };
  },

  /** Makes a key from config.yaml's api-keys the user's; skid removes it from config.yaml. */
  async importKey(userId: string, plain: string, patch: KeyPatch): Promise<SkidKey> {
    const data = await apiClient.post(`/skid/users/${enc(userId)}/keys`, {
      ...serializeKeyPatch(patch),
      import: plain,
    });
    return keyOf(data);
  },

  async updateKey(userId: string, keyId: string, patch: KeyPatch): Promise<SkidKey> {
    return keyOf(
      await apiClient.patch(
        `/skid/users/${enc(userId)}/keys/${enc(keyId)}`,
        serializeKeyPatch(patch)
      )
    );
  },

  removeKey: (userId: string, keyId: string) =>
    apiClient.delete(`/skid/users/${enc(userId)}/keys/${enc(keyId)}`),

  async usage(userId: string, range: UsageRange, keyId?: string) {
    const params: Record<string, string> = { range };
    if (keyId) params.key = keyId;
    return normalizeSeries(await apiClient.get(`/skid/users/${enc(userId)}/usage`, { params }));
  },

  async models() {
    return normalizeModels(await apiClient.get('/skid/models'));
  },
};
