// NextAuth v5 route handler — wires up /api/auth/* (signin, callback, signout, session, etc.)
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
