'use client';

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Wraps a code block (typically a <pre>) with a one-click copy button.
 *
 * Pulls the rendered text content out of the wrapped element on click
 * and writes it to the clipboard. Shows "Copied!" feedback for ~1.5s.
 *
 * Designed to wrap an arbitrary child (usually a <pre>) so the existing
 * code block styling is preserved.
 */
export function CopyBlock({
  children,
  label = 'Copy',
  style,
}: {
  children: ReactNode;
  label?: string;
  style?: CSSProperties;
}) {
  const blockRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = blockRef.current?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / non-https: fall back to a textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // No fallback worked — user can still select-all manually
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        ...style,
      }}
    >
      <button
        onClick={handleCopy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          padding: '0.375rem 0.75rem',
          background: copied ? 'rgba(34, 197, 94, 0.15)' : 'rgba(167, 139, 250, 0.15)',
          border: copied
            ? '1px solid rgba(34, 197, 94, 0.45)'
            : '1px solid rgba(167, 139, 250, 0.45)',
          borderRadius: '0.375rem',
          color: copied ? 'rgb(74, 222, 128)' : 'rgb(196, 181, 253)',
          fontSize: '0.75rem',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'background 0.15s, border-color 0.15s, color 0.15s',
          zIndex: 1,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
        }}
        onMouseEnter={(e) => {
          if (!copied) {
            e.currentTarget.style.background = 'rgba(167, 139, 250, 0.25)';
          }
        }}
        onMouseLeave={(e) => {
          if (!copied) {
            e.currentTarget.style.background = 'rgba(167, 139, 250, 0.15)';
          }
        }}
      >
        {copied ? (
          <>
            <CheckIcon />
            Copied
          </>
        ) : (
          <>
            <CopyIcon />
            {label}
          </>
        )}
      </button>
      <div ref={blockRef}>{children}</div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
