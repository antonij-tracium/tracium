// ---------------------------------------------------------------------------
// ApiKeysPage — API key management: list, create, reveal, revoke
// Inline styles only (no CSS modules).
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useEffect } from 'react';
import {
  IconSearch,
  IconPlus,
  IconCopy,
  IconTrash,
  IconKey,
  IconCheck,
  Sparkline,
  StatusPill,
} from '../../../common';
import { API_KEYS } from '../data';
import type { ApiKey } from '../interfaces';
import type { ApiKeyId, TabId } from '../ids';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ApiKeysPageProps {
  /** Seed the demo keys (auth-page preview). A real workspace starts with none. */
  demo?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// SectionHead
// ---------------------------------------------------------------------------

interface SectionHeadProps {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  first?: boolean;
}

function SectionHead({ title, hint, right, first = false }: SectionHeadProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        flexWrap: 'wrap',
        paddingTop: first ? 0 : 48,
        paddingBottom: 18,
        borderTop: first
          ? 'none'
          : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          minWidth: 0,
          paddingTop: first ? 0 : 28,
        }}
      >
        <h2
          style={{
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: '-0.018em',
            margin: 0,
            color: 'var(--foreground)',
          }}
        >
          {title}
        </h2>
        {hint && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              margin: 0,
              maxWidth: 620,
            }}
          >
            {hint}
          </p>
        )}
      </div>
      {right && (
        <div style={{ paddingTop: first ? 0 : 28, flexShrink: 0 }}>{right}</div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

interface KpiProps {
  label: string;
  value: string | number;
  hint: string;
  last?: boolean;
}

function Kpi({ label, value, hint, last = false }: KpiProps) {
  return (
    <div
      style={{
        padding: '0 28px 0 0',
        borderRight: last
          ? 'none'
          : '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 34,
          fontWeight: 500,
          letterSpacing: '-0.03em',
          color: 'var(--foreground)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {hint}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------


interface TabDef {
  id: TabId;
  label: string;
  count: number;
}

interface TabsProps {
  tab: TabId;
  setTab: (t: TabId) => void;
  tabs: TabDef[];
}

function Tabs({ tab, setTab, tabs }: TabsProps) {
  return (
    <div style={{ display: 'flex', gap: 18 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            padding: '0 0 8px',
            fontSize: 13,
            fontWeight: 500,
            background: 'transparent',
            color: tab === t.id ? 'var(--foreground)' : 'var(--muted)',
            border: 'none',
            borderBottom:
              tab === t.id
                ? '1.5px solid var(--accent)'
                : '1.5px solid transparent',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t.label}
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              fontVariantNumeric: 'tabular-nums',
              padding: '1px 6px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            {t.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvChip
// ---------------------------------------------------------------------------

function EnvChip({ env }: { env: ApiKey['env'] }) {
  const map: Record<ApiKey['env'], { fg: string; label: string }> = {
    production:  { fg: 'var(--accent)',   label: 'prod' },
    staging:     { fg: 'var(--warning)',  label: 'stg'  },
    development: { fg: 'var(--muted)',    label: 'dev'  },
  };
  const m = map[env];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        background: `color-mix(in srgb, ${m.fg} 12%, transparent)`,
        color: m.fg,
        border: `1px solid color-mix(in srgb, ${m.fg} 22%, transparent)`,
      }}
    >
      {m.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ModalShell
// ---------------------------------------------------------------------------

interface ModalShellProps {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}

function ModalShell({ children, onClose, width = 520 }: ModalShellProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4,8,7,0.7)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '92vw',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong, rgba(255,255,255,0.12))',
          borderRadius: 12,
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateKeyModal
// ---------------------------------------------------------------------------

interface CreateKeyPayload {
  name: string;
  env: ApiKey['env'];
  scopes: string[];
  expiry: string;
}

interface CreateKeyModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: CreateKeyPayload) => void;
}

type ScopeMap = Record<string, boolean>;

const ALL_SCOPES = [
  { id: 'traces:write',  hint: 'Send trace data'           },
  { id: 'traces:read',   hint: 'Read trace data'           },
  { id: 'metrics:read',  hint: 'Read aggregate metrics'    },
  { id: 'agents:write',  hint: 'Create or update agents'   },
];

const DEFAULT_SCOPES: ScopeMap = {
  'traces:write':  true,
  'traces:read':   false,
  'metrics:read':  true,
  'agents:write':  false,
};

function CreateKeyModal({ open, onClose, onCreate }: CreateKeyModalProps) {
  const [name, setName] = useState('');
  const [env, setEnv] = useState<ApiKey['env']>('production');
  const [scopes, setScopes] = useState<ScopeMap>(DEFAULT_SCOPES);
  const [expiry, setExpiry] = useState('never');

  useEffect(() => {
    if (open) {
      setName('');
      setEnv('production');
      setScopes(DEFAULT_SCOPES);
      setExpiry('never');
    }
  }, [open]);

  if (!open) return null;

  const canCreate =
    name.trim().length > 0 && Object.values(scopes).some(Boolean);

  const envOptions: { id: ApiKey['env']; label: string; prefix: string }[] = [
    { id: 'production',  label: 'Production',  prefix: 'tr_live' },
    { id: 'staging',     label: 'Staging',     prefix: 'tr_test' },
    { id: 'development', label: 'Development', prefix: 'tr_test' },
  ];

  const expiryOptions = [
    { id: '30d',   label: '30 days'       },
    { id: '90d',   label: '90 days'       },
    { id: '1y',    label: '1 year'        },
    { id: 'never', label: 'No expiration' },
  ];

  function handleSubmit() {
    if (!canCreate) return;
    const activeScopes = Object.entries(scopes)
      .filter(([, v]) => v)
      .map(([k]) => k);
    onCreate({ name, env, scopes: activeScopes, expiry });
  }

  return (
    <ModalShell onClose={onClose}>
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: 'var(--foreground)',
          }}
        >
          Create API key
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
          The full secret will be shown once after creation.
        </div>
      </div>

      <div
        style={{
          padding: '22px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* Name */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Name
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Production · Web app"
            style={{
              width: '100%',
              padding: '9px 12px',
              background: 'transparent',
              border:
                '1px solid var(--border-strong, rgba(255,255,255,0.12))',
              borderRadius: 7,
              color: 'var(--foreground)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Environment */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Environment
          </div>
          <div
            style={{
              display: 'flex',
              gap: 0,
              borderBottom:
                '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
            }}
          >
            {envOptions.map((e) => (
              <button
                key={e.id}
                onClick={() => setEnv(e.id)}
                style={{
                  padding: '8px 16px 10px',
                  marginRight: 4,
                  background: 'transparent',
                  border: 'none',
                  borderBottom:
                    env === e.id
                      ? '1.5px solid var(--accent)'
                      : '1.5px solid transparent',
                  marginBottom: -1,
                  fontSize: 13,
                  fontWeight: 500,
                  color:
                    env === e.id ? 'var(--foreground)' : 'var(--muted)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {e.label}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                    color: 'var(--muted)',
                    marginLeft: 8,
                  }}
                >
                  {e.prefix}_…
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Scopes */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Scopes
          </div>
          <div>
            {ALL_SCOPES.map((s, i) => (
              <label
                key={s.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom:
                    i < ALL_SCOPES.length - 1
                      ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)'
                      : 'none',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={scopes[s.id] ?? false}
                  onChange={(e) =>
                    setScopes({ ...scopes, [s.id]: e.target.checked })
                  }
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12.5,
                    color: 'var(--foreground)',
                  }}
                >
                  {s.id}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {s.hint}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Expiration */}
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 500,
              marginBottom: 8,
            }}
          >
            Expiration
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            {expiryOptions.map((e) => (
              <button
                key={e.id}
                onClick={() => setExpiry(e.id)}
                style={{
                  padding: '0 0 6px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom:
                    expiry === e.id
                      ? '1.5px solid var(--accent)'
                      : '1.5px solid transparent',
                  fontSize: 13,
                  fontWeight: 500,
                  color:
                    expiry === e.id ? 'var(--foreground)' : 'var(--muted)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '14px 24px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '7px 13px',
            background: 'transparent',
            border:
              '1px solid var(--border-strong, rgba(255,255,255,0.12))',
            borderRadius: 7,
            color: 'var(--foreground)',
            fontSize: 13,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          disabled={!canCreate}
          onClick={handleSubmit}
          style={{
            padding: '7px 13px',
            background: canCreate
              ? 'var(--accent)'
              : 'color-mix(in srgb, var(--accent) 35%, transparent)',
            border:
              '1px solid ' + (canCreate ? 'var(--accent)' : 'transparent'),
            borderRadius: 7,
            color: 'var(--accent-contrast)',
            fontSize: 13,
            fontWeight: 600,
            cursor: canCreate ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          Create key
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// RevealKeyModal
// ---------------------------------------------------------------------------

interface RevealKeyModalProps {
  keyData: ApiKey | null;
  onClose: () => void;
}

function RevealKeyModal({ keyData, onClose }: RevealKeyModalProps) {
  const [copied, setCopied] = useState(false);

  if (!keyData) return null;

  const fullKey = `${keyData.prefix}_${keyData.fullSecret ?? '(secret)'}`;

  function handleCopy() {
    void navigator.clipboard?.writeText(fullKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <ModalShell onClose={onClose} width={580}>
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background:
              'color-mix(in srgb, var(--accent) 14%, transparent)',
            border:
              '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--accent)',
            flexShrink: 0,
          }}
        >
          <IconKey size={15} />
        </span>
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              color: 'var(--foreground)',
            }}
          >
            Key created — copy it now
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
            You won't see the full secret again.
          </div>
        </div>
      </div>

      <div style={{ padding: '22px 24px' }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          {keyData.name}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--surface-alt)',
            border:
              '1px solid var(--border-strong, rgba(255,255,255,0.12))',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            color: 'var(--foreground)',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ flex: 1 }}>{fullKey}</span>
          <button
            onClick={handleCopy}
            style={{
              padding: '5px 11px',
              background: copied ? 'var(--accent)' : 'transparent',
              border:
                '1px solid ' +
                (copied
                  ? 'var(--accent)'
                  : 'var(--border-strong, rgba(255,255,255,0.12))'),
              borderRadius: 6,
              color: copied ? 'var(--accent-contrast)' : 'var(--foreground)',
              fontSize: 11.5,
              fontWeight: 500,
              fontFamily: 'inherit',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12.5,
            color: 'var(--muted)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </span>
          <span>
            Store this in a secrets manager. The dashboard will only ever show{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
            >
              {keyData.prefix}_…{keyData.tail}
            </code>{' '}
            from now on.
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '14px 24px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '7px 13px',
            background: 'var(--accent)',
            border: '1px solid var(--accent)',
            borderRadius: 7,
            color: 'var(--accent-contrast)',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Done — I've stored it safely
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// RevokeModal
// ---------------------------------------------------------------------------

interface RevokeModalProps {
  targetKey: ApiKey | null;
  onClose: () => void;
  onConfirm: (id: string, reason: string) => void;
}

function RevokeModal({ targetKey, onClose, onConfirm }: RevokeModalProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (targetKey) setReason('');
  }, [targetKey]);

  if (!targetKey) return null;

  return (
    <ModalShell onClose={onClose} width={460}>
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: 'var(--foreground)',
          }}
        >
          Revoke key
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
          Requests using{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>
            {targetKey.prefix}_…{targetKey.tail}
          </code>{' '}
          will fail with{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>401</code>{' '}
          immediately.
        </div>
      </div>
      <div style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          This key handled{' '}
          <span
            style={{
              color: 'var(--foreground)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtNum(targetKey.requests7d)}
          </span>{' '}
          requests in the last 7 days.
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          Reason
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Routine rotation"
          style={{
            width: '100%',
            padding: '9px 12px',
            background: 'transparent',
            border:
              '1px solid var(--border-strong, rgba(255,255,255,0.12))',
            borderRadius: 7,
            color: 'var(--foreground)',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '14px 24px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '7px 13px',
            background: 'transparent',
            border:
              '1px solid var(--border-strong, rgba(255,255,255,0.12))',
            borderRadius: 7,
            color: 'var(--foreground)',
            fontSize: 13,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(targetKey.id, reason)}
          style={{
            padding: '7px 13px',
            background:
              'color-mix(in srgb, var(--error) 12%, transparent)',
            border:
              '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
            borderRadius: 7,
            color: 'var(--error)',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Revoke key
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const ACTIVE_COLS = [
  { label: 'Name',      w: 'minmax(220px,1.5fr)', align: 'left'  as const },
  { label: 'Key',       w: 'minmax(230px,1.3fr)', align: 'left'  as const },
  { label: 'Env',       w: '60px',                align: 'left'  as const },
  { label: 'Last used', w: '130px',               align: 'left'  as const },
  { label: 'Usage 7d',  w: '90px',                align: 'left'  as const },
  { label: 'Scopes',    w: '130px',               align: 'left'  as const },
  { label: 'Created',   w: '110px',               align: 'left'  as const },
  { label: '',          w: '32px',                align: 'right' as const },
];
const ACTIVE_TMPL = ACTIVE_COLS.map((c) => c.w).join(' ');

// ---------------------------------------------------------------------------
// KeyRow — active key row with hover state
// ---------------------------------------------------------------------------

interface KeyRowProps {
  k: ApiKey;
  isLast: boolean;
  onRevoke: (k: ApiKey) => void;
}

function KeyRow({ k, isLast, onRevoke }: KeyRowProps) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);
  const masked = `${k.prefix}_••••••••••••••${k.tail}`;
  const sparkColor =
    k.env === 'production'
      ? 'var(--accent)'
      : k.env === 'staging'
        ? 'var(--warning)'
        : 'var(--muted)';

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard?.writeText(masked);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: ACTIVE_TMPL,
        minWidth: 1120,
        gap: 14,
        alignItems: 'center',
        padding: hover ? '14px 14px' : '14px 0',
        borderBottom: isLast
          ? 'none'
          : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
        transition: 'background .12s, padding .12s',
        background: hover
          ? 'color-mix(in srgb, var(--surface) 50%, transparent)'
          : 'transparent',
        borderRadius: hover ? 7 : 0,
      }}
    >
      {/* Name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: 'var(--foreground)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {k.name}
          </span>
          {k.status === 'stale' && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background:
                  'color-mix(in srgb, var(--warning) 12%, transparent)',
                color: 'var(--warning)',
                border:
                  '1px solid color-mix(in srgb, var(--warning) 22%, transparent)',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              Stale
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          by {k.createdBy}
        </div>
      </div>

      {/* Key masked */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {masked}
        </code>
        <button
          onClick={handleCopy}
          title="Copy id"
          style={{
            padding: '4px 6px',
            background: 'transparent',
            border: 'none',
            color: copied
              ? 'var(--accent)'
              : hover
                ? 'var(--muted)'
                : 'transparent',
            flexShrink: 0,
            transition: 'color .12s',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      </div>

      {/* Env chip */}
      <div>
        <EnvChip env={k.env} />
      </div>

      {/* Last used */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12.5,
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {k.lastUsedAt}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {k.lastUsedIp ?? '—'}
        </span>
      </div>

      {/* Sparkline + count */}
      <div>
        <Sparkline
          data={k.spark}
          width={70}
          height={18}
          color={sparkColor}
          fillOpacity={0}
        />
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginTop: 3,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtNum(k.requests7d)}
        </div>
      </div>

      {/* Scopes */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {k.scopes.slice(0, 2).map((s) => (
          <span
            key={s}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              padding: '2px 6px',
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--muted)',
            }}
          >
            {s}
          </span>
        ))}
        {k.scopes.length > 2 && (
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--muted)',
              padding: '2px 4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            +{k.scopes.length - 2}
          </span>
        )}
      </div>

      {/* Created */}
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {k.createdAt}
      </div>

      {/* Revoke button */}
      <div style={{ textAlign: 'right' }}>
        <button
          onClick={() => onRevoke(k)}
          title="Revoke"
          style={{
            padding: '5px 6px',
            background: 'transparent',
            border: 'none',
            color: hover ? 'var(--muted)' : 'transparent',
            transition: 'color .12s',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--error)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = hover ? 'var(--muted)' : 'transparent';
          }}
        >
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RevokedRow
// ---------------------------------------------------------------------------

interface RevokedRowProps {
  k: ApiKey;
  isLast: boolean;
}

function RevokedRow({ k, isLast }: RevokedRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px,1.4fr) minmax(220px,1.2fr) 1fr 130px',
        minWidth: 720,
        gap: 14,
        alignItems: 'center',
        padding: '13px 0',
        borderBottom: isLast
          ? 'none'
          : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
        opacity: 0.65,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: 13,
            color: 'var(--foreground)',
            textDecoration: 'line-through',
            textDecorationColor: 'var(--muted)',
          }}
        >
          {k.name}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          by {k.createdBy} · {k.createdAt}
        </span>
      </div>
      <code
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--muted)',
          justifySelf: 'start',
        }}
      >
        {k.prefix}_••••••••••••••{k.tail}
      </code>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {k.revokedReason ?? 'Revoked'}
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--muted)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        Revoked {k.revokedAt}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusPill adapter — map key status to ui StatusPill values
// ---------------------------------------------------------------------------

function KeyStatusPill({ status }: { status: ApiKey['status'] }) {
  const s = status === 'active' ? 'ok' : status === 'stale' ? 'warning' : 'failed';
  return <StatusPill status={s} />;
}

// ---------------------------------------------------------------------------
// ApiKeysPage
// ---------------------------------------------------------------------------

export default function ApiKeysPage({ demo = false }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKey[]>(demo ? API_KEYS : []);
  const [filter, setFilter] = useState<TabId>('active');
  const [envFilter, setEnvFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<ApiKey | null>(null);

  const active = useMemo(
    () => keys.filter((k) => k.status !== 'revoked'),
    [keys],
  );
  const revoked = useMemo(
    () => keys.filter((k) => k.status === 'revoked'),
    [keys],
  );

  const visible = useMemo(() => {
    let list = filter === 'revoked' ? revoked : active;
    if (envFilter !== 'all') list = list.filter((k) => k.env === envFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(s) ||
          k.prefix.toLowerCase().includes(s) ||
          k.tail.toLowerCase().includes(s),
      );
    }
    return list;
  }, [keys, filter, envFilter, search, active, revoked]);

  const totalRequests = active.reduce((a, k) => a + k.requests7d, 0);
  const oldestActive = active.length
    ? active.reduce((a, b) =>
        new Date(a.createdAt) < new Date(b.createdAt) ? a : b,
      )
    : null;
  const staleCount = active.filter((k) => k.status === 'stale').length;

  function handleCreate({ name, env, scopes }: CreateKeyPayload) {
    const tail = Math.random().toString(36).slice(-4);
    const fullSecret = Array.from({ length: 32 }, () => {
      const c = Math.random().toString(36)[2];
      return c ?? 'x';
    }).join('');
    const newKey: ApiKey = {
      id: ('k_' + Math.random().toString(36).slice(2, 6)) as ApiKeyId,
      name,
      prefix: env === 'production' ? 'tr_live' : 'tr_test',
      tail,
      env,
      scopes,
      createdBy: 'Mark Gonzales',
      createdAt: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      lastUsedAt: 'Never',
      lastUsedIp: null,
      requests7d: 0,
      spark: [0, 0, 0, 0, 0, 0, 0],
      status: 'active',
      fullSecret,
    };
    setKeys([newKey, ...keys]);
    setCreateOpen(false);
    setRevealed(newKey);
  }

  function handleRevoke(id: string, reason: string) {
    setKeys(
      keys.map((k) =>
        k.id === id
          ? {
              ...k,
              status: 'revoked' as const,
              revokedAt: new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }),
              revokedBy: 'Mark Gonzales',
              revokedReason: reason || 'Manual revocation',
            }
          : k,
      ),
    );
    setRevokeTarget(null);
  }

  // Suppress unused-var warning — StatusPill is used in KeyStatusPill which
  // is exported but we don't render it directly in this component; keep it.
  void KeyStatusPill;

  return (
    <div style={{ padding: 'clamp(24px, 4vw, 40px) clamp(16px, 4vw, 28px) 96px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Page title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 36,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: 'var(--foreground)',
              margin: 0,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            API keys
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              margin: '6px 0 0',
              maxWidth: 620,
              lineHeight: 1.55,
            }}
          >
            Authenticate SDKs and HTTP requests against this workspace. Keys
            are scoped per environment — production keys never authenticate
            against staging.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 13px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: '1px solid var(--accent)',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <IconPlus size={13} />
          Create key
        </button>
      </div>

      {/* KPI strip */}
      <SectionHead
        first
        title="Overview"
        hint="Active keys, recent traffic, and rotation health for this workspace."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 28,
          paddingTop: 4,
          marginBottom: 8,
        }}
      >
        <Kpi
          label="Active keys"
          value={active.length}
          hint={`${revoked.length} revoked`}
        />
        <Kpi
          label="Requests · 7d"
          value={fmtNum(totalRequests)}
          hint="across all keys"
        />
        <Kpi
          label="Oldest active"
          value={
            oldestActive
              ? oldestActive.createdAt.split(',')[0] ?? oldestActive.createdAt
              : '—'
          }
          hint={oldestActive ? oldestActive.name : ''}
        />
        <Kpi
          label="Stale (>30d idle)"
          value={staleCount}
          hint="consider rotating"
          last
        />
      </div>

      {/* Keys table */}
      <SectionHead
        title="Keys"
        hint="Click a row to inspect usage, IP allow-list, and rotation history."
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              style={{
                padding: '7px 10px',
                background: 'transparent',
                border:
                  '1px solid var(--border-strong, rgba(255,255,255,0.12))',
                borderRadius: 7,
                color: 'var(--foreground)',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <option value="all">All environments</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>

            <div style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                  pointerEvents: 'none',
                }}
              >
                <IconSearch size={13} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search keys…"
                style={{
                  padding: '7px 10px 7px 32px',
                  width: 220,
                  background: 'transparent',
                  border:
                    '1px solid var(--border-strong, rgba(255,255,255,0.12))',
                  borderRadius: 7,
                  color: 'var(--foreground)',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        }
      />

      {/* Tab row */}
      <div
        style={{
          paddingBottom: 14,
          borderBottom:
            '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
          marginBottom: 0,
        }}
      >
        <Tabs
          tab={filter}
          setTab={setFilter}
          tabs={[
            { id: 'active',  label: 'Active',  count: active.length  },
            { id: 'revoked', label: 'Revoked', count: revoked.length },
          ]}
        />
      </div>

      {/* Column headers + rows */}
      {filter === 'active' ? (
        <div style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: ACTIVE_TMPL,
              minWidth: 1120,
              gap: 14,
              padding: '12px 0',
              borderBottom:
                '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 500,
            }}
          >
            {ACTIVE_COLS.map((c, i) => (
              <div key={i} style={{ textAlign: c.align }}>
                {c.label}
              </div>
            ))}
          </div>

          {visible.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              {search ? `No keys match "${search}"` : 'No active keys'}
            </div>
          ) : (
            visible.map((k, i) => (
              <KeyRow
                key={k.id}
                k={k}
                isLast={i === visible.length - 1}
                onRevoke={setRevokeTarget}
              />
            ))
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          {visible.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No revoked keys
            </div>
          ) : (
            visible.map((k, i) => (
              <RevokedRow key={k.id} k={k} isLast={i === visible.length - 1} />
            ))
          )}
        </div>
      )}

      {/* SDK snippet */}
      <SectionHead
        title="Use a key in code"
        hint="Set the key as an environment variable and pass it to the SDK constructor. Never commit a key to source."
      />
      <pre
        style={{
          margin: 0,
          padding: '16px 18px',
          background: 'var(--surface-alt)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          color: 'var(--foreground)',
          overflow: 'auto',
          lineHeight: 1.65,
        }}
      >{`import { Tracium } from "@tracium/sdk";

const tracium = new Tracium({
  apiKey: process.env.TRACIUM_API_KEY,    // tr_live_…
  workspace: "aqtos",
});

await tracium.trace("rewrite-message", async (span) => {
  // your agent code
});`}</pre>

      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
      <RevealKeyModal keyData={revealed} onClose={() => setRevealed(null)} />
      <RevokeModal
        targetKey={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
      />
    </div>
  );
}
