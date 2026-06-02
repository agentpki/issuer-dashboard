'use client';

import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';

type OS = 'windows' | 'unix';

/**
 * Reusable OS toggle for code blocks.
 *
 * Renders a Windows / macOS-Linux tab pair, shows one side at a time.
 * - Auto-detects from navigator.userAgent on first mount
 * - Persists the user's pick in localStorage under `agentpki-os-pref`
 *   so they don't have to re-pick on every page load (or even across
 *   tabs spawned during the same session)
 * - Server-renders both children so the page is correct before
 *   hydration; client takes over after to apply the pick
 */
export function OsTabs({
  windows,
  unix,
  unixLabel = 'macOS / Linux / WSL / Git Bash',
  windowsLabel = 'Windows PowerShell',
}: {
  windows: ReactNode;
  unix: ReactNode;
  unixLabel?: string;
  windowsLabel?: string;
}) {
  // Start with both visible until the client has read the pref/UA
  // (avoids a hydration mismatch + jarring flash for users who would
  // expect their OS shown but get the other one for a fraction of a sec)
  const [os, setOs] = useState<OS | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('agentpki-os-pref') : null;
    if (stored === 'windows' || stored === 'unix') {
      setOs(stored);
      return;
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    setOs(/windows/i.test(ua) ? 'windows' : 'unix');
  }, []);

  const select = (next: OS) => {
    setOs(next);
    try {
      window.localStorage.setItem('agentpki-os-pref', next);
    } catch {
      // Private-browsing / storage blocked — fine; just don't persist
    }
  };

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
          marginBottom: '0.5rem',
        }}
      >
        <TabButton
          label={`🍎  ${unixLabel}`}
          active={os === 'unix'}
          onClick={() => select('unix')}
        />
        <TabButton
          label={`🪟  ${windowsLabel}`}
          active={os === 'windows'}
          onClick={() => select('windows')}
        />
      </div>
      {/* During SSR + first paint, both render (so the page is correct
          without JS); client effect picks one and hides the other. */}
      <div style={{ display: os === null || os === 'unix' ? 'block' : 'none' }}>
        {unix}
      </div>
      <div style={{ display: os === 'windows' ? 'block' : 'none' }}>
        {windows}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const baseStyle: CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    color: active ? 'var(--text)' : 'var(--text-dim, #9c9cab)',
    fontWeight: active ? 500 : 400,
    borderBottom: active ? '2px solid var(--accent, #a78bfa)' : '2px solid transparent',
    marginBottom: '-1px',
    transition: 'color 0.15s, border-color 0.15s',
  };
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={baseStyle}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--text-dim, #9c9cab)';
      }}
    >
      {label}
    </button>
  );
}
