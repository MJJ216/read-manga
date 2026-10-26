import { useEffect, useRef, useState } from 'preact/hooks';

export interface MenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
}

/** Three-dot button that opens a small popover; closes on pick or on a tap anywhere else. */
export function Menu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div class="menu" ref={root}>
      <button class="dots" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋮</button>
      {open && (
        <div class="popover" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" class={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
