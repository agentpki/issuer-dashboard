import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    // Allow server actions called from anywhere — for v0.1 demo only.
    // Production: list allowed origins explicitly.
    serverActions: { allowedOrigins: ['localhost:3000', 'issuer.agentpki.dev'] },
  },
  // The @agentpki/sdk is published ESM-only
  transpilePackages: ['@agentpki/sdk'],
};

export default config;
