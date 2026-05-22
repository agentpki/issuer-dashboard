import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function IssuerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/');

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/dashboard" style={{ fontWeight: 500 }}>
            AgentPKI Dashboard
          </Link>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <span className="dim">{session.user.email}</span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
            >
              <button type="submit" style={{ padding: '0.375rem 0.875rem', fontSize: '0.875rem' }}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
      <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
        {children}
      </main>
    </>
  );
}
