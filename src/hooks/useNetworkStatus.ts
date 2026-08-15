import { useState, useEffect } from 'react';

/**
 * Lightweight network detection for the desktop client.
 *
 * The check is useful while the UI is active, but polling a hidden WebView adds
 * wakeups with no user-visible benefit. Hidden TCloud windows therefore pause
 * the timer and perform one immediate check when they become visible again.
 */
export function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        let disposed = false;
        let interval: ReturnType<typeof setInterval> | null = null;
        let checkNetwork: (() => Promise<void>) | null = null;

        const stopPolling = () => {
            if (interval !== null) {
                clearInterval(interval);
                interval = null;
            }
        };

        const startPolling = () => {
            stopPolling();
            if (document.visibilityState !== 'visible' || !checkNetwork) return;
            interval = setInterval(() => { void checkNetwork?.(); }, 30_000);
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                void checkNetwork?.();
                startPolling();
            } else {
                stopPolling();
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);

        void import('@tauri-apps/api/core').then(({ invoke }) => {
            if (disposed) return;
            checkNetwork = async () => {
                if (disposed || document.visibilityState !== 'visible') return;
                try {
                    const available = await invoke<boolean>('cmd_is_network_available');
                    if (!disposed) setIsOnline(available);
                } catch {
                    if (!disposed) setIsOnline(false);
                }
            };

            void checkNetwork();
            startPolling();
        });

        return () => {
            disposed = true;
            stopPolling();
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return isOnline;
}
