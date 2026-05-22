'use server';

import { auth } from '@/lib/auth';
import { db, issuers, issuerKeys, domainProofs } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  generateKeyPair,
  publicKeyToSpkiBase64,
  util,
} from '@agentpki/sdk';
import { encryptBytes } from '@/lib/crypto';

const FIVE_YEARS_MS = 5 * 365 * 86400 * 1000;

// Form-friendly server actions: return Promise<void>, communicate failure
// state via the domain_proofs.failure_reason column + revalidatePath. The
// page re-renders, reads the column, and shows the inline failure banner.
// Throwing would crash the page with a generic "server-side exception".

export async function verifyDomain(issuerId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) return;

  const [proof] = await db.select().from(domainProofs).where(eq(domainProofs.issuerId, issuerId));
  if (!proof) return;

  const dnsName = `_agentpki.${iss.domain}`;
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dnsName)}&type=TXT`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
  } catch (e) {
    await recordFailure(proof.id, `Couldn't reach Cloudflare DNS: ${(e as Error).message}`);
    revalidatePath(`/issuer/${issuerId}`);
    return;
  }

  if (!res.ok) {
    await recordFailure(proof.id, `Cloudflare DNS query returned HTTP ${res.status}. Try again in a minute.`);
    revalidatePath(`/issuer/${issuerId}`);
    return;
  }

  const dnsJson = (await res.json()) as { Answer?: Array<{ data: string }> };
  const txtRecords = (dnsJson.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, ''));
  const matched = txtRecords.some((r) => r === proof.challengeToken);

  if (!matched) {
    const why =
      txtRecords.length === 0
        ? `No TXT records found at ${dnsName}. Did you add the record at Cloudflare DNS yet? Propagation usually takes 30 seconds.`
        : `TXT records exist at ${dnsName} but none match the challenge token. Saw: ${txtRecords.slice(0, 3).join(', ')}. Check the Content field exactly — no quotes, no extra whitespace.`;
    await recordFailure(proof.id, why);
    revalidatePath(`/issuer/${issuerId}`);
    return;
  }

  // Success — clear any prior failure and mark verified
  await db
    .update(domainProofs)
    .set({ attemptedAt: new Date(), succeededAt: new Date(), failureReason: null })
    .where(eq(domainProofs.id, proof.id));
  await db.update(issuers).set({ domainVerified: true }).where(eq(issuers.id, issuerId));

  revalidatePath(`/issuer/${issuerId}`);
}

export async function generateKey(issuerId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) return;
  if (!iss.domainVerified) return;

  const { privateKey, publicKey } = generateKeyPair();
  const now = new Date();
  const validTo = new Date(now.getTime() + FIVE_YEARS_MS);
  const kid = `${iss.domain.replace(/\./g, '-')}-${now.getFullYear()}-q${Math.floor(now.getMonth() / 3) + 1}-${util.randomHex(4)}`;

  let encrypted: string;
  try {
    encrypted = await encryptBytes(privateKey);
  } catch {
    // Encryption failure is rare (only if KEY_ENCRYPTION_KEY is misconfigured).
    // Surface via a future "system_errors" log; for v0.1 alpha just return.
    return;
  }

  await db.insert(issuerKeys).values({
    issuerId: iss.id,
    kid,
    algorithm: 'Ed25519',
    publicKeyHex: bytesToHex(publicKey),
    publicKeySpkiB64: publicKeyToSpkiBase64(publicKey),
    privateKeyEncrypted: encrypted,
    validFrom: now,
    validTo,
  });

  revalidatePath(`/issuer/${issuerId}`);
}

async function recordFailure(proofId: string, reason: string): Promise<void> {
  await db
    .update(domainProofs)
    .set({ attemptedAt: new Date(), failureReason: reason })
    .where(eq(domainProofs.id, proofId));
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
