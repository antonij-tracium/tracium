import type { AuthAppearance } from '../../../extensions';
import { useEffect, useState } from 'react';
import { AuthShell, AuthButton } from '../../auth/components';
import { formatDate } from '../../../common';
import { previewInvite, acceptInvite, InviteError, type InvitePreview } from '../api';
import styles from '../../auth/pages/LoginPage.module.css';

interface InvitePageProps {
  token: string;
  appearance?: AuthAppearance;
  /** The signed-in session, or null when the visitor is signed out. */
  session: { token: string; email: string } | null;
  /** Called with the joined workspace's id once the invite is accepted. */
  onAccepted?: (workspaceId: string) => void;
  /** Leaves the invite without accepting it. */
  onDismiss?: () => void;
  /** Signs out, so the invitee can sign back in with the invited address. */
  onSignOut?: () => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; invite: InvitePreview }
  | { state: 'error'; message: string };

function loadError(err: unknown): string {
  if (err instanceof InviteError) {
    if (err.status === 404) return 'This invite link isn’t valid. Ask the workspace owner for a new one.';
    if (err.status === 410) return 'This invite has expired or was already used. Ask the workspace owner for a new one.';
    if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
  }
  return 'We couldn’t load this invite. Try again in a moment.';
}

/**
 * Landing page for an invite link (/invite/<token>). Signed out, it describes
 * the invite and sends the visitor to sign in or create an account with the
 * invited address; the token is remembered meanwhile (see pending.ts). Signed
 * in, it accepts the invite for the current account.
 */
export default function InvitePage({ token, appearance, session, onAccepted, onDismiss, onSignOut }: InvitePageProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    previewInvite(token).then(
      invite => { if (!cancelled) setLoad({ state: 'ready', invite }); },
      err => { if (!cancelled) setLoad({ state: 'error', message: loadError(err) }); },
    );
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    if (!session || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const { workspace_id } = await acceptInvite(token, session.token);
      onAccepted?.(workspace_id);
    } catch (err) {
      if (err instanceof InviteError && err.status === 403) {
        setAcceptError('This invite was sent to a different email address. Sign in with that address to accept it.');
      } else if (err instanceof InviteError && (err.status === 404 || err.status === 410)) {
        setAcceptError(loadError(err));
      } else {
        setAcceptError('We couldn’t accept this invite. Try again in a moment.');
      }
    } finally {
      setAccepting(false);
    }
  };

  const dismiss = onDismiss && (
    <AuthButton variant="secondary" onClick={onDismiss}>{session ? 'Go to dashboard' : 'Dismiss'}</AuthButton>
  );

  if (load.state === 'loading') {
    return (
      <AuthShell appearance={appearance} title="Workspace invite" subtitle="Loading invite…">
        <div role="status" className={styles.noticeMuted}>Checking your invite link…</div>
      </AuthShell>
    );
  }

  if (load.state === 'error') {
    return (
      <AuthShell appearance={appearance} title="Workspace invite" subtitle="This invite can’t be used.">
        <div className={styles.form}>
          <div role="alert" className={styles.errorBanner}>{load.message}</div>
          {dismiss}
        </div>
      </AuthShell>
    );
  }

  const { invite } = load;
  const invitedBy = invite.invited_by_email || 'A workspace owner';
  const subtitle = `${invitedBy} invited ${invite.email} to join this workspace.`;
  const wrongAccount = session && session.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <AuthShell appearance={appearance} title={`Join ${invite.workspace_name}`} subtitle={subtitle}>
      <div className={styles.form}>
        {!session && (
          <>
            <div className={styles.notice}>
              <p>Sign in or create an account with <strong>{invite.email}</strong> to accept. You’ll come back here afterwards.</p>
              <p className={styles.noticeMuted}>This invite expires on {formatDate(invite.expires_at)}.</p>
            </div>
            <AuthButton href="/login">Sign in</AuthButton>
            <AuthButton href="/signup" variant="secondary">Create account</AuthButton>
          </>
        )}

        {session && wrongAccount && (
          <>
            <div role="alert" className={styles.errorBanner}>
              You’re signed in as <strong>{session.email}</strong>, but this invite is for <strong>{invite.email}</strong>. Sign out and sign in with that address to accept.
            </div>
            {onSignOut && <AuthButton onClick={onSignOut}>Sign out</AuthButton>}
            {dismiss}
          </>
        )}

        {session && !wrongAccount && (
          <>
            <div className={styles.notice}>
              <p>You’ll join <strong>{invite.workspace_name}</strong> as a member and see its traces, usage and API keys.</p>
              <p className={styles.noticeMuted}>This invite expires on {formatDate(invite.expires_at)}.</p>
            </div>
            {acceptError && <div role="alert" className={styles.errorBanner}>{acceptError}</div>}
            <button type="button" className={styles.submit} disabled={accepting} onClick={accept}>
              {accepting ? 'Joining…' : 'Accept invite'}
            </button>
            {dismiss}
          </>
        )}
      </div>
    </AuthShell>
  );
}
