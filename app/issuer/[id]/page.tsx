import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers, issuerKeys, domainProofs } from '@/lib/db';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { generateKey, verifyDomain, deleteIssuer } from './actions';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

// Only show the failure banner if the user JUST attempted verification.
// After this window, we treat it as stale state from a prior session and
// suppress the banner — the user wanted a "fresh" page on revisit.
// DB row stays put for forensic purposes; we just don't render it.
const FAILURE_BANNER_TTL_MS = 2 * 60 * 1000; // 2 minutes

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

  // Only show failure banner for fresh attempts. Stale failures from prior
  // sessions are suppressed so revisiting the page feels clean.
  const showFailureBanner =
    proof?.failureReason &&
    proof.attemptedAt &&
    Date.now() - proof.attemptedAt.getTime() < FAILURE_BANNER_TTL_MS;

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
            Publish the following TXT record on your DNS provider (Cloudflare,
            Route 53, etc.), then click verify.
          </p>
          <p className="dim small" style={{ marginTop: '0.5rem' }}>
            At Cloudflare DNS, the <strong>Name</strong> field is just{' '}
            <code>_agentpki</code> (Cloudflare auto-appends the zone). The{' '}
            <strong>Content</strong> field is the long token below (no quotes).
          </p>
          <pre style={{ marginBottom: '1rem' }}>
{`Type:    TXT
Name:    _agentpki         (CF auto-appends ".${iss.domain}")
Content: ${proof?.challengeToken ?? 'no-challenge-yet'}
TTL:     Auto`}
          </pre>
          <p className="dim" style={{ fontSize: '0.875rem' }}>
            Propagation is usually under 60 seconds. Verification queries
            Cloudflare DNS (1.1.1.1) directly to bypass local caching.
          </p>

          {showFailureBanner && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                background: 'rgba(248, 113, 113, 0.08)',
                border: '1px solid rgba(248, 113, 113, 0.4)',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
              }}
            >
              <p style={{ margin: 0, color: 'var(--danger)', fontWeight: 500 }}>
                Last verification attempt failed
              </p>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                {proof?.failureReason}
              </p>
              {proof?.attemptedAt && (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  Tried at {proof.attemptedAt.toISOString()}
                </p>
              )}
            </div>
          )}

          <form action={verifyDomain.bind(null, iss.id)} style={{ marginTop: '1rem' }}>
            <SubmitButton
              variant="primary"
              pendingChildren={<>Querying DNS at Cloudflare (1.1.1.1)…</>}
            >
              {showFailureBanner ? 'Retry verification' : "I've added the record — verify now"}
            </SubmitButton>
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
            <SubmitButton
              variant="primary"
              disabled={!iss.domainVerified}
              pendingChildren={<>Generating Ed25519 keypair…</>}
            >
              {iss.domainVerified ? 'Generate first signing key' : 'Verify domain first'}
            </SubmitButton>
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
                <th>Private key</th>
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
                  <td>
                    {k.revokedAt ? (
                      <span className="dim small">—</span>
                    ) : (
                      <Link href={`/issuer/${iss.id}/key/${k.kid}/reveal`}>
                        Reveal →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={generateKey.bind(null, iss.id)} style={{ marginTop: '1rem' }}>
            <SubmitButton pendingChildren={<>Generating Ed25519 keypair…</>}>
              + Generate new key (rotation)
            </SubmitButton>
          </form>
        </div>
      )}

      {/* ─── Step 3: well-known directory ─── */}
      {activeKey && (
        <>
          <h2>3. Publish your well-known directory</h2>

          {/* What this is + why it matters — the explainer that was missing.
              Light-green tint distinguishes it from the violet "What is an issuer?"
              card on /dashboard. */}
          <div
            className="card"
            style={{
              background: 'rgba(34, 197, 94, 0.06)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              marginBottom: '1.5rem',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--success)' }}>
              What this step does
            </h3>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Any verifier (a site, an API, a bot-defense vendor) that receives a passport
              signed by your issuer needs to <strong>fetch your public key</strong> to check
              the signature. By convention, they look at one URL:
            </p>
            <p style={{ margin: '0.5rem 0' }}>
              <code style={{ fontSize: '0.875rem' }}>{fqdn}/.well-known/agentpki-issuer.json</code>
            </p>
            <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              You publish a JSON file at that path that lists your active keys (with the{' '}
              <code>kid</code> and SPKI base64 public key), your CRL URL, and an abuse contact.
              After this step, your issuer is fully live on the internet: agents can mint
              passports against it, and <strong>every verifier on the web can validate them</strong>{' '}
              without you needing to talk to anyone.
            </p>
          </div>

          {/* Decision guide */}
          <h3 style={{ marginTop: '2rem' }}>Pick a path</h3>
          <p className="muted">
            Two ways to host the directory. Pick based on what you need:
          </p>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Path A — real-issuer Worker</th>
                  <th>Path B — static JSON</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dim">Can mint new passports?</td>
                  <td>✓ Yes — agents call your <code>/mint</code> endpoint</td>
                  <td>No — verify-only</td>
                </tr>
                <tr>
                  <td className="dim">Setup time</td>
                  <td>~10 min (clone + secrets + deploy)</td>
                  <td>~2 min (paste JSON, deploy any static host)</td>
                </tr>
                <tr>
                  <td className="dim">Runs where?</td>
                  <td>Cloudflare Workers (free tier OK)</td>
                  <td>Any static host (Vercel, Netlify, S3, GitHub Pages)</td>
                </tr>
                <tr>
                  <td className="dim">Use this if…</td>
                  <td>You're operating real agents that need passports</td>
                  <td>You only need to be on the directory (your keys live elsewhere)</td>
                </tr>
              </tbody>
            </table>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <strong>Most users want Path A.</strong> Path B is mainly for verifier-only setups
              (e.g., a publisher who wants their identity in the directory but doesn't mint).
            </p>
          </div>

          <h3 style={{ marginTop: '2rem' }}>Path A — fork the real-issuer Worker (recommended)</h3>
          <p>
            <strong>What you'll get:</strong> a Worker at <code>{iss.domain}</code> that exposes{' '}
            <code>/.well-known/agentpki-issuer.json</code> (the directory),{' '}
            <code>/.well-known/agentpki-crl.json</code> (the revocation list),{' '}
            <code>/mint</code> (mint passports for your agents), and{' '}
            <code>/abuse</code> (abuse-report intake). Full spec §3-§7 compliant.
          </p>
          <p className="muted">
            <strong>Time:</strong> about 10 minutes if you have <code>git</code>, Node, and a
            Cloudflare account ready.
          </p>

          <div className="card" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Clone the template repo</strong> and install dependencies:
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`git clone https://github.com/agentpki/real-issuer.git
cd real-issuer
pnpm install`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Don't have <code>pnpm</code>? Three options:{' '}
                  <strong>(a)</strong> run <code>corepack enable &amp;&amp; corepack prepare pnpm@latest --activate</code>{' '}
                  (zero install, requires Node 16.13+),{' '}
                  <strong>(b)</strong> <code>npm install -g pnpm</code> (standard global install), or{' '}
                  <strong>(c)</strong> just use <code>npm install</code> instead — works fine, ignores
                  the pnpm-lock.yaml and generates its own package-lock.json.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Edit <code>wrangler.toml</code></strong> and replace the placeholder
                values with these (these are the public ones — not secret):
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`[vars]
ISSUER_DOMAIN  = "${iss.domain}"
ISSUER_NAME    = "${iss.name}"
ISSUER_TIER    = "${iss.tier}"
KID            = "${activeKey.kid}"
KEY_VALID_FROM = "${Math.floor(activeKey.validFrom.getTime() / 1000)}"
KEY_VALID_TO   = "${Math.floor(activeKey.validTo.getTime() / 1000)}"`}
                </pre>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Reveal your private key</strong> — click the{' '}
                <Link href={`/issuer/${iss.id}/key/${activeKey.kid}/reveal`}>
                  Reveal →
                </Link>{' '}
                link in the keys table above. Copy the hex value (do <em>not</em> paste it into a
                file or git-tracked anywhere; it'll go straight to a Cloudflare secret).
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Set the private key as a Cloudflare Worker secret:</strong>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`npx wrangler secret put ISSUER_PRIVATE_KEY_HEX
# paste the hex value when prompted, hit Enter`}
                </pre>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Deploy the Worker:</strong>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`npx wrangler deploy`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Wrangler prints the temporary <code>*.workers.dev</code> URL on success.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Attach your custom domain.</strong> In the Cloudflare dashboard:
                Workers &amp; Pages → your new Worker → Settings → Triggers → Custom Domains →
                add <code>{iss.domain}</code>. Cloudflare auto-provisions the TLS cert (~30 sec).
              </li>
              <li>
                <strong>Test:</strong>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`curl https://${iss.domain}/.well-known/agentpki-issuer.json
curl "https://${iss.domain}/mint?sub=test&scope=read&lifetime=300"`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  First call should return your directory JSON; second should return a signed
                  passport.{' '}
                  <strong>Windows PowerShell note:</strong> <code>curl</code> in PowerShell is an
                  alias for <code>Invoke-WebRequest</code>, which has different flags and output
                  formatting. Use <code>curl.exe</code> (forces the real curl that ships with
                  Windows 10+) or just paste the GET URL into a browser tab — both work for these
                  read-only tests. On macOS/Linux/WSL/Git Bash, plain <code>curl</code> works as
                  written.
                </p>
              </li>
            </ol>
          </div>

          <h3 style={{ marginTop: '2rem' }}>Path B — static JSON (verify-only, no minting)</h3>
          <p>
            <strong>What you'll get:</strong> verifiers can validate passports signed by your
            key.{' '}
            <strong>
              You will NOT be able to mint new passports through this URL
            </strong>{' '}
            — you'd need to sign tokens yourself (using the SDK's <code>mintPassport()</code> or
            your own service) and distribute them out-of-band.
          </p>
          <p className="muted">
            <strong>Time:</strong> about 2 minutes if you already have a static host (Vercel,
            Netlify, S3, GitHub Pages, etc.).
          </p>

          <div className="card" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Save the JSON below to a file</strong> named exactly{' '}
                <code>agentpki-issuer.json</code> (case matters):
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
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
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Upload it to your static host</strong> so it's served at exactly:
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`https://${iss.domain}/.well-known/agentpki-issuer.json`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  The path matters — verifiers look at this exact URL. On Vercel/Netlify, put
                  the file at <code>public/.well-known/agentpki-issuer.json</code> in your
                  repo. On S3, the object key is <code>.well-known/agentpki-issuer.json</code>.
                  On GitHub Pages, drop it under <code>.well-known/</code> in the published branch.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Make sure it's served as JSON.</strong> Most hosts auto-set{' '}
                <code>Content-Type: application/json</code> by extension. If yours doesn't, add a
                rewrite rule so the response includes that header — verifiers will reject
                <code>text/plain</code>.
              </li>
              <li>
                <strong>Test:</strong>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`curl -i https://${iss.domain}/.well-known/agentpki-issuer.json`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Look for <code>HTTP 200</code> + <code>Content-Type: application/json</code>{' '}
                  in the headers, and the directory JSON in the body. Once that works, your
                  issuer is discoverable by every verifier on the web — including{' '}
                  <code>verify.agentpki.dev</code>.{' '}
                  <strong>Windows PowerShell note:</strong> <code>curl</code> is aliased to{' '}
                  <code>Invoke-WebRequest</code> which doesn't accept <code>-i</code>. Use{' '}
                  <code>curl.exe -i …</code> (forces the real curl bundled with Windows 10+) or
                  in PowerShell native syntax:{' '}
                  <code>(Invoke-WebRequest URL).RawContent</code>. On macOS/Linux/WSL/Git Bash,
                  plain <code>curl -i</code> works as written.
                </p>
              </li>
            </ol>
          </div>

          {/* What happens next */}
          <h3 style={{ marginTop: '2rem' }}>What happens after you publish</h3>
          <div className="card">
            <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>Your agents start minting passports</strong> against your issuer (via
                Path A's <code>/mint</code> endpoint, or via the SDK's <code>mintPassport()</code>{' '}
                using your private key).
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>Sites and APIs receive those passports</strong> on incoming requests and
                send them to a verifier (e.g. <code>verify.agentpki.dev</code> or one they host
                themselves).
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>The verifier fetches your directory</strong> at{' '}
                <code>{fqdn}/.well-known/agentpki-issuer.json</code>, checks the Ed25519
                signature against the public key listed there, consults your CRL if you have one,
                and returns a verdict.
              </li>
              <li style={{ marginBottom: '0.5rem' }}>
                <strong>Bot-defense vendors</strong> (Cloudflare, DataDome, hCaptcha, etc.) can
                use that verdict as a signal in their existing decision pipelines — see the{' '}
                <a href="https://github.com/agentpki/bot-defense-reference">~30 LOC reference integration</a>.
              </li>
            </ol>
            <p className="dim small" style={{ marginTop: '1rem', marginBottom: 0 }}>
              At that point your organization has a public, verifiable identity for the AI agents
              it operates — no shared secrets, no central authority, just standards-grade
              cryptography.
            </p>
          </div>
        </>
      )}

      {/* ─── Danger zone: delete issuer ─── */}
      <details
        style={{
          marginTop: '3rem',
          padding: '1rem 1.25rem',
          background: 'rgba(248, 113, 113, 0.04)',
          border: '1px solid rgba(248, 113, 113, 0.25)',
          borderRadius: '0.5rem',
        }}
      >
        <summary style={{ cursor: 'pointer', color: 'var(--danger)', fontWeight: 500 }}>
          Danger zone
        </summary>
        <div style={{ marginTop: '1rem' }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Delete this issuer. This removes the issuer row plus all associated signing
            keys, domain-proof attempts, and mint audit records. <strong>Irreversible.</strong>{' '}
            The domain becomes available for re-registration by you or anyone else.
          </p>
          <p className="dim small">
            If you registered the wrong domain (e.g. you entered <code>www.example.com</code>{' '}
            instead of <code>example.com</code>), delete this and create a fresh issuer at the
            correct root domain.
          </p>
          <form action={deleteIssuer.bind(null, iss.id)} style={{ marginTop: '1rem' }}>
            <SubmitButton
              variant="danger"
              pendingChildren={<>Deleting issuer…</>}
            >
              Delete issuer {iss.domain}
            </SubmitButton>
          </form>
        </div>
      </details>
    </>
  );
}
