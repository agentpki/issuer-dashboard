'use client';

import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';

type Tab = {
  id: string;
  label: string;
  /** Color of the active tab pill (text + background tint + border). Optional — defaults to accent purple. */
  color?: { text: string; bg: string; border: string };
  /** Optional tinted background + border for the active panel. Use to make
   *  the selected path's content area visually distinct from siblings. */
  panelBg?: string;
  panelBorder?: string;
  content: ReactNode;
};

/**
 * General-purpose tab group with prominent pill-style buttons.
 *
 *  - Filled background on active tab (so it doesn't look like a quiet underline)
 *  - Per-tab color so two tabs that represent very different choices can be
 *    color-coded (e.g. Path A = purple, Path B = green)
 *  - Persists selection in localStorage if a storageKey is given
 *  - SSR-renders all panels visible (correct without JS), client picks one
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
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let next: string | null = null;
    if (storageKey) {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && tabs.some((t) => t.id === stored)) next = stored;
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
        // Storage blocked — fine
      }
    }
  };

  const DEFAULT_COLOR = {
    text: 'rgb(196, 181, 253)',
    bg: 'rgba(167, 139, 250, 0.18)',
    border: 'rgba(167, 139, 250, 0.5)',
  };

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1.25rem',
        }}
      >
        {tabs.map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            active={active === t.id}
            color={t.color ?? DEFAULT_COLOR}
            onClick={() => select(t.id)}
          />
        ))}
      </div>
      {tabs.map((t) => {
        const isActive = active === t.id;
        const hasPanelTint = !!t.panelBg;
        return (
          <div
            key={t.id}
            role="tabpanel"
            style={{
              display: active === null || isActive ? 'block' : 'none',
              ...(hasPanelTint && {
                background: t.panelBg,
                border: t.panelBorder ? `1px solid ${t.panelBorder}` : undefined,
                borderRadius: '0.75rem',
                padding: '1.25rem 1.5rem',
              }),
            }}
          >
            {t.content}
          </div>
        );
      })}
    </div>
  );
}

function TabButton({
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
    padding: '0.625rem 1.125rem',
    cursor: 'pointer',
    fontSize: '0.9375rem',
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
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'translateY(1px)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {label}
    </button>
  );
}
