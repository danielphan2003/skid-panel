import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconCopy } from '@/components/ui/icons';
import {
  MACHINE_KINDS,
  WINDOW_NAMES,
  emptyLimits,
  emptyScope,
  formatTokens,
  parseTokens,
  scopeIsEmpty,
  splitList,
  type KeyPatch,
  type Limits,
  type MachineKind,
  type ModelOption,
  type Scope,
  type SkidKey,
  type SkidUser,
  type UserPatch,
} from '../model';
import styles from '../users.module.scss';

interface ScopeDraft {
  providers: string;
  models: string;
  excludedProviders: string;
  excludedModels: string;
}

const scopeDraft = (scope: Scope | null): ScopeDraft => {
  const s = scope ?? emptyScope();
  return {
    providers: s.providers.join(', '),
    models: s.models.join('\n'),
    excludedProviders: s.excludedProviders.join(', '),
    excludedModels: s.excludedModels.join('\n'),
  };
};

const scopeFromDraft = (d: ScopeDraft): Scope => ({
  providers: splitList(d.providers),
  models: splitList(d.models),
  excludedProviders: splitList(d.excludedProviders),
  excludedModels: splitList(d.excludedModels),
});

type LimitsDraft = Record<keyof Limits, string>;

const limitsDraft = (l: Limits): LimitsDraft => ({
  daily: l.daily ? formatTokens(l.daily) : '',
  weekly: l.weekly ? formatTokens(l.weekly) : '',
  monthly: l.monthly ? formatTokens(l.monthly) : '',
});

function ScopeFields({
  draft,
  onChange,
  models,
}: {
  draft: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  models: ModelOption[];
}) {
  const { t } = useTranslation();
  const providers = useMemo(
    () => Array.from(new Set(models.flatMap((m) => m.providers))).sort(),
    [models]
  );
  const toggleProvider = (p: string) => {
    const current = splitList(draft.providers);
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    onChange({ ...draft, providers: next.join(', ') });
  };
  const chosen = splitList(draft.providers);
  return (
    <fieldset className={styles.fieldset}>
      <legend>{t('users.scope_title')}</legend>
      <p className={styles.muted}>{t('users.scope_hint')}</p>
      {providers.length > 0 && (
        <div className={styles.chips} role="group" aria-label={t('users.scope_providers')}>
          {providers.map((p) => (
            <button
              type="button"
              key={p}
              className={chosen.includes(p) ? styles.chipOn : styles.chip}
              aria-pressed={chosen.includes(p)}
              onClick={() => toggleProvider(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <Input
        label={t('users.scope_providers')}
        value={draft.providers}
        onChange={(e) => onChange({ ...draft, providers: e.target.value })}
        placeholder="antigravity, openai"
      />
      <label className={styles.label}>
        {t('users.scope_models')}
        <textarea
          className={styles.textarea}
          rows={3}
          value={draft.models}
          onChange={(e) => onChange({ ...draft, models: e.target.value })}
          placeholder={'gemini-*\ngpt-6-luna'}
        />
      </label>
      <Input
        label={t('users.scope_excluded_providers')}
        value={draft.excludedProviders}
        onChange={(e) => onChange({ ...draft, excludedProviders: e.target.value })}
      />
      <label className={styles.label}>
        {t('users.scope_excluded_models')}
        <textarea
          className={styles.textarea}
          rows={2}
          value={draft.excludedModels}
          onChange={(e) => onChange({ ...draft, excludedModels: e.target.value })}
        />
      </label>
      {models.length > 0 && (
        <details className={styles.modelList}>
          <summary>{t('users.scope_available', { count: models.length })}</summary>
          <ul>
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={styles.modelPick}
                  aria-label={t('users.scope_add_model', { model: m.id })}
                  onClick={() => {
                    const current = splitList(draft.models);
                    if (!current.includes(m.id)) {
                      onChange({ ...draft, models: [...current, m.id].join('\n') });
                    }
                  }}
                >
                  <code>{m.id}</code>
                </button>{' '}
                <span className={styles.muted}>{m.providers.join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}

function LimitsFields({
  draft,
  onChange,
  errors,
}: {
  draft: LimitsDraft;
  onChange: (next: LimitsDraft) => void;
  errors: Partial<Record<keyof Limits, string>>;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className={styles.fieldset}>
      <legend>{t('users.limits_title')}</legend>
      <p className={styles.muted}>{t('users.limits_hint')}</p>
      <div className={styles.limitsRow}>
        {WINDOW_NAMES.map((w) => (
          <Input
            key={w}
            label={t(`users.window_${w}`)}
            value={draft[w]}
            inputMode="decimal"
            placeholder={t('users.no_limit')}
            error={errors[w]}
            onChange={(e) => onChange({ ...draft, [w]: e.target.value })}
          />
        ))}
      </div>
    </fieldset>
  );
}

function parseLimits(draft: LimitsDraft, message: string) {
  const limits = emptyLimits();
  const errors: Partial<Record<keyof Limits, string>> = {};
  for (const w of WINDOW_NAMES) {
    const value = parseTokens(draft[w]);
    if (value === null) errors[w] = message;
    else limits[w] = value;
  }
  return { limits, errors };
}

export function KeyEditorModal({
  open,
  keyItem,
  models,
  onClose,
  onSave,
}: {
  open: boolean;
  keyItem: SkidKey | null;
  models: ModelOption[];
  onClose: () => void;
  onSave: (patch: KeyPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(keyItem?.name ?? '');
  const [label, setLabel] = useState(keyItem?.machine?.label ?? '');
  const [kind, setKind] = useState<MachineKind | ''>(keyItem?.machine?.kind ?? '');
  const [scope, setScope] = useState(scopeDraft(keyItem?.scope ?? null));
  const [limits, setLimits] = useState(limitsDraft(keyItem?.limits ?? emptyLimits()));
  const [errors, setErrors] = useState<Partial<Record<keyof Limits, string>>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');

  const save = async (patch: KeyPatch) => {
    setSaving(true);
    setFailure('');
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const parsed = parseLimits(limits, t('users.limits_invalid'));
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length > 0) return;
    const nextScope = scopeFromDraft(scope);
    const patch: KeyPatch = {
      name: name.trim(),
      limits: parsed.limits,
      ...(scopeIsEmpty(nextScope) ? { clearScope: true } : { scope: nextScope }),
    };
    const machineChanged =
      label.trim() !== (keyItem?.machine?.label ?? '') || kind !== (keyItem?.machine?.kind ?? '');
    if (machineChanged) {
      if (label.trim() || kind) patch.machine = { label: label.trim(), kind };
      else patch.clearMachine = true;
    }
    void save(patch);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={keyItem ? t('users.key_edit_title') : t('users.key_create_title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {keyItem ? t('common.save') : t('users.key_create')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Input
          label={t('users.key_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('users.key_name_placeholder')}
        />
        <fieldset className={styles.fieldset}>
          <legend>{t('users.machine_title')}</legend>
          <p className={styles.muted}>{t('users.machine_hint')}</p>
          <div className={styles.limitsRow}>
            <Input
              label={t('users.machine_label')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <div className="form-group">
              <label>{t('users.machine_kind')}</label>
              <Select
                value={kind}
                ariaLabel={t('users.machine_kind')}
                options={[
                  { value: '', label: t('users.machine_kind_none') },
                  ...MACHINE_KINDS.map((k) => ({ value: k, label: t(`users.machine_kind_${k}`) })),
                ]}
                onChange={(value) => setKind(value as MachineKind | '')}
              />
            </div>
          </div>
          {keyItem?.machine?.source === 'user' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void save({ clearMachine: true })}
            >
              {t('users.machine_reset')}
            </Button>
          )}
        </fieldset>
        <ScopeFields draft={scope} onChange={setScope} models={models} />
        <LimitsFields draft={limits} onChange={setLimits} errors={errors} />
        {failure && <div className={styles.error}>{failure}</div>}
      </div>
    </Modal>
  );
}

export function UserEditorModal({
  open,
  user,
  models,
  onClose,
  onSave,
}: {
  open: boolean;
  user: SkidUser | null;
  models: ModelOption[];
  onClose: () => void;
  onSave: (patch: UserPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [scope, setScope] = useState(scopeDraft(user?.scope ?? null));
  const [limits, setLimits] = useState(limitsDraft(user?.limits ?? emptyLimits()));
  const [errors, setErrors] = useState<Partial<Record<keyof Limits, string>>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');

  const submit = async () => {
    const parsed = parseLimits(limits, t('users.limits_invalid'));
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length > 0) return;
    const nextScope = scopeFromDraft(scope);
    setSaving(true);
    setFailure('');
    try {
      await onSave({
        email: email.trim(),
        name: name.trim(),
        limits: parsed.limits,
        ...(scopeIsEmpty(nextScope) ? { clearScope: true } : { scope: nextScope }),
      });
      onClose();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={user ? t('users.user_edit_title') : t('users.user_create_title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {user ? t('common.save') : t('users.user_create')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Input
          label={t('users.user_email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <Input
          label={t('users.user_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className={styles.muted}>{t('users.user_ceiling_hint')}</p>
        <ScopeFields draft={scope} onChange={setScope} models={models} />
        <LimitsFields draft={limits} onChange={setLimits} errors={errors} />
        {failure && <div className={styles.error}>{failure}</div>}
      </div>
    </Modal>
  );
}

/** Shows a new key once, with a copy button and how to set a machine up with it. */
export function SecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      open={secret !== ''}
      onClose={onClose}
      title={t('users.secret_title')}
      footer={<Button onClick={onClose}>{t('users.secret_done')}</Button>}
    >
      <div className={styles.form}>
        <p className={styles.warning}>{t('users.secret_warning')}</p>
        <div className={styles.secret}>
          <code>{secret}</code>
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            <IconCopy size={14} /> {copied ? t('users.secret_copied') : t('users.secret_copy')}
          </Button>
        </div>
        <p className={styles.muted}>{t('users.secret_setup')}</p>
        <code className={styles.command}>curl -fsSL {origin}/setup | bash</code>
        <code className={styles.command}>irm {origin}/setup.ps1 | iex</code>
      </div>
    </Modal>
  );
}
