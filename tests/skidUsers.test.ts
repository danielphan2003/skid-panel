import { describe, expect, test } from 'bun:test';
import {
  formatTokens,
  normalizeKey,
  normalizeModels,
  normalizeSeries,
  normalizeUser,
  parseTokens,
  quotaTokens,
  serializeKeyPatch,
  serializeUserPatch,
  splitList,
  tokenFromSearch,
  windowShare,
} from '../src/features/users/model';

const backendUser = {
  id: 'u_1',
  email: 'friend@example.com',
  name: 'Friend',
  created_at: '2026-11-13T00:00:00Z',
  disabled: false,
  scope: { providers: ['antigravity'], 'excluded-models': ['gemini-old-*'] },
  limits: { weekly: 1000000 },
  windows: [
    { window: 'daily', used: 10, limit: 0, reset_at: '2026-11-14T00:00:00+07:00' },
    { window: 'weekly', used: 1500000, limit: 1000000, reset_at: '2026-11-16T00:00:00+07:00' },
    { window: 'hourly', used: 1, limit: 1, reset_at: '' },
  ],
  keys: [
    {
      id: 'k_1',
      name: 'laptop',
      last4: 'ab12',
      created_at: '2026-11-13T00:00:00Z',
      last_used_at: '2026-11-13T05:00:00Z',
      disabled: false,
      limits: {},
      machine: { label: "Jane's MacBook", kind: 'laptop', source: 'detected' },
      windows: [],
      sha256: 'never shown',
    },
    { name: 'no id' },
  ],
};

describe('skid users model', () => {
  test('normalizes a user and drops what it does not know', () => {
    const user = normalizeUser(backendUser);
    expect(user).not.toBeNull();
    expect(user?.scope).toEqual({
      providers: ['antigravity'],
      models: [],
      excludedProviders: [],
      excludedModels: ['gemini-old-*'],
    });
    expect(user?.limits).toEqual({ daily: 0, weekly: 1000000, monthly: 0 });
    expect(user?.windows.map((w) => w.window)).toEqual(['daily', 'weekly']);
    expect(user?.keys).toHaveLength(1);
    expect(user?.keys[0].machine).toEqual({
      label: "Jane's MacBook",
      kind: 'laptop',
      source: 'detected',
    });
    expect(JSON.stringify(user)).not.toContain('never shown');
  });

  test('an empty scope or machine normalizes to null, an unknown kind to none', () => {
    const key = normalizeKey({ id: 'k', scope: {}, machine: { label: 'box', kind: 'toaster' } });
    expect(key?.scope).toBeNull();
    expect(key?.machine).toEqual({ label: 'box', kind: '', source: '' });
    expect(normalizeKey({ id: 'k', machine: {} })?.machine).toBeNull();
    expect(normalizeUser(null)).toBeNull();
  });

  test('window share is capped and null without a limit', () => {
    const user = normalizeUser(backendUser);
    expect(windowShare(user!.windows[0])).toBeNull();
    expect(windowShare(user!.windows[1])).toBe(1);
  });

  test('series and quota tokens leave cache reads out', () => {
    const series = normalizeSeries({
      from: '2026-11-13T00:00:00Z',
      step: 'hour',
      points: [{ start: '2026-11-13T00:00:00Z', r: 2, in: 100, cr: 5000, cw: 20, out: 30 }],
      models: [{ model: 'gpt-6', r: 2, in: 100, cr: 5000, cw: 20, out: 30 }],
      total: { r: 2, in: 100, cr: 5000, cw: 20, out: 30 },
    });
    expect(quotaTokens(series.total)).toBe(150);
    expect(series.total.cacheRead).toBe(5000);
    expect(series.models[0].model).toBe('gpt-6');
    expect(normalizeSeries('garbage').points).toEqual([]);
  });

  test('models list', () => {
    expect(
      normalizeModels({
        models: [{ id: 'gemini-3', owned_by: 'google', providers: ['antigravity'] }, {}],
      })
    ).toEqual([{ id: 'gemini-3', ownedBy: 'google', providers: ['antigravity'] }]);
  });

  test('token counts parse and format', () => {
    expect(parseTokens('1.5M')).toBe(1500000);
    expect(parseTokens('200k')).toBe(200000);
    expect(parseTokens('1,000,000')).toBe(1000000);
    expect(parseTokens('')).toBe(0);
    expect(parseTokens('lots')).toBeNull();
    expect(formatTokens(1500000)).toBe('1.5M');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12000)).toBe('12K');
  });

  test('patches serialize to the backend field names', () => {
    expect(
      serializeKeyPatch({
        name: 'ci',
        scope: {
          providers: [],
          models: ['gpt-*'],
          excludedProviders: ['claude'],
          excludedModels: [],
        },
        limits: { daily: 1, weekly: 0, monthly: 0 },
        machine: { label: 'box', kind: 'server' },
      })
    ).toEqual({
      name: 'ci',
      scope: {
        providers: [],
        models: ['gpt-*'],
        'excluded-providers': ['claude'],
        'excluded-models': [],
      },
      limits: { daily: 1, weekly: 0, monthly: 0 },
      machine: { label: 'box', kind: 'server' },
    });
    expect(serializeKeyPatch({ clearScope: true, clearMachine: true })).toEqual({
      clear_scope: true,
      clear_machine: true,
    });
    expect(serializeUserPatch({ email: 'a@b.c', disabled: true })).toEqual({
      email: 'a@b.c',
      disabled: true,
    });
  });

  test('the magic link token comes from the hash route query', () => {
    expect(tokenFromSearch('?token=abc123')).toBe('abc123');
    expect(tokenFromSearch('token=x%2By')).toBe('x+y');
    expect(tokenFromSearch('')).toBe('');
    expect(splitList('a, b\nc,,')).toEqual(['a', 'b', 'c']);
  });
});

describe('limit editing', () => {
  test('an untouched limit saves back exactly', async () => {
    const { limitsDraft } = await import('../src/features/users/model');
    const draft = limitsDraft({ daily: 12345, weekly: 10500000, monthly: 0 });
    expect(parseTokens(draft.daily)).toBe(12345);
    expect(parseTokens(draft.weekly)).toBe(10500000);
    expect(parseTokens(draft.monthly)).toBe(0);
  });

  test('the admin flag is read', () => {
    expect(normalizeKey({ id: 'k', admin_disabled: true })?.adminDisabled).toBe(true);
    expect(normalizeKey({ id: 'k' })?.adminDisabled).toBe(false);
  });
});
