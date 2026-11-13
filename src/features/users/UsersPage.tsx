import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCopy,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import { apiKeysApi } from '@/services/api/apiKeys';
import { skidUsersApi } from '@/services/api/skidUsers';
import { useNotificationStore } from '@/stores';
import { UsagePanel, WindowMeters } from './components/bits';
import { UserEditorModal } from './components/editors';
import { KeysSection, type KeyOps } from './components/KeysSection';
import type { ModelOption, SkidUser, UsageRange } from './model';
import styles from './users.module.scss';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Every skid user, their keys and usage, for the admin. */
export function UsersPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);
  const showConfirmation = useNotificationStore((s) => s.showConfirmation);
  const [users, setUsers] = useState<SkidUser[] | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<SkidUser | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importFor, setImportFor] = useState<SkidUser | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    try {
      setUsers(await skidUsersApi.list());
      setError('');
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
    skidUsersApi.models().then(setModels, () => setModels([]));
  }, [load]);

  const refresh = useCallback(() => {
    setRevision((r) => r + 1);
    void load();
  }, [load]);

  const toggleUser = async (u: SkidUser, enabled: boolean) => {
    try {
      await skidUsersApi.update(u.id, { disabled: !enabled });
      refresh();
    } catch (err) {
      showNotification(errorText(err), 'error');
    }
  };

  const removeUser = (u: SkidUser) =>
    showConfirmation({
      title: t('users.user_delete_title'),
      message: t('users.user_delete_message', { email: u.email }),
      confirmText: t('users.user_delete'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await skidUsersApi.remove(u.id);
          refresh();
        } catch (err) {
          showNotification(errorText(err), 'error');
        }
      },
    });

  const copyLink = async (u: SkidUser) => {
    try {
      const url = await skidUsersApi.signInLink(u.id);
      await navigator.clipboard.writeText(url);
      showNotification(t('users.link_copied'), 'success');
    } catch (err) {
      showNotification(errorText(err), 'error');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1>{t('users.title')}</h1>
          <p className={styles.muted}>{t('users.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={refresh} aria-label={t('common.refresh')}>
            <IconRefreshCw size={16} />
          </Button>
          <Button onClick={() => setEditing('new')}>
            <IconPlus size={16} /> {t('users.user_create')}
          </Button>
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {users && users.length === 0 && (
        <EmptyState title={t('users.empty_title')} description={t('users.empty_desc')} />
      )}
      {users?.map((u) => (
        <Card key={u.id} className={u.disabled ? styles.userDisabled : undefined}>
          <div className={styles.userRow}>
            <button
              type="button"
              className={styles.userMain}
              aria-expanded={expanded === u.id}
              onClick={() => setExpanded(expanded === u.id ? null : u.id)}
            >
              <strong>{u.name || u.email}</strong>
              {u.name && <span className={styles.muted}>{u.email}</span>}
              <span className={styles.muted}>
                {t('users.keys_title', { count: u.keys.length })}
                {u.scope ? ` · ${t('users.key_scoped')}` : ''}
              </span>
            </button>
            <WindowMeters windows={u.windows} />
            <div className={styles.keyActions}>
              <ToggleSwitch
                checked={!u.disabled}
                onChange={(value) => void toggleUser(u, value)}
                ariaLabel={t('users.user_enabled')}
              />
              <Button variant="ghost" size="sm" onClick={() => void copyLink(u)}>
                <IconCopy size={14} /> {t('users.link_copy')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('common.edit')}
                onClick={() => setEditing(u)}
              >
                <IconPencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('users.user_delete')}
                onClick={() => removeUser(u)}
              >
                <IconTrash2 size={14} />
              </Button>
            </div>
          </div>
          {expanded === u.id && (
            <UserDetail
              user={u}
              models={models}
              revision={revision}
              onChanged={refresh}
              onImport={() => setImportFor(u)}
            />
          )}
        </Card>
      ))}
      {editing && (
        <UserEditorModal
          key={editing === 'new' ? 'new' : editing.id}
          open
          user={editing === 'new' ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (editing === 'new') await skidUsersApi.create(patch);
            else await skidUsersApi.update(editing.id, patch);
            refresh();
          }}
        />
      )}
      {importFor && (
        <ImportKeyModal
          user={importFor}
          onClose={() => setImportFor(null)}
          onImported={() => {
            setImportFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function UserDetail({
  user,
  models,
  revision,
  onChanged,
  onImport,
}: {
  user: SkidUser;
  models: ModelOption[];
  revision: number;
  onChanged: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const ops = useMemo<KeyOps>(
    () => ({
      create: (patch) => skidUsersApi.createKey(user.id, patch),
      update: (keyId, patch) => skidUsersApi.updateKey(user.id, keyId, patch),
      remove: (keyId) => skidUsersApi.removeKey(user.id, keyId),
      usage: (range, keyId) => skidUsersApi.usage(user.id, range, keyId),
    }),
    [user.id]
  );
  const loadUsage = useCallback((range: UsageRange) => ops.usage(range), [ops]);
  return (
    <div className={styles.detail}>
      <KeysSection
        keys={user.keys}
        models={models}
        ops={ops}
        onChanged={onChanged}
        extraActions={
          <Button variant="secondary" size="sm" onClick={onImport}>
            <IconKey size={14} /> {t('users.key_import')}
          </Button>
        }
      />
      <UsagePanel load={loadUsage} reloadKey={String(revision)} />
    </div>
  );
}

/** Gives a user one of config.yaml's api-keys; skid then removes it from config.yaml. */
function ImportKeyModal({
  user,
  onClose,
  onImported,
}: {
  user: SkidUser;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<string[]>([]);
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    apiKeysApi.list().then(setKeys, (err: unknown) => setFailure(errorText(err)));
  }, []);

  const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : '…');

  const submit = async () => {
    if (!choice) return;
    setSaving(true);
    setFailure('');
    try {
      await skidUsersApi.importKey(user.id, choice, name.trim() ? { name: name.trim() } : {});
      onImported();
    } catch (err) {
      setFailure(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('users.import_title', { email: user.email })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={!choice}>
            {t('users.key_import')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.muted}>{t('users.import_hint')}</p>
        {keys.length === 0 ? (
          <div className={styles.muted}>{t('users.import_none')}</div>
        ) : (
          <div className="form-group">
            <label>{t('users.import_choose')}</label>
            <Select
              value={choice}
              placeholder={t('users.import_choose')}
              ariaLabel={t('users.import_choose')}
              options={keys.map((k) => ({ value: k, label: mask(k) }))}
              onChange={setChoice}
            />
          </div>
        )}
        <label className={styles.label}>
          {t('users.key_name')}
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {failure && <div className={styles.error}>{failure}</div>}
      </div>
    </Modal>
  );
}
