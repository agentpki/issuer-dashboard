import Link from 'next/link';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { createIssuer } from './actions';

export default async function NewIssuer() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  return (
    <>
      <p>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
      <h1>Register a new issuer</h1>
      <p className="muted">
        An issuer is your company's domain (e.g., <code>anthropic.com</code>). After
        registering, you'll prove control of the domain via a DNS TXT record, then generate
        your first Ed25519 signing key.
      </p>

      <form action={createIssuer} className="card" style={{ maxWidth: '36rem', marginTop: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <label className="dim" style={{ display: 'block', marginBottom: '0.375rem' }}>
            Domain
          </label>
          <input
            type="text"
            name="domain"
            required
            pattern="[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}"
            placeholder="your-co.com"
            className="mono"
          />
          <p className="dim" style={{ fontSize: '0.75rem', marginTop: '0.375rem' }}>
            Lowercase, no <code>https://</code>, no trailing slash. Must be a domain you control.
          </p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="dim" style={{ display: 'block', marginBottom: '0.375rem' }}>
            Display name
          </label>
          <input type="text" name="name" required placeholder="Your Company, Inc." />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="dim" style={{ display: 'block', marginBottom: '0.375rem' }}>
            Initial tier
          </label>
          <select name="tier" defaultValue="1">
            <option value="1">T1 — DNS-verified (free, self-serve)</option>
            <option value="2" disabled>T2 — KYB-verified (coming soon)</option>
            <option value="3" disabled>T3 — Hardware-attested (coming soon)</option>
          </select>
          <p className="dim" style={{ fontSize: '0.75rem', marginTop: '0.375rem' }}>
            T1 is the only path available in v0.1. T2/T3 require business identity verification
            and hardware attestation respectively (v0.2+).
          </p>
        </div>

        <button type="submit" className="primary" style={{ width: '100%' }}>
          Register issuer
        </button>
      </form>
    </>
  );
}
