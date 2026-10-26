import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  deleteBook, listBooks, listCollectionCovers, renameCollection, setCollection, setCollectionCover, type Book,
} from './db';
import { importFiles, ImportError } from './importer';
import { dismissInstallHint, needsInstallHint } from './installHint';
import { Menu } from './Menu';
import { makeCover } from './pages';
import { pagesRead, percentOf, progressLabel, statsOf } from './progress';

const naturalTitle = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const byTitle = (a: Book, b: Book) => naturalTitle(a.title, b.title);
const byRecent = (a: Book, b: Book) => Math.max(b.lastReadAt, b.addedAt) - Math.max(a.lastReadAt, a.addedAt);

type Tile = { kind: 'book'; book: Book } | { kind: 'collection'; name: string; books: Book[] };

// Kept outside the component so coming back from the reader returns to the same collection.
let lastView: string | null = null;

function Cover({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <img src={url} alt="" />;
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [view, setViewState] = useState<string | null>(lastView);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [usage, setUsage] = useState('');
  const [covers, setCovers] = useState<Map<string, Blob>>(new Map());
  const input = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  const [hint, setHint] = useState(needsInstallHint);

  const setView = (v: string | null) => { lastView = v; setViewState(v); };

  const refresh = async () => {
    const [list, customCovers] = await Promise.all([listBooks(), listCollectionCovers()]);
    setBooks(list);
    setCovers(new Map(customCovers.map((c) => [c.name, c.cover])));
    setLoaded(true);
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) setUsage(`${(est.usage / 1048576).toFixed(0)} MB ที่ใช้`);
  };
  useEffect(() => { void refresh(); }, []);

  // A collection that lost its last book (moved out or deleted) no longer exists: go back to the top level.
  useEffect(() => {
    if (loaded && view && !books.some((b) => b.collection === view)) setView(null);
  }, [loaded, books, view]);

  const onPick = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    if (!files.length) return;
    setError('');
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy('กำลังนำเข้า…');
    try {
      const r = await importFiles(files, {
        signal: ctl.signal,
        onProgress: (name, n, total) => setBusy(`กำลังนำเข้า ${n}/${total}: ${name}`),
      });
      const notes = [...r.errors];
      if (r.cancelled) notes.push('ยกเลิกการนำเข้า (เล่มที่เสร็จแล้วยังอยู่)');
      setError(notes.join('\n'));
      await refresh();
    } catch (err) {
      setError(err instanceof ImportError ? err.message : `นำเข้าไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      abort.current = undefined;
      setBusy('');
    }
  };

  const remove = async (b: Book) => {
    if (!confirm(`ลบ "${b.title}" ?`)) return;
    await deleteBook(b.id);
    await refresh();
  };

  const collectionNames = useMemo(
    () => [...new Set(books.flatMap((b) => (b.collection ? [b.collection] : [])))].sort(naturalTitle),
    [books],
  );

  const tiles = useMemo<Tile[]>(() => {
    const query = q.trim().toLowerCase();
    const asBooks = (list: Book[]): Tile[] => list.map((book) => ({ kind: 'book', book }));
    const order = sort === 'title' ? byTitle : byRecent;
    // Searching looks across everything, collections included, and shows matching books directly.
    if (query) {
      return asBooks(books.filter((b) => b.title.toLowerCase().includes(query) || b.collection?.toLowerCase().includes(query)).sort(order));
    }
    // Volumes read best in title order (A1, A2, A10) whatever the top-level sort is.
    if (view) return asBooks(books.filter((b) => b.collection === view).sort(byTitle));
    const groups = new Map<string, Book[]>();
    for (const b of books) if (b.collection) groups.set(b.collection, [...(groups.get(b.collection) ?? []), b]);
    const collections: Tile[] = [...groups].sort(([a], [b]) => naturalTitle(a, b))
      .map(([name, list]) => ({ kind: 'collection', name, books: list.sort(byTitle) }));
    return [...collections, ...asBooks(books.filter((b) => !b.collection).sort(order))];
  }, [books, q, sort, view]);

  const idsOf = (t: Tile) => (t.kind === 'book' ? [t.book.id] : t.books.map((b) => b.id));
  const isSelected = (t: Tile) => idsOf(t).every((id) => selected.has(id));

  const toggle = (t: Tile) => setSelected((cur) => {
    const next = new Set(cur);
    const all = isSelected(t);
    for (const id of idsOf(t)) all ? next.delete(id) : next.add(id);
    return next;
  });

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); setNaming(false); setNewName(''); };

  const assign = async (name: string | undefined) => {
    await setCollection([...selected], name?.trim() || undefined);
    exitSelect();
    await refresh();
  };

  const renameView = async () => {
    const name = prompt('ชื่อคอลเลคชั่นใหม่', view ?? '')?.trim();
    if (!name || name === view) return;
    await renameCollection(view!, name);
    // Update books and view together: with the old name gone, a render in between would reset the view.
    const [list, customCovers] = await Promise.all([listBooks(), listCollectionCovers()]);
    setBooks(list);
    setCovers(new Map(customCovers.map((c) => [c.name, c.cover])));
    setView(name);
  };

  const pickCover = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file || !view) return;
    try {
      await setCollectionCover(view, await makeCover(file));
      await refresh();
    } catch {
      setError('ใช้รูปนี้เป็นปกไม่ได้ ลองเลือกไฟล์รูปอื่น');
    }
  };

  const clearCover = async () => {
    if (!view) return;
    await setCollectionCover(view, undefined);
    await refresh();
  };

  const moveToCollection = (b: Book) => {
    setSelecting(true);
    setSelected(new Set([b.id]));
    setNaming(true);
  };

  const anyInCollection = books.some((b) => selected.has(b.id) && b.collection);

  return (
    <main class="library">
      <header>
        <input class="chunky" type="search" placeholder="ค้นหา" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="chunky" onClick={() => setSort(sort === 'recent' ? 'title' : 'recent')}>
          {sort === 'recent' ? 'ล่าสุด' : 'ชื่อ'}
        </button>
        <button class={`chunky${selecting ? ' on' : ''}`} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
          {selecting ? 'เสร็จ' : 'เลือก'}
        </button>
        <button class="chunky primary" disabled={!!busy} onClick={() => input.current?.click()}>＋ นำเข้า</button>
        {/* No `accept`: iOS can't map .cbz to a file type and greys those files out; importFiles checks names itself. */}
        <input ref={input} type="file" hidden multiple onChange={onPick} />
      </header>
      {hint && (
        <p class="status hint">
          บน iPhone/iPad ให้กด แชร์ → “เพิ่มไปยังหน้าจอโฮม” ก่อนนำเข้าไฟล์ ไม่เช่นนั้น Safari อาจลบข้อมูลที่เก็บไว้เมื่อไม่ได้เปิดใช้งานหลายวัน
          <button class="chunky small" onClick={() => { dismissInstallHint(); setHint(false); }}>เข้าใจแล้ว</button>
        </p>
      )}
      {busy && (
        <p class="status">
          {busy} <button class="chunky small" onClick={() => abort.current?.abort()}>ยกเลิก</button>
        </p>
      )}
      {error && <p class="status error" style={{ whiteSpace: 'pre-line' }}>{error}</p>}
      {view && !q.trim() && (
        <div class="crumb">
          <button class="chunky small" onClick={() => setView(null)}>← ทั้งหมด</button>
          <strong class="grow">{view}</strong>
          <Menu label="ตัวเลือกคอลเลคชั่น" items={[
            { label: 'เปลี่ยนชื่อ', onClick: renameView },
            { label: 'ตั้งรูปปก', onClick: () => coverInput.current?.click() },
            ...(covers.has(view) ? [{ label: 'ใช้ปกจากเล่มแรก', onClick: clearCover }] : []),
          ]} />
          <input ref={coverInput} type="file" accept="image/*" hidden onChange={pickCover} />
        </div>
      )}
      {loaded && !books.length && !busy && <p class="status">ยังไม่มีหนังสือ — แตะ “นำเข้า” เพื่อเลือกไฟล์ CBZ, PDF หรือรูปภาพ</p>}
      <div class="grid">
        {tiles.map((t) => {
          const key = t.kind === 'book' ? t.book.id : `c:${t.name}`;
          const cover = t.kind === 'book' ? t.book.cover : covers.get(t.name) ?? t.books[0].cover;
          const stats = t.kind === 'book' ? { read: pagesRead(t.book), total: t.book.pageCount } : statsOf(t.books);
          const title = t.kind === 'book' ? t.book.title : t.name;
          const sel = selecting && isSelected(t);
          return (
            <div class={`card${t.kind === 'collection' ? ' stack' : ''}`} key={key}>
              <button class={`cover${sel ? ' selected' : ''}`} onClick={() => {
                if (selecting) toggle(t);
                else if (t.kind === 'book') onOpen(t.book.id);
                else setView(t.name);
              }}>
                <Cover blob={cover} />
                {t.kind === 'collection' && <span class="badge">{t.books.length} เล่ม</span>}
                {selecting && <span class="check">{sel ? '✓' : ''}</span>}
              </button>
              <div class="meta">
                <span class="title">{title}</span>
                {!selecting && t.kind === 'book' && (
                  <Menu label={`ตัวเลือก ${title}`} items={[
                    { label: 'จัดเข้าคอลเลคชั่น', onClick: () => moveToCollection(t.book) },
                    { label: 'ลบ', danger: true, onClick: () => remove(t.book) },
                  ]} />
                )}
              </div>
              <div class="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentOf(stats.read, stats.total)}>
                <i style={{ width: `${percentOf(stats.read, stats.total)}%` }} />
              </div>
              <div class="sub">
                {progressLabel(stats.read, stats.total)}
                {t.kind === 'book' && q.trim() && t.book.collection ? ` · 📁 ${t.book.collection}` : ''}
              </div>
            </div>
          );
        })}
      </div>
      {usage && <footer>{usage}</footer>}
      {selecting && (
        <div class="selbar">
          {naming ? (
            <div class="naming">
              {collectionNames.length > 0 && (
                <div class="chips">
                  {collectionNames.map((n) => <button key={n} class="chunky small" onClick={() => assign(n)}>📁 {n}</button>)}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void assign(newName); }}>
                <input class="chunky" placeholder="ชื่อคอลเลคชั่นใหม่ เช่น Manga-A" value={newName}
                  onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
                <button class="chunky primary" type="submit" disabled={!newName.trim()}>ตกลง</button>
              </form>
            </div>
          ) : (
            <>
              <span class="grow">เลือกแล้ว {selected.size} เล่ม</span>
              {anyInCollection && <button class="chunky" disabled={!selected.size} onClick={() => assign(undefined)}>นำออก</button>}
              <button class="chunky primary" disabled={!selected.size} onClick={() => setNaming(true)}>📁 จัดเข้าคอลเลคชั่น</button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
