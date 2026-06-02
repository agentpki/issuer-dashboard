'use client';

import { useFormStatus } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';

// Reusable submit button that watches the parent <form>'s pending state.
// Disables itself + swaps in a spinner while the server action is running.
// Drop-in for any <form action={serverAction}>.

type Props = {
  children: ReactNode;
  pendingChildren?: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: 'primary' | 'danger' | 'default';
  disabled?: boolean;
};

export function SubmitButton({
  children,
  pendingChildren,
  className,
  style,
  variant = 'default',
  disabled = false,
}: Props) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;

  const variantClass =
    variant === 'primary' ? 'primary' : variant === 'danger' ? '' : '';

  const baseStyle: CSSProperties =
    variant === 'danger'
      ? {
          background: 'rgba(248, 113, 113, 0.15)',
          color: 'var(--danger)',
          border: '1px solid rgba(248, 113, 113, 0.5)',
          padding: '0.5rem 1rem',
          borderRadius: '0.375rem',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          opacity: isDisabled ? 0.6 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
        }
      : {
          opacity: isDisabled ? 0.6 : 1,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
        };

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={[variantClass, className].filter(Boolean).join(' ')}
      style={{ ...baseStyle, ...style }}
    >
      {pending && <Spinner />}
      {pending ? (pendingChildren ?? children) : children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        strokeWidth="2.5"
        strokeDasharray="44"
        strokeDashoffset="22"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 10 10"
          to="360 10 10"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
