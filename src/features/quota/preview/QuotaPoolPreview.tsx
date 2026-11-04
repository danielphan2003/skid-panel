/**
 * DEV-only preview of the pooled quota board with synthetic accounts, at
 * `#/__preview/quota-pools`. Production builds drop it (see App.tsx).
 */

import { useMemo, useState } from 'react';
import { useThemeStore } from '@/stores';
import { HOUR_MS } from '@/utils/time/durations';
import type { QuotaLedgerSample } from '../ledger/history';
import { PoolBoard } from '../ledger/PoolBoard';
import { buildPools, type CredentialLimits } from '../ledger/pools';

const WEEK_MS = 168 * HOUR_MS;

interface Account {
  provider: 'claude' | 'codex';
  auth: string;
  /** Hours until the weekly window resets. */
  resetsInHours: number;
  /** Percent used per hour while working. */
  burn: number;
}

const ACCOUNTS: Account[] = [
  { provider: 'claude', auth: 'claude-alpha@example.com.json', resetsInHours: 22, burn: 0.9 },
  { provider: 'claude', auth: 'claude-bravo@example.com.json', resetsInHours: 47, burn: 0.7 },
  { provider: 'claude', auth: 'claude-charlie@example.com.json', resetsInHours: 70, burn: 0.5 },
  { provider: 'claude', auth: 'claude-delta@example.com.json', resetsInHours: 95, burn: 0.4 },
  { provider: 'claude', auth: 'claude-echo@example.com.json', resetsInHours: 118, burn: 0.3 },
  { provider: 'claude', auth: 'claude-foxtrot@example.com.json', resetsInHours: 150, burn: 0.2 },
  { provider: 'codex', auth: 'codex-alpha@example.com.json', resetsInHours: 30, burn: 0.8 },
  { provider: 'codex', auth: 'codex-bravo@example.com.json', resetsInHours: 80, burn: 0.5 },
  { provider: 'codex', auth: 'codex-charlie@example.com.json', resetsInHours: 140, burn: 0.3 },
];

const WINDOW = { claude: 'seven-day', codex: 'weekly' } as const;

/** Hourly samples over the past five days: daytime work drains, resets refill. */
function history(nowMs: number) {
  const samples: QuotaLedgerSample[] = [];
  const current = new Map<string, { remaining: number; resetAtMs: number }>();
  for (const account of ACCOUNTS) {
    const resetAtMs = nowMs + account.resetsInHours * HOUR_MS;
    const startMs = nowMs - 120 * HOUR_MS;
    let windowEnd = resetAtMs - Math.floor((resetAtMs - startMs) / WEEK_MS) * WEEK_MS;
    // Each window starts the preview partly spent, by how far into it the preview begins.
    let remaining = 100 - ((WEEK_MS - (windowEnd - startMs)) / WEEK_MS) * 60;
    for (let at = startMs; at <= nowMs; at += HOUR_MS) {
      if (at >= windowEnd) {
        windowEnd += WEEK_MS;
        remaining = 100;
      }
      const hour = new Date(at).getHours();
      if (hour >= 9 && hour <= 23) remaining = Math.max(0, remaining - account.burn * 2.4);
      samples.push({
        at,
        auth: account.auth,
        provider: account.provider,
        window: WINDOW[account.provider],
        remaining: Math.round(remaining * 100) / 100,
        resets_at: windowEnd,
      });
    }
    current.set(account.auth, { remaining, resetAtMs });
  }
  return { samples, current };
}

export function QuotaPoolPreview() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [nowMs] = useState(() => Date.now());
  const { samples, credentials } = useMemo(() => {
    const { samples, current } = history(nowMs);
    const credentials: CredentialLimits[] = ACCOUNTS.map((account) => {
      const state = current.get(account.auth)!;
      return {
        provider: account.provider,
        auth: account.auth,
        limits: [
          {
            id: WINDOW[account.provider],
            label: 'Weekly',
            remaining: state.remaining,
            resetAtMs: state.resetAtMs,
            periodHours: 168,
          },
        ],
      };
    });
    return { samples, credentials };
  }, [nowMs]);
  const pools = useMemo(
    () => buildPools(['claude', 'codex'], credentials, nowMs),
    [credentials, nowMs]
  );

  return (
    <div style={{ padding: 32, background: 'var(--bg-secondary)', minHeight: '100vh' }}>
      <PoolBoard
        pools={pools}
        samples={samples}
        ledgerStatus="ready"
        nowMs={nowMs}
        resolvedTheme={resolvedTheme}
        labelFor={(auth) => auth.replace(/^(\w+)-(\w)\w*@/, '$1-$2•••@').replace(/\.json$/, '')}
      />
    </div>
  );
}
