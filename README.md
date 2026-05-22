# @agentpki/issuer-dashboard

Self-serve issuer onboarding for AgentPKI. Agent builders sign up, claim a domain via DNS TXT proof, generate Ed25519 signing keys, and download the config needed to run their own [real-issuer Worker](https://github.com/agentpki/real-issuer).

> **Production caveat:** unlike the rest of the AgentPKI stack, this dashboard touches a Postgres schema + real signing keys. **Do not push schema changes directly to production**. Use `pnpm db:push` against a staging DB first, then promote. AES-encrypted key storage is a defense-in-depth measure, not a substitute for a proper HSM/KMS — see the migration path in `lib/crypto.ts`.

- **Spec:** https://agentpki.dev/spec/v0.1
- **Companion repo:** https://github.com/agentpki/real-issuer

## Stack

- **Next.js 15** App Router, Server Components, Server Actions
- **NextAuth.js v5** with email magic-link via [Resend](https://resend.com)
- **Drizzle ORM** + **Neon Postgres** (serverless HTTP driver)
- **AES-256-GCM** at rest for private signing keys
- **@agentpki/sdk** for key generation + passport signing

## Setup

### 1. Create a Neon Postgres database

[console.neon.tech](https://console.neon.tech) → new project → copy the **pooled** connection string.

### 2. Sign up for Resend

[resend.com](https://resend.com) → verify the `agentpki.dev` domain → generate an API key.

### 3. Configure `.env.local`

```bash
cp .env.example .env.local
# fill in DATABASE_URL, RESEND_API_KEY, NEXTAUTH_SECRET, KEY_ENCRYPTION_KEY
```

Generate the secrets:

```bash
# NextAuth session secret (32 random bytes, base64):
openssl rand -base64 32

# AES key for at-rest encryption of signing keys:
openssl rand -base64 32
```

**Treat `KEY_ENCRYPTION_KEY` as load-bearing — losing it makes every stored private key unrecoverable.**

### 4. Push the schema

```bash
pnpm install
pnpm db:push
```

This creates the 8 tables (NextAuth's 4 + AgentPKI's 4) in your Neon DB.

### 5. Run locally

```bash
pnpm dev
# http://localhost:3000
```

Sign in with your email → check your inbox → click the magic link → land on the dashboard.

### 6. Deploy

**Vercel (easiest):**

```bash
vercel
```

Set the same env vars in the Vercel dashboard. The Neon driver works on Vercel's serverless functions out of the box.

**Cloudflare Pages (alternative):**

```bash
pnpm add -D @cloudflare/next-on-pages
npx @cloudflare/next-on-pages
wrangler pages deploy .vercel/output/static --project-name=agentpki-issuer-dashboard
```

Set env vars via `wrangler pages secret put <NAME>` for each.

## User flow

1. **Sign in** at `/` — magic-link email from Resend
2. **Dashboard** at `/dashboard` — list of issuers you own
3. **Register issuer** at `/issuer/new` — provide domain + display name
4. **Verify domain** — publish a `_agentpki.<domain>` TXT record; dashboard checks it via Cloudflare DNS-over-HTTPS
5. **Generate first key** — Ed25519 keypair created server-side, private half AES-encrypted in Postgres
6. **Download config** — copy the env vars / static JSON for your `real-issuer` Worker deployment

The dashboard never displays the raw private key in the UI. A future "reveal key" flow with 2FA confirmation is on the v0.2 list.

## Schema

8 tables (see [`lib/db/schema.ts`](./lib/db/schema.ts)):

- `users`, `accounts`, `sessions`, `verification_tokens` — NextAuth
- `issuers` — one row per registered domain
- `issuer_keys` — Ed25519 keys (private half AES-encrypted)
- `domain_proofs` — TXT-record challenges + verification log
- `mint_audit` — append-only log of every passport minted via API (v0.2; the schema is in place but the mint endpoint moves to the real-issuer Worker)

## Security posture

| Concern | v0.1 alpha | v0.2 target |
|---|---|---|
| Private key storage | AES-256-GCM at rest, `KEY_ENCRYPTION_KEY` env var | GCP Cloud KMS-wrapped KEK (master key never in plaintext memory) |
| Auth | Email magic link via Resend | Add WebAuthn / passkeys |
| Multi-tenancy | One owner per issuer (no teams) | Org/team membership, role-based access |
| Audit | Mint audit table (v0.2) | Real-time SIEM export |
| Schema migrations | `pnpm db:push` against prod | Generated migrations checked into `drizzle/`, promoted via CI |

## License

MIT. Companion code to the AgentPKI Protocol (Apache 2.0).
