'use client';

import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';

type OS = 'windows' | 'unix';

/**
 * Windows / macOS-Linux tab toggle with the same prominent pill styling
 * as the generic <Tabs> component. Persists pick in localStorage under
 * `agentpki-os-pref` and auto-detects from userAgent on first mount.
 *
 * Windows is the default fallback (matches PowerShell-heavy HN dev mix);
 * Mac and Linux UAs explicitly switch to unix.
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
  const [os, setOs] = useState<OS | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('agentpki-os-pref') : null;
    if (stored === 'windows' || stored === 'unix') {
      setOs(stored);
      return;
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMac = /mac os x|macintosh|darwin/i.test(ua);
    const isLinuxLike = /linux|x11|cros/i.test(ua) && !/android/i.test(ua);
    setOs(isMac || isLinuxLike ? 'unix' : 'windows');
  }, []);

  const select = (next: OS) => {
    setOs(next);
    try {
      window.localStorage.setItem('agentpki-os-pref', next);
    } catch {
      // Storage blocked — fine
    }
  };

  const WINDOWS_COLOR = {
    text: 'rgb(147, 197, 253)',
    bg: 'rgba(96, 165, 250, 0.18)',
    border: 'rgba(96, 165, 250, 0.5)',
  };
  const UNIX_COLOR = {
    text: 'rgb(252, 211, 77)',
    bg: 'rgba(251, 191, 36, 0.18)',
    border: 'rgba(251, 191, 36, 0.5)',
  };

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <PillButton
          label={`🪟  ${windowsLabel}`}
          active={os === 'windows'}
          color={WINDOWS_COLOR}
          onClick={() => select('windows')}
        />
        <PillButton
          label={`🍎  ${unixLabel}`}
          active={os === 'unix'}
          color={UNIX_COLOR}
          onClick={() => select('unix')}
        />
      </div>
      <div style={{ display: os === null || os === 'windows' ? 'block' : 'none' }}>
        {windows}
      </div>
      <div style={{ display: os === 'unix' ? 'block' : 'none' }}>{unix}</div>
    </div>
  );
}

function PillButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: { text: string; bg: string; border: string };
  onClick: () => void;
}) {
  const baseStyle: CSSProperties = {
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 500,
    borderRadius: '0.5rem',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.05s',
    background: active ? color.bg : 'transparent',
    border: active ? `1.5px solid ${color.border}` : '1.5px solid var(--border, rgba(255,255,255,0.12))',
    color: active ? color.text : 'var(--text-muted, #b8b8c4)',
  };
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={baseStyle}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = color.border;
          e.currentTarget.style.color = color.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = 'var(--border, rgba(255,255,255,0.12))';
          e.currentTarget.style.color = 'var(--text-muted, #b8b8c4)';
        }
      }}
    >
      {label}
    </button>
  );
}
