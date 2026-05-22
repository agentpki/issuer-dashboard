import Link from 'next/link';
import { auth, signIn } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/" style={{ fontWeight: 500 }}>
            AgentPKI Dashboard
          </Link>
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', fontSize: '0.875rem' }}>
            <Link href="https://agentpki.dev" className="dim">agentpki.dev</Link>
            <Link href="https://agentpki.dev/spec/v0.1" className="dim">Spec</Link>
            <Link href="https://github.com/agentpki" className="dim">GitHub</Link>
            <a href="#signin" className="btn primary" style={{ padding: '0.375rem 0.875rem' }}>Sign in</a>
          </div>
        </div>
      </nav>
    <div className="container" style={{ paddingTop: '4rem' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>AgentPKI Issuer Dashboard</h1>
      <p className="muted" style={{ fontSize: '1.125rem', maxWidth: '40rem' }}>
        Self-serve issuer onboarding for AgentPKI. Claim a domain, generate Ed25519 signing
        keys, download the Worker config for your real-issuer deployment. Standards-compliant
        from day one.
      </p>

      <form
        id="signin"
        action={async (formData: FormData) => {
          'use server';
          const email = String(formData.get('email') ?? '').trim();
          if (!email) return;
          await signIn('resend-magic-link', { email, redirectTo: '/dashboard' });
        }}
        className="card"
        style={{ maxWidth: '32rem', marginTop: '2rem' }}
      >
        <h3 style={{ marginTop: 0 }}>Sign in or create an account</h3>
        <p className="dim" style={{ marginTop: '-0.5rem' }}>
          We'll email you a one-time link. No password.
        </p>
        <input
          type="email"
          name="email"
          required
          placeholder="you@your-company.com"
          style={{ marginBottom: '0.75rem' }}
        />
        <button type="submit" className="primary" style={{ width: '100%' }}>
          Send magic link
        </button>
      </form>

      <p className="dim" style={{ marginTop: '2rem' }}>
        Looking for the spec? <Link href="https://agentpki.dev/spec/v0.1">agentpki.dev/spec/v0.1</Link>
        &nbsp;·&nbsp; Source: <Link href="https://github.com/agentpki">github.com/agentpki</Link>
      </p>
    </div>
    </>
  );
}
