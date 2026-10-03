// Language of API error messages: explicit `locale` (JSON body, then ?locale=), else Accept-Language, else Polish.
import { defaultLocale, isLocale, locales, type Locale } from './locales';
import { serverMessages } from './server-messages';

/** Best supported language from an Accept-Language header ("de-DE,de;q=0.9,en;q=0.8" → 'de'). */
export function acceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter(x => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.find(x => (locales as readonly string[]).includes(x.lang))?.lang as Locale | undefined ?? null;
}

export function requestLocale(request: Request, body?: unknown): Locale {
  const fromBody = body && typeof body === 'object' ? (body as { locale?: unknown }).locale : undefined;
  if (isLocale(fromBody)) return fromBody;
  let fromQuery: string | null = null;
  try {
    fromQuery = new URL(request.url).searchParams.get('locale');
  } catch {}
  if (isLocale(fromQuery)) return fromQuery;
  return acceptLanguage(request.headers.get('accept-language')) ?? defaultLocale;
}

/** API messages for this request. */
export function apiMessages(request: Request, body?: unknown) {
  return serverMessages(requestLocale(request, body)).api;
}
