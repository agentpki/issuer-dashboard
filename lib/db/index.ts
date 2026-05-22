// Postgres client — Neon serverless driver + Drizzle ORM.
//
// The Neon driver is HTTP-based (no persistent TCP connections), which
// matches Next.js serverless / edge deployment perfectly.
//
// IMPORTANT: We use a Proxy + lazy initialization so importing this module
// does NOT throw at build time if DATABASE_URL is missing. Next.js traces
// module imports during `next build`; a thrown error in module scope kills
// the build even when the page wouldn't actually run at build time.
// The DB connects on the first `db.<anything>` property access.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. See .env.example for the format. ' +
        'In Vercel: Project Settings → Environment Variables.',
    );
  }
  _db = drizzle(neon(url), { schema });
  return _db;
}

// Proxy preserves the same `db.select(...)`, `db.insert(...)`, etc. call sites
// while deferring real initialization until first access.
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
}) as DrizzleDb;

export * from './schema.js';
