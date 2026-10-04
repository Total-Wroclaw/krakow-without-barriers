'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { messages, type MessageKey } from '@/lib/i18n/messages';
import type { PartnerDeclaration } from '@/lib/objects';
import { formatDate } from './shared';

const pl = messages.pl;
const label = (key: string) => pl[key as MessageKey] ?? key;

/** Owner declarations (no verification yet): the city can hide a false one, which keeps it stored for audit. */
export default function PartnerDeclarations({ initial }: { initial: PartnerDeclaration[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function setHidden(item: PartnerDeclaration, hidden: boolean) {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/city/partners/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden }) });
      if (response.status === 401) return router.refresh();
      if (response.status === 404) {
        setItems(list => list.filter(x => x.id !== item.id));
        throw new Error('gone');
      }
      if (!response.ok) throw new Error();
      const { partner } = (await response.json()) as { partner: PartnerDeclaration };
      setItems(list => list.map(x => (x.id === partner.id ? partner : x)));
      toast.success(hidden ? `Ukryto deklarację: ${item.name}` : `Przywrócono deklarację: ${item.name}`);
    } catch (error) {
      toast.error(error instanceof Error && error.message === 'gone' ? 'Deklaracja została wycofana przez właściciela.' : 'Nie udało się zmienić widoczności deklaracji.');
    } finally {
      setBusy(null);
    }
  }

  const hiddenCount = items.filter(i => i.hidden).length;
  return (
    <section aria-labelledby="partners-heading" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="partners-heading" className="text-lg font-semibold">
          Deklaracje właścicieli obiektów
        </h2>
        <p role="status" className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? 'deklaracja' : 'deklaracji'}, w tym ukrytych: {hiddenCount}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Dane wpisane przez właścicieli, bez weryfikacji. Ukryta deklaracja znika z katalogu miejsc, ale zostaje zapisana; można ją przywrócić.
      </p>
      {items.length === 0 ? (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Store aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Brak deklaracji</EmptyTitle>
            <EmptyDescription>Deklaracje właścicieli pojawią się tutaj.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {items.map(item => {
            const headingId = `pd-${item.id}`;
            return (
              <li key={item.id}>
                <article aria-labelledby={headingId} className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-[1fr_auto]">
                  <div className="grid min-w-0 content-start gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id={headingId} className="font-semibold">
                        {item.name}
                      </h3>
                      {item.hidden && (
                        <Badge variant="outline" className="border-barrier/40 bg-barrier-soft text-barrier">
                          <EyeOff aria-hidden="true" /> Ukryta
                        </Badge>
                      )}
                      <time dateTime={item.editedAt ?? item.createdAt} className="text-sm text-muted-foreground">
                        {item.editedAt ? `poprawiona ${formatDate(item.editedAt)}` : formatDate(item.createdAt)}
                      </time>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {[label(`cat.${item.category}`), item.address, item.existingObjectId ? 'dołączona do istniejącego miejsca' : null].filter(Boolean).join(' · ')}
                    </p>
                    {item.features.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {item.features.map(f => (
                          <li key={f.key} className="rounded-md bg-muted px-2 py-0.5 text-sm">
                            {label(`feature.${f.key}`)}: <span className="font-medium">{label(`fvalue.${f.value}`)}</span>
                            {f.detail ? ` (${f.detail})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.description && <p className="line-clamp-3">{item.description}</p>}
                    <p className="text-sm text-muted-foreground">
                      Kontakt: <a className="text-primary underline underline-offset-2" href={`mailto:${item.contactEmail}`}>{item.contactEmail}</a>
                      {item.website && (
                        <>
                          {' · '}
                          <a className="text-primary underline underline-offset-2" href={item.website} target="_blank" rel="noreferrer">
                            strona www<span className="sr-only"> (otwiera się w nowej karcie)</span>
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-start sm:justify-end">
                    <Button variant={item.hidden ? 'default' : 'outline'} className="w-full sm:w-auto" disabled={busy === item.id} onClick={() => setHidden(item, !item.hidden)}>
                      {item.hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                      {item.hidden ? 'Przywróć' : 'Ukryj'}
                      <span className="sr-only">: {item.name}</span>
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
