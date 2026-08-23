import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AuthBackground,
  AuthCard,
  AuthButton,
  AuthDivider,
  GoogleOAuthButton,
  AuthPreview,
} from '../components';
import { loginUser, AuthError } from '../api';
import styles from './LoginPage.module.css';

const errorMessages: Record<string, string> = {
  missing_fields: 'Please provide both your email and password to continue.',
  invalid_credentials: "We couldn't verify those credentials. Check your details and try again.",
  oauth_failed: 'Google sign-in failed. Please try again.',
  oauth_missing_token: 'Authentication failed. Please try again.',
};

interface LoginPageProps {
  onLogin: (token: string, email: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const params = new URLSearchParams(window.location.search);
  const errorKey = params.get('error') ?? undefined;

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    errorKey ? (errorMessages[errorKey] ?? 'Something went wrong. Please try again.') : null,
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    if (!email || !password) {
      setFormError(errorMessages.missing_fields);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const { token } = await loginUser({ email, password });
      onLogin(token, email);
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        setFormError(errorMessages.invalid_credentials);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <AuthBackground />

      <div className={styles.layout}>
        <div className={styles.previewPanel}>
          <AuthPreview />
        </div>

        <AuthCard>
          <div className={styles.heading}>
            <h1 className={styles.formTitle}>Welcome back</h1>
            <p className={styles.formSubtitle}>Sign in to your Tracium account</p>
          </div>

          <GoogleOAuthButton mode="login" />

          <AuthDivider text="Or continue with email" />

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
                placeholder="you@company.com"
              />
            </div>

            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor="password">
                  Password
                </label>
                <Link to="/forgot-password" className={styles.forgotLink}>
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={styles.input}
                placeholder="••••••••"
              />
            </div>

            {formError ? (
              <div className={styles.errorBanner}>{formError}</div>
            ) : null}

            <AuthButton type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </AuthButton>
          </form>

          <AuthDivider text="New to Tracium?" />

          <AuthButton href="/signup" variant="secondary">
            Create free account
          </AuthButton>
        </AuthCard>
      </div>
    </div>
  );
}
