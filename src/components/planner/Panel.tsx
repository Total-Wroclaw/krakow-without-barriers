'use client';
import { useRef, type ReactNode } from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';

/**
 * Panels are often opened from state (a map marker, a list item) rather than a Radix trigger,
 * so return focus to whatever opened them; fall back to Radix' default when it's gone.
 */
export function useRestoreFocus(open: boolean) {
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') opener.current = document.activeElement;
  wasOpen.current = open;
  return (e: Event) => {
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected && el !== document.body) {
      e.preventDefault();
      el.focus();
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
  const wide = useMediaQuery('(min-width: 768px)');
  const restore = useRestoreFocus(open);
  if (wide) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" onCloseAutoFocus={restore} className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader className="px-6 pt-6">
            <SheetTitle className="text-xl">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="px-6 pb-8">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92svh]" onCloseAutoFocus={restore}>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl">{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
