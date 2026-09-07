// ---------------------------------------------------------------------------
// SettingsPage — Account, Workspace, Danger Zone
// Inline styles only (no CSS modules).
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import type { TabId } from '../ids';
import type { Workspace } from '../../shell/interfaces';
import type { Account } from '../../auth';
import {
  IconUser,
  IconBuilding,
  IconTrash,
  IconCheck,
  IconCopy,
  IconPlus,
  useMaxWidth,
  BREAKPOINTS,
} from '../../../common';

// ---------------------------------------------------------------------------
// Exported page props
// ---------------------------------------------------------------------------

export interface WorkspaceDraft {
  name: string;
  slug: string;
  env: Workspace['env'];
}

export interface SettingsPageProps {
  /** Persists a new workspace and selects it. Provided by the Dashboard shell. */
  createWorkspace?: (draft: WorkspaceDraft) => Promise<Workspace>;
  onOpenOverview?: () => void;
  onCancelCreate?: () => void;
  /** When true, the Workspace tab opens on a create-workspace form. */
  createMode?: boolean;
  /** When true, render the rich demo data (logged-out auth-page preview). */
  demo?: boolean;
  /** The real signed-in workspace. Used when not in demo mode. */
  workspace?: Workspace | null;
  /** The real signed-in account. Used when not in demo mode. */
  account?: Account | null;
}

// ---------------------------------------------------------------------------
// Static mock data
// ---------------------------------------------------------------------------

interface SettingsUser {
  name: string;
  email: string;
  initials: string;
  role: string;
  joined: string;
}

interface SettingsWorkspace {
  name: string;
  id: string;
  defaultRetention: string;
  members: number;
}

const SET_USER: SettingsUser = {
  name: 'Mark Gonzales',
  email: 'mark@aqtos.io',
  initials: 'MG',
  role: 'Owner',
  joined: 'Jan 14, 2025',
};

const SET_WORKSPACE: SettingsWorkspace = {
  name: 'aqtos',
  id: 'ws_2qHv4Rt81xLpKnvR',
  defaultRetention: '30 days',
  members: 12,
};

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

const SET_TABS: TabDef[] = [
  { id: 'account',       label: 'Account',        icon: <IconUser size={14} /> },
  { id: 'workspace',     label: 'Workspace',      icon: <IconBuilding size={14} /> },
  { id: 'danger',        label: 'Danger zone',    icon: <IconTrash size={14} /> },
];

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

interface SectionHeadProps {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  first?: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
  style?: React.CSSProperties;
}

function SectionHead({ title, hint, right, first = false, headingRef, style }: SectionHeadProps) {
  return (
    <header style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 24, flexWrap: 'wrap',
      paddingTop: first ? 0 : 48,
      paddingBottom: 18,
      borderTop: first ? 'none' : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
      ...style,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, paddingTop: first ? 0 : 28 }}>
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.018em', margin: 0, color: 'var(--foreground)' }}>{title}</h2>
        {hint && <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, maxWidth: 620, lineHeight: 1.55 }}>{hint}</p>}
      </div>
      {right && <div style={{ paddingTop: first ? 0 : 28, flexShrink: 0 }}>{right}</div>}
    </header>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  last?: boolean;
}

function Field({ label, hint, children, right, last = false }: FieldProps) {
  // On phones the label / control / action columns stack vertically instead of
  // squeezing into a three-column grid.
  const stacked = useMaxWidth(BREAKPOINTS.mobile);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: stacked ? '1fr' : 'minmax(180px, 220px) 1fr auto',
      gap: stacked ? 12 : 32, alignItems: 'start',
      padding: '20px 0',
      borderBottom: last ? 'none' : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{label}</span>
        {hint && <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{hint}</span>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
      <div style={{ justifySelf: stacked ? 'start' : 'end', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Btn {
  children: React.ReactNode;
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;
  title?: string;
}

function Btn({ children, variant = 'secondary', onClick, disabled, type = 'button', style, title }: Btn) {
  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary:   { background: 'var(--accent)', color: 'var(--accent-contrast)', border: '1px solid var(--accent)', fontWeight: 600 },
    secondary: { background: 'transparent', color: 'var(--foreground)', border: '1px solid var(--border-strong, rgba(255,255,255,0.12))', fontWeight: 500 },
    ghost:     { background: 'transparent', color: 'var(--muted)', border: '1px solid transparent', fontWeight: 500 },
    danger:    { background: 'color-mix(in srgb, var(--error) 12%, transparent)', color: 'var(--error)', border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)', fontWeight: 500 },
  };
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '7px 13px', borderRadius: 7,
      fontSize: 13, fontFamily: 'inherit',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...variantStyles[variant], ...style,
    }}>{children}</button>
  );
}

interface InputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  readOnly?: boolean;
  label?: string;
}

function Input({ value, onChange, placeholder, type = 'text', mono = false, prefix, suffix, readOnly, label }: InputProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 11px',
        background: readOnly ? 'var(--surface-alt)' : 'transparent',
        border: '1px solid var(--border-strong, rgba(255,255,255,0.12))',
        borderRadius: 7,
        transition: 'border-color 120ms',
      }}
      onFocusCapture={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 50%, transparent)'; }}
      onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--border-strong, rgba(255,255,255,0.12))'; }}
    >
      {prefix && <span style={{ fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>{prefix}</span>}
      <input
        aria-label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        readOnly={readOnly}
        style={{
          flex: 1, minWidth: 0, padding: '9px 0',
          background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--foreground)',
          fontSize: 13,
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        }}
      />
      {suffix && <span style={{ flexShrink: 0 }}>{suffix}</span>}
    </div>
  );
}

interface ToggleProps {
  on: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ on, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 36, height: 20,
        background: on ? 'var(--accent)' : 'var(--surface-alt)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-strong, rgba(255,255,255,0.12))'),
        borderRadius: 999,
        position: 'relative',
        transition: 'background 150ms, border-color 150ms',
        padding: 0, cursor: 'pointer',
      }}
    >
      <span style={{
        position: 'absolute', top: 1, left: on ? 17 : 1,
        width: 16, height: 16, borderRadius: 999,
        background: on ? 'var(--accent-contrast)' : 'var(--foreground)',
        transition: 'left 150ms',
      }} />
    </button>
  );
}

interface SegmentedOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps {
  value: string;
  onChange: (v: string) => void;
  options: SegmentedOption[];
}

function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 7, padding: 2 }}>
      {options.map(o => (
        <button type="button" aria-pressed={value === o.id} key={o.id} onClick={() => onChange(o.id)} style={{
          padding: '5px 11px',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
          background: value === o.id ? 'var(--surface)' : 'transparent',
          color: value === o.id ? 'var(--foreground)' : 'var(--muted)',
          border: '1px solid ' + (value === o.id ? 'var(--border)' : 'transparent'),
          borderRadius: 5,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          cursor: 'pointer',
        }}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab rail
// ---------------------------------------------------------------------------

interface TabRailProps {
  tab: TabId;
  setTab: (t: TabId) => void;
  /** Renders the rail as a horizontally scrolling strip (stacked layouts). */
  horizontal?: boolean;
  demo?: boolean;
}

function TabRail({ tab, setTab, horizontal = false, demo = false }: TabRailProps) {
  return (
    <aside style={{
      ...(horizontal
        ? { width: '100%', overflowX: 'auto' }
        : { width: 220, flexShrink: 0, position: 'sticky', top: 73, alignSelf: 'flex-start' }),
      paddingTop: 4,
    }}>
      {!horizontal && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, padding: '0 10px 10px' }}>Settings</div>
      )}
      <nav style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap: horizontal ? 4 : 1 }}>
        {SET_TABS.filter(t => demo || t.id !== "danger").map(t => {
          const active = t.id === tab;
          const danger = t.id === 'danger';
          const count = t.count;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 10px',
                fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                color: active ? (danger ? 'var(--error)' : 'var(--foreground)') : 'var(--muted)',
                background: active ? 'var(--surface)' : 'transparent',
                border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
                borderRadius: 7,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'color .12s, background .12s',
                ...(horizontal ? { flexShrink: 0, whiteSpace: 'nowrap' } : {}),
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = danger ? 'var(--error)' : 'var(--foreground)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--muted)'; }}
            >
              <span style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}>{t.icon}</span>
              <span style={{ flex: 1 }}>{t.label}</span>
              {count != null && (
                <span style={{
                  fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums',
                  padding: '1px 6px', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 4,
                }}>{count}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// VIEW: Account
// ---------------------------------------------------------------------------

interface AccountViewProps {
  user: SettingsUser;
  demo: boolean;
}

function AccountView({ user, demo }: AccountViewProps) {
  const [tabnav, setTabnav] = useState(true);
  if (!demo) return <div>
    <SectionHead first title="Account" hint="Your sign-in identity. Profile and password editing are unavailable in this alpha." />
    <Field label="Email" last><span>{user.email}</span></Field>
  </div>;

  return (
    <div>
      <SectionHead
        first
        title="Profile"
        hint="How you appear in audit logs, comments, and trace assignments across this workspace."
      />
      <div>

        <Field
          label="Email"
          hint="Used for sign-in."
          right={<Btn variant="ghost">Change email</Btn>}
          last
        >
          <Input
            value={user.email}
            onChange={() => undefined}
            readOnly
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 18 }}>
        <Btn variant="ghost">Cancel</Btn>
        <Btn variant="primary">Save profile</Btn>
      </div>

      {/* Security */}
      <SectionHead title="Security" hint="Sign-in factors, active sessions, and recent activity on your account." />
      <div>
        <Field label="Password" hint={demo ? 'Last changed 84 days ago.' : 'Set when you created your account.'} right={<Btn variant="secondary">Change</Btn>} last>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)', letterSpacing: '0.2em' }}>•••••••••••</span>
        </Field>
      </div>

      {/* Display */}
      <SectionHead title="Display" hint="Personal preferences. Stored on this device." />
      <div>
        <Field label="Keyboard navigation" hint="Use J / K to move through trace lists; / to focus search." last>
          <Toggle on={tabnav} onChange={setTabnav} />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW: Create workspace
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface CreateWorkspaceViewProps {
  onCreate: (draft: WorkspaceDraft) => Promise<void>;
  onCancel: () => void;
}

function CreateWorkspaceView({ onCreate, onCancel }: CreateWorkspaceViewProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [env, setEnv] = useState<Workspace['env']>('production');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const canCreate = name.trim().length > 0 && effectiveSlug.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), slug: effectiveSlug, env });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} aria-busy={pending}>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 16px' }}>Step 1 of 2 · Workspace details</p>
      <SectionHead
        first
        title="Create workspace"
        hint="First, name your workspace. Next, we’ll give you its ID and the configuration to connect your application."
      />
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Workspace name" hint="Shown in the workspace switcher and on invites.">
          <Input label="Workspace name" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Production" />
        </Field>

        <Field label="Slug" hint="A readable label. Tracium generates a separate workspace ID for sending data.">
          <Input
            label="Slug"
            value={effectiveSlug}
            onChange={e => { setSlugEdited(true); setSlug(slugify(e.target.value)); }}
            placeholder="acme-production"
            mono
          />
        </Field>

        <Field label="Environment" hint="Labels the workspace in the switcher." last>
          <Segmented value={env} onChange={v => setEnv(v as Workspace['env'])} options={[
            { id: 'production',  label: 'Production' },
            { id: 'staging',     label: 'Staging' },
            { id: 'development', label: 'Development' },
          ]} />
        </Field>
      </fieldset>
      {error && <p role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 18 }}>
        <Btn variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!canCreate || pending} type="submit">
          <IconPlus size={13} />
          {pending ? 'Creating…' : 'Create workspace & continue'}
        </Btn>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// VIEW: Workspace
// ---------------------------------------------------------------------------

interface WorkspaceViewProps {
  ws: SettingsWorkspace;
  demo?: boolean;
  justCreated?: boolean;
  onOpenOverview?: () => void;
}

function CopyButton({ value, label, compact = false }: { value: string; label: string; compact?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    setStatus('idle');
  }, [value]);
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };
  const message = status === 'error' ? 'Couldn’t copy. Select and copy the text manually.' : status === 'copied' ? `${label.replace('Copy ', '')} copied to clipboard.` : '';
  const iconSize = compact ? 11 : 13;
  return <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: compact ? 0 : 6 }}>
    <Btn onClick={copy} title={compact ? message || label : undefined} style={compact ? {
      padding: '3px 8px', borderRadius: 5, gap: 4, fontSize: 11,
      color: status === 'copied' ? 'var(--accent)' : status === 'error' ? 'var(--error)' : 'var(--muted)',
    } : undefined}>
      {status === 'copied' ? <IconCheck size={iconSize} /> : <IconCopy size={iconSize} />}
      {status === 'copied' ? 'Copied' : compact ? status === 'error' ? 'Copy manually' : 'Copy' : label}
    </Btn>
    <span role="status" style={compact ? {
      position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
      overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0,
    } : { fontSize: 12, color: status === 'error' ? 'var(--error)' : 'var(--muted)' }}>
      {message}
    </span>
  </span>;
}

function WorkspaceConnection({ ws, justCreated, onOpenOverview }: WorkspaceViewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (justCreated) heading.current?.focus();
  }, [justCreated]);
  const config = `OTEL_RESOURCE_ATTRIBUTES="tracium.workspace.id=${ws.id}"`;
  return <div>
    {justCreated && <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 13, margin: '0 0 16px' }}>
      <IconCheck size={14} /> {ws.name} created · Step 2 of 2
    </p>}
    <SectionHead first title="Connect your application" headingRef={heading} style={{ paddingBottom: 8 }} />
    <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 24px', maxWidth: 620 }}>
      Every application sending data to <strong style={{ color: 'var(--foreground)' }}>{ws.name}</strong> needs this workspace ID. It tells Tracium where your traces belong.
    </p>
    <div style={{ paddingBottom: 24, borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)', marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Workspace ID</span>
        <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>Required for ingestion</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px 24px', flexWrap: 'wrap' }}>
        <code style={{ minWidth: 0, fontSize: 14, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere', userSelect: 'all' }}>{ws.id}</code>
        <CopyButton value={ws.id} label="Copy workspace ID" />
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '10px 0 0' }}>Generated by Tracium. Use this exact ID in your configuration; the workspace name and slug won’t work.</p>
    </div>
    <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>1. Add the workspace to your application</h3>
    <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 12px' }}>Set this environment variable where your OpenTelemetry application runs. If you already set resource attributes, append <code>tracium.workspace.id={ws.id}</code> to the existing comma-separated list.</p>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px 24px', flexWrap: 'wrap', padding: '8px 0 24px', borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
      <pre style={{ minWidth: 0, flex: '1 1 280px', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>{config}</pre>
      <CopyButton value={config} label="Copy configuration" />
    </div>
    <h3 style={{ fontSize: 14, fontWeight: 600, margin: '24px 0 8px' }}>2. Send your first trace</h3>
    <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>Point <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> to your collector, then restart your instrumented application and run a request. For an application running on the host of a local Docker installation, the HTTP endpoint is <code>http://localhost:4318</code>. For other deployments, use the collector address provided by your operator.</p>
    <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '16px 0 0' }}>You can always find this ID and configuration in <strong style={{ color: 'var(--foreground)' }}>Settings → Workspace</strong>.</p>
    {onOpenOverview && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
      <Btn variant="primary" onClick={onOpenOverview}>Go to overview</Btn>
    </div>}
  </div>;
}

function WorkspaceView({ ws, demo = false, justCreated = false, onOpenOverview }: WorkspaceViewProps) {
  const [name, setName] = useState(ws.name);
  const [retention, setRetention] = useState(ws.defaultRetention);

  if (!demo) return <div>
    {ws.id ? <WorkspaceConnection ws={ws} justCreated={justCreated} onOpenOverview={onOpenOverview} /> : <SectionHead first title="Workspace" hint="Create a workspace to get its ID and connection instructions." />}
    {!justCreated && <>
      <SectionHead title="Retention" hint="Retention is configured by the deployment operator. Expired spans are deleted; daily aggregates are retained separately." />
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Workspace editing and retention controls are unavailable in this alpha.</p>
    </>}
  </div>;

  return (
    <div>
      <SectionHead
        first
        title="Identity"
        hint="The display name and identifiers your team and SDKs use to reach this workspace."
      />
      <div>
        <Field label="Workspace name" hint="Shown in the workspace switcher and on invites.">
          <Input value={name} onChange={e => setName(e.target.value)} />
        </Field>

        <Field label="Workspace ID" hint="Pass to the SDK as workspace. This value is stable." last>
          <Input
            value={ws.id}
            onChange={() => undefined}
            mono
            readOnly
            suffix={<CopyButton value={ws.id} label="Copy workspace ID" compact />}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 18 }}>
        <Btn variant="ghost">Cancel</Btn>
        <Btn variant="primary">Save changes</Btn>
      </div>

      <SectionHead title="Data & ingestion" hint="Controls applied to every trace ingested into this workspace." />
      <div>
        <Field label="Trace retention" hint="Older spans are moved to cold storage and excluded from search." last>
          <Segmented value={retention} onChange={setRetention} options={[
            { id: '7 days',   label: '7 days' },
            { id: '30 days',  label: '30 days' },
            { id: '90 days',  label: '90 days' },
            { id: '365 days', label: '1 year' },
          ]} />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW: Danger Zone
// ---------------------------------------------------------------------------

type DangerVariant = 'secondary' | 'danger';

interface DangerItem {
  title: string;
  hint: string;
  cta: string;
  variant: DangerVariant;
}

const DANGER_ITEMS: DangerItem[] = [
  {
    title: 'Transfer ownership',
    hint: 'Move ownership of this workspace to another member. The current owner becomes an Admin.',
    cta: 'Transfer', variant: 'secondary',
  },
  {
    title: 'Pause ingestion',
    hint: 'Stop accepting new spans. Existing data and dashboards remain readable. SDK calls will return 503.',
    cta: 'Pause workspace', variant: 'secondary',
  },
  {
    title: 'Purge trace history',
    hint: 'Delete every span ingested before today. Aggregate metrics older than today are also dropped.',
    cta: 'Purge', variant: 'danger',
  },
  {
    title: 'Delete workspace',
    hint: 'Permanently remove the workspace, all members, traces, keys, and integrations. This cannot be undone.',
    cta: 'Delete', variant: 'danger',
  },
];

function DangerView() {
  return (
    <div>
      <SectionHead
        first
        title="Danger zone"
        hint="Destructive workspace operations. Most require typing the workspace name to confirm and cannot be undone."
      />
      {DANGER_ITEMS.map((item, i) => (
        <div key={item.title} style={{
          display: 'grid', gridTemplateColumns: '1fr auto',
          gap: 24, alignItems: 'center',
          padding: '20px 0',
          borderBottom: i < DANGER_ITEMS.length - 1 ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: item.variant === 'danger' ? 'var(--error)' : 'var(--foreground)', marginBottom: 4 }}>{item.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, maxWidth: 580 }}>{item.hint}</div>
          </div>
          <Btn variant={item.variant}>{item.cta}</Btn>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function SettingsPage({
  createWorkspace,
  onOpenOverview,
  onCancelCreate,
  createMode = false,
  demo = false,
  workspace = null,
  account = null,
}: SettingsPageProps): JSX.Element {
  const [tab, setTab] = useState<TabId>(createMode || !demo ? 'workspace' : 'account');
  const [creating, setCreating] = useState(createMode);
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (createMode) {
      setTab('workspace');
      setCreating(true);
      setCreatedId(null);
    }
  }, [createMode]);
  // Below the tablet breakpoint the tab rail moves above the content instead of
  // sitting in a fixed 220px left column.
  const stackRail = useMaxWidth(BREAKPOINTS.tablet);

  // Switching tabs leaves the create-workspace form.
  const selectTab = (t: TabId) => {
    setCreating(false);
    onCancelCreate?.();
    setTab(t);
  };

  // The auth-page preview (demo) shows the rich seeded data; a real signed-in
  // workspace shows its own identity.
  const user: SettingsUser = demo
    ? SET_USER
    : {
        name: account?.name ?? 'Account',
        email: account?.email ?? '',
        initials: account?.initials ?? '—',
        role: workspace?.role ?? 'Owner',
        joined: '—',
      };

  const ws: SettingsWorkspace = demo
    ? SET_WORKSPACE
    : {
        name: workspace?.name ?? '',
        id: workspace?.id ?? '',
        defaultRetention: '30 days',
        members: workspace?.members ?? 1,
      };

  const viewMap: Record<TabId, React.ReactNode> = {
    account:   <AccountView user={user} demo={demo} />,
    workspace: creating && createWorkspace
      ? <CreateWorkspaceView onCreate={async draft => {
          const created = await createWorkspace(draft);
          setCreatedId(created.id);
          setCreating(false);
          setTab('workspace');
        }} onCancel={() => { setCreating(false); onCancelCreate?.(); }} />
      : <>
          <WorkspaceView key={ws.id} ws={ws} demo={demo} justCreated={createdId === ws.id} onOpenOverview={onOpenOverview} />
          {!demo && createWorkspace && <div style={{ marginTop: 24 }}><Btn onClick={() => { setCreatedId(null); setCreating(true); }}>{ws.id ? 'Create another workspace' : 'Create workspace'}</Btn></div>}
        </>,
    danger:    <DangerView />,
  };

  return (
    <div style={{ padding: 'clamp(24px, 4vw, 40px) clamp(16px, 4vw, 28px) 96px', maxWidth: 1280, margin: '0 auto' }} data-screen-label="Settings">
      {/* Page header */}
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--foreground)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0', maxWidth: 620, lineHeight: 1.55 }}>
          Account and workspace settings for <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{ws.name || 'this workspace'}</span>.
          Select a workspace to view its identity and connection instructions.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: stackRail ? '1fr' : '220px 1fr', gap: stackRail ? 24 : 48, alignItems: 'start' }}>
        <TabRail tab={tab} setTab={selectTab} horizontal={stackRail} demo={demo} />
        <div style={{ minWidth: 0 }}>{viewMap[tab]}</div>
      </div>
    </div>
  );
}
