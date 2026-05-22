import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers, issuerKeys, domainProofs } from '@/lib/db';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { generateKey, verifyDomain } from './actions';

export default async function IssuerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, id));
  if (!iss || iss.ownerId !== session.user.id) notFound();

  const [proof] = await db
    .select()
    .from(domainProofs)
    .where(eq(domainProofs.issuerId, iss.id))
    .orderBy(desc(domainProofs.createdAt));

  const keys = await db
    .select()
    .from(issuerKeys)
    .where(and(eq(issuerKeys.issuerId, iss.id), isNull(issuerKeys.revokedAt)))
    .orderBy(desc(issuerKeys.createdAt));

  const activeKey = keys[0];
  const fqdn = `https://${iss.domain}`;

  return (
    <>
      <p>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
      <h1 className="mono" style={{ wordBreak: 'break-all' }}>{iss.domain}</h1>
      <p className="muted">
        {iss.name} · Tier {iss.tier} ·{' '}
        {iss.domainVerified ? (
          <span style={{ color: 'var(--success)' }}>Domain verified ✓</span>
        ) : (
          <span style={{ color: 'var(--text-dim)' }}>Domain unverified</span>
        )}
      </p>

      {/* ─── Step 1: domain verification ─── */}
      <h2>1. Verify domain control (T1)</h2>
      {iss.domainVerified ? (
        <div className="card">
          <p style={{ color: 'var(--success)', margin: 0 }}>
            ✓ Domain ownership verified via DNS TXT record.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Publish the following TXT record on your DNS, then click verify.
          </p>
          <pre style={{ marginBottom: '1rem' }}>
{`_agentpki.${iss.domain}.   IN TXT   "${proof?.challengeToken ?? 'no-challenge-yet'}"`}
          </pre>
          <p className="dim" style={{ fontSize: '0.875rem' }}>
            Propagation is usually under 60 seconds. Verification checks the record via
            public DNS (1.1.1.1, 8.8.8.8) to bypass local caching.
          </p>
          <form action={verifyDomain.bind(null, iss.id)} style={{ marginTop: '1rem' }}>
            <button type="submit" className="primary">
              I've added the record — verify now
            </button>
          </form>
        </div>
      )}

      {/* ─── Step 2: signing keys ─── */}
      <h2>2. Signing keys</h2>
      {keys.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            No active signing keys yet. Generate one — it'll be Ed25519 (RFC 8032) and
            stored AES-256-GCM-encrypted at rest. The private key never leaves the server.
          </p>
          <form action={generateKey.bind(null, iss.id)}>
            <button
              type="submit"
              className="primary"
              disabled={!iss.domainVerified}
              style={!iss.domainVerified ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              {iss.domainVerified ? 'Generate first signing key' : 'Verify domain first'}
            </button>
          </form>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>KID</th>
                <th>Algorithm</th>
                <th>Valid from / to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="mono">{k.kid}</td>
                  <td>{k.algorithm}</td>
                  <td className="dim small">
                    {k.validFrom.toISOString().slice(0, 10)} →{' '}
                    {k.validTo.toISOString().slice(0, 10)}
                  </td>
                  <td>
                    {k.revokedAt ? (
                      <span style={{ color: 'var(--danger)' }}>Revoked</span>
                    ) : (
                      <span style={{ color: 'var(--success)' }}>Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={generateKey.bind(null, iss.id)} style={{ marginTop: '1rem' }}>
            <button type="submit">+ Generate new key (rotation)</button>
          </form>
        </div>
      )}

      {/* ─── Step 3: well-known directory ─── */}
      {activeKey && (
        <>
          <h2>3. Publish the well-known directory</h2>
          <p className="muted">
            Two paths to serve the directory at <code>{fqdn}/.well-known/agentpki-issuer.json</code>:
          </p>

          <h3>Path A — fork the real-issuer Worker (recommended)</h3>
          <p>
            Deploys at <code>{iss.domain}</code> with full mint + CRL endpoints. See{' '}
            <a href="https://github.com/agentpki/real-issuer">github.com/agentpki/real-issuer</a>{' '}
            for setup. You'll need:
          </p>
          <pre>
{`ISSUER_DOMAIN     = "${iss.domain}"
ISSUER_NAME       = "${iss.name}"
ISSUER_TIER       = "${iss.tier}"
KID               = "${activeKey.kid}"
KEY_VALID_FROM    = "${Math.floor(activeKey.validFrom.getTime() / 1000)}"
KEY_VALID_TO      = "${Math.floor(activeKey.validTo.getTime() / 1000)}"

# private key (download from the link below; treat as secret):
ISSUER_PRIVATE_KEY_HEX = <download via "Reveal" button below>`}
          </pre>

          <h3>Path B — static JSON (verifier-only, no minting)</h3>
          <p>
            Host this JSON file at <code>{fqdn}/.well-known/agentpki-issuer.json</code>:
          </p>
          <pre>
{JSON.stringify(
  {
    v: 1,
    issuer: iss.domain,
    name: iss.name,
    tier: iss.tier,
    current_keys: [
      {
        kid: activeKey.kid,
        alg: 'Ed25519',
        pubkey: activeKey.publicKeySpkiB64,
        valid_from: Math.floor(activeKey.validFrom.getTime() / 1000),
        valid_to: Math.floor(activeKey.validTo.getTime() / 1000),
      },
    ],
    crl_url: `${fqdn}/.well-known/agentpki-crl.json`,
    abuse_report_url: `${fqdn}/abuse`,
    contact: {
      abuse: `mailto:abuse@${iss.domain}`,
      security: `mailto:security@${iss.domain}`,
    },
  },
  null,
  2,
)}
          </pre>
          <p className="dim small">
            Path B is read-only — verifiers can verify passports signed by your key, but
            you'll need to host the minting endpoint separately. Path A is recommended.
          </p>
        </>
      )}
    </>
  );
}
