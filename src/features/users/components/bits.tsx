import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import {
  USAGE_RANGES,
  formatTokens,
  quotaTokens,
  windowShare,
  type Machine,
  type MachineKind,
  type QuotaWindow,
  type UsageRange,
  type UsageSeries,
} from '../model';
import styles from '../users.module.scss';

const kindPaths: Record<MachineKind, ReactNode> = {
  server: (
    <>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <path d="M8 7h.01M8 17h.01" />
    </>
  ),
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.5 4.5 0 0 0 7 18z" />,
  linux: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 9l3 2.5L7 14M12 14h5" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  'mac-mini': (
    <>
      <rect x="3" y="9" width="18" height="7" rx="2.5" />
      <path d="M7 12.5h.01" />
    </>
  ),
  'mac-studio': (
    <>
      <rect x="5" y="6" width="14" height="12" rx="2.5" />
      <path d="M9 14h6" />
    </>
  ),
};

/** The machine-kind icons T3 Code shows for a machine. */
export function MachineIcon({ kind, size = 16 }: { kind: MachineKind | ''; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind ? kindPaths[kind] : kindPaths.desktop}
    </svg>
  );
}

export function MachineBadge({ machine }: { machine: Machine | null }) {
  const { t } = useTranslation();
  if (!machine) return <span className={styles.muted}>{t('users.machine_none')}</span>;
  return (
    <span className={styles.machine}>
      <MachineIcon kind={machine.kind} />
      <span>{machine.label || t(`users.machine_kind_${machine.kind || 'desktop'}`)}</span>
      {machine.source === 'detected' && (
        <span className={styles.tag}>{t('users.machine_detected')}</span>
      )}
    </span>
  );
}

const formatReset = (iso: string, locale: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
};

/** Each quota window: used of limit, with a bar when it has a limit. */
export function WindowMeters({ windows }: { windows: QuotaWindow[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles.windows}>
      {windows.map((w) => {
        const share = windowShare(w);
        return (
          <div key={w.window} className={styles.window}>
            <div className={styles.windowHead}>
              <span>{t(`users.window_${w.window}`)}</span>
              <span className={styles.windowValue}>
                {formatTokens(w.used)}
                {w.limit > 0 ? ` / ${formatTokens(w.limit)}` : ''}
              </span>
            </div>
            {share !== null ? (
              <div
                className={styles.meter}
                role="meter"
                aria-label={t(`users.window_${w.window}`)}
                aria-valuemin={0}
                aria-valuemax={w.limit}
                aria-valuenow={Math.min(w.used, w.limit)}
              >
                <div
                  className={share >= 1 ? styles.meterFull : styles.meterFill}
                  style={{ width: `${share * 100}%` }}
                />
              </div>
            ) : (
              <div className={styles.muted}>{t('users.no_limit')}</div>
            )}
            {w.limit > 0 && w.resetAt && (
              <div className={styles.muted}>
                {t('users.resets_at', { time: formatReset(w.resetAt, i18n.language) })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A usage chart over 24 hours, 7 days or 30 days, and its per-model totals. */
export function UsagePanel({
  load,
  reloadKey,
}: {
  load: (range: UsageRange) => Promise<UsageSeries>;
  reloadKey?: string;
}) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<UsageRange>('7d');
  const [series, setSeries] = useState<UsageSeries | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    load(range)
      .then((next) => alive && setSeries(next))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [load, range, reloadKey]);

  const peak = Math.max(1, ...(series?.points ?? []).map(quotaTokens));
  const stepLabel = (iso: string) => {
    const date = new Date(iso);
    return range === '24h'
      ? date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  };

  return (
    <div className={styles.usage}>
      <div className={styles.usageHead}>
        <strong>{t('users.usage_title')}</strong>
        <div className={styles.rangeSelect}>
          <Select
            size="sm"
            fullWidth={false}
            value={range}
            ariaLabel={t('users.usage_range')}
            options={USAGE_RANGES.map((r) => ({ value: r, label: t(`users.range_${r}`) }))}
            onChange={(value) => setRange(value as UsageRange)}
          />
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {series && (
        <>
          <div className={styles.totals}>
            <span>
              {t('users.usage_tokens')}: <strong>{formatTokens(quotaTokens(series.total))}</strong>
            </span>
            <span>
              {t('users.usage_cache_reads')}:{' '}
              <strong>{formatTokens(series.total.cacheRead)}</strong>
            </span>
            <span>
              {t('users.usage_requests')}: <strong>{series.total.requests}</strong>
            </span>
          </div>
          <svg
            className={styles.chart}
            viewBox={`0 0 ${Math.max(1, series.points.length) * 10} 60`}
            preserveAspectRatio="none"
            role="img"
            aria-label={t('users.usage_chart_label')}
          >
            {series.points.map((p, i) => {
              const h = (quotaTokens(p) / peak) * 56;
              return (
                <rect key={p.start} x={i * 10 + 1} y={60 - h} width={8} height={h} rx={1}>
                  <title>{`${stepLabel(p.start)}: ${formatTokens(quotaTokens(p))}`}</title>
                </rect>
              );
            })}
          </svg>
          {series.models.length > 0 ? (
            <table className={styles.modelTable}>
              <thead>
                <tr>
                  <th>{t('users.usage_model')}</th>
                  <th>{t('users.usage_tokens')}</th>
                  <th>{t('users.usage_cache_reads')}</th>
                  <th>{t('users.usage_requests')}</th>
                </tr>
              </thead>
              <tbody>
                {series.models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td>{formatTokens(quotaTokens(m))}</td>
                    <td>{formatTokens(m.cacheRead)}</td>
                    <td>{m.requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.muted}>{t('users.usage_empty')}</div>
          )}
        </>
      )}
    </div>
  );
}
