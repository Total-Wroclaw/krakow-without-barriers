import type { NextConfig } from 'next';

// Security headers. No script/style CSP on purpose: MapLibre needs blob: workers and tiles come from
// OpenFreeMap and our own /api/tiles proxy; only framing is restricted.
// /embed is the partner widget and must stay embeddable on any site (frame-ancestors *, no X-Frame-Options);
// partners grant location with <iframe allow="geolocation">, which geolocation=(self) permits for our origin.
const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
  // Browsers only honour it over HTTPS, so local http:// development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
 turbopack: { root: process.cwd() }, poweredByHeader: false,
 outputFileTracingExcludes: { '/api/**': ['.runtime/**/*', '.env*', 'artifacts/**/*'] },
 async headers() {
  return [
   // Everything except /embed and /embed/…
   { source: '/:path((?!embed(?:/|$)).*)', headers: [...common, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }] },
   { source: '/embed', headers: [...common, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
   { source: '/embed/:path*', headers: [...common, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
  ];
 },
};
export default config;
