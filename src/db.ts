import { openDB, type DBSchema } from 'idb';

export interface Book {
  id: string;
  title: string;
  kind: 'cbz' | 'images' | 'pdf';
  /** Entry names for cbz, file names for images, empty for pdf. */
  pageNames: string[];
  pageCount: number;
  cover: Blob;
  fileSize: number;
  fingerprint: string;
  addedAt: number;
  lastReadAt: number;
  lastPage: number;
  /** Name of the collection this book is grouped under; absent = not in a collection. */
  collection?: string;
  /** Per-book overrides; absent means "use the defaults from settings". */
  readingMode?: 'single' | 'double' | 'webtoon';
  direction?: 'ltr' | 'rtl';
}

// cbz/pdf: the original file as one Blob; images: the picked files in page order.
export type BookData = Blob | Blob[];

export interface Bookmark {
  bookId: string;
  pageIndex: number;
  createdAt: number;
}

interface Schema extends DBSchema {
  books: { key: string; value: Book };
  data: { key: string; value: BookData };
  bookmarks: { key: [string, number]; value: Bookmark; indexes: { byBook: string } };
}

const dbp = openDB<Schema>('chunky-reader', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('data');
    }
    if (oldVersion < 2) {
      db.createObjectStore('bookmarks', { keyPath: ['bookId', 'pageIndex'] }).createIndex('byBook', 'bookId');
    }
  },
});

export const listBooks = async () => (await dbp).getAll('books');
export const getBook = async (id: string) => (await dbp).get('books', id);
export const getData = async (id: string) => (await dbp).get('data', id);

export async function saveBook(book: Book, data: BookData) {
  const tx = (await dbp).transaction(['books', 'data'], 'readwrite');
  tx.objectStore('books').put(book);
  tx.objectStore('data').put(data, book.id);
  await tx.done;
}

// Read-modify-write in one transaction so concurrent progress/prefs updates can't drop each other.
async function patchBook(id: string, patch: (b: Book) => Partial<Book>) {
  const tx = (await dbp).transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...book, ...patch(book) });
  await tx.done;
}

export const updateProgress = (id: string, lastPage: number) => patchBook(id, () => ({ lastPage, lastReadAt: Date.now() }));

export const updateBookPrefs = (id: string, prefs: Pick<Book, 'readingMode' | 'direction'>) => patchBook(id, () => prefs);

/** Put books into the named collection, or take them out of any collection when `name` is undefined. */
export async function setCollection(ids: string[], name: string | undefined) {
  const tx = (await dbp).transaction('books', 'readwrite');
  for (const id of ids) {
    const book = await tx.store.get(id);
    if (!book) continue;
    const { collection: _old, ...rest } = book;
    await tx.store.put(name ? { ...rest, collection: name } : rest);
  }
  await tx.done;
}

export async function deleteBook(id: string) {
  const tx = (await dbp).transaction(['books', 'data', 'bookmarks'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('data').delete(id);
  const marks = tx.objectStore('bookmarks');
  for (const key of await marks.index('byBook').getAllKeys(id)) await marks.delete(key);
  await tx.done;
}

export async function listBookmarks(bookId: string) {
  const marks = await (await dbp).getAllFromIndex('bookmarks', 'byBook', bookId);
  return marks.sort((a, b) => a.pageIndex - b.pageIndex);
}

export async function addBookmark(bookId: string, pageIndex: number) {
  await (await dbp).put('bookmarks', { bookId, pageIndex, createdAt: Date.now() });
}

export async function removeBookmark(bookId: string, pageIndex: number) {
  await (await dbp).delete('bookmarks', [bookId, pageIndex]);
}
