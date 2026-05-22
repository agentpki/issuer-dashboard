'use server';

import { auth } from '@/lib/auth';
import { db, issuers, domainProofs } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { util } from '@agentpki/sdk';

export async function createIssuer(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthorized');

  const domain = String(formData.get('domain') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const tier = parseInt(String(formData.get('tier') ?? '1'), 10);

  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    throw new Error('Invalid domain shape.');
  }
  if (!name || name.length < 2) throw new Error('Name required.');
  if (![1, 2, 3].includes(tier)) throw new Error('Invalid tier.');

  // Check global uniqueness — each domain is claimable by exactly one user
  const existing = await db.select().from(issuers).where(eq(issuers.domain, domain));
  if (existing.length > 0) {
    throw new Error(
      `Domain "${domain}" is already registered. If it's yours, contact hello@agentpki.dev for transfer.`,
    );
  }

  // Insert issuer + generate DNS challenge token
  const challengeToken = `agentpki-verify-${util.randomHex(12)}`;
  const [inserted] = await db
    .insert(issuers)
    .values({
      ownerId: session.user.id,
      domain,
      name,
      tier,
      domainVerified: false,
    })
    .returning();

  if (!inserted) throw new Error('Failed to register issuer.');

  await db.insert(domainProofs).values({
    issuerId: inserted.id,
    challengeToken,
  });

  redirect(`/issuer/${inserted.id}`);
}
