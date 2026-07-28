import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker updates, held until they are safe to apply.
 *
 * The worker registers in `prompt` mode (see vite.config.ts), so a new deploy
 * waits instead of activating and reloading the page by itself. That matters on
 * a sideline. A reload costs no data — state re-folds from the event log in
 * IndexedDB, which is the point of the architecture — but blanking the screen
 * mid-substitution is the worst possible moment to spend even a second.
 *
 * So: the game screen suppresses the offer outright while the clock is live,
 * everywhere else it is one tap, and it applies on the next cold launch anyway.
 */

let needRefresh = false;
let suppressCount = 0;
let applyUpdate: (() => void) | null = null;

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// A new version is worth offering only when one is waiting and nothing has
// asked us to hold off.
const getSnapshot = () => needRefresh && suppressCount === 0;

export function registerServiceWorker(): void {
  const update = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
  });
  // `true` tells the waiting worker to take over, which reloads the page.
  applyUpdate = () => void update(true);
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function applyPendingUpdate(): void {
  applyUpdate?.();
}

/**
 * Hold back the update offer while `active`. Counted rather than a boolean so
 * overlapping callers cannot clear each other's hold.
 */
export function useSuppressUpdates(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    suppressCount += 1;
    emit();
    return () => {
      suppressCount -= 1;
      emit();
    };
  }, [active]);
}

/** Running from the home screen rather than a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // The iOS-only flag, and still the only reliable signal on older Safari.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  // iPadOS 13+ claims to be a Mac; the touch-point count gives it away.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Only Safari can add to the home screen. Chrome, Firefox and Edge on iOS are
 * WebKit underneath but expose no such option, so they need sending elsewhere.
 */
function isIosSafari(): boolean {
  return isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
}

export type InstallHint = 'add-to-home-screen' | 'open-in-safari' | null;

const DISMISS_KEY = 'subtime.install-hint-dismissed';

/**
 * What, if anything, to tell the user about installing.
 *
 * iOS fires no `beforeinstallprompt`, so nothing in the browser will ever
 * volunteer that installing is possible — and used as a tab the app loses the
 * wake lock, the full-screen pitch, and storage that survives a week unopened.
 * The hint is the only thing standing between opening a link and losing all of
 * that silently.
 */
export function useInstallHint(): { hint: InstallHint; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Private browsing can throw on access; treat it as "not dismissed".
      return false;
    }
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Nothing to do — the hint just returns next launch.
    }
  }, []);

  if (dismissed || !isIos() || isInstalled()) return { hint: null, dismiss };
  return { hint: isIosSafari() ? 'add-to-home-screen' : 'open-in-safari', dismiss };
}
