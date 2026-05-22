import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db, issuers } from '@/lib/db';
import { eq } from 'drizzle-orm';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const myIssuers = await db.select().from(issuers).where(eq(issuers.ownerId, session.user.id));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Your issuers</h1>
        <Link href="/issuer/new" className="btn primary">
          + New issuer
        </Link>
      </div>

      {myIssuers.length === 0 ? (
        <div className="card" style={{ marginTop: '2rem', textAlign: 'center' }}>
          <p className="muted">You haven't registered any issuers yet.</p>
          <p className="dim">
            An issuer is your company's domain (e.g., <code>your-co.com</code>) that mints
            AgentPKI passports for the agents you operate. Start by claiming a domain.
          </p>
          <Link href="/issuer/new" className="btn primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
            Claim your first domain
          </Link>
        </div>
      ) : (
        <table style={{ marginTop: '2rem' }}>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Name</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {myIssuers.map((iss) => (
              <tr key={iss.id}>
                <td className="mono">{iss.domain}</td>
                <td>{iss.name}</td>
                <td>T{iss.tier}</td>
                <td>
                  {iss.domainVerified ? (
                    <span style={{ color: 'var(--success)' }}>✓ Verified</span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>Pending DNS</span>
                  )}
                </td>
                <td className="dim">{iss.createdAt.toISOString().slice(0, 10)}</td>
                <td>
                  <Link href={`/issuer/${iss.id}`}>Manage →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
