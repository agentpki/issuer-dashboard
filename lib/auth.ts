// NextAuth.js v5 configuration — email magic-link via Resend.
//
// We use the Drizzle adapter so user/account/session/verificationToken
// tables live in the same Neon Postgres database as the issuer data.

import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { Resend } from 'resend';
import { db } from './db';
import { users, accounts, sessions, verificationTokens } from './db/schema';

const resend = new Resend(process.env.RESEND_API_KEY);

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  trustHost: true,
  providers: [
    {
      id: 'resend-magic-link',
      name: 'Email',
      type: 'email',
      from: process.env.EMAIL_FROM ?? 'hello@agentpki.dev',
      maxAge: 24 * 60 * 60, // 24h magic-link validity
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        // Vary subject per-send so Gmail's duplicate-detection / promotions-clustering
        // doesn't bury repeat sign-in attempts. Without this, the second magic link
        // to the same recipient lands in Spam / Promotions / All Mail instead of Inbox.
        const code = shortCode();
        const sentAtUtc = new Date().toUTCString();
        const { error } = await resend.emails.send({
          from: provider.from ?? 'AgentPKI <hello@agentpki.dev>',
          to: identifier,
          subject: `Sign in to AgentPKI — code ${code}`,
          html: magicLinkHtml(url, code, sentAtUtc),
          text: magicLinkText(url, code, sentAtUtc),
          headers: {
            // Tells Gmail this is transactional, not bulk — bypasses Promotions clustering.
            'X-Entity-Ref-ID': code,
            'List-Unsubscribe': '<mailto:hello@agentpki.dev?subject=unsubscribe>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (error) throw new Error(`Resend error: ${error.message}`);
      },
    },
  ],
  pages: {
    signIn: '/',
    verifyRequest: '/auth/check-email',
  },
});

function magicLinkHtml(url: string, code: string, sentAtUtc: string): string {
  return `
    <!DOCTYPE html>
    <html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;color:#1c1c20;">
      <h1 style="font-size:22px;">Sign in to AgentPKI</h1>
      <p>Click the link below to sign in. It expires in 24 hours and works once.</p>
      <p style="margin:24px 0;">
        <a href="${url}" style="background:#a78bfa;color:#08080b;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500;">Sign in</a>
      </p>
      <p style="font-size:13px;color:#6b6b78;">If you didn't request this email, you can ignore it.</p>
      <p style="font-size:11px;color:#9c9cab;margin-top:32px;">AgentPKI · cryptographic identity for AI agents · agentpki.dev</p>
      <p style="font-size:11px;color:#c0c0c8;margin-top:8px;">Request code: ${code} · ${sentAtUtc}</p>
    </body></html>
  `;
}

function magicLinkText(url: string, code: string, sentAtUtc: string): string {
  return `Sign in to AgentPKI:\n\n${url}\n\nThis link expires in 24 hours and works once.\n\nRequest code: ${code}\nSent: ${sentAtUtc}`;
}

// Short random alphanumeric code — purely to differentiate Subject lines
// between consecutive sign-in attempts so Gmail doesn't cluster duplicates.
// NOT cryptographic; the magic-link token already provides security.
function shortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous (no 0/O/1/I)
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
