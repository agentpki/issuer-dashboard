import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers, issuerKeys } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { decryptBytes } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

export default async function RevealPrivateKey({
  params,
}: {
  params: Promise<{ id: string; kid: string }>;
}) {
  const { id, kid } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, id));
  if (!iss || iss.ownerId !== session.user.id) notFound();

  const [key] = await db
    .select()
    .from(issuerKeys)
    .where(and(eq(issuerKeys.issuerId, id), eq(issuerKeys.kid, kid)));
  if (!key) notFound();

  let hex: string;
  let decryptError: string | null = null;
  try {
    const plain = await decryptBytes(key.privateKeyEncrypted);
    hex = bytesToHex(plain);
  } catch (e) {
    hex = '';
    decryptError = (e as Error).message;
  }

  return (
    <>
      <p>
        <Link href={`/issuer/${id}`}>← Back to issuer</Link>
      </p>
      <h1>Reveal private key</h1>
      <p className="muted">
        KID: <code className="mono">{key.kid}</code>
      </p>

      <div
        className="card"
        style={{
          background: 'rgba(248, 113, 113, 0.06)',
          border: '1px solid rgba(248, 113, 113, 0.4)',
        }}
      >
        <p style={{ marginTop: 0, color: 'var(--danger)', fontWeight: 600 }}>
          ⚠ Treat this value as a top-secret credential
        </p>
        <ul style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 0 }}>
          <li>Anyone with this hex can mint passports as <code>{iss.domain}</code>.</li>
          <li>Paste it into your Cloudflare Worker as an encrypted secret (<code>wrangler secret put ISSUER_PRIVATE_KEY_HEX</code>) — never commit it to git.</li>
          <li>Close this tab as soon as you've copied it. The value will re-display if you reload, but every reload is one more place it could leak.</li>
          <li>If you suspect compromise, revoke this key on the issuer page and generate a new one.</li>
        </ul>
      </div>

      {decryptError ? (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>
            Decryption failed: {decryptError}
          </p>
          <p className="dim small" style={{ margin: '0.5rem 0 0' }}>
            This usually means <code>KEY_ENCRYPTION_KEY</code> is missing or different from the
            value used when the key was generated. Check Vercel env vars.
          </p>
        </div>
      ) : (
        <>
          <h2>Private key (hex)</h2>
          <pre
            className="mono"
            style={{
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
              background: 'var(--surface-2)',
              padding: '1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
          >
            {hex}
          </pre>

          <h2>Wrangler one-liner</h2>
          <p className="muted small">
            From your forked <code>real-issuer</code> Worker directory, with{' '}
            <code>wrangler</code> authenticated:
          </p>
          <pre>{`echo "${hex}" | wrangler secret put ISSUER_PRIVATE_KEY_HEX`}</pre>

          <h2>Plain (non-secret) env vars</h2>
          <p className="muted small">
            Set these in <code>wrangler.toml</code> under <code>[vars]</code>:
          </p>
          <pre>{`ISSUER_DOMAIN  = "${iss.domain}"
ISSUER_NAME    = "${iss.name}"
ISSUER_TIER    = "${iss.tier}"
KID            = "${key.kid}"
KEY_VALID_FROM = "${Math.floor(key.validFrom.getTime() / 1000)}"
KEY_VALID_TO   = "${Math.floor(key.validTo.getTime() / 1000)}"`}</pre>
        </>
      )}
    </>
  );
}
