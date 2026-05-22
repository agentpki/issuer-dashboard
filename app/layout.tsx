import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentPKI Issuer Dashboard',
  description:
    'Self-serve issuer onboarding for AgentPKI. Claim a domain, generate signing keys, download your real-issuer Worker config.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
