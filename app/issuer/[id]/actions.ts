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

// Server actions that return structured results instead of throwing.
// Throwing crashes the page with a generic "server-side exception" in
// Next.js production. Returning lets the UI show a clear message inline.

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; seen?: string[] };

export async function verifyDomain(issuerId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return fail('You are not signed in. Refresh and try again.');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) return fail('Issuer not found.');

  const [proof] = await db.select().from(domainProofs).where(eq(domainProofs.issuerId, issuerId));
  if (!proof) return fail('No active domain-verification challenge for this issuer.');

  const dnsName = `_agentpki.${iss.domain}`;
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dnsName)}&type=TXT`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
  } catch (e) {
    await db
      .update(domainProofs)
      .set({ attemptedAt: new Date(), failureReason: `dns_fetch_error: ${(e as Error).message}` })
      .where(eq(domainProofs.id, proof.id));
    revalidatePath(`/issuer/${issuerId}`);
    return fail(`Couldn't reach Cloudflare DNS (${(e as Error).message}). Try again in a minute.`);
  }

  if (!res.ok) {
    await db
      .update(domainProofs)
      .set({ attemptedAt: new Date(), failureReason: `dns_http_${res.status}` })
      .where(eq(domainProofs.id, proof.id));
    revalidatePath(`/issuer/${issuerId}`);
    return fail(`Cloudflare DNS query returned HTTP ${res.status}. Try again in a minute.`);
  }

  const dnsJson = (await res.json()) as { Answer?: Array<{ data: string }> };
  const txtRecords = (dnsJson.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, ''));
  const matched = txtRecords.some((r) => r === proof.challengeToken);

  if (!matched) {
    await db
      .update(domainProofs)
      .set({
        attemptedAt: new Date(),
        failureReason: `TXT not found. Saw: ${txtRecords.slice(0, 5).join(', ') || '(no records)'}`,
      })
      .where(eq(domainProofs.id, proof.id));
    revalidatePath(`/issuer/${issuerId}`);
    return {
      ok: false,
      error:
        txtRecords.length === 0
          ? `No TXT records found at ${dnsName}. Add the record at Cloudflare DNS, wait ~30 seconds for propagation, then click Verify again.`
          : `TXT record at ${dnsName} doesn't match the challenge token. Check the value matches exactly (no quotes, no whitespace).`,
      seen: txtRecords.slice(0, 5),
    };
  }

  // Success
  await db
    .update(domainProofs)
    .set({ attemptedAt: new Date(), succeededAt: new Date(), failureReason: null })
    .where(eq(domainProofs.id, proof.id));
  await db.update(issuers).set({ domainVerified: true }).where(eq(issuers.id, issuerId));

  revalidatePath(`/issuer/${issuerId}`);
  return { ok: true };
}

export async function generateKey(issuerId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return fail('You are not signed in.');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) return fail('Issuer not found.');
  if (!iss.domainVerified) return fail('Verify your domain first before generating a signing key.');

  const { privateKey, publicKey } = generateKeyPair();
  const now = new Date();
  const validTo = new Date(now.getTime() + FIVE_YEARS_MS);
  const kid = `${iss.domain.replace(/\./g, '-')}-${now.getFullYear()}-q${Math.floor((now.getMonth() / 3)) + 1}-${util.randomHex(4)}`;

  let encrypted: string;
  try {
    encrypted = await encryptBytes(privateKey);
  } catch (e) {
    return fail(`Encryption failed: ${(e as Error).message}`);
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
  return { ok: true };
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
