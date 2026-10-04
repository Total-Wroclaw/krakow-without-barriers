'use client';
import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useI18n } from '@/lib/i18n/client';

/** The last opener outside any panel: where focus goes when a panel opened from another (now closed) panel closes. */
let outsideOpener: Element | null = null;

/**
 * Panels are often opened from state (a map marker, a list item) rather than a Radix trigger,
 * so return focus to whatever opened them; fall back to Radix' default when it's gone.
 */
function useRestoreFocus(open: boolean) {
  const opener = useRef<Element | null>(null);
  const fallback = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[role=dialog]')) outsideOpener = active;
    opener.current = active;
    fallback.current = outsideOpener;
  }
  wasOpen.current = open;
  return (e: Event) => {
    // E.g. "Zgłoś" → chooser → photo notice: the chooser's button is gone by then, so go back to "Zgłoś".
    const el = [opener.current, fallback.current].find(x => x instanceof HTMLElement && x.isConnected && x !== document.body);
    if (el instanceof HTMLElement) {
      e.preventDefault();
      el.focus({ preventScroll: true });
    }
  };
}

/** Bottom drawer on phones, side sheet on larger screens. */
export function Panel({ open, onOpenChange, title, description, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const wide = useMediaQuery('(min-width: 768px)');
  const restore = useRestoreFocus(open);
  if (wide) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" onCloseAutoFocus={restore} className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="px-6 pr-14 pt-6">
            <SheetTitle className="text-xl">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="px-6 pb-8">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    // autoFocus: move focus into the drawer (vaul leaves it behind by default), so keyboard and screen-reader users land in it.
    <Drawer open={open} onOpenChange={onOpenChange} autoFocus>
      <DrawerContent className="max-h-[92svh]" onCloseAutoFocus={restore}>
        <DrawerHeader className="pr-14 text-left">
          <DrawerTitle className="text-xl">{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="relative overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
        {/* Last in order, like the side sheet's; dragging down is not the only way out for screen-reader, switch and keyboard users. */}
        <DrawerClose className="absolute right-2 top-5 grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label={t('common.close')}>
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}
