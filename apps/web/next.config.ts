import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Strict CSP without nonces (no proxy.ts in this app's UI slice). Scripts are limited to
 * same-origin files; Next's inline RSC bootstrap needs 'unsafe-inline' until a nonce
 * proxy exists (see docs/DECISIONS.md A13). No third-party origin is allowed anywhere:
 * no CDN fonts, no analytics, no remote images.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@civic-ledger/core', '@civic-ledger/db'],
  // Native/WASM database drivers stay as runtime requires on the server.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  poweredByHeader: false,
  // The repo's AGENTS.md / CLAUDE.md are the agent instructions; don't generate another.
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
