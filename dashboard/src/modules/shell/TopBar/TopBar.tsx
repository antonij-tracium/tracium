import React from 'react';
import { IconSearch, IconMenu } from '../../../common';
import type { BreadcrumbItem, Workspace } from '../interfaces';

interface RangeOption {
  id: string;
  label: string;
}

// 90d and 1y are served from the daily rollup (tracium.metrics_daily) so they
// stay fast at scale; see the API's UseRollup. Latency isn't available at those
// ranges (the rollup can't reconstruct per-trace durations).
const RANGE_OPTIONS: RangeOption[] = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '1y', label: '1y' },
];

const VIEWS_WITH_RANGE = ['overview', 'workflows', 'usage'];

interface TopBarProps {
  breadcrumb: BreadcrumbItem[];
  range: string;
  setRange: (r: string) => void;
  onOpenCmd: () => void;
  workspace: Workspace | null;
  setWorkspace: (ws: Workspace) => void;
  setView: (v: string) => void;
  embedded?: boolean;
  /** Shows the hamburger menu button (mobile: opens the sidebar drawer). */
  showMenu?: boolean;
  /** Opens the sidebar drawer. */
  onOpenNav?: () => void;
}

export function TopBar({
  breadcrumb,
  range,
  setRange,
  onOpenCmd,
  embedded = false,
  showMenu = false,
  onOpenNav,
}: TopBarProps): React.ReactElement {
  const currentView = breadcrumb[0]?.label?.toLowerCase();
  const lastView = breadcrumb[breadcrumb.length - 1]?.label?.toLowerCase();
  const showRange =
    VIEWS_WITH_RANGE.includes(currentView ?? '') ||
    (breadcrumb.length > 1 && VIEWS_WITH_RANGE.includes(lastView ?? ''));

  return (
    <header
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 clamp(12px, 3vw, 20px)',
        gap: 12,
        background: 'var(--background)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        position: embedded ? 'relative' : 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      {/* Hamburger (mobile) */}
      {showMenu && (
        <button
          onClick={onOpenNav}
          aria-label="Open menu"
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--foreground)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            marginLeft: -6,
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            borderRadius: 7,
            color: 'var(--muted)',
            cursor: 'pointer',
          }}
        >
          <IconMenu size={18} />
        </button>
      )}

      {/* Breadcrumb */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        {breadcrumb.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span style={{ color: 'var(--border-strong)', fontSize: 13 }}>/</span>
            )}
            {crumb.onClick ? (
              <button
                onClick={crumb.onClick}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = 'var(--foreground)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color =
                    i === breadcrumb.length - 1 ? 'var(--foreground)' : 'var(--muted)')
                }
                style={{
                  fontSize: 13,
                  fontWeight: i === breadcrumb.length - 1 ? 500 : 400,
                  color:
                    i === breadcrumb.length - 1
                      ? 'var(--foreground)'
                      : 'var(--muted)',
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 4px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {crumb.label}
              </button>
            ) : (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: i === breadcrumb.length - 1 ? 500 : 400,
                  color:
                    i === breadcrumb.length - 1
                      ? 'var(--foreground)'
                      : 'var(--muted)',
                  padding: '2px 4px',
                }}
              >
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Range picker */}
      {showRange && (
        <div
          style={{
            display: 'flex',
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: 2,
          }}
        >
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setRange(o.id)}
              style={{
                padding: '4px 9px',
                fontSize: 12,
                fontWeight: 500,
                background: range === o.id ? 'var(--surface)' : 'transparent',
                color: range === o.id ? 'var(--foreground)' : 'var(--muted)',
                border:
                  '1px solid ' + (range === o.id ? 'var(--border)' : 'transparent'),
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* Search / cmd */}
      <button
        onClick={onOpenCmd}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-strong)';
          e.currentTarget.style.color = 'var(--foreground)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.color = 'var(--muted)';
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          background: 'var(--surface-alt)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          cursor: 'pointer',
          color: 'var(--muted)',
          fontSize: 12,
        }}
      >
        <IconSearch size={13} />
        <span>Search</span>
        <kbd
          style={{
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 4,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            fontFamily: 'inherit',
          }}
        >
          ⌘K
        </kbd>
      </button>
    </header>
  );
}
