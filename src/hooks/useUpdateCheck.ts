import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { prepareRollback, cancelRollback } from '../services/tcloudCompletion';


function updaterUnavailableMessage(error: unknown): string | null {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const normalized = raw.toLowerCase();
    if (normalized.includes('endpoint') || normalized.includes('pubkey') || normalized.includes('public key') || normalized.includes('not configured') || normalized.includes('no current version')) {
        return 'Atualizações automáticas ainda não estão configuradas para este build.';
    }
    return null;
}

interface UpdateState {
    checking: boolean;
    available: boolean;
    downloading: boolean;
    progress: number;
    error: string | null;
    version: string | null;
}

export function useUpdateCheck() {
    const [state, setState] = useState<UpdateState>({
        checking: false,
        available: false,
        downloading: false,
        progress: 0,
        error: null,
        version: null,
    });
    const [update, setUpdate] = useState<Update | null>(null);

    const checkForUpdates = useCallback(async () => {
        setState(s => ({ ...s, checking: true, error: null }));
        try {
            const updateInfo = await check();
            if (updateInfo) {
                setUpdate(updateInfo);
                setState(s => ({
                    ...s,
                    checking: false,
                    available: true,
                    version: updateInfo.version,
                }));
            } else {
                setState(s => ({ ...s, checking: false, available: false }));
            }
        } catch (err: unknown) {
            const message = updaterUnavailableMessage(err) ?? (err instanceof Error ? err.message : 'Não foi possível verificar atualizações');
            setState(s => ({
                ...s,
                checking: false,
                error: message,
            }));
        }
    }, []);

    const downloadAndInstall = useCallback(async () => {
        if (!update) return;

        setState(s => ({ ...s, downloading: true, progress: 0 }));
        let downloaded = 0;
        let contentLength = 0;

        try {
            await prepareRollback(update.version);
            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    const data = event.data as { contentLength?: number };
                    contentLength = data.contentLength || 0;
                } else if (event.event === 'Progress') {
                    const data = event.data as { chunkLength?: number };
                    downloaded += data.chunkLength || 0;
                    if (contentLength > 0) {
                        const pct = Math.round((downloaded / contentLength) * 100);
                        setState(s => ({ ...s, progress: Math.min(pct, 100) }));
                    }
                }
            });

            await relaunch();
        } catch (err: unknown) {
            await cancelRollback().catch(() => {});
            const message = err instanceof Error ? err.message : 'Não foi possível instalar a atualização';
            setState(s => ({
                ...s,
                downloading: false,
                error: message,
            }));
        }
    }, [update]);

    const dismissUpdate = useCallback(() => {
        setState(s => ({ ...s, available: false }));
        setUpdate(null);
    }, []);

    useEffect(() => {
        let idleId: number | null = null;
        const timer = window.setTimeout(() => {
            if (document.visibilityState !== 'visible') return;
            const run = () => { void checkForUpdates().catch(() => {}); };
            if ('requestIdleCallback' in window) {
                idleId = window.requestIdleCallback(run, { timeout: 5000 });
            } else {
                run();
            }
        }, 30_000);

        return () => {
            window.clearTimeout(timer);
            if (idleId !== null && 'cancelIdleCallback' in window) {
                window.cancelIdleCallback(idleId);
            }
        };
    }, [checkForUpdates]);

    return {
        ...state,
        checkForUpdates,
        downloadAndInstall,
        dismissUpdate,
    };
}
