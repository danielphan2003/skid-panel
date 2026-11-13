import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  AccountApiError,
  AccountSignedOutError,
  accountSession,
  skidAccountApi,
} from '@/services/api/skidAccount';
import { UsagePanel, WindowMeters } from './components/bits';
import { KeysSection, type KeyOps } from './components/KeysSection';
import { tokenFromSearch, type ModelOption, type SkidUser, type UsageRange } from './model';
import styles from './users.module.scss';

type Phase = 'loading' | 'signed-out' | 'signed-in';

/**
 * A skid user's own page: email sign-in with a magic link, then their keys
 * and usage. It never calls the Management API or needs the management key.
 */
export function AccountPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<SkidUser | null>(null);
  const [notice, setNotice] = useState('');
  const verifying = useRef('');

  const signedOut = useCallback((message = '') => {
    setUser(null);
    setNotice(message);
    setPhase('signed-out');
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setUser(await skidAccountApi.me());
      setPhase('signed-in');
    } catch (err) {
      if (err instanceof AccountSignedOutError) signedOut();
      else signedOut(err instanceof Error ? err.message : String(err));
    }
  }, [signedOut]);

  useEffect(() => {
    const token = tokenFromSearch(location.search);
    if (!token) {
      // A sign-in from a link is still being checked.
      if (verifying.current) return;
      if (accountSession.get()) void loadMe();
      else signedOut();
      return;
    }
    if (verifying.current === token) return;
    verifying.current = token;
    // An old session must not race the new one.
    accountSession.clear();
    // The token is single-use: take it out of the address bar right away.
    navigate('/account', { replace: true });
    skidAccountApi
      .verify(token)
      .then((u) => {
        setUser(u);
        setPhase('signed-in');
      })
      .finally(() => {
        verifying.current = '';
      })
      .catch((err: unknown) =>
        signedOut(
          err instanceof AccountApiError && err.status === 401
            ? t('account.link_expired')
            : err instanceof Error
              ? err.message
              : String(err)
        )
      );
  }, [location.search, loadMe, navigate, signedOut, t]);

  if (phase === 'loading') return <div className={styles.accountShell} aria-busy="true" />;
  if (phase === 'signed-out' || !user) return <EmailSignIn notice={notice} />;
  return (
    <AccountView
      user={user}
      onChanged={() => void loadMe()}
      onSignOut={() => {
        void skidAccountApi.logout().finally(() => signedOut(t('account.signed_out')));
      }}
      onSignedOut={() => signedOut(t('account.session_ended'))}
    />
  );
}

function EmailSignIn({ notice }: { notice: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setFailure('');
    try {
      await skidAccountApi.requestSignIn(email.trim());
      setMessage(t('account.link_sent'));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.accountShell}>
      <Card className={styles.signInCard}>
        <h1>{t('account.sign_in_title')}</h1>
        <p className={styles.muted}>{t('account.sign_in_desc')}</p>
        {notice && <div className={styles.notice}>{notice}</div>}
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
          <Input
            label={t('account.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" loading={sending} disabled={!email.trim()}>
            {t('account.send_link')}
          </Button>
        </form>
        {message && <div className={styles.notice}>{message}</div>}
        {failure && <div className={styles.error}>{failure}</div>}
        <a className={styles.adminLink} href="#/login">
          {t('account.admin_sign_in')}
        </a>
      </Card>
    </div>
  );
}

function AccountView({
  user,
  onChanged,
  onSignOut,
  onSignedOut,
}: {
  user: SkidUser;
  onChanged: () => void;
  onSignOut: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    skidAccountApi.models().then(setModels, () => setModels([]));
  }, []);

  // A session that ends mid-way sends the user back to sign in.
  const guard = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      try {
        return await work;
      } catch (err) {
        if (err instanceof AccountSignedOutError) onSignedOut();
        throw err;
      }
    },
    [onSignedOut]
  );

  const ops = useMemo<KeyOps>(
    () => ({
      create: (patch) => guard(skidAccountApi.createKey(patch)),
      update: (keyId, patch) => guard(skidAccountApi.updateKey(keyId, patch)),
      remove: (keyId) => guard(skidAccountApi.removeKey(keyId)),
      usage: (range, keyId) => guard(skidAccountApi.usage(range, keyId)),
    }),
    [guard]
  );
  const loadUsage = useCallback((range: UsageRange) => ops.usage(range), [ops]);

  return (
    <div className={styles.accountShell}>
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <div>
            <h1>{t('account.title')}</h1>
            <p className={styles.muted}>
              {user.name ? `${user.name} · ${user.email}` : user.email}
            </p>
          </div>
          <Button variant="secondary" onClick={onSignOut}>
            {t('account.sign_out')}
          </Button>
        </div>
        <Card title={t('account.limits_title')}>
          <p className={styles.muted}>{t('account.limits_desc')}</p>
          <WindowMeters windows={user.windows} />
        </Card>
        <Card>
          <KeysSection
            keys={user.keys}
            models={models}
            ops={ops}
            onChanged={() => {
              setRevision((r) => r + 1);
              onChanged();
            }}
          />
        </Card>
        <Card>
          <UsagePanel load={loadUsage} reloadKey={String(revision)} />
        </Card>
      </div>
    </div>
  );
}
