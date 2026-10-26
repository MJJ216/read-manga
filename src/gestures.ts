export interface GestureHandlers {
  /** dir: 1 = swiped toward the next page (finger moved left), -1 = previous. */
  onSwipe(dir: 1 | -1): void;
  /** x is the tap position as a fraction (0..1) of the surface width. */
  onTap(x: number): void;
  /** Which side of an overflowing page to show first (the side reading starts from). */
  startSide?(): 'left' | 'right';
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 10;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_DIST = 40;
const SWIPE_MIN = 50;
const EDGE = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Pointer-event gesture state machine for the reader surface: tap zones, swipe (only when not zoomed),
 * pinch-zoom, drag-pan while zoomed and double-tap zoom. The target element is scaled around its own center.
 * The surface must have `touch-action: none`.
 */
export function attachGestures(
  surface: HTMLElement,
  getTarget: () => HTMLElement | null,
  h: GestureHandlers,
) {
  let scale = 1, tx = 0, ty = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; t: number; moved: boolean } | null = null;
  let pinch: { dist: number; scale: number } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;
  let pending = 0;

  const rel = (x: number, y: number) => {
    const r = surface.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };

  // How far the scaled content may travel from center on each axis (0 = it fits the surface).
  const bounds = () => {
    const t = getTarget();
    if (!t) return { maxX: 0, maxY: 0 };
    const r = surface.getBoundingClientRect();
    return {
      maxX: Math.max(0, (t.offsetWidth * scale - r.width) / 2),
      maxY: Math.max(0, (t.offsetHeight * scale - r.height) / 2),
    };
  };

  const apply = () => {
    const t = getTarget();
    if (!t) return;
    const { maxX, maxY } = bounds();
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
    t.style.transform = scale === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  // At 1x, a page larger than the surface (fit width/height) starts at its top and at the reading-start side.
  const fit = () => {
    if (scale !== 1) return;
    const { maxX, maxY } = bounds();
    tx = h.startSide?.() === 'right' ? -maxX : maxX;
    ty = maxY;
    apply();
  };

  // Zoom to `next`, keeping the surface point (fx, fy) (relative to center) fixed on screen.
  const zoomAt = (next: number, fx: number, fy: number) => {
    next = clamp(next, 1, MAX_SCALE);
    const k = next / scale;
    tx = fx - (fx - tx) * k;
    ty = fy - (fy - ty) * k;
    scale = next;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  };

  const cancelPending = () => { clearTimeout(pending); pending = 0; };

  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('[data-gesture-ignore]')) return;
    try { surface.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      if (down) down.moved = true;
      cancelPending();
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const f = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt((pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist, f.x, f.y);
      return;
    }
    if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) down.moved = true;
    if (down?.moved && (scale > 1 || bounds().maxX > 0 || bounds().maxY > 0)) {
      tx += dx;
      ty += dy;
      apply();
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size >= 1) return; // remaining finger of a pinch: ignore until all lifted
    if (pinch) { pinch = null; down = null; return; }
    const d = down;
    down = null;
    if (!d) return;

    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const dt = performance.now() - d.t;

    if (d.moved) {
      if (bounds().maxX < 8 && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) h.onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (dt > TAP_MS) return;

    const r = surface.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    const now = performance.now();

    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_DIST) {
      cancelPending();
      lastTap = null;
      const f = rel(e.clientX, e.clientY);
      zoomAt(scale > 1 ? 1 : DOUBLE_TAP_SCALE, f.x, f.y);
      return;
    }
    lastTap = { x: e.clientX, y: e.clientY, t: now };
    // Edge taps at 1x flip the page right away; anything else waits to see whether a second tap follows.
    const edge = frac < EDGE || frac > 1 - EDGE;
    if (edge && scale === 1) { lastTap = null; h.onTap(frac); return; }
    cancelPending();
    pending = window.setTimeout(() => { pending = 0; lastTap = null; h.onTap(frac); }, DOUBLE_TAP_MS);
  };

  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) { down = null; pinch = null; }
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const f = rel(e.clientX, e.clientY);
    zoomAt(scale * Math.exp(-e.deltaY / 200), f.x, f.y);
  };

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onCancel);
  surface.addEventListener('wheel', onWheel, { passive: false });

  return {
    /** Back to 1x; call when the page changes. */
    reset() { cancelPending(); lastTap = null; scale = 1; tx = 0; ty = 0; apply(); fit(); },
    /** Re-align after the page's real size is known (image finished loading). */
    fit,
    destroy() {
      cancelPending();
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onCancel);
      surface.removeEventListener('wheel', onWheel);
    },
  };
}
