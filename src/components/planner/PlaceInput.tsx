'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Building2, Clock3, LoaderCircle, LocateFixed, MapPin, Route, TramFront, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { pointSchema, type CityPlace } from '@/lib/city-types';
import type { PlaceSuggestion } from '@/lib/journey-types';
import { useMediaQuery } from '@/hooks/use-media-query';
import { errorText } from '@/lib/client';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

const RECENT_KEY = 'krok-recent-places-v1';

export function readRecent(): PlaceSuggestion[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]').slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberPlace(place: PlaceSuggestion) {
  if (place.kind === 'current') return;
  try {
    const next = [place, ...readRecent().filter(p => p.id !== place.id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

const kindIcon = { address: Building2, street: Route, poi: MapPin, stop: TramFront, current: LocateFixed };

export async function locateMe(t: (key: MessageKey, vars?: Record<string, string>) => string): Promise<PlaceSuggestion> {
  if (!navigator.geolocation) throw new Error(t('search.noGeo'));
  const position = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }),
  ).catch(() => {
    throw new Error(t('search.geoDenied'));
  });
  const point = { lat: position.coords.latitude, lon: position.coords.longitude };
  if (!pointSchema.safeParse(point).success) throw new Error(t('search.outside'));
  let detail = t('search.gpsDetail');
  try {
    const res = await fetch(`/api/places?reverse=1&lat=${point.lat}&lon=${point.lon}`);
    const data = await res.json();
    if (res.ok && data.place?.name) detail = t('search.near', { name: data.place.name });
  } catch {}
  return { id: `point:${point.lat}:${point.lon}`, name: t('search.myLocation'), detail, source: 'GPS', kind: 'current', ...point };
}

type Props = {
  label: string;
  placeholder: string;
  value: CityPlace | null;
  onChange: (place: PlaceSuggestion | null) => void;
  marker: 'start' | 'end';
  near?: { lat: number; lon: number } | null;
  onError: (message: string) => void;
  /** Reports when the suggestion list opens or closes (phones switch to a full-screen search). */
  onActiveChange?: (active: boolean) => void;
};

export function PlaceInput({ label, placeholder, value, onChange, marker, near, onError, onActiveChange }: Props) {
  // On phones the list renders inline: a popover would flip above the field when the keyboard is open.
  const inline = useMediaQuery('(max-width: 1023px)');
  const { t, locale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ query: string; places: PlaceSuggestion[] }>({ query: '', places: [] });
  const [recent, setRecent] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [touched, setTouched] = useState(false);
  const hintId = useId();

  useEffect(() => setQuery(value?.name ?? ''), [value]);
  useEffect(() => onActiveChange?.(open), [open, onActiveChange]);

  // cmdk always reports an expanded list; the list here lives in a popover that may be closed.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute('aria-expanded', String(open));
    if (!open) input.removeAttribute('aria-controls');
  });

  const typed = query.trim();
  // Text typed but never picked from the list does not count as a place; say so instead of silently showing nothing.
  const unresolved = touched && !open && typed.length > 0 && typed !== value?.name;
  const searching = open && typed.length >= 2 && typed !== value?.name;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const params = new URLSearchParams({ q: typed, locale });
        if (near) params.set('lat', String(near.lat)), params.set('lon', String(near.lon));
        const res = await fetch(`/api/places?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error();
        setResults({ query: typed, places: data.places });
      } catch (e) {
        if (!controller.signal.aborted) {
          setFailed(true);
          setResults({ query: typed, places: [] });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed, searching, near, locale]);

  function choose(place: PlaceSuggestion) {
    rememberPlace(place);
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    // Close the on-screen keyboard so the routes become visible.
    if (inline) inputRef.current?.blur();
  }

  async function useLocation() {
    setLocating(true);
    try {
      choose(await locateMe(t));
    } catch (e) {
      onError(errorText(e, t('search.geoFailed')));
    } finally {
      setLocating(false);
    }
  }

  const settled = results.query === typed;
  const list = searching ? results.places : [];

  const hint = unresolved ? (
    <p id={hintId} className="px-3 pb-1.5 text-sm font-medium text-barrier">
      {t('search.pickFromList')}
    </p>
  ) : null;

  const field = (
    <div className="flex min-h-12 items-center gap-3 rounded-lg px-3 focus-within:bg-accent/60 focus-within:ring-2 focus-within:ring-ring">
      <span
        aria-hidden="true"
        className={cn(
          'size-3 shrink-0 rounded-full border-[3px]',
          marker === 'start' ? 'border-ink bg-white' : 'border-primary bg-primary',
        )}
      />
      <span aria-hidden="true" onClick={() => inputRef.current?.focus()} className="w-12 shrink-0 text-sm text-muted-foreground">
        {label}
      </span>
      <CommandPrimitive.Input
        ref={inputRef}
        value={query}
        onValueChange={text => {
          setQuery(text);
          setOpen(true);
        }}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false);
          else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) setOpen(true);
        }}
        onBlur={() => {
          if (inline) setTimeout(() => setOpen(false), 150);
          setTouched(true);
        }}
        aria-describedby={unresolved ? hintId : undefined}
        aria-invalid={unresolved || undefined}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="h-12 min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:outline-none"
      />
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground" /> : null}
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            onChange(null);
            inputRef.current?.focus();
          }}
          className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label={t('search.clear', { label })}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );

  const suggestions = (
    <CommandList className={inline ? "max-h-[60svh]" : "max-h-[min(22rem,55svh)]"}>
      {searching && settled && !loading && !list.length ? (
        <CommandEmpty>{failed ? t('search.failed') : t('search.empty')}</CommandEmpty>
      ) : null}
      {!searching ? (
        <CommandGroup>
          <CommandItem value="__current" onSelect={useLocation} className="min-h-12 gap-3">
            {locating ? <LoaderCircle className="animate-spin text-primary" /> : <LocateFixed className="text-primary" />}
            <span className="font-medium">{t('search.myLocation')}</span>
          </CommandItem>
        </CommandGroup>
      ) : null}
      {!searching && recent.length ? (
        <CommandGroup heading={t('search.recent')}>
          {recent.map(place => (
            <Suggestion key={`recent-${place.id}`} place={place} onSelect={choose} recent />
          ))}
        </CommandGroup>
      ) : null}
      {list.length ? (
        <CommandGroup heading={t('search.results')}>
          {list.map(place => (
            <Suggestion key={place.id} place={place} onSelect={choose} />
          ))}
        </CommandGroup>
      ) : null}
    </CommandList>
  );

  if (inline) {
    return (
      <Command label={label} shouldFilter={false} loop className="overflow-visible bg-transparent">
        {field}
        {hint}
        {open ? (
          // Keep focus in the input while tapping a suggestion.
          <div className="mx-1 mt-1 overflow-hidden rounded-xl border bg-popover shadow-sm" onMouseDown={e => e.preventDefault()}>
            {suggestions}
          </div>
        ) : null}
      </Command>
    );
  }

  return (
    <Command label={label} shouldFilter={false} loop className="overflow-visible bg-transparent">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>{field}</PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => {
            if (e.target instanceof Node && inputRef.current?.parentElement?.contains(e.target)) e.preventDefault();
          }}
          className="w-[min(calc(100vw-2rem),26rem)] p-0"
        >
          {suggestions}
        </PopoverContent>
      </Popover>
      {hint}
    </Command>
  );
}

function Suggestion({ place, onSelect, recent }: { place: PlaceSuggestion; onSelect: (p: PlaceSuggestion) => void; recent?: boolean }) {
  const Icon = recent ? Clock3 : kindIcon[place.kind] ?? MapPin;
  return (
    <CommandItem value={place.id} onSelect={() => onSelect(place)} className="min-h-12 items-start gap-3 py-2.5">
      <Icon className="mt-0.5 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{place.name}</span>
        {place.detail ? <span className="block truncate text-xs text-muted-foreground">{place.detail}</span> : null}
      </span>
    </CommandItem>
  );
}
