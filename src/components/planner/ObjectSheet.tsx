'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Check, ChevronDown, CircleHelp, Clock, ExternalLink, Info, LoaderCircle, Minus, Navigation, Pencil, Share2, Store, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ObjectSource, PlaceObject, SourceStatus } from '@/lib/explore-types';
import { errorText, requestJson } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { forgetPartnerToken, ownedDeclarations, PARTNER_TOKEN_HEADER, partnerToken, partnerWriteStamp, touchPartnerWrite } from '@/lib/partner-tokens';
import { groupFacts, groupSources, keyFactKeys, toneOf, type FactGroup, type FactStatement, type Tone } from '@/lib/place-facts';
import { cn } from '@/lib/utils';
import { ShowMore } from './AerialParts';
import { AerialSection } from './AerialSection';
import { PartnerBadges } from './Explore';
import { PartnerForm } from './PartnerForm';
import { Panel } from './Panel';
import { useMediaQuery } from '@/hooks/use-media-query';

const toneStyle: Record<Tone, string> = {
  good: 'bg-rest-soft text-rest',
  warn: 'bg-barrier-soft text-barrier',
  bad: 'bg-barrier text-white',
  unknown: 'bg-muted text-muted-foreground',
};
const toneIcon = (tone: Tone, limited: boolean) => (tone === 'good' ? Check : tone === 'bad' ? X : tone === 'unknown' ? CircleHelp : limited ? Minus : TriangleAlert);
const dot: Record<SourceStatus, string> = { map: 'bg-primary', city: 'bg-rest', partner: 'bg-drive', unverified: 'bg-report', example: 'bg-barrier' };

function ToneIcon({ tone, limited, className }: { tone: Tone; limited: boolean; className?: string }) {
  const Icon = toneIcon(tone, limited);
  return (
    <span aria-hidden className={cn('grid size-7 shrink-0 place-items-center rounded-full', toneStyle[tone], className)}>
      <Icon className="size-4" strokeWidth={2.5} />
    </span>
  );
}

export function ObjectSheet({ id, onClose, onRoute, onPhoto, onOwner }: {
  id: string | null;
  onClose: () => void;
  onRoute: (o: PlaceObject) => void;
  onPhoto: (o: PlaceObject) => void;
  onOwner: (o: PlaceObject) => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ loading: boolean; object: PlaceObject | null; error: string }>({ loading: false, object: null, error: '' });
  // Bumped after the owner corrects a declaration, so the card shows what the catalogue now says.
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const editAuth = editing ? partnerToken(editing) : null;

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState(prev => (prev.object?.id === id && version ? { ...prev, error: '' } : { loading: true, object: null, error: '' }));
    fetch(`/api/objects/${encodeURIComponent(id)}?locale=${locale}${partnerWriteStamp() ? `&w=${partnerWriteStamp()}` : ''}`, { signal: controller.signal })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setState({ loading: false, object: data.object, error: '' });
      })
      .catch(() => !controller.signal.aborted && setState({ loading: false, object: null, error: t('explore.failed') }));
    return () => controller.abort();
  }, [id, locale, t, version]);

  if (!id) return null;
  const o = state.object;

  return (
    <>
    <PlaceFrame title={o?.name ?? t('explore.loading')} description={o ? [o.categoryLabel, o.address].filter(Boolean).join(', ') : undefined} onClose={onClose}>
      {state.loading ? (
        <p className="flex items-center gap-2 py-6 text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          {t('explore.loading')}
        </p>
      ) : state.error || !o ? (
        <p role="alert" className="py-6 font-medium">{state.error}</p>
      ) : (
        <PlaceBody
          o={o}
          onRoute={onRoute}
          onPhoto={onPhoto}
          onOwner={onOwner}
          onEditDeclaration={setEditing}
          onWithdrawn={() => (o.id.startsWith('partner-') && !o.sources.some(s => s.kind !== 'partner') ? onClose() : setVersion(v => v + 1))}
        />
      )}
    </PlaceFrame>
    <PartnerForm
      open={!!editing && !!editAuth}
      existing={o}
      edit={editing && editAuth ? { id: editing, token: editAuth } : null}
      onClose={() => setEditing(null)}
      onSaved={() => setVersion(v => v + 1)}
    />
    </>
  );
}

/**
 * Card order: what decides a visit first (the four key facts, conflicts, route), then the remaining facts, user
 * reports, practical details and where the facts come from, the bird's-eye view, and finally how to correct them.
 */
function PlaceBody({ o, onRoute, onPhoto, onOwner, onEditDeclaration, onWithdrawn }: {
  o: PlaceObject;
  onRoute: (o: PlaceObject) => void;
  onPhoto: (o: PlaceObject) => void;
  onOwner: (o: PlaceObject) => void;
  onEditDeclaration: (partnerId: string) => void;
  onWithdrawn: () => void;
}) {
  const { t, locale } = useI18n();
  const groups = groupFacts(o.features, o.sources);
  const byKey = new Map(groups.map(g => [g.key, g]));
  // Key facts the tiles show completely stay out of the list below; split or disputed ones get their full story there.
  const rest = groups.filter(g => !keyFactKeys.includes(g.key) || g.statements.length > 1);
  const keyFacts = keyFactKeys.map(k => byKey.get(k)).filter((g): g is FactGroup => !!g && g.value !== 'unknown');
  const missing = keyFactKeys.filter(k => !keyFacts.some(g => g.key === k));
  const reports = o.sources.filter(s => s.kind === 'user');

  async function share() {
    const url = new URL(window.location.origin);
    url.searchParams.set('to', `${o.lat.toFixed(5)},${o.lon.toFixed(5)},${o.name}`);
    try {
      if (navigator.share) await navigator.share({ title: o.name, text: t('explore.shareText', { name: o.name }), url: url.toString() });
      else {
        await navigator.clipboard.writeText(url.toString());
        toast.success(t('explore.shareCopied'));
      }
    } catch {}
  }

  return (
    <div className="flex flex-col gap-5">
      {o.partner ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <PartnerBadges partner={o.partner} />
          {o.partner.tagline ? <span>{o.partner.tagline}</span> : null}
        </div>
      ) : null}

      <section aria-labelledby="key-facts-title" className="flex flex-col gap-2">
        <h3 id="key-facts-title" className="sr-only">{t('explore.keyFacts')}</h3>
        {keyFacts.length ? (
          <ul className="grid grid-cols-2 gap-2">
            {keyFacts.map((g, i) => <KeyFact key={g.key} group={g} wide={i === keyFacts.length - 1 && i % 2 === 0} />)}
          </ul>
        ) : null}
        {missing.length ? (
          // Missing key facts stay visible, but as one quiet line rather than a tile each.
          <p className="flex items-start gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
            <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">{t('explore.noInfo')}:</span> {missing.map(k => t(`feature.${k}`)).join(', ')}
            </span>
          </p>
        ) : null}
        {o.conflicts.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-barrier-soft p-3 text-sm font-medium text-barrier" role="note">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('explore.conflictNote', { list: o.conflicts.map(k => t(`feature.${k}`)).join(', ') })}
          </p>
        ) : null}
      </section>

      <div className="flex gap-2">
        <Button className="h-11 flex-1" onClick={() => onRoute(o)}>
          <Navigation />
          {t('explore.route')}
        </Button>
        <Button variant="outline" className="h-11" onClick={share}>
          <Share2 />
          {t('explore.share')}
        </Button>
      </div>

      {rest.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="features-title">
          <h3 id="features-title" className="font-semibold">{t('explore.features')}</h3>
          <ShowMore
            labelledBy="features-title"
            preview={4}
            frameClassName="overflow-hidden rounded-xl border bg-card"
            listClassName="flex flex-col divide-y"
            restClassName="border-t"
            items={rest.map(g => <FactRow key={g.key} group={g} />)}
          />
        </section>
      ) : null}

      {o.description ? <p className="text-sm text-muted-foreground">{o.description}</p> : null}

      {reports.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="reports-title">
          <h3 id="reports-title" className="font-semibold">{t('explore.reports')}</h3>
          <ul className="flex flex-col gap-2">
            {reports.map(s => (
              <li key={s.id} className="flex gap-3 rounded-xl bg-muted/70 p-3 text-sm">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full bg-report" />
                <span className="min-w-0">
                  <span className="block font-semibold">{s.label}</span>
                  {s.note ? <span className="block break-words">{s.note}</span> : null}
                  <span className="block text-muted-foreground">
                    {formatDate(s.obtainedAt, locale)}
                    {s.url ? (
                      <>
                        {' · '}
                        <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
                          {t('explore.reportPhoto')}
                          <span className="sr-only"> {t('fact.newTab')}</span>
                        </a>
                      </>
                    ) : null}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {o.openingHours || o.website ? (
        <section className="flex flex-col gap-2" aria-labelledby="hours-title">
          <h3 id="hours-title" className="sr-only">{t('explore.practical')}</h3>
          {o.openingHours ? (
            <div className="flex gap-3 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              {/* OSM opening_hours: one rule per line ("Mo-Fr 10:00-18:00; Sa 10:00-14:00"). */}
              <ul className="flex flex-col gap-0.5 tabular-nums" aria-label={t('explore.hours')}>
                {o.openingHours.split(/\s*;\s*/).filter(Boolean).map(rule => (
                  <li key={rule} className="break-words">{rule}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {o.website ? (
            <a href={o.website} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-3 text-sm font-medium text-primary underline-offset-2 hover:underline">
              <ExternalLink className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{t('explore.website')}: {host(o.website)}</span>
              <span className="sr-only">{t('fact.newTab')}</span>
            </a>
          ) : null}
        </section>
      ) : null}

      <Provenance o={o} />

      <OwnerDeclarations o={o} onEdit={onEditDeclaration} onWithdrawn={onWithdrawn} />

      <AerialSection lat={o.lat} lon={o.lon} name={o.name} objectId={o.id} />

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" className="h-11" onClick={() => onPhoto(o)}>
          <Camera />
          {t('explore.photo')}
        </Button>
        <Button variant="ghost" className="h-11" onClick={() => onOwner(o)}>
          <Store />
          {t('explore.owner')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Declarations on this place that this browser submitted (it holds the edit token): correct or withdraw them.
 * Nobody else gets these buttons, and the server checks the token again.
 */
function OwnerDeclarations({ o, onEdit, onWithdrawn }: { o: PlaceObject; onEdit: (partnerId: string) => void; onWithdrawn: () => void }) {
  const { t, locale } = useI18n();
  const [mine, setMine] = useState<ReturnType<typeof ownedDeclarations>>([]);
  // localStorage is read after mount so the first client render matches the server.
  useEffect(() => setMine(ownedDeclarations(o.sources)), [o.sources]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const withdrawButtons = useRef(new Map<string, HTMLButtonElement>());
  if (!mine.length) return null;

  async function withdraw(id: string) {
    const token = partnerToken(id);
    if (!token) return;
    setBusy(true);
    try {
      await requestJson('DELETE', `/api/partners/objects/${id}?locale=${locale}`, undefined, 35000, { [PARTNER_TOKEN_HEADER]: token });
      forgetPartnerToken(id);
      touchPartnerWrite();
      toast.success(t('partner.withdrawn'));
      setConfirming(null);
      onWithdrawn();
    } catch (err) {
      toast.error(errorText(err, t('partner.withdrawFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="owner-decl-title" className="flex flex-col gap-3 rounded-xl border border-drive/40 bg-card p-3">
      <h3 id="owner-decl-title" className="font-semibold">{t('partner.mine')}</h3>
      <ul className="flex flex-col gap-3">
        {mine.map(({ id, source }) => (
          <li key={id} className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('status.partner')}</span>
              {' · '}
              {source.editedAt && source.editedAt !== source.obtainedAt ? t('explore.edited', { date: formatDate(source.editedAt, locale) }) : t('explore.obtained', { date: formatDate(source.obtainedAt, locale) })}
            </p>
            {confirming === id ? (
              <div className="flex flex-col gap-2 rounded-lg border border-barrier/40 p-3">
                <p className="font-medium">{t('partner.withdrawConfirm')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" className="h-11" disabled={busy} autoFocus onClick={() => withdraw(id)}>
                    {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                    {t('partner.withdrawYes')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-11"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null);
                      window.setTimeout(() => withdrawButtons.current.get(id)?.focus(), 0);
                    }}
                  >
                    {t('partner.withdrawNo')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-11" onClick={() => onEdit(id)}>
                  <Pencil />
                  {t('partner.edit')}
                </Button>
                <Button variant="ghost" className="h-11" ref={el => { if (el) withdrawButtons.current.set(id, el); }} onClick={() => setConfirming(id)}>
                  <Trash2 />
                  {t('partner.withdraw')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One of the four key facts as the best source states it. */
function KeyFact({ group, wide }: { group: FactGroup; wide: boolean }) {
  const { t } = useI18n();
  const label = t(`feature.${group.key}`);
  const value = group.conflict ? t('explore.sourcesDiffer') : group.byEntrance && group.mixed ? t('explore.dependsOnEntrance') : t(`fvalue.${group.value}`);
  const first = group.statements[0]?.details[0]?.text;
  // A detail that only repeats the label ("winda" under "Winda") adds nothing.
  const detail = group.conflict || (group.byEntrance && group.mixed) ? null : group.mixed ? t('explore.entrancesDiffer') : first && first.toLocaleLowerCase() !== label.toLocaleLowerCase() ? first : null;
  return (
    <li className={cn('flex flex-col gap-1 rounded-xl border bg-card p-3', wide && 'col-span-2')}>
      <span className="text-sm leading-tight break-words text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <ToneIcon tone={group.tone} limited={group.value === 'limited'} className="size-6" />
        <span className="font-bold leading-snug">{value}</span>
      </span>
      {detail ? <span className="text-xs break-words text-muted-foreground">{detail}</span> : null}
    </li>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const detailText = (s: FactStatement) => s.details.map(d => (d.count > 1 ? `${d.text} (×${d.count})` : d.text)).join('; ');

/** One feature: headline value, then each distinct statement (value, details, and the source when kinds of source differ). */
function FactRow({ group }: { group: FactGroup }) {
  const { t } = useI18n();
  const showSources = new Set(group.statements.flatMap(s => s.sources.map(x => x.status))).size > 1;
  const single = group.statements.length === 1;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span aria-hidden className="flex h-6 items-center">
        <ToneIcon tone={group.tone} limited={group.value === 'limited'} className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">
          {t(`feature.${group.key}`)}:{' '}
          <span className="font-bold">
            {group.conflict ? t('explore.sourcesDiffer') : group.byEntrance && group.mixed ? t('explore.dependsOnEntrance') : t(`fvalue.${group.value}`)}
          </span>
        </span>
        {single ? (
          <StatementLine statement={group.statements[0]} showSources={showSources} />
        ) : (
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {group.statements.map(s => (
              <li key={`${s.value}-${s.entrance}`} className="flex items-start gap-1.5 text-sm">
                <ToneIcon tone={toneOf(group.key, s.value)} limited={s.value === 'limited'} className="mt-0.5 size-4 [&_svg]:size-3" />
                <span className="min-w-0">
                  <span className="font-semibold">{t(`fvalue.${s.value}`)}</span>
                  <StatementLine statement={s} showSources={showSources} inline />
                </span>
              </li>
            ))}
          </ul>
        )}
      </span>
    </li>
  );
}

function StatementLine({ statement: s, showSources, inline }: { statement: FactStatement; showSources: boolean; inline?: boolean }) {
  const { t, tp } = useI18n();
  const parts = [detailText(s), s.entrance && !s.details.length ? tp('explore.entrances', s.bare) : ''].filter(Boolean).join('; ');
  const tags = showSources ? [...new Set(s.sources.map(x => x.status))] : [];
  if (!parts && !tags.length) return null;
  return (
    <span className={cn('text-sm break-words text-muted-foreground', inline ? 'ml-1' : 'block')}>
      {inline && parts ? '— ' : ''}
      {parts}
      {tags.map(status => (
        <span key={status} className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap text-xs">
          <span aria-hidden className={cn('size-1.5 rounded-full', dot[status])} />
          {t(`explore.src.${status}`)}
        </span>
      ))}
    </span>
  );
}

/** Where the facts come from, condensed: one line closed; per source (map data as one entry) with dates when open. */
function Provenance({ o }: { o: PlaceObject }) {
  const { t, tp, locale } = useI18n();
  const groups = groupSources(o.sources);
  if (!groups.length) return null;
  const confirmed = groups.map(g => g.confirmedAt).filter(Boolean).sort().pop();
  // A general OSM survey date says someone looked at the place, not that its accessibility was checked.
  const checked = groups.map(g => g.checkedAt).filter(Boolean).sort().pop();
  return (
    <Collapsible className="rounded-xl bg-muted/70 text-sm">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-start gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {t('explore.sources')}: {[...new Set(groups.map(g => t(`explore.src.${g.status}`)))].join(', ')}
          </span>
          <span className="block text-muted-foreground">
            {confirmed
              ? t('explore.confirmed', { date: formatDate(confirmed, locale) })
              : checked
                ? t('explore.checked', { date: formatDate(checked, locale) })
                : t('explore.notConfirmed')}
          </span>
        </span>
        <ChevronDown className="mt-0.5 size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-3 px-3 pb-3">
          {groups.map(g => (
            <li key={g.main.id} className="flex gap-2">
              <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot[g.status])} />
              <span className="min-w-0">
                <span className="block font-medium">{t(`status.${g.status}`)}</span>
                <span className="block text-muted-foreground">
                  <SourceLink source={g.main} />
                  {g.entrances.length ? (
                    <>
                      {' · '}
                      {tp('explore.entrances', g.entrances.length)}:{' '}
                      <span className="inline-flex flex-wrap gap-1 align-middle">
                        {g.entrances.map((e, i) => <SourceLink key={e.id} source={e} label={String(i + 1)} />)}
                      </span>
                    </>
                  ) : null}
                </span>
                {g.main.note ? <span className="block break-words text-muted-foreground">{g.main.note}</span> : null}
                <span className="block text-muted-foreground">
                  {t('explore.obtained', { date: formatDate(g.main.obtainedAt, locale) })}
                  {g.editedAt ? ` · ${t('explore.edited', { date: formatDate(g.editedAt, locale) })}` : ''}
                  {g.confirmedAt ? ` · ${t('explore.confirmed', { date: formatDate(g.confirmedAt, locale) })}` : g.checkedAt ? ` · ${t('explore.checked', { date: formatDate(g.checkedAt, locale) })}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceLink({ source, label }: { source: ObjectSource; label?: string }) {
  const { t } = useI18n();
  const text = label ?? source.label;
  if (!source.url) return <span className="text-foreground">{text}</span>;
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className={cn('font-medium text-primary underline underline-offset-2 [overflow-wrap:anywhere]', label && 'inline-grid min-h-6 min-w-6 place-items-center')}>
      {text}
      <span className="sr-only"> {label ? `(${source.label})` : ''} {t('fact.newTab')}</span>
    </a>
  );
}


/**
 * Desktop: a non-modal floating card over the right side of the map, so the list and map stay usable.
 * Phones: the usual bottom drawer.
 */
function PlaceFrame({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const wide = useMediaQuery('(min-width: 1024px)');
  const heading = useRef<HTMLHeadingElement>(null);
  // Captured on first render, before focus moves into the card, so closing returns focus to the opener.
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!wide) return;
    const back = opener.current;
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog][data-state=open]') && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [wide]);

  if (!wide) {
    return (
      <Panel open onOpenChange={open => !open && onClose()} title={title} description={description}>
        {children}
      </Panel>
    );
  }
  return (
    <section
      aria-labelledby="place-card-title"
      className="fixed bottom-10 right-16 top-4 z-30 flex w-[min(420px,calc(100vw-520px))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-ink/20 animate-in fade-in slide-in-from-right-4"
    >
      <header className="flex items-start justify-between gap-3 border-b py-3 pl-4 pr-2">
        <div className="min-w-0 pt-1">
          <h2 id="place-card-title" ref={heading} tabIndex={-1} className="text-xl font-bold leading-tight break-words outline-none">{title}</h2>
          {description ? <p className="mt-1 text-sm break-words text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-muted" aria-label={t('explore.close')}>
          <X className="size-5" />
        </button>
      </header>
      <div data-place-card-body className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </section>
  );
}
