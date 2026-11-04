/**
 * OpenCode Go usage limits.
 *
 * Go is an API-key subscription that CLIProxyAPI reaches through an
 * `openai-compatibility` entry, so its credentials never appear in the
 * auth-files list the other quota cards come from. This module finds them in
 * the compatibility config and reads Go's usage endpoint through the
 * management api-call proxy, which substitutes the key for `$TOKEN$`.
 *
 * The key itself is never read: only an entry's `auth-index` leaves here.
 */

import type { AuthFileItem, OpencodeGoQuotaWindow } from '@/types';
import { useAuthStore } from '@/stores';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { normalizeApiBase } from '@/utils/connection';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

export const OPENCODE_GO_PROVIDER = 'opencode-go';
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
export const OPENCODE_GO_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  Accept: 'application/json',
} as const;

const OPENCODE_GO_LABEL = 'OpenCode Go';
/** The v8 API has no per-family route; v0 still serves the list with each key's auth index. */
const COMPAT_PATH = '/v0/management/openai-compatibility';

/** A compatibility entry is Go when it points at Go's inference API or is named for it. */
export function isOpencodeGoCompatEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (typeof entry.name === 'string' && entry.name.trim().toLowerCase() === OPENCODE_GO_PROVIDER) {
    return true;
  }
  const baseUrl = entry['base-url'];
  if (typeof baseUrl !== 'string') return false;
  try {
    const url = new URL(baseUrl.trim());
    return url.hostname.toLowerCase() === 'opencode.ai' && url.pathname.startsWith('/inference/go');
  } catch {
    return false;
  }
}

/**
 * One quota credential per Go key that has an auth index, shaped like the
 * auth-file items the quota page already lists. Keys without an index cannot
 * be addressed through api-call, so they are skipped.
 */
export function opencodeGoCredentials(payload: unknown): AuthFileItem[] {
  const entries = isRecord(payload) ? payload['openai-compatibility'] : undefined;
  if (!Array.isArray(entries)) return [];
  const credentials: AuthFileItem[] = [];
  for (const entry of entries) {
    if (!isOpencodeGoCompatEntry(entry) || !isRecord(entry) || entry.disabled === true) continue;
    const keys = entry['api-key-entries'];
    if (!Array.isArray(keys)) continue;
    for (const key of keys) {
      const authIndex = isRecord(key) ? normalizeAuthIndex(key['auth-index']) : null;
      if (!authIndex) continue;
      const ordinal = credentials.length + 1;
      credentials.push({
        name: ordinal === 1 ? OPENCODE_GO_LABEL : `${OPENCODE_GO_LABEL} ${ordinal}`,
        type: OPENCODE_GO_PROVIDER,
        provider: OPENCODE_GO_PROVIDER,
        authIndex,
        source: 'config',
      });
    }
  }
  return credentials;
}

/** Go credentials from the live config; an unreadable config contributes none. */
export async function fetchOpencodeGoCredentials(): Promise<AuthFileItem[]> {
  try {
    const base = normalizeApiBase(useAuthStore.getState().apiBase);
    return opencodeGoCredentials(await apiClient.get(`${base}${COMPAT_PATH}`));
  } catch {
    return [];
  }
}

const WINDOWS = [
  { key: 'rolling', id: 'five-hour', label: 'Session (5h)', periodHours: 5 },
  { key: 'weekly', id: 'weekly', label: 'Weekly', periodHours: 168 },
  // The billing month's length varies, so it has no fixed period.
  { key: 'monthly', id: 'monthly', label: 'Monthly', periodHours: null },
] as const;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const parseResetMs = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The windows in a `/usage` response, in session, weekly, monthly order.
 * Null when the body is not a Go usage response at all; a response that
 * lacks one window simply omits it.
 */
export function parseOpencodeGoUsage(body: unknown): OpencodeGoQuotaWindow[] | null {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const usage = isRecord(body) ? body.usage : undefined;
  if (!isRecord(usage)) return null;
  const windows: OpencodeGoQuotaWindow[] = [];
  for (const window of WINDOWS) {
    const raw = usage[window.key];
    if (!isRecord(raw)) continue;
    const percent = raw.percent;
    windows.push({
      id: window.id,
      label: window.label,
      labelKey: `opencode_go_quota.window_${window.key}`,
      usedPercent:
        typeof percent === 'number' && Number.isFinite(percent) ? clampPercent(percent) : null,
      resetAtMs: parseResetMs(raw.resetsAt),
      periodHours: window.periodHours,
    });
  }
  return windows.length > 0 ? windows : null;
}
