import type { PageSource } from './pages';

export interface LoadedPage {
  url: string;
  w: number;
  h: number;
}

const DECODE_TIMEOUT_MS = 1000;

/**
 * Object-URL cache over a PageSource. Natural sizes are remembered after a page is released
 * (double-page pairing and webtoon placeholders need them), the URLs are not.
 */
export class PageCache {
  private loaded = new Map<number, LoadedPage>();
  private loading = new Map<number, Promise<LoadedPage>>();
  private dims = new Map<number, { w: number; h: number }>();
  private disposed = false;

  constructor(private src: PageSource) {}

  size(i: number) {
    return this.dims.get(i);
  }

  peek(i: number) {
    return this.loaded.get(i);
  }

  load(i: number): Promise<LoadedPage> {
    const have = this.loaded.get(i);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(i);
    if (!p) {
      p = this.src.get(i).then(async (blob) => {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.src = url;
        // Pre-decode so the page paints without a flash, but never let a stalled decode block display.
        await Promise.race([im.decode().catch(() => {}), new Promise((r) => setTimeout(r, DECODE_TIMEOUT_MS))]);
        const page = { url, w: im.naturalWidth, h: im.naturalHeight };
        if (this.disposed) { URL.revokeObjectURL(url); return page; }
        if (page.w) this.dims.set(i, { w: page.w, h: page.h });
        this.loaded.set(i, page);
        return page;
      }).finally(() => this.loading.delete(i));
      this.loading.set(i, p);
    }
    return p;
  }

  release(i: number) {
    const p = this.loaded.get(i);
    if (p) { URL.revokeObjectURL(p.url); this.loaded.delete(i); }
  }

  /** Free every page outside [lo, hi]. */
  keepOnly(lo: number, hi: number) {
    for (const i of [...this.loaded.keys()]) if (i < lo || i > hi) this.release(i);
  }

  dispose() {
    this.disposed = true;
    for (const i of [...this.loaded.keys()]) this.release(i);
    this.loading.clear();
  }
}
