const BASE_RESUME_GRACE_MS = 420;

let resumeUntil = 0;
let blurStartedAt = 0;
let lastUiInteractionAt = 0;
let installed = false;
let classTimer: number | null = null;

const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

const scheduleResumeClassRemoval = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (classTimer !== null) window.clearTimeout(classTimer);

    const delay = Math.max(16, resumeUntil - now() + 24);
    classTimer = window.setTimeout(() => {
        classTimer = null;
        if (now() < resumeUntil) {
            scheduleResumeClassRemoval();
            return;
        }
        document.documentElement.classList.remove('tcloud-window-resuming');
        window.dispatchEvent(new Event('tcloud-ui-resumed'));
    }, delay);
};

export function markTCloudWindowResume(graceMs = BASE_RESUME_GRACE_MS) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const safeGrace = Math.max(120, Math.min(1500, graceMs));
    resumeUntil = Math.max(resumeUntil, now() + safeGrace);
    document.documentElement.classList.add('tcloud-window-resuming');
    window.dispatchEvent(new CustomEvent('tcloud-ui-resume', {
        detail: { resumeUntil },
    }));
    scheduleResumeClassRemoval();
}

export function getTCloudUiResumeDelay(extraMs = 0) {
    return Math.max(0, resumeUntil + Math.max(0, extraMs) - now());
}

export function getTCloudUiIdleDelay(graceMs = 550) {
    return Math.max(0, lastUiInteractionAt + Math.max(0, graceMs) - now());
}

export function getTCloudBackgroundWorkDelay(resumeExtraMs = 0, idleGraceMs = 550) {
    return Math.max(
        getTCloudUiResumeDelay(resumeExtraMs),
        getTCloudUiIdleDelay(idleGraceMs),
    );
}

export function isTCloudUiBackgroundReady(extraMs = 0, idleGraceMs = 550) {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    return getTCloudBackgroundWorkDelay(extraMs, idleGraceMs) <= 0;
}

export function installTCloudWindowResumeController() {
    if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
    installed = true;

    blurStartedAt = now();
    lastUiInteractionAt = now();

    const markInteraction = () => {
        lastUiInteractionAt = now();
    };
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('wheel', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('touchstart', markInteraction, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            markTCloudWindowResume(480);
        }
    });

    window.addEventListener('blur', () => {
        blurStartedAt = now();
    });

    window.addEventListener('focus', () => {
        const awayFor = Math.max(0, now() - blurStartedAt);
        if (awayFor >= 300) {
            markTCloudWindowResume(awayFor >= 3000 ? 460 : 240);
        }
    });

    // Native restore paths (tray click / second launch) emit this event. Load the
    // event bridge lazily so it never delays the first application paint.
    void import('@tauri-apps/api/event')
        .then(({ listen }) => listen('tcloud-window-resumed', () => {
            markTCloudWindowResume(480);
        }))
        .catch(() => {
            // Browser/dev mode can run without the native event bridge.
        });
}
