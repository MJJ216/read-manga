import { useEffect, useState } from 'preact/hooks';

export type Theme = 'system' | 'light' | 'dark';
export type Mode = 'single' | 'double' | 'webtoon';
export type Direction = 'ltr' | 'rtl';
export type Fit = 'contain' | 'width' | 'height';

export interface Settings {
  theme: Theme;
  /** Defaults for books that have no mode/direction of their own. */
  defaultMode: Mode;
  defaultDirection: Direction;
  fit: Fit;
  /** Double-page mode: show the first page (cover) on its own. */
  coverAlone: boolean;
}

const KEY = 'chunky-settings';
const DEFAULTS: Settings = { theme: 'system', defaultMode: 'single', defaultDirection: 'ltr', fit: 'contain', coverAlone: true };

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory only */ }
  if (patch.theme) applyTheme(current.theme);
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

applyTheme(current.theme);
