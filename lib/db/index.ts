// Postgres client — Neon serverless driver + Drizzle ORM.
//
// The Neon driver is HTTP-based (no persistent TCP connections), so the
// `neon(url)` call doesn't actually connect — it just stores the URL.
// Real connections happen on the first query. This means we can hand a
// placeholder URL to Drizzle at module load WITHOUT breaking the build,
// even when DATABASE_URL isn't set in the build environment.
//
// Pages that actually run a query at runtime will hit the real DATABASE_URL
// (which Vercel passes through to runtime env). If DATABASE_URL is missing
// at runtime, the query fails with a clear connection error.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const url =
  process.env.DATABASE_URL ??
  // Placeholder — only used during builds where DATABASE_URL isn't set.
  // Runtime always uses the real env var; if it's missing, queries fail
  // with a clear connection error rather than crashing the build.
  'postgres://build_only:build_only@localhost:5432/build_only';

const sql = neon(url);
export const db = drizzle(sql, { schema });

export * from './schema';
