/**
 * skid users: the shapes skid's users API returns (docs/skid-users.md in
 * skid), normalized from untrusted JSON, and the small calculations the users
 * and account pages share.
 */

export const MACHINE_KINDS = [
  'server',
  'cloud',
  'linux',
  'desktop',
  'laptop',
  'mac-mini',
  'mac-studio',
] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

export const WINDOW_NAMES = ['daily', 'weekly', 'monthly'] as const;
export type WindowName = (typeof WINDOW_NAMES)[number];

export const USAGE_RANGES = ['24h', '7d', '30d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export interface Scope {
  providers: string[];
  models: string[];
  excludedProviders: string[];
  excludedModels: string[];
}

export type Limits = Record<WindowName, number>;

export interface Machine {
  label: string;
  kind: MachineKind | '';
  source: 'detected' | 'user' | '';
}

export interface QuotaWindow {
  window: WindowName;
  used: number;
  limit: number;
  resetAt: string;
}

export interface SkidKey {
  id: string;
  name: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string;
  disabled: boolean;
  scope: Scope | null;
  limits: Limits;
  machine: Machine | null;
  windows: QuotaWindow[];
}

export interface SkidUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  disabled: boolean;
  scope: Scope | null;
  limits: Limits;
  windows: QuotaWindow[];
  keys: SkidKey[];
}

export interface UsageBucket {
  requests: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface UsageSeries {
  from: string;
  step: string;
  points: (UsageBucket & { start: string })[];
  models: (UsageBucket & { model: string })[];
  total: UsageBucket;
}

export interface ModelOption {
  id: string;
  ownedBy: string;
  providers: string[];
}

export interface KeyPatch {
  name?: string;
  disabled?: boolean;
  scope?: Scope;
  clearScope?: boolean;
  limits?: Limits;
  machine?: { label: string; kind: MachineKind | '' };
  clearMachine?: boolean;
}

export interface UserPatch {
  email?: string;
  name?: string;
  disabled?: boolean;
  scope?: Scope;
  clearScope?: boolean;
  limits?: Limits;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const emptyScope = (): Scope => ({
  providers: [],
  models: [],
  excludedProviders: [],
  excludedModels: [],
});

export const emptyLimits = (): Limits => ({ daily: 0, weekly: 0, monthly: 0 });

export const scopeIsEmpty = (scope: Scope | null): boolean =>
  !scope ||
  (scope.providers.length === 0 &&
    scope.models.length === 0 &&
    scope.excludedProviders.length === 0 &&
    scope.excludedModels.length === 0);

export function normalizeScope(value: unknown): Scope | null {
  if (!isObject(value)) return null;
  const scope: Scope = {
    providers: strings(value.providers),
    models: strings(value.models),
    excludedProviders: strings(value['excluded-providers']),
    excludedModels: strings(value['excluded-models']),
  };
  return scopeIsEmpty(scope) ? null : scope;
}

export function normalizeLimits(value: unknown): Limits {
  const limits = emptyLimits();
  if (!isObject(value)) return limits;
  for (const name of WINDOW_NAMES) limits[name] = Math.max(0, num(value[name]));
  return limits;
}

const isMachineKind = (value: string): value is MachineKind =>
  (MACHINE_KINDS as readonly string[]).includes(value);

export function normalizeMachine(value: unknown): Machine | null {
  if (!isObject(value)) return null;
  const kind = str(value.kind);
  const source = str(value.source);
  const machine: Machine = {
    label: str(value.label),
    kind: isMachineKind(kind) ? kind : '',
    source: source === 'detected' || source === 'user' ? source : '',
  };
  return machine.label || machine.kind ? machine : null;
}

export function normalizeWindows(value: unknown): QuotaWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const window = str(entry.window);
    if (!(WINDOW_NAMES as readonly string[]).includes(window)) return [];
    return [
      {
        window: window as WindowName,
        used: num(entry.used),
        limit: num(entry.limit),
        resetAt: str(entry.reset_at),
      },
    ];
  });
}

export function normalizeKey(value: unknown): SkidKey | null {
  if (!isObject(value) || !str(value.id)) return null;
  return {
    id: str(value.id),
    name: str(value.name),
    last4: str(value.last4),
    createdAt: str(value.created_at),
    lastUsedAt: str(value.last_used_at),
    disabled: value.disabled === true,
    scope: normalizeScope(value.scope),
    limits: normalizeLimits(value.limits),
    machine: normalizeMachine(value.machine),
    windows: normalizeWindows(value.windows),
  };
}

export function normalizeUser(value: unknown): SkidUser | null {
  if (!isObject(value) || !str(value.id)) return null;
  const keys = Array.isArray(value.keys) ? value.keys : [];
  return {
    id: str(value.id),
    email: str(value.email),
    name: str(value.name),
    createdAt: str(value.created_at),
    disabled: value.disabled === true,
    scope: normalizeScope(value.scope),
    limits: normalizeLimits(value.limits),
    windows: normalizeWindows(value.windows),
    keys: keys.map(normalizeKey).filter((k): k is SkidKey => k !== null),
  };
}

function normalizeBucket(value: unknown): UsageBucket {
  const v = isObject(value) ? value : {};
  return {
    requests: num(v.r),
    input: num(v.in),
    cacheRead: num(v.cr),
    cacheWrite: num(v.cw),
    output: num(v.out),
  };
}

export function normalizeSeries(value: unknown): UsageSeries {
  const v = isObject(value) ? value : {};
  const points = Array.isArray(v.points) ? v.points : [];
  const models = Array.isArray(v.models) ? v.models : [];
  return {
    from: str(v.from),
    step: str(v.step),
    points: points.map((p) => ({ ...normalizeBucket(p), start: isObject(p) ? str(p.start) : '' })),
    models: models.map((m) => ({ ...normalizeBucket(m), model: isObject(m) ? str(m.model) : '' })),
    total: normalizeBucket(v.total),
  };
}

export function normalizeModels(value: unknown): ModelOption[] {
  const list = isObject(value) && Array.isArray(value.models) ? value.models : [];
  return list.flatMap((m) =>
    isObject(m) && str(m.id)
      ? [{ id: str(m.id), ownedBy: str(m.owned_by), providers: strings(m.providers) }]
      : []
  );
}

const serializeScope = (scope: Scope): Json => ({
  providers: scope.providers,
  models: scope.models,
  'excluded-providers': scope.excludedProviders,
  'excluded-models': scope.excludedModels,
});

export function serializeKeyPatch(patch: KeyPatch): Json {
  const out: Json = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.disabled !== undefined) out.disabled = patch.disabled;
  if (patch.clearScope) out.clear_scope = true;
  else if (patch.scope) out.scope = serializeScope(patch.scope);
  if (patch.limits) out.limits = patch.limits;
  if (patch.clearMachine) out.clear_machine = true;
  else if (patch.machine) out.machine = patch.machine;
  return out;
}

export function serializeUserPatch(patch: UserPatch): Json {
  const out: Json = {};
  if (patch.email !== undefined) out.email = patch.email;
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.disabled !== undefined) out.disabled = patch.disabled;
  if (patch.clearScope) out.clear_scope = true;
  else if (patch.scope) out.scope = serializeScope(patch.scope);
  if (patch.limits) out.limits = patch.limits;
  return out;
}

/** Quota tokens: everything but cache reads. */
export const quotaTokens = (b: UsageBucket): number => b.input + b.cacheWrite + b.output;

/** Used share of a window, 0 to 1, or null when it has no limit. */
export const windowShare = (w: QuotaWindow): number | null =>
  w.limit > 0 ? Math.min(1, Math.max(0, w.used / w.limit)) : null;

export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(value));
}

/** Parses a token count typed as "1.5M", "200k" or "12000"; empty means 0 (no limit). */
export function parseTokens(input: string): number | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, '');
  if (!text) return 0;
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(text);
  if (!match) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2] as 'k' | 'm' | 'b'] ?? 1;
  return Math.round(Number(match[1]) * scale);
}

/** Splits a comma or newline separated list. */
export const splitList = (input: string): string[] =>
  input
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The sign-in token from a magic link: `#/account?token=…` puts it in the
 * hash route's query, which react-router exposes as `search`.
 */
export function tokenFromSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return (params.get('token') ?? '').trim();
}
