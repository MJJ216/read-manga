import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { LoadedPage, PageCache } from './pageCache';
import type { Nav } from './PagedView';

const DEFAULT_ASPECT = '2 / 3';

interface Props {
  count: number;
  cache: PageCache;
  /** Scroll to this page whenever `jump.nonce` changes (restore, slider, buttons). */
  jump: { page: number; nonce: number };
  onPage(p: number): void;
  onToggleMenu(): void;
  nav: { current: Nav | undefined };
}

interface ItemProps {
  i: number;
  cache: PageCache;
  scroller: { current: HTMLDivElement | null };
}

// One page slot. Its box keeps the page's aspect ratio even while the image is unloaded, so the strip
// never collapses; the image itself is only held while the slot is near the viewport.
function Item({ i, cache, scroller }: ItemProps) {
  const el = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<LoadedPage>();
  const prevH = useRef(0);
  const size = cache.size(i);

  useEffect(() => {
    const node = el.current!;
    let live = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          cache.load(i).then((p) => live && setPage(p)).catch(() => {});
        } else {
          cache.release(i);
          setPage(undefined);
        }
      },
      { root: scroller.current, rootMargin: '150% 0px' },
    );
    io.observe(node);
    return () => { live = false; io.disconnect(); cache.release(i); };
  }, [i, cache]);

  // When a slot above the viewport changes height (estimate -> real size), keep the content in view still.
  useLayoutEffect(() => {
    const node = el.current!, sc = scroller.current!;
    const h = node.offsetHeight;
    if (prevH.current && h !== prevH.current && node.offsetTop + prevH.current <= sc.scrollTop) sc.scrollTop += h - prevH.current;
    prevH.current = h;
  }, [size?.w, size?.h]);

  return (
    <div class="wt-item" ref={el} style={{ aspectRatio: size ? `${size.w} / ${size.h}` : DEFAULT_ASPECT }}>
      {page && <img src={page.url} alt={`หน้า ${i + 1}`} draggable={false} />}
    </div>
  );
}

export function WebtoonView({ count, cache, jump, onPage, onToggleMenu, nav }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const raf = useRef(0);

  const scrollToPage = (p: number) => {
    const sc = scroller.current!;
    const item = sc.children[Math.max(0, Math.min(count - 1, p))] as HTMLElement | undefined;
    if (item) sc.scrollTop = item.offsetTop;
  };

  useLayoutEffect(() => {
    current.current = jump.page;
    scrollToPage(jump.page);
  }, [jump.nonce]);

  useEffect(() => {
    nav.current = {
      next: () => scrollToPage(current.current + 1),
      prev: () => scrollToPage(current.current - 1),
    };
    return () => { nav.current = undefined; cancelAnimationFrame(raf.current); };
  }, [count]);

  // The page under the middle of the viewport counts as the one being read.
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const sc = scroller.current!;
      const mid = sc.scrollTop + sc.clientHeight / 2;
      let lo = 0, hi = count - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if ((sc.children[m] as HTMLElement).offsetTop <= mid) lo = m; else hi = m - 1;
      }
      if (lo !== current.current) { current.current = lo; onPage(lo); }
    });
  };

  return (
    <div class="webtoon" ref={scroller} onScroll={onScroll} onClick={onToggleMenu}>
      {Array.from({ length: count }, (_, i) => <Item key={i} i={i} cache={cache} scroller={scroller} />)}
    </div>
  );
}
