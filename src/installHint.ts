const KEY = 'chunky-install-hint-dismissed';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iOS evicts site data of non-installed web apps after ~7 days unused, so nudge people to install first. */
export function needsInstallHint() {
  try {
    return isIos() && !isStandalone() && localStorage.getItem(KEY) !== '1';
  } catch {
    return isIos() && !isStandalone();
  }
}

export function dismissInstallHint() {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: it will just show again */ }
}
