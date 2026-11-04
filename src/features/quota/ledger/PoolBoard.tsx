/**
 * Pooled quota per provider: how much is left across every account, where it
 * is heading, and how fast it went. One control bar drives every pool card.
 *
 * The chart spans two weeks: a few days of recorded history before today and
 * a projection after "now" that spends the burn rate the way the proxy does,
 * soonest reset first, refilling each account at its reset.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import type { ResolvedTheme } from '@/features/authFiles/constants';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import {
  addLocalDays,
  capacityTicks,
  dayTicks,
  formatDay,
  formatWeekdayClock,
  rateCeiling,
  rateTicks,
  startOfLocalDay,
} from './chartScale';
import {
  averageDrain,
  forecastPool,
  measuredResets,
  poolHistory,
  rollingDrain,
  windowPace,
  type QuotaLedgerSample,
  type SeriesFilter,
} from './history';
import { readLedgerPreference, writeLedgerPreference } from './preferences';
import type { PoolLimit, QuotaPool } from './pools';
import { ProviderMark } from './ProviderMark';
import { TimeChart, type ChartMarker } from './TimeChart';
import type { QuotaLedgerStatus } from './useQuotaLedger';
import styles from './PoolBoard.module.scss';

const BURN_WINDOWS = { '1h': HOUR_MS, '3h': 3 * HOUR_MS, '6h': 6 * HOUR_MS } as const;
type BurnWindow = keyof typeof BURN_WINDOWS;
const BURN_KEYS = Object.keys(BURN_WINDOWS) as BurnWindow[];

const FUTURE_USAGE = { same: 1, heavy: 1.5, light: 0.5, none: 0 } as const;
type FutureUsage = keyof typeof FUTURE_USAGE;
const FUTURE_KEYS = Object.keys(FUTURE_USAGE) as FutureUsage[];

/** The chart shows two weeks, starting a few days before today. */
const RANGE_DAYS = 14;
const DAYS_BEFORE_TODAY = 3;
/** The stats look at least this far ahead, even when the range ends sooner. */
const MIN_FORECAST_MS = 7 * DAY_MS;
const FORECAST_STEP_MS = 15 * MINUTE_MS;
const CHART_POINTS = 240;

/** Chart accents per provider; others use the theme's primary color. */
const CHART_ACCENTS: Partial<Record<string, string>> = {
  claude: '#e8794a',
  codex: '#8b8cff',
};

const PLUGIN_URL = 'https://github.com/danielphan2003/skid-quota-ledger';

const filterFor = (provider: string, limit: PoolLimit): SeriesFilter => ({
  provider,
  window: limit.id,
  auths: limit.members.map((member) => member.auth),
});

export interface PoolBoardProps {
  pools: QuotaPool[];
  samples: QuotaLedgerSample[];
  ledgerStatus: QuotaLedgerStatus;
  nowMs: number;
  resolvedTheme: ResolvedTheme;
  /** The name to show for a credential, honoring the email setting. */
  labelFor: (auth: string) => string;
}

export function PoolBoard({
  pools,
  samples,
  ledgerStatus,
  nowMs,
  resolvedTheme,
  labelFor,
}: PoolBoardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const [view, setView] = useState<'remaining' | 'drain'>(() =>
    readLedgerPreference('poolView', 'remaining', ['remaining', 'drain'])
  );
  const [burn, setBurn] = useState<BurnWindow>(() =>
    readLedgerPreference('burnWindow', '3h', BURN_KEYS)
  );
  const [future, setFuture] = useState<FutureUsage>(() =>
    readLedgerPreference('futureUsage', 'same', FUTURE_KEYS)
  );
  const [weekOffset, setWeekOffset] = useState(0);

  const measured = pools.filter((pool) => pool.headline !== null);
  if (measured.length === 0) return null;

  const fromMs = addLocalDays(startOfLocalDay(nowMs), weekOffset * 7 - DAYS_BEFORE_TODAY);
  const toMs = addLocalDays(fromMs, RANGE_DAYS);
  const range = { fromMs, toMs };

  return (
    <section className={styles.board} aria-label={t('quota_pool.title')}>
      <div className={styles.controls}>
        <div className={styles.controlGroup} role="group" aria-label={t('quota_pool.view')}>
          {(['remaining', 'drain'] as const).map((id) => (
            <Segment
              key={id}
              active={view === id}
              onClick={() => {
                setView(id);
                writeLedgerPreference('poolView', id);
              }}
            >
              {t(`quota_pool.view_${id}`)}
            </Segment>
          ))}
        </div>
        <div className={styles.controlGroup} role="group" aria-label={t('quota_pool.burn_rate')}>
          <span className={styles.controlLabel}>{t('quota_pool.burn_rate')}</span>
          {BURN_KEYS.map((id) => (
            <Segment
              key={id}
              active={burn === id}
              onClick={() => {
                setBurn(id);
                writeLedgerPreference('burnWindow', id);
              }}
            >
              {t('quota_pool.hours', { count: BURN_WINDOWS[id] / HOUR_MS })}
            </Segment>
          ))}
        </div>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>{t('quota_pool.future_usage')}</span>
          <Select
            size="sm"
            value={future}
            ariaLabel={t('quota_pool.future_usage')}
            options={FUTURE_KEYS.map((id) => ({ value: id, label: t(`quota_pool.future_${id}`) }))}
            onChange={(value) => {
              setFuture(value as FutureUsage);
              writeLedgerPreference('futureUsage', value as FutureUsage);
            }}
          />
        </div>
        <div className={styles.range}>
          <span className={styles.rangeLabel}>
            {t('quota_pool.range', {
              from: formatDay(fromMs, locale),
              to: formatDay(addLocalDays(toMs, -1), locale),
            })}
          </span>
          <button
            type="button"
            className={styles.rangeButton}
            aria-label={t('quota_pool.previous_week')}
            onClick={() => setWeekOffset((offset) => offset - 1)}
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={`${styles.rangeButton} ${styles.rangeToday}`}
            disabled={weekOffset === 0}
            onClick={() => setWeekOffset(0)}
          >
            {t('quota_pool.today')}
          </button>
          <button
            type="button"
            className={styles.rangeButton}
            aria-label={t('quota_pool.next_week')}
            onClick={() => setWeekOffset((offset) => offset + 1)}
          >
            <IconChevronLeft size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
        </div>
      </div>

      {measured.map((pool) => (
        <PoolCard
          key={pool.provider}
          pool={pool}
          headline={pool.headline!}
          samples={samples}
          ledgerStatus={ledgerStatus}
          nowMs={nowMs}
          range={range}
          view={view}
          burnWindowMs={BURN_WINDOWS[burn]}
          usage={FUTURE_USAGE[future]}
          resolvedTheme={resolvedTheme}
          labelFor={labelFor}
        />
      ))}
    </section>
  );
}

function Segment(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={`${styles.segment} ${props.active ? styles.segmentActive : ''}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

interface PoolCardProps {
  pool: QuotaPool;
  headline: PoolLimit;
  samples: QuotaLedgerSample[];
  ledgerStatus: QuotaLedgerStatus;
  nowMs: number;
  range: { fromMs: number; toMs: number };
  view: 'remaining' | 'drain';
  burnWindowMs: number;
  usage: number;
  resolvedTheme: ResolvedTheme;
  labelFor: (auth: string) => string;
}

function PoolCard(props: PoolCardProps) {
  const { pool, headline, samples, nowMs, range, burnWindowMs, usage } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const filter = useMemo(() => filterFor(pool.provider, headline), [pool.provider, headline]);

  const burn = useMemo(
    () => averageDrain(samples, filter, nowMs, burnWindowMs),
    [samples, filter, nowMs, burnWindowMs]
  );
  // Before the ledger has measured a burn, each window's pace so far stands in.
  const pace = useMemo(() => windowPace(headline.members, nowMs), [headline.members, nowMs]);
  const drain = burn ?? pace;
  const forecast = useMemo(
    () =>
      drain === null
        ? null
        : forecastPool(
            headline.members,
            drain * usage,
            nowMs,
            Math.max(MIN_FORECAST_MS, range.toMs - nowMs),
            FORECAST_STEP_MS
          ),
    [drain, usage, headline.members, nowMs, range.toMs]
  );
  const statsUntilMs = Math.max(range.toMs, nowMs + MIN_FORECAST_MS);

  const firstEmpty = forecast?.firstEmpty ?? null;
  const stats: { label: string; value: string; muted?: boolean }[] = [
    {
      label: t('quota_pool.pool_empty'),
      ...(forecast === null
        ? { value: t('quota_pool.unknown'), muted: true }
        : forecast.emptyAtMs === null
          ? { value: t('quota_pool.not_by', { date: formatDay(statsUntilMs, locale) }) }
          : { value: whenLabel(forecast.emptyAtMs, nowMs, t, locale) }),
    },
    {
      label: t('quota_pool.first_empty'),
      ...(forecast === null
        ? { value: t('quota_pool.unknown'), muted: true }
        : firstEmpty === null
          ? { value: t('quota_pool.none_ahead') }
          : {
              value: `${props.labelFor(firstEmpty.auth)} · ${whenLabel(firstEmpty.at, nowMs, t, locale)}`,
            }),
    },
    {
      label: t('quota_pool.next_reset'),
      ...(forecast?.nextReset
        ? {
            value: t('quota_pool.reset_value', {
              gain: Math.round(forecast.nextReset.gain),
              when: formatWeekdayClock(forecast.nextReset.at, locale),
            }),
          }
        : { value: t('quota_pool.none_ahead'), muted: true }),
    },
    {
      label: t('quota_pool.burn_last', { count: burnWindowMs / HOUR_MS }),
      ...(burn === null
        ? { value: t('quota_pool.unknown'), muted: true }
        : { value: t('quota_pool.per_hour', { rate: burn.toFixed(1) }) }),
    },
  ];

  return (
    <article
      className={styles.card}
      style={
        CHART_ACCENTS[pool.provider]
          ? ({ '--chart-accent': CHART_ACCENTS[pool.provider] } as CSSProperties)
          : undefined
      }
    >
      <header className={styles.cardHeader}>
        <ProviderMark provider={pool.provider} resolvedTheme={props.resolvedTheme} />
        <span className={styles.cardCount}>
          {t('quota_pool.accounts', { count: pool.credentialCount })}
        </span>
      </header>
      <div className={styles.cardSummary}>
        <div className={styles.figure}>
          <span className={styles.figureValue}>{Math.round(headline.remaining)}%</span>
          <span className={styles.figureCapacity}>
            {t('quota_pool.of_capacity', { capacity: headline.capacity })}
          </span>
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.stat}>
              <dt>{stat.label}</dt>
              <dd className={stat.muted ? styles.statMuted : undefined}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {props.ledgerStatus === 'unavailable' ? (
        <p className={styles.notice}>
          {t('quota_pool.plugin_missing')}{' '}
          <a href={PLUGIN_URL} target="_blank" rel="noreferrer">
            quota-ledger
          </a>
        </p>
      ) : props.ledgerStatus === 'error' ? (
        <p className={styles.notice}>{t('quota_pool.history_failed')}</p>
      ) : props.view === 'remaining' ? (
        <RemainingChart
          headline={headline}
          samples={samples}
          filter={filter}
          nowMs={nowMs}
          range={range}
          projectedPoints={forecast?.points ?? []}
          projectedResets={forecast?.resets ?? []}
        />
      ) : (
        <DrainChart
          samples={samples}
          filter={filter}
          nowMs={nowMs}
          range={range}
          burnWindowMs={burnWindowMs}
        />
      )}
    </article>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

const whenLabel = (atMs: number, nowMs: number, t: Translate, locale?: string) =>
  atMs <= nowMs ? t('quota_pool.now') : formatWeekdayClock(atMs, locale);

const gainLabel = (gain: number) => `+${Math.round(gain)}%`;

interface RemainingChartProps {
  headline: PoolLimit;
  samples: QuotaLedgerSample[];
  filter: SeriesFilter;
  nowMs: number;
  range: { fromMs: number; toMs: number };
  projectedPoints: { at: number; value: number | null }[];
  projectedResets: { at: number; gain: number; value: number }[];
}

function RemainingChart(props: RemainingChartProps) {
  const { headline, samples, filter, nowMs, range } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const stepMs = (range.toMs - range.fromMs) / CHART_POINTS;

  const recorded = useMemo(() => {
    const until = Math.min(nowMs, range.toMs);
    if (until <= range.fromMs) return [];
    const points = poolHistory(samples, filter, range.fromMs, until, stepMs);
    return nowMs <= range.toMs ? [...points, { at: nowMs, value: headline.remaining }] : points;
  }, [samples, filter, range.fromMs, range.toMs, nowMs, stepMs, headline.remaining]);
  const projected = useMemo(
    () =>
      props.projectedPoints.filter((point) => point.at >= range.fromMs && point.at <= range.toMs),
    [props.projectedPoints, range.fromMs, range.toMs]
  );
  const markers = useMemo<ChartMarker[]>(
    () =>
      [...measuredResets(recorded), ...props.projectedResets].map((reset) => ({
        at: reset.at,
        value: reset.value,
        label: gainLabel(reset.gain),
      })),
    [recorded, props.projectedResets]
  );

  return (
    <>
      <TimeChart
        points={recorded}
        projected={projected}
        markers={markers}
        yMax={headline.capacity}
        yTicks={capacityTicks(headline.capacity)}
        xFrom={range.fromMs}
        xTo={range.toMs}
        xTicks={dayTicks(range.fromMs, range.toMs, locale)}
        nowMs={nowMs}
        nowLabel={t('quota_pool.now')}
        ariaLabel={t('quota_pool.remaining_chart_label', {
          remaining: Math.round(headline.remaining),
          capacity: headline.capacity,
        })}
        formatTooltip={(point) =>
          t('quota_pool.tooltip_left', {
            when: formatWeekdayClock(point.at, locale),
            value: Math.round(point.value),
          })
        }
      />
      <div className={styles.legend}>
        <span className={styles.legendTitle}>{t('quota_pool.pool')}</span>
        <span className={styles.legendSolid}>{t('quota_pool.recorded')}</span>
        <span className={styles.legendDashed}>{t('quota_pool.projected')}</span>
      </div>
    </>
  );
}

interface DrainChartProps {
  samples: QuotaLedgerSample[];
  filter: SeriesFilter;
  nowMs: number;
  range: { fromMs: number; toMs: number };
  burnWindowMs: number;
}

function DrainChart({ samples, filter, nowMs, range, burnWindowMs }: DrainChartProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const stepMs = (range.toMs - range.fromMs) / CHART_POINTS;
  const points = useMemo(() => {
    const until = Math.min(nowMs, range.toMs);
    if (until <= range.fromMs) return [];
    return rollingDrain(samples, filter, range.fromMs, until, burnWindowMs, stepMs);
  }, [samples, filter, range.fromMs, range.toMs, nowMs, burnWindowMs, stepMs]);
  const peak = points.reduce((max, point) => Math.max(max, point.value ?? 0), 0);
  const ceiling = rateCeiling(peak);
  const hasData = points.some((point) => point.value !== null);

  return (
    <>
      <TimeChart
        points={points}
        yMax={ceiling}
        yTicks={rateTicks(ceiling)}
        xFrom={range.fromMs}
        xTo={range.toMs}
        xTicks={dayTicks(range.fromMs, range.toMs, locale)}
        nowMs={nowMs}
        nowLabel={t('quota_pool.now')}
        ariaLabel={t('quota_pool.drain_chart_label', { peak: peak.toFixed(1) })}
        formatTooltip={(point) =>
          t('quota_pool.tooltip_rate', {
            when: formatWeekdayClock(point.at, locale),
            value: point.value.toFixed(1),
          })
        }
      />
      <div className={styles.legend}>
        <span className={styles.legendTitle}>{t('quota_pool.pool')}</span>
        <span className={styles.legendSolid}>
          {t('quota_pool.legend_rate', { count: burnWindowMs / HOUR_MS })}
        </span>
        {!hasData && <span className={styles.legendNote}>{t('quota_pool.no_drain_history')}</span>}
      </div>
    </>
  );
}
