'use client';

import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';

type Tab = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * General-purpose tab group. Persists selection in localStorage if a
 * storageKey is given. Server-renders all tabs visible so the page is
 * correct before JS; client takes over to apply the active selection.
 *
 * Different from <OsTabs> in that:
 *  - takes an arbitrary array of tabs (not just unix/windows)
 *  - lets callers pass an explicit default + storage key
 *  - no auto-detection logic
 */
export function Tabs({
  tabs,
  storageKey,
  defaultId,
}: {
  tabs: Tab[];
  storageKey?: string;
  defaultId?: string;
}) {
  // null initial = "show all on first paint" (SSR + first hydration)
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let next: string | null = null;
    if (storageKey) {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && tabs.some((t) => t.id === stored)) {
        next = stored;
      }
    }
    if (!next) next = defaultId ?? tabs[0]?.id ?? null;
    setActive(next);
  }, [storageKey, defaultId, tabs]);

  const select = (id: string) => {
    setActive(id);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, id);
      } catch {
        // Storage blocked — fine, just don't persist
      }
    }
  };

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0,
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
          marginBottom: '1rem',
        }}
      >
        {tabs.map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            active={active === t.id}
            onClick={() => select(t.id)}
          />
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          style={{ display: active === null || active === t.id ? 'block' : 'none' }}
        >
          {t.content}
        </div>
      ))}
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
    padding: '0.625rem 1rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
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
