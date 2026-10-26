import { saveBook, listBooks, type Book } from './db';
import { isImageName, listCbzPages, makeCover, naturalSort, openSource } from './pages';

const stem = (n: string) => n.replace(/\.[^.]+$/, '');
const fingerprintOf = (files: File[]) => files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');

export class ImportError extends Error {}

type Job = { kind: 'cbz' | 'pdf'; files: [File] } | { kind: 'images'; files: File[] };

export interface ImportResult {
  added: Book[];
  errors: string[];
  cancelled: boolean;
}

export interface ImportOptions {
  /** Called before each book starts, with its name and 1-based position. */
  onProgress?(name: string, index: number, total: number): void;
  signal?: AbortSignal;
}

function planJobs(files: File[]): Job[] {
  const jobs: Job[] = [];
  for (const f of files) {
    if (/\.(cbz|zip)$/i.test(f.name)) jobs.push({ kind: 'cbz', files: [f] });
    else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') jobs.push({ kind: 'pdf', files: [f] });
  }
  const images = files.filter((f) => isImageName(f.name)).sort((a, b) => naturalSort(a.name, b.name));
  if (images.length) jobs.push({ kind: 'images', files: images });
  return jobs;
}

/** Each CBZ/ZIP and each PDF becomes its own book; all picked images together become one book. */
export async function importFiles(files: File[], { onProgress, signal }: ImportOptions = {}): Promise<ImportResult> {
  const jobs = planJobs(files);
  if (!jobs.length) throw new ImportError('ไม่รองรับไฟล์ที่เลือก (ใช้ CBZ/ZIP, PDF หรือรูปภาพ)');

  const result: ImportResult = { added: [], errors: [], cancelled: false };
  for (const [n, job] of jobs.entries()) {
    if (signal?.aborted) { result.cancelled = true; break; }
    const name = job.kind === 'images' ? `${job.files.length} รูป` : job.files[0].name;
    onProgress?.(name, n + 1, jobs.length);
    try {
      result.added.push(await importJob(job));
    } catch (e) {
      const msg = e instanceof ImportError ? e.message
        : (e as DOMException).name === 'QuotaExceededError' ? 'พื้นที่เก็บข้อมูลเต็ม'
        : `นำเข้าไม่สำเร็จ: ${(e as Error).message}`;
      result.errors.push(jobs.length > 1 ? `${name}: ${msg}` : msg);
    }
  }
  return result;
}

async function importJob(job: Job): Promise<Book> {
  const fingerprint = fingerprintOf(job.files);
  if ((await listBooks()).some((b) => b.fingerprint === fingerprint)) throw new ImportError('นำเข้าเล่มนี้แล้ว');

  const now = Date.now();
  const base = { id: crypto.randomUUID(), fingerprint, addedAt: now, lastReadAt: 0, lastPage: 0 };
  let book: Omit<Book, 'cover'>;
  let data: Blob | Blob[];
  let first: Blob;

  if (job.kind === 'cbz') {
    const file = job.files[0];
    let pageNames: string[];
    try {
      pageNames = await listCbzPages(file);
    } catch {
      throw new ImportError('ไฟล์ซิปเสียหรืออ่านไม่ได้');
    }
    if (!pageNames.length) throw new ImportError('ไม่พบรูปภาพในไฟล์');
    book = { ...base, title: stem(file.name), kind: 'cbz', pageNames, pageCount: pageNames.length, fileSize: file.size };
    data = file;
    const src = await openSource({ ...book, cover: file }, file);
    try { first = await src.get(0); } finally { src.close(); }
  } else if (job.kind === 'pdf') {
    const file = job.files[0];
    const probe = { ...base, title: stem(file.name), kind: 'pdf' as const, pageNames: [], pageCount: 0, fileSize: file.size, cover: file };
    let count: number;
    try {
      const src = await openSource(probe, file);
      try { count = src.count; first = await src.get(0); } finally { src.close(); }
    } catch {
      throw new ImportError('ไฟล์ PDF เสียหรือเปิดไม่ได้');
    }
    if (!count) throw new ImportError('PDF ไม่มีหน้า');
    book = { ...base, title: probe.title, kind: 'pdf', pageNames: [], pageCount: count, fileSize: file.size };
    data = file;
  } else {
    const images = job.files;
    book = { ...base, title: stem(images[0].name), kind: 'images', pageNames: images.map((f) => f.name),
      pageCount: images.length, fileSize: images.reduce((s, f) => s + f.size, 0) };
    data = images;
    first = images[0];
  }

  const full = { ...book, cover: await makeCover(first) };
  await saveBook(full, data);
  return full;
}
