import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import type { Book, BookData } from './db';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};
const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isImageName = (name: string) => ext(name) in MIME;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalSort = (a: string, b: string) => collator.compare(a, b);

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\._/i;

/** Reads only the zip central directory; no page data is decompressed. */
export async function listCbzPages(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  const entries = await reader.getEntries();
  await reader.close();
  return entries
    .filter((e): e is FileEntry => !e.directory && !JUNK.test(e.filename) && isImageName(e.filename))
    .map((e) => e.filename)
    .sort(naturalSort);
}

export interface PageSource {
  count: number;
  get(i: number): Promise<Blob>;
  close(): void;
}

export async function openSource(book: Book, data: BookData): Promise<PageSource> {
  if (book.kind === 'pdf') {
    // pdf.js is large; only load it when a PDF is actually opened.
    const { openPdf } = await import('./pdf');
    return openPdf(data as Blob);
  }
  if (Array.isArray(data)) {
    return { count: data.length, get: async (i) => data[i], close() {} };
  }
  const reader = new ZipReader(new BlobReader(data));
  const entries = new Map<string, FileEntry>();
  for (const e of await reader.getEntries()) if (!e.directory) entries.set(e.filename, e);
  return {
    count: book.pageCount,
    async get(i) {
      const name = book.pageNames[i];
      const entry = entries.get(name);
      if (!entry) throw new Error(`Missing page: ${name}`);
      return entry.getData(new BlobWriter(MIME[ext(name)]));
    },
    close() { void reader.close(); },
  };
}

export async function makeCover(first: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(first);
  const w = 320;
  const h = Math.round((bmp.height / bmp.width) * w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('cover failed'))), 'image/jpeg', 0.8),
  );
}
