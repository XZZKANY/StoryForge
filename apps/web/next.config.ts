import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const apiUrl = process.env.STORYFORGE_API_BASE_URL ?? 'http://127.0.0.1:8000';
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const sentryOrigin = sentryDsn ? new URL(sentryDsn).origin : '';

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${apiUrl} ${sentryOrigin}`.trim(),
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspDirectives.join('; ') },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
