import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  isOpencodeGoCompatEntry,
  opencodeGoCredentials,
  parseOpencodeGoUsage,
} from '@/services/api/opencodeGoQuota';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { quotaLimits, headlineLimitId } from '@/features/quota/ledger/limits';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';

const t = ((key: string) => key) as unknown as TFunction;

const SAMPLE = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-11-04T19:15:41.000Z' },
    weekly: { status: 'ok', percent: 10, resetsAt: '2026-11-09T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 5, resetsAt: '2026-12-03T20:30:29.000Z' },
  },
};

const SECRET = 'sk-go-secret-never-shown';

const goEntry = {
  name: 'opencode-go',
  'base-url': 'https://opencode.ai/inference/go/openai/v1',
  'api-key-entries': [{ 'api-key': SECRET, 'auth-index': '27f1839b5dc78c10' }],
};

describe('parseOpencodeGoUsage', () => {
  test('reads the three windows in order', () => {
    const windows = parseOpencodeGoUsage(SAMPLE);
    expect(windows?.map((window) => window.id)).toEqual(['five-hour', 'weekly', 'monthly']);
    expect(windows?.[1]).toEqual({
      id: 'weekly',
      label: 'Weekly',
      labelKey: 'opencode_go_quota.window_weekly',
      usedPercent: 10,
      resetAtMs: Date.parse('2026-11-09T00:00:00.000Z'),
      periodHours: 168,
    });
    expect(windows?.[0].periodHours).toBe(5);
    expect(windows?.[2].periodHours).toBeNull();
  });

  test('accepts the body as a JSON string', () => {
    expect(parseOpencodeGoUsage(JSON.stringify(SAMPLE))).toHaveLength(3);
  });

  test('omits a missing window and keeps the rest', () => {
    const windows = parseOpencodeGoUsage({ usage: { weekly: SAMPLE.usage.weekly } });
    expect(windows?.map((window) => window.id)).toEqual(['weekly']);
  });

  test('clamps percent and tolerates bad fields', () => {
    const windows = parseOpencodeGoUsage({
      usage: {
        rolling: { percent: 140, resetsAt: 'not a date' },
        weekly: { percent: -5 },
        monthly: { percent: 'lots' },
      },
    });
    expect(windows?.map((window) => window.usedPercent)).toEqual([100, 0, null]);
    expect(windows?.[0].resetAtMs).toBeNull();
  });

  test('rejects bodies that are not Go usage', () => {
    expect(parseOpencodeGoUsage(null)).toBeNull();
    expect(parseOpencodeGoUsage('{not json')).toBeNull();
    expect(parseOpencodeGoUsage({ error: 'nope' })).toBeNull();
    expect(parseOpencodeGoUsage({ usage: {} })).toBeNull();
  });
});

describe('opencodeGoCredentials', () => {
  test('recognises Go by base URL or name', () => {
    expect(isOpencodeGoCompatEntry(goEntry)).toBe(true);
    expect(
      isOpencodeGoCompatEntry({ name: 'go', 'base-url': 'https://opencode.ai/inference/go/v1' })
    ).toBe(true);
    expect(isOpencodeGoCompatEntry({ name: 'OpenCode-Go', 'base-url': 'https://x.test' })).toBe(
      true
    );
    expect(
      isOpencodeGoCompatEntry({ name: 'openrouter', 'base-url': 'https://openrouter.ai/api/v1' })
    ).toBe(false);
    expect(isOpencodeGoCompatEntry({ name: 'zen', 'base-url': 'https://opencode.ai/zen/v1' })).toBe(
      false
    );
  });

  test('one credential per Go key with an auth index', () => {
    const credentials = opencodeGoCredentials({
      'openai-compatibility': [
        { ...goEntry, 'api-key-entries': [...goEntry['api-key-entries'], { 'api-key': SECRET }] },
        {
          name: 'openrouter',
          'base-url': 'https://openrouter.ai/api/v1',
          'api-key-entries': [{ 'api-key': 'sk-or', 'auth-index': 'abc' }],
        },
        { ...goEntry, disabled: true },
      ],
    });
    expect(credentials).toEqual([
      {
        name: 'OpenCode Go',
        type: 'opencode-go',
        provider: 'opencode-go',
        authIndex: '27f1839b5dc78c10',
        source: 'config',
      },
    ]);
  });

  test('numbers additional Go keys', () => {
    const credentials = opencodeGoCredentials({
      'openai-compatibility': [
        goEntry,
        { ...goEntry, 'api-key-entries': [{ 'api-key': SECRET, 'auth-index': 'second' }] },
      ],
    });
    expect(credentials.map((credential) => credential.name)).toEqual([
      'OpenCode Go',
      'OpenCode Go 2',
    ]);
  });

  test('never carries the API key', () => {
    const credentials = opencodeGoCredentials({ 'openai-compatibility': [goEntry] });
    expect(JSON.stringify(credentials)).not.toContain(SECRET);
  });

  test('tolerates malformed config', () => {
    expect(opencodeGoCredentials(null)).toEqual([]);
    expect(opencodeGoCredentials({ 'openai-compatibility': 'nope' })).toEqual([]);
    expect(
      opencodeGoCredentials({ 'openai-compatibility': [{ ...goEntry, 'api-key-entries': 1 }] })
    ).toEqual([]);
  });
});

describe('Go in the quota page', () => {
  const [credential] = opencodeGoCredentials({ 'openai-compatibility': [goEntry] });
  const quota = { status: 'success', windows: parseOpencodeGoUsage(SAMPLE) };

  test('classifies as its own provider', () => {
    expect(classifyQuotaFiles([credential]).map((entry) => entry.type)).toEqual(['opencode-go']);
  });

  test('feeds the ledger and pools with weekly as the headline', () => {
    const limits = quotaLimits('opencode-go', quota, t);
    expect(limits.map((limit) => [limit.id, limit.remaining])).toEqual([
      ['five-hour', 100],
      ['weekly', 90],
      ['monthly', 95],
    ]);
    expect(headlineLimitId('opencode-go', limits)).toBe('weekly');
  });

  test('anchors the timeline lane on the weekly window', () => {
    const lane = buildTimelineLane({
      name: credential.name,
      displayName: credential.name,
      provider: 'opencode-go',
      quota,
    });
    expect(lane.anchorMs).toBe(Date.parse('2026-11-09T00:00:00.000Z'));
    expect(lane.remaining).toBe(90);
    expect(lane.limits.map((limit) => limit.label)).toEqual(['Session (5h)', 'Weekly', 'Monthly']);
  });
});
