import { reduceImageMemoryCachesForBackground } from './imagePreviewCache';
import { trimFolderNavigationCacheForBackground } from './tcloudFolderNavigationCache';

const MEMORY_TRIM_DELAY_MS = 60_000;
const NAV_TRIM_DELAY_MS = 120_000;

let installed = false;
let memoryTrimTimer: number | null = null;
let navTrimTimer: number | null = null;

const clearTimers = () => {
    if (memoryTrimTimer !== null) {
        window.clearTimeout(memoryTrimTimer);
        memoryTrimTimer = null;
    }
    if (navTrimTimer !== null) {
        window.clearTimeout(navTrimTimer);
        navTrimTimer = null;
    }
};

const emitState = (hidden: boolean) => {
    window.dispatchEvent(new CustomEvent('tcloud-background-state', {
        detail: { hidden, at: Date.now() },
    }));
};

const enterBackground = () => {
    clearTimers();
    emitState(true);

    memoryTrimTimer = window.setTimeout(() => {
        memoryTrimTimer = null;
        reduceImageMemoryCachesForBackground();
    }, MEMORY_TRIM_DELAY_MS);

    navTrimTimer = window.setTimeout(() => {
        navTrimTimer = null;
        trimFolderNavigationCacheForBackground();
    }, NAV_TRIM_DELAY_MS);
};

const leaveBackground = () => {
    clearTimers();
    emitState(false);

    // Give the first restored frame priority before any listener resumes
    // speculative/background work.
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            window.dispatchEvent(new Event('tcloud-foreground-ready'));
        });
    });
};

export function installTCloudBackgroundEfficiencyController() {
    if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
    installed = true;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') enterBackground();
        else leaveBackground();
    });

    if (document.visibilityState === 'hidden') enterBackground();
}
