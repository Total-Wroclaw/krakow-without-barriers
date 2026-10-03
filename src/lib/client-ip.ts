// Client address for rate limiting.
//
// Deployment assumption (see docs/ARCHITECTURE.md, "Bezpieczeństwo"): the app is only reachable through our reverse proxy
// (Traefik, optionally behind Cloudflare). Clients can put anything in X-Forwarded-For; each proxy
// *appends* the address it received the connection from, so only the LAST entry was written by our
// own proxy and cannot be forged. Cloudflare sets CF-Connecting-IP itself (overwriting any client value),
// so it is preferred when present. If the app were exposed directly, both headers would be client-controlled;
// do not publish the Node port.
//
// Requests without either header (local dev, tests, direct calls) share the 'local' bucket.

const MAX = 64;
const clean = (value: string | null | undefined) => {
  const v = value?.trim();
  return v && v.length <= MAX && /^[0-9a-fA-F:.]+$/.test(v) ? v : '';
};

export function clientIp(request: Request): string {
  const cf = clean(request.headers.get('cf-connecting-ip'));
  if (cf) return cf;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').map(s => s.trim()).filter(Boolean).pop();
    // Keep non-IP tokens usable as a key (e.g. tests), but bounded.
    if (last) return clean(last) || last.slice(0, MAX);
  }
  return 'local';
}
