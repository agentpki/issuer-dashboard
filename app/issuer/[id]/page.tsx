import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers, issuerKeys, domainProofs } from '@/lib/db';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { generateKey, verifyDomain, deleteIssuer } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { OsTabs } from '@/components/OsTabs';
import { CopyBlock } from '@/components/CopyBlock';
import { Tabs } from '@/components/Tabs';

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

          {/* ─── Before you start: prerequisites + the subdomain recommendation ─── */}
          <div
            className="card"
            style={{
              background: 'rgba(251, 191, 36, 0.05)',
              border: '1px solid rgba(251, 191, 36, 0.35)',
              marginBottom: '1.5rem',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'rgb(251, 191, 36)' }}>
              ⚠ Before you start — read this
            </h3>
            <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              The single most common reason this step fails is a{' '}
              <strong>CDN conflict</strong>: your domain ({iss.domain}) is already attached to
              another provider (Vercel, Netlify, Squarespace, GitHub Pages, etc.), and that
              provider intercepts traffic before your new Worker can serve it. You'll see
              symptoms like <code>308 Permanent Redirect</code> or{' '}
              <code>server: Vercel</code> in the response headers.
            </p>
            <p className="muted" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
              <strong>
                Strongly recommended: use a subdomain instead of your bare domain.
              </strong>
            </p>
            <p className="muted small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
              Real issuers run on a dedicated subdomain like{' '}
              <code>issuer.{iss.domain}</code>,{' '}
              <code>agents.{iss.domain}</code>, or <code>id.{iss.domain}</code>. That way your
              main domain ({iss.domain}) keeps doing whatever it does today, and the issuer
              gets its own quiet corner with no fighting over routing. The well-known URL ends
              up at e.g. <code>https://issuer.{iss.domain}/.well-known/agentpki-issuer.json</code>{' '}
              — verifiers find it exactly the same way as if it were on the bare domain.
            </p>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
              <strong>If you registered this issuer with the bare domain</strong> and want to
              switch to a subdomain: scroll to the <strong>Danger zone</strong> at the bottom of
              this page, delete this issuer, and create a fresh one with the subdomain (e.g.{' '}
              <code>issuer.{iss.domain}</code>). It takes 2 minutes and saves you the routing
              headache below.
            </p>
            <p className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
              <strong>If you must use the bare domain</strong> ({iss.domain}) — that's fine,
              but be aware: in Step 8 (attach custom domain) you may have to manually remove
              the domain from your current CDN and delete a stale DNS record. Specific steps
              for Vercel / Netlify / others are inline in Step 8 below.
            </p>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <strong>Other prerequisites:</strong> a Cloudflare account (free tier OK), Node
              ≥ 16.13 installed, git installed, and a text editor. That's it.
            </p>
          </div>

          {/* Decision guide */}
          <h3 style={{ marginTop: '2rem' }}>Pick a path</h3>
          <p className="muted">
            Two ways to host the directory. Pick based on what you need:
          </p>
          <p className="dim small" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
            <strong>Not sure?</strong> If you're building real AI agents that need to mint
            passports → Path A. If you just want to be in the directory so verifiers know you
            exist (e.g. publisher allow-listing your own crawler) → Path B. <strong>Path B is
            significantly simpler</strong> — no Worker, no secrets, no KV namespace, no
            wrangler. It's just a static JSON file you upload.
          </p>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th style={{ color: 'rgb(196, 181, 253)', fontWeight: 700 }}>
                    Path A — real-issuer Worker
                  </th>
                  <th style={{ color: 'rgb(110, 231, 183)', fontWeight: 700 }}>
                    Path B — static JSON
                  </th>
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

          <p className="muted" style={{ marginTop: '2rem', marginBottom: '0.75rem' }}>
            <strong>Choose your path:</strong>
          </p>
          <Tabs
            storageKey="agentpki-pathway-pref"
            defaultId="a"
            tabs={[
              {
                id: 'a',
                label: 'Path A — deploy a real issuer (mint + verify)',
                color: {
                  text: 'rgb(196, 181, 253)',
                  bg: 'rgba(167, 139, 250, 0.18)',
                  border: 'rgba(167, 139, 250, 0.5)',
                },
                content: (
                  <>
                  <p>
                    <strong>What you'll get:</strong> a server at <code>{iss.domain}</code> that
                    exposes <code>/.well-known/agentpki-issuer.json</code> (the directory) and{' '}
                    <code>/mint</code> (issues passports to your agents). Pick your host — same
                    end result, different deploy mechanics:
                  </p>
          <Tabs
            storageKey="agentpki-host-pref"
            defaultId="cf"
            tabs={[
              {
                id: 'cf',
                label: '☁  Cloudflare Workers  (recommended — 3 min)',
                color: {
                  text: 'rgb(254, 215, 170)',
                  bg: 'rgba(251, 146, 60, 0.18)',
                  border: 'rgba(251, 146, 60, 0.5)',
                },
                content: (
                  <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    <strong>Why recommended:</strong> the <code>real-issuer</code> template
                    ships with KV state, CRL endpoint, abuse intake, and a complete{' '}
                    <code>wrangler.toml</code> — full spec §3-§7 compliant out of the box.
                    One paste deploys everything.
                  </p>

                  {/* ─── ONE-PASTE BOOTSTRAP — preferred for tomorrow's HN visitors ─── */}
          <div
            className="card"
            style={{
              background: 'rgba(34, 197, 94, 0.06)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              marginTop: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--success)' }}>
              ⚡ Fastest path — paste 2 commands, that's it
            </h3>
            <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              The script below replaces steps 2 through 7 of the numbered walkthrough. It edits{' '}
              <code>wrangler.toml</code>, creates the KV namespace, generates the{' '}
              <code>INTERNAL_MINT_SECRET</code> for you, prompts once for your private key, and
              deploys. Total time: about 3 minutes.
            </p>
            <p
              style={{
                marginTop: 0,
                marginBottom: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'rgba(251, 191, 36, 0.1)',
                borderLeft: '3px solid rgba(251, 191, 36, 0.7)',
                borderRadius: '0 0.375rem 0.375rem 0',
                fontSize: '0.875rem',
                color: 'rgb(252, 211, 77)',
              }}
            >
              <strong>⚠ Before pasting:</strong> have the{' '}
              <strong>Reveal private key</strong> page open in another tab — you'll need to
              paste the 64-char hex when prompted.
            </p>

            <p className="muted" style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
              <strong>Step 1 — clone + enter the repo:</strong>
            </p>
            <CopyBlock>
              <pre style={{ marginTop: 0, marginBottom: '0.75rem' }}>
{`git clone https://github.com/agentpki/real-issuer.git
cd real-issuer
npm install`}
              </pre>
            </CopyBlock>
            <p
              style={{
                marginTop: 0,
                marginBottom: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'rgba(96, 165, 250, 0.1)',
                borderLeft: '3px solid rgba(96, 165, 250, 0.7)',
                borderRadius: '0 0.375rem 0.375rem 0',
                fontSize: '0.875rem',
                color: 'rgb(147, 197, 253)',
              }}
            >
              <strong>💡 Tip:</strong> Use <code>npm install</code> — works on every machine
              with Node installed. If you have <code>pnpm</code> available,{' '}
              <code>pnpm install</code> also works.
            </p>

            <p className="muted" style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
              <strong>Step 2 — paste this whole block. Pick your shell:</strong>
            </p>
            <OsTabs
              unix={
                <CopyBlock>
                <pre style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.75rem' }}>
{`# Auto-bootstrap for issuer ${iss.domain}
set -e

# 1) Edit wrangler.toml
sed -i.bak \\
  -e 's|name = "agentpki-issuer"|name = "agentpki-issuer-${iss.domain.replace(/\./g, '-')}"|' \\
  -e 's|ISSUER_DOMAIN = "your-issuer-domain.com"|ISSUER_DOMAIN = "${iss.domain}"|' \\
  -e 's|ISSUER_NAME = "Your Company, Inc."|ISSUER_NAME = "${iss.name.replace(/"/g, '\\"')}"|' \\
  -e 's|KID = "your-issuer-2026-q2"|KID = "${activeKey.kid}"|' \\
  -e 's|KEY_VALID_FROM = "1714521600"|KEY_VALID_FROM = "${Math.floor(activeKey.validFrom.getTime() / 1000)}"|' \\
  -e 's|KEY_VALID_TO   = "1893456000"|KEY_VALID_TO   = "${Math.floor(activeKey.validTo.getTime() / 1000)}"|' \\
  -e 's|ABUSE_CONTACT_EMAIL    = "abuse@your-issuer-domain.com"|ABUSE_CONTACT_EMAIL    = "abuse@${iss.domain}"|' \\
  -e 's|SECURITY_CONTACT_EMAIL = "security@your-issuer-domain.com"|SECURITY_CONTACT_EMAIL = "security@${iss.domain}"|' \\
  wrangler.toml
rm wrangler.toml.bak

# 2) Create KV namespace and inject the id
KV_ID=$(npx wrangler kv namespace create ISSUER_STATE 2>&1 | grep -oE 'id = "[a-f0-9]+"' | grep -oE '[a-f0-9]+')
[ -z "$KV_ID" ] && { echo "Could not parse KV id"; exit 1; }
sed -i.bak "s|PASTE-KV-NAMESPACE-ID-HERE|$KV_ID|" wrangler.toml
rm wrangler.toml.bak
echo "✅ KV namespace created: $KV_ID"

# 3) Generate INTERNAL_MINT_SECRET
MINT_SECRET=$(openssl rand -base64 48 | tr -d '\\n')
echo ""
echo "🔑 SAVE THIS — your agents will need it to call /mint:"
echo "   $MINT_SECRET"
echo ""
echo "$MINT_SECRET" | npx wrangler secret put INTERNAL_MINT_SECRET

# 4) Prompt for ISSUER_PRIVATE_KEY_HEX
read -p "Paste your 64-char hex private key from the Reveal page: " PRIVATE_KEY
echo "$PRIVATE_KEY" | tr -d '\\n' | npx wrangler secret put ISSUER_PRIVATE_KEY_HEX

# 5) Deploy
npx wrangler deploy

echo ""
echo "✅ DEPLOYED. Next: attach ${iss.domain} as a Custom Domain in CF Workers."
echo "   Workers & Pages → agentpki-issuer-${iss.domain.replace(/\./g, '-')} → Domains tab → + Add"`}
                </pre>
                </CopyBlock>
              }
              windows={
                <CopyBlock>
                <pre style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.75rem' }}>
{`# Auto-bootstrap for issuer ${iss.domain}
$ErrorActionPreference = 'Stop'

# 1) Edit wrangler.toml — replace placeholder vars with your issuer's
$toml = Get-Content wrangler.toml -Raw
$toml = $toml -replace 'name = "agentpki-issuer"', 'name = "agentpki-issuer-${iss.domain.replace(/\./g, '-')}"'
$toml = $toml -replace 'ISSUER_DOMAIN = "your-issuer-domain.com"', 'ISSUER_DOMAIN = "${iss.domain}"'
$toml = $toml -replace 'ISSUER_NAME = "Your Company, Inc."', 'ISSUER_NAME = "${iss.name.replace(/"/g, '\\"')}"'
$toml = $toml -replace 'ISSUER_TIER = "1"', 'ISSUER_TIER = "${iss.tier}"'
$toml = $toml -replace 'KID = "your-issuer-2026-q2"', 'KID = "${activeKey.kid}"'
$toml = $toml -replace 'KEY_VALID_FROM = "1714521600"', 'KEY_VALID_FROM = "${Math.floor(activeKey.validFrom.getTime() / 1000)}"'
$toml = $toml -replace 'KEY_VALID_TO   = "1893456000"', 'KEY_VALID_TO   = "${Math.floor(activeKey.validTo.getTime() / 1000)}"'
$toml = $toml -replace 'ABUSE_CONTACT_EMAIL    = "abuse@your-issuer-domain.com"', 'ABUSE_CONTACT_EMAIL    = "abuse@${iss.domain}"'
$toml = $toml -replace 'SECURITY_CONTACT_EMAIL = "security@your-issuer-domain.com"', 'SECURITY_CONTACT_EMAIL = "security@${iss.domain}"'
Set-Content wrangler.toml -Value $toml -NoNewline

# 2) Create KV namespace and inject the id
$kvOutput = npx wrangler kv namespace create ISSUER_STATE 2>&1 | Out-String
$kvId = ([regex]'id = "([a-f0-9]+)"').Match($kvOutput).Groups[1].Value
if (-not $kvId) { throw "Could not parse KV namespace id from output: $kvOutput" }
$toml = (Get-Content wrangler.toml -Raw) -replace 'PASTE-KV-NAMESPACE-ID-HERE', $kvId
Set-Content wrangler.toml -Value $toml -NoNewline
Write-Host "✅ KV namespace created: $kvId"

# 3) Generate INTERNAL_MINT_SECRET — auto-random, save the output
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$mintSecret = [Convert]::ToBase64String($bytes)
Write-Host ""
Write-Host "🔑 SAVE THIS — your agents will need it to call /mint:" -ForegroundColor Yellow
Write-Host "   $mintSecret" -ForegroundColor Yellow
Write-Host ""
$mintSecret | npx wrangler secret put INTERNAL_MINT_SECRET

# 4) Prompt for ISSUER_PRIVATE_KEY_HEX (paste it from the reveal page)
$privateKey = Read-Host "Paste your 64-char hex private key from the Reveal page"
$privateKey.Trim() | npx wrangler secret put ISSUER_PRIVATE_KEY_HEX

# 5) Deploy
npx wrangler deploy

Write-Host ""
Write-Host "✅ DEPLOYED. Next step: attach ${iss.domain} as a Custom Domain in CF Workers." -ForegroundColor Green
Write-Host "   Workers & Pages → agentpki-issuer-${iss.domain.replace(/\./g, '-')} → Domains tab → + Add" -ForegroundColor Green`}
                </pre>
                </CopyBlock>
              }
            />

            <p className="dim small" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <strong>What the script does, in order:</strong> patches{' '}
              <code>wrangler.toml</code> with your issuer's values → creates the KV namespace
              and injects its id → generates an <code>INTERNAL_MINT_SECRET</code> and prints it
              (save it!) → prompts you for the private key → runs{' '}
              <code>npx wrangler deploy</code>.{' '}
              <strong>After this finishes, only step 8 (attach custom domain) is left.</strong>{' '}
              You're 3 minutes from a live issuer.
            </p>
            <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              <strong>First run will prompt for Cloudflare login</strong> — wrangler opens a
              browser window to auth. Click Allow. Then the script continues.
            </p>
          </div>

          <details style={{ marginBottom: '1.5rem' }}>
            <summary className="muted" style={{ cursor: 'pointer', padding: '0.5rem 0' }}>
              Prefer to do it manually? Expand for the 11 individual numbered steps →
            </summary>
            <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              The detailed walkthrough below covers the same operations the bootstrap script
              does, but with each step broken out so you can understand or customize. If the
              bootstrap script worked for you, skip directly to step 8 (attach custom domain).
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
                <strong>Open <code>wrangler.toml</code></strong> in any text editor and replace
                the placeholder values with these (these are the public ones — not secret):
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <strong>Where is it?</strong> After step 1, you're already in the{' '}
                  <code>real-issuer/</code> folder. <code>wrangler.toml</code> is a single file
                  at the root of that folder — same level as <code>package.json</code> and{' '}
                  <code>src/</code>. To open it:
                </p>
                <ul className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem', paddingLeft: '1.25rem' }}>
                  <li>
                    <strong>VS Code:</strong> <code>code wrangler.toml</code> (if you have the{' '}
                    <code>code</code> command on your PATH — installed via Cmd+Shift+P → "Shell
                    Command: Install 'code' command in PATH" on macOS), or <code>code .</code>{' '}
                    to open the whole folder then click <code>wrangler.toml</code> in the sidebar
                  </li>
                  <li>
                    <strong>Cursor/Sublime/etc:</strong> same idea — <code>cursor wrangler.toml</code>,{' '}
                    <code>subl wrangler.toml</code>
                  </li>
                  <li>
                    <strong>macOS TextEdit:</strong> <code>open -a TextEdit wrangler.toml</code>
                  </li>
                  <li>
                    <strong>Windows Notepad:</strong> <code>notepad wrangler.toml</code> in
                    PowerShell, or right-click the file in File Explorer → Open with → Notepad
                  </li>
                  <li>
                    <strong>Terminal-only editors:</strong>{' '}
                    <code>nano wrangler.toml</code> /{' '}
                    <code>vim wrangler.toml</code> if you're comfortable with those
                  </li>
                </ul>
                <p className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                  Inside the file you'll see a section starting with <code>[vars]</code> and
                  some placeholder values (e.g., <code>ISSUER_DOMAIN = "your-co.com"</code>).
                  Replace that whole <code>[vars]</code> block with what's below:
                </p>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`[vars]
ISSUER_DOMAIN  = "${iss.domain}"
ISSUER_NAME    = "${iss.name}"
ISSUER_TIER    = "${iss.tier}"
KID            = "${activeKey.kid}"
KEY_VALID_FROM = "${Math.floor(activeKey.validFrom.getTime() / 1000)}"
KEY_VALID_TO   = "${Math.floor(activeKey.validTo.getTime() / 1000)}"
ABUSE_CONTACT_EMAIL    = "abuse@${iss.domain}"
SECURITY_CONTACT_EMAIL = "security@${iss.domain}"`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <strong>About the contact emails:</strong> these end up in your published
                  <code>/.well-known/agentpki-issuer.json</code> directory as the abuse-report and
                  security-disclosure inboxes. <code>abuse@{iss.domain}</code> and{' '}
                  <code>security@{iss.domain}</code> are conventions but anything you actually
                  monitor works (e.g. <code>hello@{iss.domain}</code>). If those mailboxes don't
                  exist yet, set up Cloudflare Email Routing (free) to forward them to a real
                  inbox — verifiers and security researchers will look at these.
                </p>
                <p className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                  <strong>One more change in this file:</strong> at the very top, find the line{' '}
                  <code>name = "agentpki-issuer"</code> (or with{' '}
                  <code>-edit-me</code> suffix in older versions). This is your Cloudflare
                  Worker's name — must be unique within your Cloudflare account. Suggest:
                </p>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`name = "agentpki-issuer-${iss.domain.replace(/\./g, '-')}"`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Save the file (<code>Ctrl+S</code> / <code>Cmd+S</code>) and close the editor.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Create the issuer-state KV namespace.</strong> Your Worker needs a
                Cloudflare KV namespace to store revoked-passport IDs, key rotation history,
                and the mint audit log. One command creates it:
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`npx wrangler kv namespace create ISSUER_STATE`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  Wrangler prints something like:
                </p>
                <pre style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.75rem' }}>
{`🌀 Creating namespace with title "ISSUER_STATE"
✨ Success!
Add the following to your configuration file:
[[kv_namespaces]]
binding = "ISSUER_STATE"
id = "abc123def456789..."   ← copy this id`}
                </pre>
                <p className="dim small" style={{ marginTop: 0, marginBottom: 0 }}>
                  <strong>Copy the <code>id</code> value</strong> and open{' '}
                  <code>wrangler.toml</code> again. Find the existing{' '}
                  <code>[[kv_namespaces]]</code> block (it has a placeholder id like{' '}
                  <code>PASTE-KV-NAMESPACE-ID-HERE</code> or{' '}
                  <code>EDIT-ME-...</code>) and replace just the <code>id</code> value with
                  what wrangler printed. Save the file.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Reveal your private key.</strong> Click the link below — it opens a
                page that shows your Ed25519 private key in hex, plus a ready-made wrangler
                command you'll use in step 4:
                <p style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <Link
                    href={`/issuer/${iss.id}/key/${activeKey.kid}/reveal`}
                    style={{
                      display: 'inline-block',
                      padding: '0.5rem 1rem',
                      background: 'rgba(167, 139, 250, 0.15)',
                      border: '1px solid rgba(167, 139, 250, 0.4)',
                      borderRadius: '0.375rem',
                      textDecoration: 'none',
                    }}
                  >
                    Reveal private key for <code>{activeKey.kid}</code> →
                  </Link>
                </p>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <strong>What you'll see on the reveal page:</strong>
                </p>
                <ul className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem', paddingLeft: '1.25rem' }}>
                  <li>
                    A red warning card at the top reminding you the value is a top-secret
                    credential — anyone with it can mint passports as <code>{iss.domain}</code>.
                  </li>
                  <li>
                    A <strong>"Private key (hex)"</strong> block — a 64-character hexadecimal
                    string (32 bytes of Ed25519 seed). Looks like{' '}
                    <code>a3f7…</code>. Don't worry about reading it; you don't need to.
                  </li>
                  <li>
                    A <strong>"Wrangler one-liner"</strong> block — your hex already pre-inlined
                    into a command:{' '}
                    <code style={{ fontSize: '0.7rem' }}>echo "&lt;your-hex&gt;" | wrangler secret put ISSUER_PRIVATE_KEY_HEX</code>.{' '}
                    This is what you'll use in step 4 — copy it now.
                  </li>
                  <li>
                    A <strong>"Plain (non-secret) env vars"</strong> block — duplicate of what
                    you already pasted into <code>wrangler.toml</code> in step 2. You can ignore
                    it on this page.
                  </li>
                </ul>
                <p className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                  <strong>What to do:</strong> click the "Wrangler one-liner" block to select it,
                  copy it to your clipboard (<code>Ctrl+C</code> / <code>Cmd+C</code>), then come
                  back here.
                </p>
                <p className="dim small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                  <strong>Security rules — read these:</strong>
                </p>
                <ul className="dim small" style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
                  <li>
                    <strong>Do not</strong> paste the hex into a file, a chat, a note app, an
                    LLM, an email, or anywhere persisted. It's a clipboard-only value on its
                    way to a Cloudflare secret.
                  </li>
                  <li>
                    <strong>Do not</strong> commit it to git (the wrangler.toml you edited in
                    step 2 does NOT contain the private key — that's the whole point of the
                    "secret" pattern).
                  </li>
                  <li>
                    <strong>Do not</strong> screenshot the reveal page.
                  </li>
                  <li>
                    <strong>Close the reveal tab</strong> as soon as the wrangler command in
                    step 4 succeeds. The value re-displays on reload — but every reload is one
                    more place it could leak.
                  </li>
                  <li>
                    If you suspect the key was exposed at any point (clipboard manager,
                    accidental paste, etc.), come back to this issuer page, generate a new key,
                    and revoke the old one. Then start step 3 over with the new key.
                  </li>
                </ul>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Paste the wrangler one-liner from step 3</strong> into your terminal
                (in the <code>real-issuer/</code> directory you cd'd into in step 1), then hit
                Enter. The command looks like this — yours will have the actual hex inlined:
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`echo "<your-64-char-hex>" | npx wrangler secret put ISSUER_PRIVATE_KEY_HEX`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Wrangler reads the hex from stdin (no hidden prompt, no manual paste — clean).
                  You'll see <code>✨ Success! Uploaded secret ISSUER_PRIVATE_KEY_HEX</code> on
                  success. Now go back to the reveal tab and close it. The private key never
                  touches disk on your machine.
                </p>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  <strong>Windows PowerShell note:</strong> the <code>echo "…" | …</code> form
                  works in PowerShell too — <code>echo</code> is an alias for{' '}
                  <code>Write-Output</code> and the pipe is native PS syntax. No change needed.
                </p>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Set the second secret — <code>INTERNAL_MINT_SECRET</code>.</strong> This
                is a random bearer token your <em>own</em> agents will use to authenticate to
                your Worker's <code>/mint</code> endpoint (the public verifier endpoint is
                wide-open; <code>/mint</code> is the private one). Generate and set it in one
                line:
                <OsTabs
                  unix={
                    <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`openssl rand -base64 48 | npx wrangler secret put INTERNAL_MINT_SECRET`}
                    </pre>
                  }
                  windows={
                    <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`# Works on both PS 5.1 and PS 7+
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$s = [Convert]::ToBase64String($bytes)
Write-Host "SAVE THIS for your agents: $s"
$s | npx wrangler secret put INTERNAL_MINT_SECRET`}
                    </pre>
                  }
                />
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Generates a 64-character base64 string, pipes it into Cloudflare as a secret,
                  and (on PowerShell) echoes it back once so you can save it to a password
                  manager. Your agents will need this value to call <code>/mint</code>. The
                  Worker will reject any <code>/mint</code> request without an{' '}
                  <code>Authorization: Bearer &lt;this-value&gt;</code> header.
                </p>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  If you lose the value, just re-run the command — wrangler will overwrite the
                  secret with a new one and your agents will need to be updated.
                </p>
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
                <ol style={{ marginTop: '0.5rem', marginBottom: '0.5rem', paddingLeft: '1.25rem' }}>
                  <li>Go to <strong>Workers &amp; Pages</strong> in the left sidebar</li>
                  <li>Click your newly-deployed Worker (the name you set in step 2)</li>
                  <li>
                    Click the <strong>Domains</strong> tab in the top nav (between{' '}
                    <em>Observability</em> and <em>Settings</em>). Note: as of mid-2026,
                    Cloudflare moved Custom Domains out of Settings → Triggers into its own
                    top-level tab.
                  </li>
                  <li>
                    Under <strong>Custom Domains</strong>, click <strong>+ Add</strong> and
                    enter <code>{iss.domain}</code>
                  </li>
                  <li>
                    Click <strong>Add Domain</strong>. Cloudflare validates DNS + auto-provisions
                    the TLS cert (~30 sec).
                  </li>
                </ol>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Once it shows green, your Worker is reachable at{' '}
                  <code>https://{iss.domain}</code> and the well-known directory will be served
                  at <code>https://{iss.domain}/.well-known/agentpki-issuer.json</code>.
                </p>

                {/* CDN-conflict troubleshooting block */}
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(251, 191, 36, 0.05)',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: 'rgb(251, 191, 36)' }}>
                    🛟 If "Add Domain" fails or you still get errors after attaching:
                  </p>
                  <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                    Most failures here come from another CDN (Vercel, Netlify, Squarespace, etc.)
                    still claiming <code>{iss.domain}</code>. To fix:
                  </p>
                  <ol className="dim small" style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
                    <li style={{ marginBottom: '0.4rem' }}>
                      <strong>Cloudflare error: "A CNAME record already exists for this hostname"</strong>
                      <br />
                      → CF DNS → Records → find the CNAME for <code>{iss.domain}</code> pointing
                      to e.g. <code>vercel-dns-*.com</code> or your old CDN → click ⋮ → Delete →
                      retry the Add Domain step. (CF won't auto-replace existing CNAMEs.)
                    </li>
                    <li style={{ marginBottom: '0.4rem' }}>
                      <strong>You get <code>308 Permanent Redirect</code> when curling the URL</strong>
                      <br />
                      → Run <code>curl.exe -i https://{iss.domain}/.well-known/agentpki-issuer.json</code>{' '}
                      and look at the <code>server:</code> header. If it says{' '}
                      <code>Vercel</code> / <code>Netlify</code> / etc., that CDN still owns
                      the domain at its edge — remove the domain from your project there{' '}
                      <strong>before</strong> CF can take over.
                    </li>
                    <li style={{ marginBottom: '0.4rem' }}>
                      <strong>How to remove from Vercel:</strong> vercel.com → click the project
                      that owns the domain → Settings → Domains → ⋮ next to{' '}
                      <code>{iss.domain}</code> → Remove. (Don't delete the project itself —
                      that kills the app.) The Vercel-given URL{' '}
                      <code>your-project.vercel.app</code> keeps working.
                    </li>
                    <li style={{ marginBottom: '0.4rem' }}>
                      <strong>How to remove from Netlify:</strong> app.netlify.com → site →
                      Site configuration → Domain management → remove the custom domain.
                    </li>
                    <li>
                      <strong>Once the other CDN releases the domain</strong> + you've deleted
                      the stale CNAME (step 1 above), retry the CF Custom Domain attach. It
                      should succeed in ~30 sec.
                    </li>
                  </ol>
                  <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                    <strong>Want to skip all this entirely?</strong> Delete this issuer and
                    create a new one with a <em>subdomain</em> (e.g.{' '}
                    <code>issuer.{iss.domain}</code>) that's not claimed by any other CDN. The{' '}
                    <strong>"Before you start"</strong> callout above explains the trade-off.
                  </p>
                </div>
              </li>
              <li style={{ marginBottom: '0.75rem' }}>
                <strong>Verify the directory is live at your domain:</strong>
                <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`curl https://${iss.domain}/.well-known/agentpki-issuer.json`}
                </pre>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  Should return your directory JSON (the same one you saw at the{' '}
                  <code>*.workers.dev</code> URL).{' '}
                  <strong>Windows PowerShell:</strong> use <code>curl.exe</code> (not bare{' '}
                  <code>curl</code>, which is <code>Invoke-WebRequest</code>) or paste the URL
                  into a browser tab.
                </p>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  If you see <code>308 Permanent Redirect</code> or another CDN's server header,
                  go back to step 6's troubleshooting section.
                </p>
              </li>
              <li>
                <strong>Close the loop end-to-end — mint a passport and verify it:</strong>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  This is the moment your independently-deployed Worker proves it actually
                  works. We mint a test passport via your <code>/mint</code> endpoint, then send
                  it to the production verifier at <code>verify.agentpki.dev</code>. If the
                  verifier returns <code>verdict: allow</code>, your loop is closed.
                </p>
                <OsTabs
                  unix={
                    <pre style={{ marginTop: '0.5rem', marginBottom: 0 }}>
{`# 1. Mint a passport (replace <YOUR_MINT_SECRET> with the value from step 4)
curl -X POST https://${iss.domain}/mint \\
  -H "Authorization: Bearer <YOUR_MINT_SECRET>" \\
  -H "Content-Type: application/json" \\
  -d '{"sub":"agent:test","scope":["read"],"lifetime":300}'

# 2. Copy the "token" from the response above, then send it to verify:
curl -X POST https://verify.agentpki.dev/v1/verify \\
  -H "Content-Type: application/json" \\
  -d '{"token":"<paste-token-from-step-1>"}'`}
                    </pre>
                  }
                  windows={
                    <pre style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.75rem' }}>
{`# 1. Mint
$mint = Invoke-RestMethod -Method POST -Uri "https://${iss.domain}/mint" \`
  -Headers @{ Authorization = "Bearer <YOUR_MINT_SECRET>" } \`
  -ContentType "application/json" \`
  -Body '{"sub":"agent:test","scope":["read"],"lifetime":300}'
$mint.token

# 2. Verify
$verify = Invoke-RestMethod -Method POST -Uri "https://verify.agentpki.dev/v1/verify" \`
  -ContentType "application/json" \`
  -Body (@{ token = $mint.token } | ConvertTo-Json)
$verify`}
                    </pre>
                  }
                />
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  <strong>Expected result:</strong>{' '}
                  <code style={{ color: 'var(--success)' }}>
                    {'{ "verdict": "allow", "passport": { "iss": "'}{iss.domain}{'", ... } }'}
                  </code>
                </p>
                <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  <strong>If verdict is allow:</strong> 🎉 your issuer is fully operational.
                  Your agents can mint passports against it, and every verifier on the web —
                  including bot-defense vendors, sites, APIs — can validate them. No shared
                  keys, no central authority, just open-protocol cryptography.
                </p>
              </li>
            </ol>
          </div>
          </details>

          {/* Universal debug help — applies to any wall hit during Path A */}
          <div
            className="card"
            style={{
              background: 'rgba(96, 165, 250, 0.05)',
              border: '1px solid rgba(96, 165, 250, 0.3)',
              marginTop: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
              🔧 Stuck? Open a debug window in 30 seconds
            </h3>
            <p className="muted small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
              Run this in your <code>real-issuer</code> directory:
            </p>
            <pre style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
{`npx wrangler tail`}
            </pre>
            <p className="muted small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
              That streams live logs from your deployed Worker as you hit it. Open another
              terminal and curl the URL — any exception will print with a file + line within ~1
              second. 9 out of 10 silent failures get diagnosed this way.
            </p>
            <p className="dim small" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
              <strong>Common errors and their fixes:</strong>
            </p>
            <ul className="dim small" style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.4rem' }}>
                <code>ISSUER_PRIVATE_KEY_HEX is not set</code> — re-run step 5. The most
                common cause is bare <code>wrangler</code> vs <code>npx wrangler</code> — use{' '}
                <code>npx wrangler</code>. Verify with <code>npx wrangler secret list</code>.
              </li>
              <li style={{ marginBottom: '0.4rem' }}>
                <code>KV namespace 'EDIT-ME-...' is not valid</code> — you deployed before
                pasting the real KV id into wrangler.toml. Re-run step 3, paste the id from the
                output into the <code>[[kv_namespaces]]</code> block, redeploy.
              </li>
              <li style={{ marginBottom: '0.4rem' }}>
                <code>Could not resolve "@agentpki/sdk"</code> — your <code>real-issuer</code>{' '}
                clone is out of date. Pull the latest:{' '}
                <code>cd real-issuer; git pull; rm -rf node_modules pnpm-lock.yaml; pnpm install</code>.
              </li>
              <li>
                <code>308 Permanent Redirect</code> with <code>server: Vercel</code> (or other) —
                another CDN still claims the domain. See step 6 troubleshooting.
              </li>
            </ul>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              Still stuck after trying the above? Email{' '}
              <a href="mailto:hello@agentpki.dev">hello@agentpki.dev</a> with the{' '}
              <code>wrangler tail</code> output and we'll unblock you.
            </p>
          </div>
                  </>
                ),
              },
              {
                id: 'node',
                label: '🌐  Vercel / Render / Fly / AWS / Other Node.js host',
                color: {
                  text: 'rgb(165, 243, 252)',
                  bg: 'rgba(34, 211, 238, 0.18)',
                  border: 'rgba(34, 211, 238, 0.5)',
                },
                content: (
                  <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    AgentPKI is host-agnostic. If you're on AWS / GCP / Vercel / Fly / Render /
                    Railway / your own VPS, you can still mint passports — you just write a
                    tiny server using the SDK directly and deploy it where you already deploy
                    code. Total LOC: ~30.
                  </p>
                  <p className="dim small" style={{ marginTop: 0 }}>
                    <strong>What this skips vs. Cloudflare:</strong> no KV-backed CRL endpoint,
                    no built-in abuse intake. Both are v0.2 extensions you can add later
                    (~50 LOC each) — see <a href="https://github.com/agentpki/real-issuer/tree/main/src">
                      real-issuer/src
                    </a> for reference. For v0.1 verifier conformance, directory + mint is
                    enough.
                  </p>

                  <h4 style={{ marginTop: '1rem', fontSize: '0.9375rem' }}>
                    Minimal Node.js mint server (deploys on anything that runs Node)
                  </h4>
            <p className="dim small" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
              Save as <code>server.js</code>, set the env vars, run{' '}
              <code>node server.js</code>. Deploy to{' '}
              <strong>Vercel</strong>, <strong>Render</strong>, <strong>Fly.io</strong>,{' '}
              <strong>Railway</strong>, <strong>AWS Lambda + API Gateway</strong>,{' '}
              <strong>GCP Cloud Run</strong>, <strong>Azure Container Apps</strong>, or any
              VPS. The code is identical:
            </p>
            <CopyBlock>
              <pre style={{ marginTop: 0, marginBottom: 0, fontSize: '0.75rem' }}>
{`// server.js — minimal AgentPKI mint server (Node 18+)
// Deploys identically to Vercel, Render, Fly, Railway, AWS Lambda, GCP Run, Azure, etc.
//
// Env vars to set on your host:
//   ISSUER_PRIVATE_KEY_HEX   = "<64-char hex from Reveal page>"
//   INTERNAL_MINT_SECRET     = "<random 32+ char string>"
//
// Public env vars (also set on your host, or hardcode):
//   ISSUER_DOMAIN  = "${iss.domain}"
//   ISSUER_NAME    = "${iss.name}"
//   ISSUER_TIER    = "${iss.tier}"
//   KID            = "${activeKey.kid}"

import http from 'node:http';
import { signPassport } from '@agentpki/sdk';

const PORT = process.env.PORT || 8080;
const SECRET = process.env.INTERNAL_MINT_SECRET;
const KEY_HEX = process.env.ISSUER_PRIVATE_KEY_HEX;
const privateKey = Uint8Array.from(Buffer.from(KEY_HEX, 'hex'));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');

    // /.well-known/agentpki-issuer.json — public directory
    if (req.method === 'GET' && url.pathname === '/.well-known/agentpki-issuer.json') {
      return res.end(JSON.stringify(${JSON.stringify(
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
        0,
      )}));
    }

    // POST /mint — Bearer-auth, returns a signed passport
    if (req.method === 'POST' && url.pathname === '/mint') {
      const auth = req.headers.authorization || '';
      if (auth !== \`Bearer \${SECRET}\`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const { sub, scope = ['read'], lifetime = 300 } = JSON.parse(body || '{}');
      const token = await signPassport({
        iss: '${iss.domain}',
        sub,
        scope,
        kid: '${activeKey.kid}',
        privateKey,
        lifetime,
      });
      return res.end(JSON.stringify({ token, expires_in: lifetime }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'internal', detail: String(e) }));
  }
}).listen(PORT, () => console.log(\`AgentPKI issuer listening on :\${PORT}\`));`}
              </pre>
            </CopyBlock>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
              <strong>Per-host deploy notes:</strong>
            </p>
            <ul className="dim small" style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>Vercel:</strong> save as <code>api/issuer/[...slug].js</code> in a
                Next.js project (rewrite the http server to a Next API route). Or use a Vercel
                Function. <code>vercel deploy</code>. Add custom domain in Vercel dashboard.
              </li>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>Fly.io:</strong>{' '}
                <code>fly launch</code> in the folder → it generates a Dockerfile for Node →{' '}
                <code>fly secrets set ISSUER_PRIVATE_KEY_HEX=… INTERNAL_MINT_SECRET=…</code> →{' '}
                <code>fly deploy</code>.
              </li>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>Render / Railway:</strong> push to a GitHub repo, connect to Render or
                Railway, add the env vars in their dashboard, deploy auto-runs on push.
              </li>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>AWS Lambda + API Gateway:</strong> wrap the handler logic in a
                Lambda-compatible handler (or use{' '}
                <a href="https://github.com/awslabs/aws-lambda-web-adapter">aws-lambda-web-adapter</a>{' '}
                to run the http server as-is). Set env vars in Lambda config. Add custom domain
                via API Gateway → ACM.
              </li>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>GCP Cloud Run:</strong>{' '}
                <code>gcloud run deploy --source .</code>. Cloud Run reads PORT from env. Add
                env vars via{' '}
                <code>--set-env-vars</code> or in the console.
              </li>
              <li style={{ marginBottom: '0.25rem' }}>
                <strong>Self-hosted VPS / Docker:</strong> just{' '}
                <code>node server.js</code> behind nginx with Let's Encrypt. Point your domain
                at the VPS, you're done.
              </li>
            </ul>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <strong>What about the CRL, abuse reports, replay cache?</strong> The Worker
              template includes those. The minimal Node.js example above doesn't — those are
              v0.2 extensions. For v0.1 conformance (which is what verifiers check today),
              the directory + mint are sufficient. Add CRL + abuse handlers as you need them
              — see <a href="https://github.com/agentpki/real-issuer/tree/main/src">
                real-issuer/src
              </a> for reference implementations of each route in &lt;50 lines each.
            </p>
                  </>
                ),
              },
            ]}
          />

                  </>
                ),
              },
              {
                id: 'b',
                label: 'Path B — static JSON (verify-only, no minting)',
                color: {
                  text: 'rgb(110, 231, 183)',
                  bg: 'rgba(34, 197, 94, 0.18)',
                  border: 'rgba(34, 197, 94, 0.5)',
                },
                content: (
                  <>
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

          {/* One-click download for Path B — no copy/paste required */}
          <div
            className="card"
            style={{
              background: 'rgba(34, 197, 94, 0.06)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              marginTop: '1rem',
              marginBottom: '1rem',
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--success)' }}>
              ⚡ Fastest path — click to download, then upload
            </h3>
            <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              Your <code>agentpki-issuer.json</code> is auto-generated below. Download it,
              upload it to your static host at the path{' '}
              <code>/.well-known/agentpki-issuer.json</code>, done.
            </p>
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(
                JSON.stringify(
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
                ),
              )}`}
              download="agentpki-issuer.json"
              style={{
                display: 'inline-block',
                padding: '0.625rem 1.25rem',
                background: 'var(--success)',
                color: '#08080b',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                fontWeight: 500,
                fontSize: '0.9375rem',
              }}
            >
              ⬇ Download agentpki-issuer.json
            </a>
            <p className="dim small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <strong>Per-host upload paths:</strong>
            </p>
            <ul className="dim small" style={{ marginTop: '0.25rem', marginBottom: 0, paddingLeft: '1.25rem' }}>
              <li>
                <strong>Vercel / Netlify / Next.js / Astro:</strong> drop the file at{' '}
                <code>public/.well-known/agentpki-issuer.json</code> in your repo, commit, push.
                Auto-deploys at <code>https://{iss.domain}/.well-known/agentpki-issuer.json</code>.
              </li>
              <li>
                <strong>S3:</strong> upload with object key{' '}
                <code>.well-known/agentpki-issuer.json</code>, public-read ACL, set{' '}
                <code>Content-Type: application/json</code>.
              </li>
              <li>
                <strong>GitHub Pages:</strong> place at{' '}
                <code>.well-known/agentpki-issuer.json</code> in your published branch.
              </li>
              <li>
                <strong>Cloudflare Pages:</strong> drop into <code>public/.well-known/</code> in
                your repo. Auto-served on next deploy.
              </li>
            </ul>
          </div>

          <details style={{ marginBottom: '1rem' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Prefer to copy/paste the JSON manually? Expand for the original walkthrough.
            </summary>

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
          </details>
                  </>
                ),
              },
            ]}
          />

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
