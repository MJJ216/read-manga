import { useEffect, useState } from 'preact/hooks';

export type Mode = 'single' | 'double' | 'webtoon';
export type Direction = 'ltr' | 'rtl';
export type Fit = 'contain' | 'width' | 'height';

export interface Settings {
  /** Defaults for books that have no mode/direction of their own. */
  defaultMode: Mode;
  defaultDirection: Direction;
  fit: Fit;
  /** Double-page mode: show the first page (cover) on its own. */
  coverAlone: boolean;
}

const KEY = 'chunky-settings';
const DEFAULTS: Settings = { defaultMode: 'single', defaultDirection: 'ltr', fit: 'contain', coverAlone: true };

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    // Unknown keys from older versions (e.g. a saved theme) are ignored.
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULTS)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory only */ }
  listeners.forEach((l) => l(current));
}

export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}
