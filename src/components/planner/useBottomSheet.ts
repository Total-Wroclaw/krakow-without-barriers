'use client';
// The phone layout's panel: a sheet over a full-screen map that rests at three heights and follows the finger,
// like a maps app. Dragged by its handle, or by the content when that is scrolled to the top (down) or not yet
// fully open (up). On desktop (lg) none of this applies: the panel is a side column.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

export type Snap = 'peek' | 'half' | 'full';
const order: Snap[] = ['peek', 'half', 'full'];
/** Collapsed height when the peek element can't be measured: handle plus the first row of the panel. */
const PEEK = 112;
/** Space kept under the peek element (e.g. the tabs) when collapsed. */
const PEEK_GAP = 12;
/** Map left visible above the fully open sheet, so it can be tapped or dragged back down. */
const TOP_GAP = 64;
/** How far ahead (ms) a flick carries the sheet when choosing where it settles. */
const FLICK_MS = 180;

/**
 * `peekTo`: the element that must stay fully visible when the sheet is collapsed (the tabs), measured so the
 * collapsed height follows font size and language instead of a fixed number.
 */
export function useBottomSheet(scroller: RefObject<HTMLElement | null>, forced?: Snap, peekTo?: RefObject<HTMLElement | null>) {
  const [snap, setSnap] = useState<Snap>('half');
  const [peek, setPeek] = useState(PEEK);
  const [drag, setDrag] = useState<number | null>(null);
  const [viewport, setViewport] = useState<{ h: number; mobile: boolean } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const update = () => {
      setViewport({ h: window.innerHeight, mobile: mq.matches });
      const el = peekTo?.current;
      const box = scroller.current;
      // Distance from the sheet's top edge to the bottom of the element, ignoring the current scroll.
      if (el && box) setPeek(Math.round(el.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop + box.offsetTop + PEEK_GAP));
    };
    update();
    window.addEventListener('resize', update);
    mq.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mq.removeEventListener('change', update);
    };
  }, [peekTo, scroller]);

  const current = forced ?? snap;
  const heightOf = useCallback(
    (s: Snap) => (viewport ? (s === 'peek' ? peek : s === 'half' ? Math.round(viewport.h * 0.5) : viewport.h - TOP_GAP) : 0),
    [viewport, peek],
  );
  const height = viewport?.mobile ? (drag ?? heightOf(current)) : null;

  // Gesture state lives in refs so the touch listeners stay attached for the whole gesture.
  const live = useRef({ height, current, heightOf });
  live.current = { height, current, heightOf };
  const gesture = useRef<{ y: number; h: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);

  const begin = useCallback((y: number) => {
    const h = live.current.height;
    if (h === null) return false;
    gesture.current = { y, h, lastY: y, lastT: performance.now(), v: 0, moved: false };
    return true;
  }, []);
  const move = useCallback((y: number) => {
    const g = gesture.current;
    if (!g) return;
    const now = performance.now();
    // Upward speed in px/ms, smoothed.
    g.v = 0.7 * ((g.lastY - y) / Math.max(1, now - g.lastT)) + 0.3 * g.v;
    g.lastY = y;
    g.lastT = now;
    if (Math.abs(y - g.y) > 4) g.moved = true;
    const { heightOf } = live.current;
    setDrag(Math.min(heightOf('full'), Math.max(heightOf('peek') - 24, g.h + (g.y - y))));
  }, []);
  const end = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return false;
    if (g.moved) {
      const { heightOf } = live.current;
      const aim = g.h + (g.y - g.lastY) + g.v * FLICK_MS;
      setSnap(order.reduce((best, s) => (Math.abs(heightOf(s) - aim) < Math.abs(heightOf(best) - aim) ? s : best)));
    }
    setDrag(null);
    return g.moved;
  }, []);

  // Dragging the content: down when it is scrolled to the top, up while the sheet is not fully open.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !viewport?.mobile) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'sheet' | 'scroll' | null = null;
    const onStart = (e: TouchEvent) => {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      mode = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (!mode) {
        const dx = x - start.x, dy = y - start.y;
        if (Math.hypot(dx, dy) < 6) return;
        const target = e.target instanceof Element ? e.target : null;
        const own = target?.closest('input[type="range"], [role="slider"], [data-no-sheet-drag]');
        const sheetWay = Math.abs(dy) > Math.abs(dx) && !own && ((dy > 0 && el.scrollTop <= 0) || (dy < 0 && live.current.current !== 'full'));
        mode = sheetWay ? 'sheet' : 'scroll';
        if (mode === 'sheet') begin(start.y);
      }
      if (mode === 'sheet') {
        e.preventDefault();
        move(y);
      }
    };
    const onEnd = () => {
      if (mode === 'sheet') end();
      start = null;
      mode = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller, viewport?.mobile, begin, move, end]);

  // Keyboard focus moving into a lowered sheet must not end up below the screen edge (WCAG 2.4.11): at peek, or
  // when the control would sit below the bottom once a temporary full height (the place search) ends, open it fully.
  const resting = useRef(snap);
  resting.current = snap;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !viewport?.mobile) return;
    let frame = 0;
    const onFocus = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !target.matches(':focus-visible') || resting.current === 'full') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { height, heightOf } = live.current;
        // The sheet is anchored to the bottom: settling at its resting height moves the content down by the difference.
        const below = target.getBoundingClientRect().bottom + (height ?? 0) - heightOf(resting.current) > window.innerHeight;
        if (resting.current === 'peek' || below) setSnap('full');
      });
    };
    // And the other way round: keyboard focus on the map (its canvas, markers, attribution) that the sheet covers
    // lowers the sheet, so the focused control shows.
    const sheet = el.parentElement;
    const onMapFocus = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !sheet || sheet.contains(target) || !target.matches(':focus-visible')) return;
      const r = target.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && sheet.contains(hit)) setSnap('peek');
    };
    el.addEventListener('focusin', onFocus);
    document.addEventListener('focusin', onMapFocus);
    return () => {
      el.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusin', onMapFocus);
      cancelAnimationFrame(frame);
    };
  }, [scroller, viewport?.mobile]);

  // The handle: drag with any pointer; tap or Enter steps through the heights; arrow keys go up/down.
  const dragged = useRef(false);
  const step = (by: 1 | -1) => setSnap(order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + by))]);
  const handle = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (begin(e.clientY)) e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => gesture.current && move(e.clientY),
    onPointerUp: () => {
      dragged.current = end();
    },
    onPointerCancel: () => {
      end();
    },
    onClick: () => {
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      setSnap(current === 'full' ? 'peek' : order[order.indexOf(current) + 1]);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(e.key === 'ArrowUp' ? 1 : -1);
      }
    },
  };

  return { mobile: !!viewport?.mobile, snap: current, setSnap, height, dragging: drag !== null, handle };
}
