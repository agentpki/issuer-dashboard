// Postgres schema for the AgentPKI issuer dashboard.
//
// Tables:
//   users         — owners of issuers (NextAuth-managed)
//   accounts      — NextAuth OAuth account links (not used yet but required)
//   sessions      — NextAuth sessions
//   verification_tokens — NextAuth magic-link tokens
//   issuers       — registered issuers (one per domain)
//   issuer_keys   — Ed25519 signing keys per issuer (AES-encrypted at rest)
//   domain_proofs — TXT-record proof attempts for T1 domain verification
//   mint_audit    — append-only log of every passport minted via the API

import {
  pgTable,
  text,
  timestamp,
  integer,
  primaryKey,
  uuid,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';

// ─── NextAuth tables ─────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// ─── AgentPKI domain tables ──────────────────────────────────────────

export const issuers = pgTable('issuers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(), // e.g., "anthropic.com"
  name: text('name').notNull(),               // human label, e.g., "Anthropic, PBC"
  tier: integer('tier').notNull().default(1),  // 1=DNS, 2=KYB, 3=hardware
  domainVerified: boolean('domain_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const issuerKeys = pgTable('issuer_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id')
    .notNull()
    .references(() => issuers.id, { onDelete: 'cascade' }),
  kid: text('kid').notNull(),
  algorithm: text('algorithm').notNull().default('Ed25519'),
  publicKeyHex: text('public_key_hex').notNull(),
  publicKeySpkiB64: text('public_key_spki_b64').notNull(),
  // AES-256-GCM ciphertext of the 32-byte private key seed.
  // Format: base64(iv || ciphertext || tag).
  privateKeyEncrypted: text('private_key_encrypted').notNull(),
  validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validTo: timestamp('valid_to', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const domainProofs = pgTable('domain_proofs', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id')
    .notNull()
    .references(() => issuers.id, { onDelete: 'cascade' }),
  // Token the user must publish at _agentpki.<domain> as a TXT record.
  challengeToken: text('challenge_token').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
  succeededAt: timestamp('succeeded_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mintAudit = pgTable('mint_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  issuerId: uuid('issuer_id')
    .notNull()
    .references(() => issuers.id, { onDelete: 'cascade' }),
  keyId: uuid('key_id')
    .notNull()
    .references(() => issuerKeys.id, { onDelete: 'cascade' }),
  jti: text('jti').notNull(),
  sub: text('sub').notNull(),
  scope: jsonb('scope').$type<string[]>(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Issuer = typeof issuers.$inferSelect;
export type IssuerKey = typeof issuerKeys.$inferSelect;
