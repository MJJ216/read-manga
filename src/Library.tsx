import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { deleteBook, listBooks, type Book } from './db';
import { importFiles, ImportError } from './importer';
import { dismissInstallHint, needsInstallHint } from './installHint';
import { updateSettings, useSettings, type Theme } from './settings';

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON: Record<Theme, string> = { system: '🌓', light: '☀', dark: '🌙' };

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
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [usage, setUsage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const settings = useSettings();
  const abort = useRef<AbortController | undefined>(undefined);
  const [hint, setHint] = useState(needsInstallHint);

  const refresh = async () => {
    setBooks(await listBooks());
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) setUsage(`${(est.usage / 1048576).toFixed(0)} MB ที่ใช้`);
  };
  useEffect(() => { void refresh(); }, []);

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

  const shown = useMemo(() => {
    const f = books.filter((b) => b.title.toLowerCase().includes(q.toLowerCase()));
    return f.sort(sort === 'title'
      ? (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })
      : (a, b) => Math.max(b.lastReadAt, b.addedAt) - Math.max(a.lastReadAt, a.addedAt));
  }, [books, q, sort]);

  return (
    <main class="library">
      <header>
        <input class="chunky" type="search" placeholder="ค้นหา" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="chunky" onClick={() => setSort(sort === 'recent' ? 'title' : 'recent')}>
          {sort === 'recent' ? 'ล่าสุด' : 'ชื่อ'}
        </button>
        <button class="chunky" aria-label="ธีม" onClick={() => updateSettings({ theme: THEME_NEXT[settings.theme] })}>
          {THEME_ICON[settings.theme]}
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
      {!books.length && !busy && <p class="status">ยังไม่มีหนังสือ — แตะ “นำเข้า” เพื่อเลือกไฟล์ CBZ, PDF หรือรูปภาพ</p>}
      <div class="grid">
        {shown.map((b) => (
          <div class="card" key={b.id}>
            <button class="cover" onClick={() => onOpen(b.id)}>
              <Cover blob={b.cover} />
              <span class="bar"><i style={{ width: `${((b.lastPage + 1) / b.pageCount) * 100}%` }} /></span>
            </button>
            <div class="meta">
              <span class="title">{b.title}</span>
              <button class="chunky small" aria-label="ลบ" onClick={() => remove(b)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {usage && <footer>{usage}</footer>}
    </main>
  );
}
