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

export async function verifyDomain(issuerId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthorized');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) throw new Error('not_found');

  const [proof] = await db.select().from(domainProofs).where(eq(domainProofs.issuerId, issuerId));
  if (!proof) throw new Error('no_active_challenge');

  // Query Cloudflare DNS-over-HTTPS for the TXT record at _agentpki.<domain>
  const dnsName = `_agentpki.${iss.domain}`;
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dnsName)}&type=TXT`;
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
  if (!res.ok) {
    await db
      .update(domainProofs)
      .set({ attemptedAt: new Date(), failureReason: `dns_http_${res.status}` })
      .where(eq(domainProofs.id, proof.id));
    throw new Error('DNS lookup failed. Try again in a minute.');
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
    throw new Error(`Challenge token not found in TXT records at ${dnsName}.`);
  }

  // Success — mark issuer verified
  await db
    .update(domainProofs)
    .set({ attemptedAt: new Date(), succeededAt: new Date(), failureReason: null })
    .where(eq(domainProofs.id, proof.id));
  await db.update(issuers).set({ domainVerified: true }).where(eq(issuers.id, issuerId));

  revalidatePath(`/issuer/${issuerId}`);
}

export async function generateKey(issuerId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthorized');

  const [iss] = await db.select().from(issuers).where(eq(issuers.id, issuerId));
  if (!iss || iss.ownerId !== session.user.id) throw new Error('not_found');
  if (!iss.domainVerified) throw new Error('domain_not_verified');

  const { privateKey, publicKey } = generateKeyPair();
  const now = new Date();
  const validTo = new Date(now.getTime() + FIVE_YEARS_MS);
  const kid = `${iss.domain.replace(/\./g, '-')}-${now.getFullYear()}-q${Math.floor((now.getMonth() / 3)) + 1}-${util.randomHex(4)}`;

  const encrypted = await encryptBytes(privateKey);

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

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
