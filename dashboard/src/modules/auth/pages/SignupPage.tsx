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
import { registerUser, AuthError } from '../api';
import styles from './LoginPage.module.css';

interface SignupPageProps {
  onLogin: (token: string, email: string) => void;
}

export default function SignupPage({ onLogin }: SignupPageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      const { token } = await registerUser({ email, password });
      onLogin(token, email);
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

  return (
    <div className={styles.page}>
      <AuthBackground />

      <div className={styles.layout}>
        <div className={styles.previewPanel}>
          <AuthPreview />
        </div>

        <AuthCard>
          <div className={styles.heading}>
            <h1 className={styles.formTitle}>Create your account</h1>
            <p className={styles.formSubtitle}>Start tracing with Tracium</p>
          </div>

          <GoogleOAuthButton mode="signup" />

          <AuthDivider text="Or sign up with email" />

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
              <label className={styles.label} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                className={styles.input}
                placeholder="••••••••"
              />
            </div>

            {formError ? (
              <div className={styles.errorBanner}>{formError}</div>
            ) : null}

            <AuthButton type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
            </AuthButton>
          </form>

          <AuthDivider text="Already have an account?" />

          <AuthButton href="/login" variant="secondary">
            Sign in
          </AuthButton>
        </AuthCard>
      </div>
    </div>
  );
}
