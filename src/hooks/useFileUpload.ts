import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DropUploadResult, DroppedPathValidation, QueueItem, TelegramFile, UploadProtectionIntent } from '../types';
import { formatBytes, showFileDialogFallback, pickWithFallback } from '../utils';
import { useSettings } from '../context/SettingsContext';
import type { Store } from '@tauri-apps/plugin-store';
import { useTranslation } from 'react-i18next';
import { checkLocalDuplicate, listRules } from '../services/tcloudProductivity';
import { getFolderCryptoPolicy } from '../services/tcloudCompletion';

interface ProgressPayload {
    id: string;
    percent: number;
    uploaded_bytes: number;
    total_bytes: number;
    speed_bytes_per_sec: number;
}

interface RemoteProgressPayload {
    id: string;
    phase: 'downloading' | 'uploading';
    percent: number;
    speed: number;
    uploaded_bytes: number;
    total_bytes: number;
}

export function useFileUpload(activeFolderId: number | null, store: Store | null) {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { settings } = useSettings();
    const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
    const [initialized, setInitialized] = useState(false);
    const cancelledRef = useRef<Set<string>>(new Set());
    const activeCountRef = useRef(0);
    const refreshTimersRef = useRef<Map<string, number>>(new Map());

    const scheduleFolderRefresh = (folderId: number | null) => {
        const key = folderId === null ? 'saved' : String(folderId);
        const previous = refreshTimersRef.current.get(key);
        if (previous !== undefined) window.clearTimeout(previous);
        const timer = window.setTimeout(() => {
            refreshTimersRef.current.delete(key);
            void queryClient.invalidateQueries({ queryKey: ['files', folderId], refetchType: 'active' });
        }, 900);
        refreshTimersRef.current.set(key, timer);
    };

    useEffect(() => () => {
        refreshTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        refreshTimersRef.current.clear();
    }, []);

    // Buffer native progress bursts. Telegram can emit many progress events per
    // second; repainting the whole dashboard for each event makes scrolling and
    // clicking feel sticky. The transfer panel remains visually smooth at ~10 FPS.
    useEffect(() => {
        let unlistenProgress: UnlistenFn | undefined;
        let unlistenRemote: UnlistenFn | undefined;
        let flushTimer: number | null = null;
        const pending = new Map<string, Partial<QueueItem>>();

        const flush = () => {
            flushTimer = null;
            if (pending.size === 0) return;
            const updates = new Map(pending);
            pending.clear();
            setUploadQueue((queue) => queue.map((item) => {
                const patch = updates.get(item.id);
                return patch ? { ...item, ...patch } : item;
            }));
        };
        const scheduleFlush = () => {
            if (flushTimer !== null) return;
            flushTimer = window.setTimeout(flush, 100);
        };

        listen<ProgressPayload>('upload-progress', (event) => {
            pending.set(event.payload.id, {
                progress: event.payload.percent,
                uploadedBytes: event.payload.uploaded_bytes,
                totalBytes: event.payload.total_bytes,
                speedBytesPerSec: event.payload.speed_bytes_per_sec,
            });
            scheduleFlush();
        }).then(fn => { unlistenProgress = fn; });

        listen<RemoteProgressPayload>('remote-upload-progress', (event) => {
            pending.set(event.payload.id, {
                status: event.payload.phase,
                progress: event.payload.percent,
                speedBytesPerSec: event.payload.speed,
                uploadedBytes: event.payload.uploaded_bytes,
                totalBytes: event.payload.total_bytes,
            });
            scheduleFlush();
        }).then(fn => { unlistenRemote = fn; });

        return () => {
            if (flushTimer !== null) window.clearTimeout(flushTimer);
            unlistenProgress?.();
            unlistenRemote?.();
        };
    }, []);

    useEffect(() => {
        if (!store || initialized) return;
        store.get<QueueItem[]>('uploadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                // Anything that was active when Windows/TCloud stopped is safe to
                // retry from the beginning. Telegram never receives a partial message,
                // so this gives crash/reboot persistence without inventing byte resume.
                const pending = saved
                    .filter(i => ['pending', 'uploading', 'downloading', 'waiting_for_unlock'].includes(i.status))
                    .map(i => ({
                        ...i,
                        status: i.protection?.mode === 'passphrase' || i.protection?.mode === 'vault_and_passphrase'
                            ? 'waiting_for_unlock' as const
                            : 'pending' as const,
                        progress: undefined,
                        uploadedBytes: undefined,
                        speedBytesPerSec: undefined,
                        protection: i.protection ? { ...i.protection, promptToken: undefined } : undefined,
                    }));
                if (pending.length > 0) {
                    setUploadQueue(pending);
                    toast.info(`Restored ${pending.length} pending uploads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized]);

    const uploadPersistTimerRef = useRef<number | null>(null);
    const uploadPersistSignatureRef = useRef('');
    useEffect(() => {
        if (!store || !initialized) return;
        const persistable = uploadQueue
            .filter(i => ['pending', 'uploading', 'downloading', 'waiting_for_unlock'].includes(i.status))
            .map(i => ({
                ...i,
                // Persist active work as pending. Volatile progress fields are
                // deliberately excluded so disk I/O is not triggered per progress tick.
                status: i.status === 'waiting_for_unlock' ? 'waiting_for_unlock' as const : 'pending' as const,
                progress: undefined,
                uploadedBytes: undefined,
                totalBytes: undefined,
                speedBytesPerSec: undefined,
                protection: i.protection ? { ...i.protection, promptToken: undefined } : undefined,
            }));
        const signature = JSON.stringify(persistable);
        if (signature === uploadPersistSignatureRef.current) return;
        uploadPersistSignatureRef.current = signature;
        if (uploadPersistTimerRef.current !== null) window.clearTimeout(uploadPersistTimerRef.current);
        uploadPersistTimerRef.current = window.setTimeout(() => {
            uploadPersistTimerRef.current = null;
            void store.set('uploadQueue', persistable).then(() => store.save()).catch(() => {});
        }, 450);
    }, [store, uploadQueue, initialized]);

    useEffect(() => () => {
        if (uploadPersistTimerRef.current !== null) window.clearTimeout(uploadPersistTimerRef.current);
    }, []);

    // Process up to maxConcurrentUploads in parallel
    useEffect(() => {
        const maxConcurrent = settings.maxConcurrentUploads || 1;
        const available = maxConcurrent - activeCountRef.current;
        if (available <= 0) return;
        const priorityRank = { high: 0, normal: 1, low: 2 } as const;
        const pendingItems = uploadQueue
            .filter(i => i.status === 'pending')
            .sort((a, b) => priorityRank[a.priority ?? 'normal'] - priorityRank[b.priority ?? 'normal'])
            .slice(0, available);
        for (const item of pendingItems) {
            processItem(item);
        }
    }, [uploadQueue, settings.maxConcurrentUploads]);

    /** Clean up temp zip file if the item was created from a folder */
    const cleanupTempZip = async (item: QueueItem) => {
        if (item.tempZipPath) {
            try {
                await invoke('cmd_delete_temp_zip', { path: item.tempZipPath });
            } catch {
                // Best-effort cleanup
            }
        }
    };

    const processItem = async (item: QueueItem) => {
        const protection: UploadProtectionIntent = item.protection ?? {
            mode: settings.encryptionDefaultMode,
            protectMetadata: settings.encryptionProtectMetadata,
        };
        if (
            (protection.mode === 'passphrase' || protection.mode === 'vault_and_passphrase')
            && !protection.promptToken
        ) {
            setUploadQueue(q => q.map(i => i.id === item.id ? {
                ...i,
                protection,
                status: 'waiting_for_unlock',
                error: 'File passphrase required',
            } : i));
            return;
        }
        activeCountRef.current++;
        const initialStatus = item.url ? 'downloading' : 'uploading';
        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: initialStatus, progress: 0 } : i));
        let uploadedMessageId: string | null = null;
        try {
            if (item.url) {
                await invoke('cmd_upload_from_url', {
                    url: item.url,
                    folderId: item.folderId,
                    transferId: item.id,
                    protectionMode: protection.mode,
                    promptToken: protection.promptToken,
                    protectMetadata: protection.protectMetadata ?? settings.encryptionProtectMetadata,
                });
            } else {
                uploadedMessageId = await invoke<string>('cmd_upload_file', {
                    path: item.path,
                    folderId: item.folderId,
                    transferId: item.id,
                    protectionMode: protection.mode,
                    promptToken: protection.promptToken,
                    protectMetadata: protection.protectMetadata ?? settings.encryptionProtectMetadata,
                });
                const numericMessageId = Number(uploadedMessageId);
                if (Number.isFinite(numericMessageId) && numericMessageId > 0) {
                    const versionName = item.path.split(/[\\/]/).pop() || item.path;
                    void invoke('tcloud_pro_version_add', {
                        messageId: numericMessageId,
                        folderId: item.folderId,
                        name: versionName,
                        size: item.totalBytes || 0,
                        note: 'Upload automático',
                    }).catch(() => {});
                }
            }
            // Check if cancelled during upload. The UI is updated optimistically and
            // the authoritative Telegram listing is refreshed once, after a short
            // coalescing delay. Do not hold a transfer slot while a full folder scan runs.
            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));

                const numericMessageId = Number(uploadedMessageId);
                if (Number.isFinite(numericMessageId) && numericMessageId > 0) {
                    const name = item.path.split(/[\\/]/).pop() || item.path;
                    const optimistic: TelegramFile = {
                        id: numericMessageId,
                        name,
                        size: item.totalBytes || 0,
                        sizeStr: formatBytes(item.totalBytes || 0),
                        created_at: String(Math.floor(Date.now() / 1000)),
                        type: 'file',
                        folder_id: item.folderId,
                        sync_status: 'synced',
                    };
                    queryClient.setQueryData<TelegramFile[]>(['files', item.folderId], (current = []) =>
                        current.some((file) => file.id === numericMessageId) ? current : [optimistic, ...current]
                    );
                }

                scheduleFolderRefresh(item.folderId);
            }
            // Temp cleanup is best-effort and must not delay the next queued upload.
            void cleanupTempZip(item);
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                const errMsg = String(e);
                if (errMsg.includes('Transfer cancelled')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'cancelled' } : i));
                } else if (errMsg.includes('VAULT_LOCKED') || errMsg.includes('KEY_REQUIRED')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? {
                        ...i,
                        status: 'waiting_for_unlock',
                        error: errMsg,
                        protection: i.protection ? { ...i.protection, promptToken: undefined } : protection,
                    } : i));
                    toast.warning(t('settings.encryption_mode_passphrase'));
                } else if (errMsg.includes('FILE_TOO_BIG') || errMsg.includes('too large') || errMsg.includes('2 GB')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: errMsg } : i));
                    toast.error(`Upload failed: Telegram has a 2 GB file size limit. Try splitting large folders.`);
                } else {
                    const displayPath = item.url || item.path;
                    const retryCount = item.retryCount ?? 0;
                    const maxRetries = Math.max(0, settings.retryAttempts ?? 0);
                    const retryable = /(timeout|network|connection|temporar|flood|rpc|socket|reset|unreachable|try again)/i.test(errMsg);
                    if (retryable && retryCount < maxRetries) {
                        const base = Math.max(0.5, settings.retryBaseBackoffSec || 1);
                        const maxBackoff = Math.max(base, settings.retryMaxBackoffSec || 30);
                        const delaySec = Math.min(maxBackoff, base * Math.pow(2, retryCount));
                        setUploadQueue(q => q.map(i => i.id === item.id ? {
                            ...i, status: 'error', retryCount: retryCount + 1,
                            error: `Falha temporária. Nova tentativa ${retryCount + 1}/${maxRetries} em ${delaySec.toFixed(1)}s…`
                        } : i));
                        window.setTimeout(() => {
                            setUploadQueue(q => q.map(i => i.id === item.id && i.status === 'error' ? {
                                ...i, status: 'pending', error: undefined, progress: undefined, uploadedBytes: undefined, speedBytesPerSec: undefined
                            } : i));
                        }, delaySec * 1000);
                    } else {
                        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: errMsg } : i));
                        toast.error(`Upload failed for ${displayPath.split(/[\\/]/).pop()}: ${e}`);
                    }
                }
            } else {
                cancelledRef.current.delete(item.id);
            }
            // Clean up temp zip even on failure, without holding the queue slot.
            void cleanupTempZip(item);
        } finally {
            activeCountRef.current--;
        }
    };

    const stageProtectionForFiles = async (
        count: number,
        requestedMode = settings.encryptionDefaultMode,
        destinationFolderId: number | null = activeFolderId,
    ): Promise<UploadProtectionIntent[] | null> => {
        let mode = requestedMode;
        let protectMetadata = settings.encryptionProtectMetadata;
        if (destinationFolderId !== null) {
            try {
                const policy = await getFolderCryptoPolicy(destinationFolderId);
                if (policy.mode !== 'inherit') mode = policy.mode;
                protectMetadata = policy.protect_metadata;
            } catch {
                // Folder policy is optional and must never block an upload.
            }
        }
        const base: UploadProtectionIntent = {
            mode,
            protectMetadata,
        };
        if (mode !== 'passphrase' && mode !== 'vault_and_passphrase') {
            return Array.from({ length: count }, () => ({ ...base }));
        }

        const accepted = window.confirm(t('settings.encryption_disclaimer_body'));
        if (!accepted) return null;
        const passphrase = window.prompt(
            `${t('settings.encryption_mode_passphrase')}\n${t('settings.min_passphrase_length')}`,
        );
        if (!passphrase) return null;
        if (new TextEncoder().encode(passphrase).length < 8) {
            toast.error(t('settings.min_passphrase_length'));
            return null;
        }
        const confirmation = window.prompt(t('settings.confirm_passphrase'));
        if (confirmation !== passphrase) {
            toast.error(t('settings.passphrases_no_match'));
            return null;
        }
        try {
            const tokens = await Promise.all(
                Array.from({ length: count }, () => invoke<number>('cmd_stage_file_passphrase', { passphrase })),
            );
            return tokens.map(promptToken => ({ ...base, promptToken }));
        } catch (error) {
            toast.error(`Could not prepare encrypted upload: ${String(error)}`);
            return null;
        }
    };

    /** Queues a set of file paths with an explicit, non-secret protection intent. */
    const queueFiles = async (
        paths: string[],
        destinationFolderId: number | null = activeFolderId,
    ): Promise<number> => {
        if (!paths || paths.length === 0) return 0;

        let acceptedPaths = paths;
        let autoBundlePath: string | null = null;
        const fingerprints = new Map<string, Awaited<ReturnType<typeof checkLocalDuplicate>>>();
        const duplicateCheckEnabled = localStorage.getItem('tcloud:duplicate-check-before-upload') === 'true';
        if (duplicateCheckEnabled) {
            try {
                const checks = await Promise.all(paths.map(async (path) => {
                    const result = await checkLocalDuplicate(path);
                    fingerprints.set(path, result);
                    return { path, result };
                }));
                const duplicates = checks.filter(({ result }) => result.matches > 0);
                if (duplicates.length > 0) {
                    const names = duplicates.slice(0, 5).map(({ path, result }) => `${path.split(/[\\/]/).pop()} (${result.matches} cópia(s))`).join('\n');
                    const keep = window.confirm(`${duplicates.length} arquivo(s) já existem no índice do TCloud:\n\n${names}\n\nOK = reenviar bytes\nCancelar = reutilizar a cópia já existente quando possível.`);
                    if (!keep) {
                        let reused = 0;
                        const handled = new Set<string>();
                        for (const duplicate of duplicates) {
                            const source = duplicate.result.sources?.[0];
                            if (!source) continue;
                            try {
                                if ((source.folder_id ?? null) !== destinationFolderId) {
                                    await invoke('cmd_copy_files', { messageIds: [source.message_id], sourceFolderId: source.folder_id ?? null, targetFolderId: destinationFolderId });
                                }
                                reused += 1;
                                handled.add(duplicate.path);
                            } catch (error) {
                                console.warn('[Upload] server-side duplicate reuse failed', error);
                            }
                        }
                        acceptedPaths = paths.filter((path) => !handled.has(path));
                        if (reused > 0) toast.success(`${reused} arquivo(s) reutilizado(s) sem reenviar os dados locais.`);
                        if (acceptedPaths.length === 0) return reused;
                    }
                }
            } catch {
                // The local index may not have hashes yet. Duplicate detection is best-effort.
            }
        }

        // Optional batch compression: when explicitly enabled, multiple files sent
        // to one selected destination are packed into a single ZIP. This is intentionally
        // disabled at the root because automatic organization rules may route files to
        // different destinations.
        const autoCompress = localStorage.getItem('tcloud:auto-compress-batches') === 'true';
        if (autoCompress && destinationFolderId !== null && acceptedPaths.length >= 2) {
            try {
                toast.info(`Compactando ${acceptedPaths.length} arquivos antes do upload…`);
                autoBundlePath = await invoke<string>('tcloud_completion_zip_files', {
                    paths: acceptedPaths,
                    archiveName: `TCloud-lote-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`,
                });
                acceptedPaths = [autoBundlePath];
            } catch (error) {
                toast.warning(`Não foi possível compactar o lote; os arquivos serão enviados separadamente. ${String(error)}`);
                autoBundlePath = null;
            }
        }

        const protection = await stageProtectionForFiles(acceptedPaths.length, settings.encryptionDefaultMode, destinationFolderId);
        if (!protection) {
            if (autoBundlePath) await invoke('cmd_delete_temp_zip', { path: autoBundlePath }).catch(() => {});
            return 0;
        }
        let rules = [] as Awaited<ReturnType<typeof listRules>>;
        if (destinationFolderId === null) {
            try { rules = (await listRules()).filter((rule) => rule.enabled); } catch { /* optional */ }
        }

        const destinationCache = new Map<number | null, boolean>();
        const isValidDestination = async (folderId: number | null) => {
            if (folderId === null) return true;
            if (destinationCache.has(folderId)) return destinationCache.get(folderId)!;
            try {
                const valid = await invoke<boolean>('cmd_validate_upload_destination', { folderId });
                destinationCache.set(folderId, valid);
                return valid;
            } catch {
                destinationCache.set(folderId, false);
                return false;
            }
        };

        const baseDestinationValid = await isValidDestination(destinationFolderId);
        if (!baseDestinationValid && destinationFolderId !== null) {
            if (autoBundlePath) await invoke('cmd_delete_temp_zip', { path: autoBundlePath }).catch(() => {});
            toast.error('A pasta selecionada não está mais disponível no Telegram. Selecione outra pasta e tente novamente.');
            return 0;
        }

        // An explicitly opened folder/topic ALWAYS wins. Automatic organization
        // rules are only allowed when uploading from the root / Saved Messages.
        // This prevents a rule with an old chat id from silently moving an upload
        // away from the topic the user is currently viewing.
        const resolvedDestinations = destinationFolderId !== null
            ? acceptedPaths.map(() => destinationFolderId)
            : await Promise.all(acceptedPaths.map(async (path) => {
                const filename = path.split(/[\\/]/).pop() || path;
                const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';
                const lowerName = filename.toLowerCase();
                const fingerprint = fingerprints.get(path);
                const matchingRule = rules.find((rule) => {
                    const extensions = rule.extensions
                        .split(',')
                        .map((value) => value.trim().replace(/^\./, '').toLowerCase())
                        .filter(Boolean);
                    const extensionMatches = extensions.length === 0 || extensions.includes(ext);
                    const nameMatches = !rule.name_contains || lowerName.includes(rule.name_contains.toLowerCase());
                    const size = fingerprint?.size;
                    const minMatches = rule.min_size == null || size == null || size >= rule.min_size;
                    const maxMatches = rule.max_size == null || size == null || size <= rule.max_size;
                    return extensionMatches && nameMatches && minMatches && maxMatches;
                });
                if (matchingRule && await isValidDestination(matchingRule.target_folder_id)) {
                    return matchingRule.target_folder_id;
                }
                return null;
            }));

        const newItems: QueueItem[] = acceptedPaths.map((path: string, index) => ({
            id: Math.random().toString(36).substr(2, 9),
            path,
            folderId: resolvedDestinations[index],
            status: 'pending' as const,
            priority: 'normal' as const,
            retryCount: 0,
            tempZipPath: autoBundlePath && path === autoBundlePath ? autoBundlePath : undefined,
            protection: protection[index],
        }));
        setUploadQueue(prev => [...prev, ...newItems]);
        toast.info(t('notifications.uploads_queued', { count: acceptedPaths.length }));
        return acceptedPaths.length;
    };

    const handleManualUpload = async () => {
        const paths = await pickWithFallback(
            async () => {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const selected = await open({ multiple: true, directory: false });
                if (!selected) return null;
                return Array.isArray(selected) ? selected : [selected];
            },
            () => handleManualUpload(),
            {
                errorTitle: 'File picker failed',
                onBrowserPicker: async () => {
                    const fallbackPaths = await showFileDialogFallback({ directory: false, multiple: true });
                    return fallbackPaths.length > 0 ? fallbackPaths : null;
                },
            },
        );
        if (paths && paths.length > 0) {
            await queueFiles(paths);
        }
    };

    /** Queue files dropped from the OS file manager (drag-and-drop upload) */
    const handleDropUpload = async (paths: string[]): Promise<DropUploadResult> => {
        if (!paths || paths.length === 0) return { queued: 0, rejected: [] };

        // Snapshot the destination before validation or an encryption prompt can yield.
        const destinationFolderId = activeFolderId;
        let validation: DroppedPathValidation;
        try {
            validation = await invoke<DroppedPathValidation>('cmd_validate_dropped_paths', { paths });
        } catch (error) {
            toast.error(t('settings.failed_prefix', { error: String(error) }));
            return { queued: 0, rejected: [] };
        }

        if (validation.rejected.length > 0) {
            toast.warning(t('notifications.drop_rejected', { count: validation.rejected.length }));
        }

        const queued = await queueFiles(validation.accepted, destinationFolderId);
        return {
            queued,
            rejected: validation.rejected,
            cancelled: validation.accepted.length > 0 && queued === 0,
        };
    };

    const handleFolderUpload = async () => {
        const folderPath = await pickWithFallback(
            async () => {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const selected = await open({ multiple: false, directory: true, title: 'Select Folder to Upload' });
                if (!selected) return null;
                const fp = Array.isArray(selected) ? selected[0] : selected;
                return fp || null;
            },
            () => handleFolderUpload(),
            {
                errorTitle: 'Folder picker failed',
                onBrowserPicker: async () => {
                    const fallbackPaths = await showFileDialogFallback({ directory: true, multiple: true });
                    if (fallbackPaths.length > 0) {
                        // HTML folder picker returns individual file paths, not a folder path.
                        // We can't zip without a folder path, so files upload individually.
                        toast.info('Folder zipping unavailable with browser picker — uploading files individually.');
                        await queueFiles(fallbackPaths);
                    }
                    return null; // Already handled via queueFiles — signal that the main flow should stop
                },
            },
        );
        if (!folderPath) return;

        const folderName = folderPath.split('/').pop() || folderPath.split('\\').pop() || 'folder';

        if (settings.zipFolders) {
            toast.info(`Zipping "${folderName}"...`);
            try {
                const zipPath = await invoke<string>('cmd_zip_folder', { folderPath });
                const protection = await stageProtectionForFiles(1, settings.encryptionDefaultMode, activeFolderId);
                if (!protection) {
                    await invoke('cmd_delete_temp_zip', { path: zipPath }).catch(() => {});
                    return;
                }
                const item: QueueItem = {
                    id: Math.random().toString(36).substr(2, 9),
                    path: zipPath,
                    folderId: activeFolderId,
                    status: 'pending',
                    tempZipPath: zipPath,
                    protection: protection[0],
                };
                setUploadQueue(prev => [...prev, item]);
                toast.success(`Queued "${folderName}.zip" for upload`);
            } catch (e) {
                console.error('[Upload] Zip error:', e);
                toast.error(`Failed to zip folder: ${e}`);
            }
        } else {
            toast.info(`Folder upload without zipping is not supported. Enable "Zip folders before upload" in Settings.`);
        }
    };

    const cancelAll = () => {
        setUploadQueue(q => {
            const activeItems = q.filter(i => i.status === 'uploading' || i.status === 'downloading');
            for (const item of activeItems) {
                cancelledRef.current.add(item.id);
                invoke('cmd_cancel_transfer', { transferId: item.id }).catch(() => {});
            }
            return q
                .filter(i => i.status !== 'pending')
                .map(i => (i.status === 'uploading' || i.status === 'downloading') ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All uploads cancelled');
    };

    const cancelItem = (id: string) => {
        setUploadQueue(q => {
            const item = q.find(i => i.id === id);
            if (item?.status === 'uploading' || item?.status === 'downloading') {
                cancelledRef.current.add(id);
                invoke('cmd_cancel_transfer', { transferId: id }).catch(() => {});
                return q.map(i => i.id === id ? { ...i, status: 'cancelled' as const } : i);
            }
            // Remove pending items directly
            if (item?.status === 'pending') {
                return q.filter(i => i.id !== id);
            }
            return q;
        });
    };

    const retryItem = async (id: string) => {
        const item = uploadQueue.find(candidate => candidate.id === id);
        if (!item || !['error', 'cancelled', 'waiting_for_unlock'].includes(item.status)) return;
        let protection = item.protection;
        if (protection?.mode === 'passphrase' || protection?.mode === 'vault_and_passphrase') {
            const staged = await stageProtectionForFiles(1, protection.mode, item.folderId ?? null);
            if (!staged) return;
            protection = { ...staged[0], protectMetadata: protection.protectMetadata };
        }
        setUploadQueue(q => q.map(i =>
            i.id === id
                ? { ...i, protection, status: 'pending' as const, retryCount: 0, error: undefined, progress: undefined, uploadedBytes: undefined, totalBytes: undefined, speedBytesPerSec: undefined }
                : i
        ));
    };

    const setItemPriority = (id: string, priority: 'high' | 'normal' | 'low') => {
        setUploadQueue(q => q.map(item => item.id === id ? { ...item, priority } : item));
    };

    const handleUrlUpload = async (url: string, folderId: number | null) => {
        if (!url || !url.trim()) return;
        let filename: string;
        try {
            filename = new URL(url).pathname.split('/').pop() || 'remote_file';
        } catch {
            filename = url.split('/').pop() || 'remote_file';
        }
        const protection = await stageProtectionForFiles(1, settings.encryptionDefaultMode, folderId);
        if (!protection) return;
        const item: QueueItem = {
            id: Math.random().toString(36).substr(2, 9),
            path: filename,
            url: url.trim(),
            folderId: folderId,
            status: 'pending' as const,
            protection: protection[0],
        };
        setUploadQueue(prev => [...prev, item]);
        toast.info(`Queued remote upload from URL`);
    };

    return {
        uploadQueue,
        setUploadQueue,
        handleManualUpload,
        handleFolderUpload,
        handleDropUpload,
        handleUrlUpload,
        cancelAll,
        cancelItem,
        retryItem,
        setItemPriority,
    };
}
