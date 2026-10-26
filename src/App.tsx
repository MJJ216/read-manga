import { useEffect, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { Library } from './Library';
import { Reader } from './Reader';

export function App() {
  const [bookId, setBookId] = useState<string | null>(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    const onPop = () => setBookId(history.state?.bookId ?? null);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const open = (id: string) => { history.pushState({ bookId: id }, ''); setBookId(id); };
  const close = () => history.back();

  return (
    <>
      {bookId ? <Reader id={bookId} onClose={close} /> : <Library onOpen={open} />}
      {needRefresh && (
        <button class="chunky toast" onClick={() => updateServiceWorker(true)}>มีเวอร์ชันใหม่ — แตะเพื่ออัปเดต</button>
      )}
    </>
  );
}
