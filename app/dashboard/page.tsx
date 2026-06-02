import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers } from '@/lib/db';
import { eq } from 'drizzle-orm';

// Per-user data — never pre-render; always run on request
export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const myIssuers = await db.select().from(issuers).where(eq(issuers.ownerId, session.user.id));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Your issuers</h1>
        <Link href="/issuer/new" className="btn primary">
          + New issuer
        </Link>
      </div>

      {/* Always-visible explainer — first-time visitors and returning users alike
          should see what an issuer is and what they can do with one. */}
      <div
        className="card"
        style={{
          marginTop: '1.5rem',
          background: 'rgba(167, 139, 250, 0.04)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>What is an issuer?</h3>
        <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
          An <strong>issuer</strong> is your organization's identity in AgentPKI — pinned to a
          domain you control (e.g. <code>acme.com</code>). Each issuer can mint cryptographic{' '}
          <strong>passports</strong> for the AI agents you operate, signing them with your
          Ed25519 private key. Verifiers (sites, APIs, bot-defense vendors) check your
          signature against the public key you publish at{' '}
          <code>/.well-known/agentpki-issuer.json</code>.
        </p>
        <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
          <strong>About passport lifetimes:</strong> passports are{' '}
          <strong>short-lived by design</strong> — typically minted with a{' '}
          <strong>5-15 minute</strong> expiry (you choose at mint time). The spec caps the
          maximum lifetime at <strong>1 hour</strong> (
          <a href="https://agentpki.dev/spec/v0.2">spec §4.2</a>). Short lifetimes mean a leaked
          passport stops working on its own within minutes — even if you don't notice the leak —
          drastically reducing the blast radius compared to long-lived API keys. For revocation
          before natural expiry, use the CRL endpoint your issuer publishes.
        </p>
        <p className="dim small" style={{ marginBottom: 0 }}>
          Three steps per issuer: <strong>1.</strong> register the domain →{' '}
          <strong>2.</strong> prove control via a DNS TXT record → <strong>3.</strong>{' '}
          generate a signing key and publish the well-known directory. After that, your agents
          mint passports via your domain and the whole web can verify them — no shared secret,
          no central authority. Spec: <a href="https://agentpki.dev/spec/v0.2">agentpki.dev/spec/v0.2</a>.
        </p>
      </div>

      {myIssuers.length === 0 ? (
        <div className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <p className="muted">You haven't registered any issuers yet.</p>
          <p className="dim">Start by claiming a domain you control.</p>
          <Link href="/issuer/new" className="btn primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
            Claim your first domain
          </Link>
        </div>
      ) : (
        <table style={{ marginTop: '1.5rem' }}>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Name</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {myIssuers.map((iss) => (
              <tr key={iss.id}>
                <td className="mono">{iss.domain}</td>
                <td>{iss.name}</td>
                <td>T{iss.tier}</td>
                <td>
                  {iss.domainVerified ? (
                    <span style={{ color: 'var(--success)' }}>✓ Verified</span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Pending DNS</span>
                  )}
                </td>
                <td className="dim">{iss.createdAt.toISOString().slice(0, 10)}</td>
                <td>
                  <Link href={`/issuer/${iss.id}`}>Manage →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
