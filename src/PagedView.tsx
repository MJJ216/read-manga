import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { attachGestures } from './gestures';
import type { LoadedPage, PageCache } from './pageCache';
import type { Direction, Fit } from './settings';

const PRELOAD = 2;

export interface Nav {
  next(): void;
  prev(): void;
}

interface Props {
  count: number;
  cache: PageCache;
  mode: 'single' | 'double';
  direction: Direction;
  fit: Fit;
  coverAlone: boolean;
  /** Any page inside the spread to show; the view reports the spread's first page back through onPage. */
  page: number;
  onPage(p: number): void;
  onToggleMenu(): void;
  nav: { current: Nav | undefined };
  onError(message: string): void;
}

interface Shown {
  ids: number[];
  items: LoadedPage[];
}

export function PagedView(props: Props) {
  const { count, cache, mode, direction, fit, coverAlone, page } = props;
  const [shown, setShown] = useState<Shown>();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gestures = useRef<ReturnType<typeof attachGestures> | undefined>(undefined);

  // First page of every spread. Pairing uses the page sizes seen so far: a landscape page stands alone.
  const startsNow = () => {
    const wide = (i: number) => { const d = cache.size(i); return !!d && d.w > d.h; };
    const starts: number[] = [];
    for (let i = 0; i < count; ) {
      starts.push(i);
      const pair = mode === 'double' && i + 1 < count && !(i === 0 && coverAlone) && !wide(i) && !wide(i + 1);
      i += pair ? 2 : 1;
    }
    return starts;
  };
  const spreadAt = (p: number, starts = startsNow()) => {
    let s = 0;
    for (const st of starts) if (st <= p) s = st; else break;
    const next = starts[starts.indexOf(s) + 1] ?? count;
    return Array.from({ length: next - s }, (_, k) => s + k);
  };

  const latest = useRef({ props, shown, startsNow, spreadAt });
  latest.current = { props, shown, startsNow, spreadAt };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await Promise.all(spreadAt(page).map((i) => cache.load(i)));
        const ids = spreadAt(page); // sizes are known now, so the pairing may have changed
        const items = await Promise.all(ids.map((i) => cache.load(i)));
        if (!live) return;
        setShown({ ids, items });
        if (ids[0] !== page) props.onPage(ids[0]);
        const last = ids[ids.length - 1];
        if (ids[0] > 0) void cache.load(ids[0] - 1).catch(() => {});
        cache.keepOnly(ids[0] - 3, last + PRELOAD * 2);
        for (let k = 1; k <= PRELOAD * 2; k++) if (last + k < count) void cache.load(last + k).catch(() => {});
      } catch (e) {
        if (live) props.onError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [page, mode, coverAlone, cache, count]);

  useEffect(() => {
    const surface = surfaceRef.current!;
    const step = (forward: boolean) => {
      const { shown: s, startsNow: starts } = latest.current;
      if (!s) return;
      const list = starts();
      const first = s.ids[0];
      const target = forward ? s.ids[s.ids.length - 1] + 1 : [...list].reverse().find((st) => st < first);
      if (target !== undefined && target >= 0 && target < count) latest.current.props.onPage(target);
    };
    const rtl = () => latest.current.props.direction === 'rtl';
    const g = attachGestures(surface, () => surface.querySelector('.spread'), {
      // dir: 1 = finger moved left. In RTL the next page is revealed by moving the finger right.
      onSwipe: (dir) => step((dir === 1) !== rtl()),
      onTap: (x) => {
        if (x < 0.3) step(rtl());
        else if (x > 0.7) step(!rtl());
        else latest.current.props.onToggleMenu();
      },
      startSide: () => (rtl() ? 'right' : 'left'),
    });
    gestures.current = g;
    props.nav.current = { next: () => step(true), prev: () => step(false) };
    return () => { g.destroy(); gestures.current = undefined; props.nav.current = undefined; };
  }, [count]);

  useLayoutEffect(() => { gestures.current?.reset(); }, [shown, fit, direction]);

  return (
    <div class="surface" ref={surfaceRef}>
      {shown && (
        <div class={`spread fit-${fit} ${direction}`} style={{ '--n': shown.items.length }}>
          {shown.items.map((it, k) => (
            <img key={shown.ids[k]} src={it.url} alt={`หน้า ${shown.ids[k] + 1}`} draggable={false}
              onLoad={() => gestures.current?.fit()} />
          ))}
        </div>
      )}
    </div>
  );
}
