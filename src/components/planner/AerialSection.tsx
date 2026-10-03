'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle, Satellite } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { postJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n/client';
import { StatusRow } from './FactSheet';

type Aerial = { image: string; draft: { context: string[]; unknowns: string[]; groundChecks: string[] } | null };

/** On-demand AI description of the official orthophoto around a place (one request per tap). */
export function AerialSection({ lat, lon, name }: { lat: number; lon: number; name: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ busy: boolean; data: Aerial | null; error: string }>({ busy: false, data: null, error: '' });

  useEffect(() => setState({ busy: false, data: null, error: '' }), [lat, lon, locale]);

  async function run() {
    setState({ busy: true, data: null, error: '' });
    try {
      const data = (await postJson('/api/aerial', { lat, lon, name, locale }, 45000)) as Aerial;
      setState({ busy: false, data, error: data.draft ? '' : t('aerial.failed') });
    } catch (e) {
      setState({ busy: false, data: null, error: e instanceof Error ? e.message : t('aerial.failed') });
    }
  }

  const { data } = state;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="aerial-title">
      <h3 id="aerial-title" className="font-semibold">{t('aerial.title')}</h3>
      {!data ? (
        <Button variant="outline" className="h-11 self-start" onClick={run} disabled={state.busy}>
          {state.busy ? <LoaderCircle className="animate-spin" /> : <Satellite />}
          {state.busy ? t('aerial.loading') : t('aerial.button')}
        </Button>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.image} alt={t('aerial.imageAlt', { name })} className="aspect-[4/3] w-full rounded-xl bg-muted object-cover" />
          {data.draft ? (
            <div className="grid gap-3 text-sm sm:grid-cols-1">
              {([['aerial.context', data.draft.context], ['aerial.unknowns', data.draft.unknowns], ['aerial.checks', data.draft.groundChecks]] as const).map(([key, items]) =>
                items.length ? (
                  <div key={key}>
                    <p className="font-semibold">{t(key)}</p>
                    <ul className="ml-4 list-disc text-muted-foreground">
                      {items.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          ) : null}
          <StatusRow tone="example" label={t('aerial.status')}>{t('map.satelliteCredit')}</StatusRow>
        </>
      )}
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    </section>
  );
}
