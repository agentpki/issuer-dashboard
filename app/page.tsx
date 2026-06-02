import Link from 'next/link';
import { auth, signIn } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { SubmitButton } from '@/components/SubmitButton';

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
          const email = String(formData.get('email') ?? '').trim().toLowerCase();
          if (!email) return;
          // Look up before signIn so we can route to a status-specific check-email page.
          // NextAuth's flow itself doesn't differentiate new vs returning users in its
          // post-send redirect — we layer that distinction here.
          const existing = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          const status = existing.length > 0 ? 'resent' : 'new';
          // redirect: false → don't auto-redirect to NextAuth's verify page,
          // we'll redirect manually so we can append the status query param.
          // redirectTo is what gets baked into the magic link itself (post-click).
          await signIn('resend-magic-link', {
            email,
            redirect: false,
            redirectTo: '/dashboard',
          });
          redirect(`/auth/check-email?status=${status}`);
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
        <SubmitButton
          variant="primary"
          style={{ width: '100%', justifyContent: 'center' }}
          pendingChildren={<>Sending magic link…</>}
        >
          Send magic link
        </SubmitButton>
      </form>

      <p className="dim" style={{ marginTop: '2rem' }}>
        Looking for the spec? <Link href="https://agentpki.dev/spec/v0.1">agentpki.dev/spec/v0.1</Link>
        &nbsp;·&nbsp; Source: <Link href="https://github.com/agentpki">github.com/agentpki</Link>
      </p>
    </div>
    </>
  );
}
