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

const immutableCacheHeader = {
  key: 'Cache-Control',
  value: 'public, max-age=31536000, immutable',
};
const standaloneOutput = process.env.STORYFORGE_WEB_STANDALONE === '1' ? 'standalone' : undefined;

export async function storyforgeLegacyRedirects() {
  return [
    {
      source: '/studio',
      destination: '/ide?tab=legacy%3Astudio&active=legacy%3Astudio',
      permanent: true,
    },
    {
      source: '/retrieval',
      destination: '/ide?panel.left=search',
      permanent: true,
    },
    {
      source: '/runs',
      destination: '/ide?panel.bottom=runs',
      permanent: true,
    },
    {
      source: '/artifacts',
      destination: '/ide?panel.bottom=artifacts',
      permanent: true,
    },
    {
      source: '/evaluations',
      destination: '/ide?panel.bottom=evaluation',
      permanent: true,
    },
  ];
}

const nextConfig: NextConfig = {
  output: standaloneOutput,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/_next/static/(.*)', headers: [immutableCacheHeader] },
      { source: '/_next/image(.*)', headers: [immutableCacheHeader] },
      {
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ];
  },
  async redirects() {
    return storyforgeLegacyRedirects();
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
});
