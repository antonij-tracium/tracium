import type { AuthAppearance } from '../../../extensions';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TraciumWordmark } from '../../shell/Logo/TraciumWordmark';
import { AuthBackground } from './AuthBackground';
import styles from './AuthShell.module.css';

interface AuthShellProps {
  appearance?: AuthAppearance;
  active: 'signin' | 'signup';
  title: string;
  subtitle: string;
  footnote: { text: string; linkText: string; to: string };
  children: ReactNode;
}

/**
 * Shared chrome for the auth screens: the drifting background, the brand
 * header, and a single tabbed card. The tabs double as navigation between the
 * /login and /signup routes, so each page keeps its own form logic while the
 * two read as one surface.
 */
export function AuthShell({ active, title, subtitle, footnote, children, appearance }: AuthShellProps) {
  return (
    <div className={styles.page}>
      <AuthBackground />

      <div className={styles.shell}>
        <header className={styles.header}>
          <TraciumWordmark height={26} className={styles.logo} />
          <span className={styles.status}>
            <span className={styles.statusDot} />
            {appearance?.tagline ?? 'Open source · self-hosted'}
          </span>
        </header>

        <div className={styles.card}>
          <nav className={styles.tabs}>
            <Link
              to="/login"
              className={`${styles.tab} ${active === 'signin' ? styles.tabActive : ''}`}
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className={`${styles.tab} ${active === 'signup' ? styles.tabActive : ''}`}
            >
              Create account
            </Link>
          </nav>

          <div className={styles.body}>
            <div className={styles.heading}>
              <h1 className={styles.title}>{title}</h1>
              <p className={styles.subtitle}>{subtitle}</p>
            </div>

            {children}

            <div className={styles.divider} />

            <p className={styles.footnote}>
              {footnote.text}{' '}
              <Link to={footnote.to} className={styles.footlink}>
                {footnote.linkText}
              </Link>
            </p>
          </div>
        </div>

        <p className={styles.legal}>{appearance?.footer ?? 'Open source · self-hosted · your traces never leave your infrastructure'}</p>
      </div>
    </div>
  );
}
