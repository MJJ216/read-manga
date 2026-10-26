import { useEffect, useRef, useState } from 'preact/hooks';
import {
  addBookmark, getBook, getData, listBookmarks, removeBookmark, updateBookPrefs, updateProgress, type Book,
} from './db';
import { PageCache } from './pageCache';
import { openSource } from './pages';
import { percentOf } from './progress';
import { PagedView, type Nav } from './PagedView';
import { updateSettings, useSettings, type Direction, type Fit, type Mode } from './settings';
import { WebtoonView } from './WebtoonView';

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange(v: T): void;
}) {
  return (
    <div class="choice">
      <span>{label}</span>
      <div>
        {options.map(([v, text]) => (
          <button key={v} class={`chip${v === value ? ' on' : ''}`} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export function Reader({ id, onClose }: { id: string; onClose: () => void }) {
  const settings = useSettings();
  const [book, setBook] = useState<Book>();
  const [cache, setCache] = useState<PageCache>();
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState({ page: 0, nonce: 0 });
  const [mode, setMode] = useState<Mode>('single');
  const [direction, setDirection] = useState<Direction>('ltr');
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'' | 'settings' | 'marks'>('');
  const [marks, setMarks] = useState<number[]>([]);
  const [error, setError] = useState('');
  const nav = useRef<Nav | undefined>(undefined);

  useEffect(() => {
    let dead = false;
    let made: { cache: PageCache; close(): void } | undefined;
    (async () => {
      try {
        const b = await getBook(id);
        const data = await getData(id);
        if (!b || !data) throw new Error('ไม่พบหนังสือ');
        const s = await openSource(b, data);
        if (dead) return s.close();
        const c = new PageCache(s);
        made = { cache: c, close: () => s.close() };
        const start = Math.min(b.lastPage, b.pageCount - 1);
        setMode(b.readingMode ?? settings.defaultMode);
        setDirection(b.direction ?? settings.defaultDirection);
        setPage(start);
        setJump({ page: start, nonce: 0 });
        setMarks((await listBookmarks(id)).map((m) => m.pageIndex));
        if (dead) return; // the effect cleanup already disposed `made`
        setBook(b);
        setCache(c);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => { dead = true; made?.cache.dispose(); made?.close(); };
  }, [id]);

  useEffect(() => { if (book) void updateProgress(id, page); }, [page, book]);

  const changeMode = (m: Mode) => {
    setMode(m);
    setJump((j) => ({ page, nonce: j.nonce + 1 }));
    updateSettings({ defaultMode: m });
    void updateBookPrefs(id, { readingMode: m, direction });
  };
  const changeDirection = (d: Direction) => {
    setDirection(d);
    updateSettings({ defaultDirection: d });
    void updateBookPrefs(id, { readingMode: mode, direction: d });
  };
  const seek = (p: number) => { setPage(p); setJump((j) => ({ page: p, nonce: j.nonce + 1 })); };

  const marked = marks.includes(page);
  const toggleBookmark = () => {
    if (marked) {
      setMarks((m) => m.filter((p) => p !== page));
      void removeBookmark(id, page);
    } else {
      setMarks((m) => [...m, page].sort((a, b) => a - b));
      void addBookmark(id, page);
    }
  };
  const dropBookmark = (p: number) => {
    setMarks((m) => m.filter((x) => x !== p));
    void removeBookmark(id, p);
  };

  // Desktop keyboard: arrows turn pages (mirrored in RTL), Escape goes back to the library.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const flip = direction === 'rtl' && mode !== 'webtoon';
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') (e.key === 'ArrowRight' && flip ? nav.current?.prev() : nav.current?.next());
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') (e.key === 'ArrowLeft' && flip ? nav.current?.next() : nav.current?.prev());
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      keys.current(e);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  if (error) return <div class="reader"><p class="status error">{error}</p><button class="chunky" onClick={onClose}>กลับ</button></div>;
  if (!book || !cache) return <div class="reader"><p class="status">กำลังเปิด…</p></div>;

  const rtl = direction === 'rtl' && mode !== 'webtoon';
  const toggleMenu = () => setMenu((m) => { if (m) setSheet(''); return !m; });
  const toggleSheet = (s: 'settings' | 'marks') => setSheet((cur) => (cur === s ? '' : s));

  return (
    <div class="reader">
      {mode === 'webtoon' ? (
        <WebtoonView count={book.pageCount} cache={cache} jump={jump} onPage={setPage} onToggleMenu={toggleMenu} nav={nav} />
      ) : (
        <PagedView count={book.pageCount} cache={cache} mode={mode} direction={direction} fit={settings.fit}
          coverAlone={settings.coverAlone} page={page} onPage={setPage} onToggleMenu={toggleMenu} nav={nav}
          onError={setError} />
      )}
      {menu && (
        <>
          <div class="topbar">
            <button class="ibtn" aria-label="กลับ" onClick={onClose}>←</button>
            <span class="grow">{book.title}</span>
            <button class={`ibtn${marked ? ' lit' : ''}`} aria-label={marked ? 'ลบบุ๊กมาร์ก' : 'เพิ่มบุ๊กมาร์ก'} onClick={toggleBookmark}>{marked ? '★' : '☆'}</button>
            <button class="ibtn" aria-label="รายการบุ๊กมาร์ก" onClick={() => toggleSheet('marks')}>☰{marks.length ? <sup>{marks.length}</sup> : ''}</button>
            <button class="ibtn" aria-label="ตั้งค่า" onClick={() => toggleSheet('settings')}>⚙</button>
          </div>
          {sheet === 'marks' && (
            <div class="sheet">
              {!marks.length && <p>ยังไม่มีบุ๊กมาร์ก — แตะ ☆ เพื่อเก็บหน้านี้</p>}
              {marks.map((p) => (
                <div class="mark" key={p}>
                  <button class="chip grow" onClick={() => { seek(p); setSheet(''); }}>หน้า {p + 1}</button>
                  <button class="ibtn" aria-label={`ลบบุ๊กมาร์กหน้า ${p + 1}`} onClick={() => dropBookmark(p)}>✕</button>
                </div>
              ))}
            </div>
          )}
          {sheet === 'settings' && (
            <div class="sheet">
              <Choice label="โหมด" value={mode} onChange={changeMode}
                options={[['single', '1 หน้า'], ['double', '2 หน้า'], ['webtoon', 'เลื่อนลง']]} />
              {mode !== 'webtoon' && (
                <Choice label="ทิศทาง" value={direction} onChange={changeDirection}
                  options={[['ltr', 'ซ้าย→ขวา'], ['rtl', 'ขวา→ซ้าย (มังงะ)']]} />
              )}
              {mode !== 'webtoon' && (
                <Choice<Fit> label="ขนาดภาพ" value={settings.fit} onChange={(fit) => updateSettings({ fit })}
                  options={[['contain', 'พอดีจอ'], ['width', 'เต็มกว้าง'], ['height', 'เต็มสูง']]} />
              )}
              {mode === 'double' && (
                <Choice<'on' | 'off'> label="ปกอยู่หน้าเดียว" value={settings.coverAlone ? 'on' : 'off'}
                  onChange={(v) => updateSettings({ coverAlone: v === 'on' })} options={[['on', 'เปิด'], ['off', 'ปิด']]} />
              )}
            </div>
          )}
          <div class="bottombar">
            <button class="ibtn" aria-label="หน้าซ้าย" onClick={() => (rtl ? nav.current?.next() : nav.current?.prev())}>‹</button>
            <input type="range" min={0} max={book.pageCount - 1} value={page} dir={rtl ? 'rtl' : 'ltr'}
              onInput={(e) => seek(Number((e.target as HTMLInputElement).value))} />
            <span class="pos">{page + 1}/{book.pageCount} หน้า · {percentOf(page + 1, book.pageCount)}%</span>
            <button class="ibtn" aria-label="หน้าขวา" onClick={() => (rtl ? nav.current?.prev() : nav.current?.next())}>›</button>
          </div>
        </>
      )}
    </div>
  );
}
