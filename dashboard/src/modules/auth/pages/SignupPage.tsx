import type { AuthAppearance } from '../../../extensions';
import { FormEvent, useState } from 'react';
import { AuthShell } from '../components';
import { registerUser, AuthError } from '../api';
import styles from './LoginPage.module.css';

interface SignupPageProps {
  appearance?: AuthAppearance;
  onLogin: (token: string, email: string) => void;
}

export default function SignupPage({ onLogin, appearance }: SignupPageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set once the account is created but still needs email confirmation; holds
  // the address we sent the link to so we can show it back to the user.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    if (!email || !password) {
      setFormError('Please provide both your email and password to continue.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const result = await registerUser({ email, password });
      // The hosted service withholds the session until the email is confirmed;
      // prompt the user to check their inbox instead of signing them in.
      if (result.confirmationRequired || !result.token) {
        setPendingEmail(email);
        return;
      }
      onLogin(result.token, email);
    } catch (err) {
      if (err instanceof AuthError && err.status === 409) {
        setFormError('An account with that email already exists. Try signing in instead.');
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingEmail) {
    return (
      <AuthShell appearance={appearance}
        active="signup"
        title="Confirm your email"
        subtitle="Your account is almost ready."
        footnote={{ text: 'Already confirmed?', linkText: 'Sign in', to: '/login' }}
      >
        <div className={styles.notice}>
          <p>
            We sent a confirmation link to <strong>{pendingEmail}</strong>. Open it to
            activate your account, then come back to sign in.
          </p>
          <p className={styles.noticeMuted}>
            The link expires in 24 hours. If it isn't in your inbox, check your spam folder.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell appearance={appearance}
      active="signup"
      title="Start tracing"
      subtitle="Free and open source. Self-host in minutes — no limits, no lock-in."
      footnote={{ text: 'Already have an account?', linkText: 'Sign in', to: '/login' }}
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={styles.input}
            placeholder="you@example.com"
          />
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor="password">
              Password
            </label>
            <span className={`${styles.hint} ${styles.hintStatic}`}>12+ characters</span>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className={`${styles.input} ${styles.password}`}
            placeholder="••••••••••••"
          />
        </div>

        {formError ? <div className={styles.errorBanner}>{formError}</div> : null}

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create free account'}
        </button>
      </form>
    </AuthShell>
  );
}
