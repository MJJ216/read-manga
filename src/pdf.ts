import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSource } from './pages';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// iOS Safari limits a canvas to ~16.7M pixels; stay well under it.
const MAX_PIXELS = 12_000_000;
const MIN_WIDTH = 1000;
const MAX_WIDTH = 2400;

// Serves byte ranges straight from the stored Blob, so a large PDF is never read into memory whole.
class BlobRangeTransport extends pdfjs.PDFDataRangeTransport {
  constructor(private blob: Blob) {
    super(blob.size, null);
  }
  requestDataRange(begin: number, end: number) {
    void this.blob.slice(begin, end).arrayBuffer().then((buf) => this.onDataRange(begin, new Uint8Array(buf)));
  }
}

async function load(blob: Blob) {
  const attempt = async (task: pdfjs.PDFDocumentLoadingTask) => ({ task, doc: await task.promise });
  try {
    return await attempt(pdfjs.getDocument({ range: new BlobRangeTransport(blob), disableAutoFetch: true, disableStream: true }));
  } catch {
    // Range transport not usable: fall back to reading the file once.
    return attempt(pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }));
  }
}

/** A PDF exposed as the same page-image source the CBZ reader uses; pages are rasterised on demand. */
export async function openPdf(blob: Blob): Promise<PageSource> {
  const { task, doc } = await load(blob);
  const targetWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Math.max(innerWidth, 360) * Math.min(devicePixelRatio || 1, 3) * 1.5)));
  let queue: Promise<unknown> = Promise.resolve();

  const render = async (i: number): Promise<Blob> => {
    const page = await doc.getPage(i + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      let scale = targetWidth / base.width;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const out = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/jpeg', 0.9));
      canvas.width = canvas.height = 0;
      return out;
    } finally {
      page.cleanup();
    }
  };

  return {
    count: doc.numPages,
    // One page at a time: several full-size canvases at once can exhaust memory on phones.
    get(i) {
      const run = queue.then(() => render(i));
      queue = run.catch(() => {});
      return run;
    },
    close() { void task.destroy(); },
  };
}
