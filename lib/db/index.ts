// Postgres client — Neon serverless driver + Drizzle ORM.
//
// The Neon driver is HTTP-based (no persistent TCP connections), which
// matches Next.js serverless / edge deployment perfectly.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See .env.example.');
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });

export * from './schema.js';
