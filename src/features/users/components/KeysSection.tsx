import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconPencil, IconPlus, IconTrash2 } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import type { KeyPatch, ModelOption, SkidKey, UsageRange, UsageSeries } from '../model';
import { MachineBadge, UsagePanel, WindowMeters } from './bits';
import { KeyEditorModal, SecretModal } from './editors';
import styles from '../users.module.scss';

/** What the key list can do: the admin's routes or the signed-in user's. */
export interface KeyOps {
  create: (patch: KeyPatch) => Promise<{ key: SkidKey; secret: string }>;
  update: (keyId: string, patch: KeyPatch) => Promise<SkidKey>;
  remove: (keyId: string) => Promise<unknown>;
  usage: (range: UsageRange, keyId?: string) => Promise<UsageSeries>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function KeysSection({
  keys,
  models,
  ops,
  onChanged,
  extraActions,
  asAdmin = false,
}: {
  keys: SkidKey[];
  models: ModelOption[];
  ops: KeyOps;
  onChanged: () => void;
  extraActions?: React.ReactNode;
  /** The admin's switch is the admin flag; the user's is their own. */
  asAdmin?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const [editing, setEditing] = useState<SkidKey | 'new' | null>(null);
  const [secret, setSecret] = useState('');
  const [usageKey, setUsageKey] = useState<string | null>(null);

  const loadKeyUsage = useCallback(
    (range: UsageRange) => ops.usage(range, usageKey ?? undefined),
    [ops, usageKey]
  );

  const toggle = async (k: SkidKey, enabled: boolean) => {
    try {
      await ops.update(k.id, { disabled: !enabled });
      onChanged();
    } catch (err) {
      showNotification(errorText(err), 'error');
    }
  };

  const remove = (k: SkidKey) =>
    showConfirmation({
      title: t('users.key_delete_title'),
      message: t('users.key_delete_message', { name: k.name || `…${k.last4}` }),
      confirmText: t('users.key_delete'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await ops.remove(k.id);
          onChanged();
        } catch (err) {
          showNotification(errorText(err), 'error');
        }
      },
    });

  const formatDate = (iso: string) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
      : '';

  return (
    <div className={styles.keys}>
      <div className={styles.sectionHead}>
        <strong>{t('users.keys_title', { count: keys.length })}</strong>
        <div className={styles.actions}>
          {extraActions}
          <Button size="sm" onClick={() => setEditing('new')}>
            <IconPlus size={14} /> {t('users.key_create')}
          </Button>
        </div>
      </div>
      {keys.length === 0 && <div className={styles.muted}>{t('users.keys_empty')}</div>}
      {keys.map((k) => (
        <div
          key={k.id}
          className={k.disabled || k.adminDisabled ? styles.keyRowDisabled : styles.keyRow}
        >
          <div className={styles.keyMain}>
            <div className={styles.keyTitle}>
              <strong>{k.name || t('users.key_unnamed')}</strong>
              <code className={styles.muted}>…{k.last4}</code>
            </div>
            <MachineBadge machine={k.machine} />
            <div className={styles.muted}>
              {k.lastUsedAt
                ? t('users.key_last_used', { time: formatDate(k.lastUsedAt) })
                : t('users.key_never_used')}
              {k.scope ? ` · ${t('users.key_scoped')}` : ''}
            </div>
            {k.adminDisabled && <span className={styles.tag}>{t('users.key_admin_disabled')}</span>}
            {asAdmin && k.disabled && (
              <span className={styles.tag}>{t('users.key_user_disabled')}</span>
            )}
          </div>
          <WindowMeters windows={k.windows} />
          <div className={styles.keyActions}>
            <ToggleSwitch
              checked={asAdmin ? !k.adminDisabled : !k.disabled && !k.adminDisabled}
              disabled={!asAdmin && k.adminDisabled}
              onChange={(value) => void toggle(k, value)}
              ariaLabel={t('users.key_enabled')}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('users.usage_title')}
              onClick={() => setUsageKey(usageKey === k.id ? null : k.id)}
            >
              {t('users.usage_title')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('common.edit')}
              onClick={() => setEditing(k)}
            >
              <IconPencil size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('users.key_delete')}
              onClick={() => remove(k)}
            >
              <IconTrash2 size={14} />
            </Button>
          </div>
          {usageKey === k.id && (
            <div className={styles.keyUsage}>
              <UsagePanel load={loadKeyUsage} reloadKey={k.id} />
            </div>
          )}
        </div>
      ))}
      {editing && (
        <KeyEditorModal
          key={editing === 'new' ? 'new' : editing.id}
          open
          keyItem={editing === 'new' ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (editing === 'new') {
              const created = await ops.create(patch);
              setSecret(created.secret);
            } else {
              await ops.update(editing.id, patch);
            }
            onChanged();
          }}
        />
      )}
      <SecretModal secret={secret} onClose={() => setSecret('')} />
    </div>
  );
}
