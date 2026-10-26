import type { Book } from './db';

/** Pages read so far; a book that was never opened counts as 0 (lastPage defaults to 0 too). */
export const pagesRead = (b: Book) => (b.lastReadAt ? b.lastPage + 1 : 0);

export const percentOf = (read: number, total: number) => (total ? Math.round((read / total) * 100) : 0);

export function statsOf(books: Book[]) {
  const read = books.reduce((s, b) => s + pagesRead(b), 0);
  const total = books.reduce((s, b) => s + b.pageCount, 0);
  return { read, total, pct: percentOf(read, total) };
}

export function progressLabel(read: number, total: number) {
  return read ? `อ่านแล้ว ${read}/${total} หน้า · ${percentOf(read, total)}%` : `ยังไม่ได้อ่าน · ${total} หน้า`;
}
