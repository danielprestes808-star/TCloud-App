import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, File, X, ZoomIn, ZoomOut, RotateCcw, Image as ImageIcon, Cloud } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { TelegramFile } from '../../../types';
import { isImageFile } from '../../../utils';
import { useSettings } from '../../../context/SettingsContext';
import {
    forgetPreview,
    forgetThumbnail,
    getCachedPreview,
    getCachedThumbnail,
    loadPreview,
    loadThumbnail,
    prefetchPreview,
    prefetchThumbnail,
} from '../../../services/imagePreviewCache';

const MAX_PREFETCH_BYTES = 25 * 1024 * 1024;

type PreviewProgress = {
    message_id: number;
    folder_id: number | null;
    downloaded_bytes: number;
    total_bytes: number;
    percent: number;
};

interface PreviewModalProps {
    file: TelegramFile;
    onClose: () => void;
    onNext?: () => void;
    onPrev?: () => void;
    currentIndex?: number;
    totalItems?: number;
    nextFile?: TelegramFile | null;
    prevFile?: TelegramFile | null;
    activeFolderId: number | null;
}

export function PreviewModal({
    file,
    onClose,
    onNext,
    onPrev,
    currentIndex,
    totalItems,
    nextFile,
    activeFolderId,
}: PreviewModalProps) {
    const { settings } = useSettings();
    const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
    const [fullSrc, setFullSrc] = useState<string | null>(null);
    const [fullReady, setFullReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const latestRequestRef = useRef(0);
    const currentFileIdRef = useRef(file.id);
    currentFileIdRef.current = file.id;
    const imagePreview = isImageFile(file.name);

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;

        listen<PreviewProgress>('preview-progress', ({ payload }) => {
            if (
                payload.message_id === file.id
                && (payload.folder_id ?? null) === activeFolderId
            ) {
                setProgress(payload.percent);
            }
        }).then((stopListening) => {
            if (disposed) stopListening();
            else unlisten = stopListening;
        }).catch(() => {
            // Progress is an enhancement; preview loading remains fully functional without it.
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [file.id, activeFolderId]);

    useEffect(() => {
        const requestId = ++latestRequestRef.current;
        const cachedPreview = getCachedPreview(file.id, activeFolderId);
        const cachedThumbnail = imagePreview
            ? getCachedThumbnail(file.id, activeFolderId)
            : null;

        setThumbnailSrc(cachedThumbnail);
        setFullSrc(cachedPreview);
        setFullReady(false);
        setLoading(true);
        setProgress(cachedPreview ? 100 : 0);
        setError(null);
        setZoom(1);

        if (imagePreview && !cachedThumbnail) {
            loadThumbnail(file.id, activeFolderId).then((src) => {
                if (requestId === latestRequestRef.current && src) {
                    setThumbnailSrc(src);
                }
            }).catch(() => {
                // The full-resolution preview can still load without a thumbnail.
            });
        }

        const startFullPreview = () => {
            void loadPreview(file.id, activeFolderId).then((src) => {
                if (requestId !== latestRequestRef.current) return;
                if (!src) {
                    setError('Visualização indisponível');
                    setLoading(false);
                    return;
                }
                setFullSrc(src);
                if (!imagePreview) setLoading(false);
            }).catch((loadError) => {
                if (requestId !== latestRequestRef.current) return;
                setError(String(loadError));
                setLoading(false);
            });
        };

        // Give the placeholder/thumbnail one browser frame to paint, then start
        // the foreground preview immediately. This removes the old fixed 60 ms
        // delay without making a multi-megabyte transfer block the modal's first frame.
        if (imagePreview && !cachedPreview) {
            const frameId = window.requestAnimationFrame(startFullPreview);
            return () => window.cancelAnimationFrame(frameId);
        }

        startFullPreview();
    }, [file.id, file.name, activeFolderId, imagePreview]);

    // Prefetch only the likely next image, after the current one is fully decoded and
    // the browser is idle. Avoid speculative downloads when a bandwidth cap is active.
    useEffect(() => {
        if (!fullReady || !nextFile || !isImageFile(nextFile.name)) return;
        if (nextFile.size > MAX_PREFETCH_BYTES) return;
        if (settings.vpnMode && settings.bandwidthLimitDownKBs > 0) return;
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        if (connection?.saveData) return;

        const idleWindow = window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        };
        let idleId: number | undefined;
        prefetchThumbnail(nextFile.id, activeFolderId);
        const timerId = window.setTimeout(() => {
            if (getCachedPreview(nextFile.id, activeFolderId)) return;
            if (idleWindow.requestIdleCallback) {
                idleId = idleWindow.requestIdleCallback(
                    () => { prefetchPreview(nextFile.id, activeFolderId); },
                    { timeout: 1800 },
                );
            } else {
                prefetchPreview(nextFile.id, activeFolderId);
            }
        }, 700);

        return () => {
            window.clearTimeout(timerId);
            if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
        };
    }, [fullReady, nextFile, activeFolderId, settings.vpnMode, settings.bandwidthLimitDownKBs]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            const key = event.key.toLowerCase();
            if (event.key === 'ArrowRight' || key === 'l') {
                event.preventDefault();
                onNext?.();
            } else if (event.key === 'ArrowLeft' || key === 'j') {
                event.preventDefault();
                onPrev?.();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev]);

    return (
        <div className="viewer-overlay tcloud-viewer-overlay fixed inset-0 z-[150] flex items-center justify-center p-4" onClick={onClose}>
            <div className="tcloud-preview-shell relative flex max-h-screen w-full max-w-5xl flex-col items-center justify-center" onClick={(event) => event.stopPropagation()}>
                <div className="tcloud-preview-header">
                    <div className="tcloud-preview-file">
                        <span className="tcloud-preview-file-icon">
                            {imagePreview ? <ImageIcon className="h-4 w-4" /> : <File className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                            <strong title={file.name}>{file.name}</strong>
                            <span><Cloud className="h-3 w-3" /> {file.sizeStr || 'TCloud'}</span>
                        </div>
                    </div>

                    <div className="tcloud-preview-header-actions">
                        {imagePreview && (
                            <div className="tcloud-preview-zoom">
                                <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} title="Diminuir zoom">
                                    <ZoomOut className="h-3.5 w-3.5" />
                                </button>
                                <span>{Math.round(zoom * 100)}%</span>
                                <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} title="Aumentar zoom">
                                    <ZoomIn className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => setZoom(1)} title="Restaurar zoom">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        )}
                        {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                            <span className="tcloud-preview-position">{currentIndex + 1} / {totalItems}</span>
                        )}
                        <button onClick={onClose} className="tcloud-preview-close" title="Fechar" aria-label="Fechar preview">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <button
                    onClick={onPrev}
                    disabled={!onPrev}
                    className="viewer-navigation tcloud-preview-prev absolute start-2 top-1/2 z-20 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
                    title="Anterior (←)"
                    aria-label="Arquivo anterior"
                >
                    <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
                </button>

                <button
                    onClick={onNext}
                    disabled={!onNext}
                    className="viewer-navigation tcloud-preview-next absolute end-2 top-1/2 z-20 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-0"
                    title="Próximo (→)"
                    aria-label="Próximo arquivo"
                >
                    <ChevronRight className="h-5 w-5 rtl:rotate-180" />
                </button>

                {error && (
                    <div className="viewer-panel max-w-md border-app-danger/25 bg-app-danger/10 p-4 text-app-danger">
                        <p className="text-ui font-semibold">Erro na visualização</p>
                        <p className="mt-1 text-metadata leading-relaxed">{error}</p>
                    </div>
                )}

                {!error && imagePreview && (
                    <div className="viewer-panel relative flex h-[85vh] w-full items-center justify-center">
                        {thumbnailSrc && !fullReady && (
                            <img
                                src={thumbnailSrc}
                                decoding="async"
                                className="max-h-full max-w-full scale-[1.01] bg-black object-contain blur-[2px]"
                                alt=""
                                aria-hidden="true"
                                onError={() => {
                                    forgetThumbnail(file.id, activeFolderId);
                                    setThumbnailSrc(null);
                                }}
                            />
                        )}

                        {fullSrc && (
                            <img
                                src={fullSrc}
                                decoding="async"
                                className={`absolute inset-0 m-auto max-h-full max-w-full bg-black object-contain transition-[opacity,transform] duration-200 ${fullReady ? 'opacity-100' : 'opacity-0'}`}
                                style={{ transform: `scale(${zoom})` }}
                                alt={file.name}
                                onLoad={(event) => {
                                    const image = event.currentTarget;
                                    const loadedFileId = file.id;
                                    const reveal = () => {
                                        if (currentFileIdRef.current !== loadedFileId) return;
                                        setFullReady(true);
                                        setLoading(false);
                                        setProgress(100);
                                    };
                                    if (typeof image.decode === 'function') {
                                        void image.decode().catch(() => {}).finally(reveal);
                                    } else {
                                        reveal();
                                    }
                                }}
                                onError={() => {
                                    forgetPreview(file.id, activeFolderId);
                                    setError('Falha ao exibir a imagem');
                                    setLoading(false);
                                }}
                            />
                        )}

                        {loading && (
                            <div className={`viewer-toolbar absolute flex-col gap-2 px-4 py-3 text-white ${thumbnailSrc ? 'bottom-4' : 'start-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2'}`}>
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-app-accent" />
                                <p className="text-metadata">Carregando visualização…</p>
                                {progress > 0 && (
                                    <div className="h-1 w-32 overflow-hidden rounded-full bg-white/15" aria-label={`${progress}%`}>
                                        <div className="h-full rounded-full bg-telegram-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {!error && !imagePreview && !loading && fullSrc && (
                    <div className="viewer-panel max-w-md p-6 text-center text-white">
                        <File className="mx-auto mb-3 h-10 w-10 text-app-accent" />
                        <h3 className="truncate text-app-title font-medium" title={file.name}>{file.name}</h3>
                        <p className="mt-2 text-ui text-white/60">Preview not supported in app.</p>
                        <p className="mt-4 text-badge text-white/40">File type: {file.name.split('.').pop()}</p>
                    </div>
                )}

                <div className="viewer-toolbar absolute -bottom-11 max-w-[min(80vw,40rem)] px-3 py-1.5 text-metadata text-white/70">
                    <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
                    {typeof currentIndex === 'number' && typeof totalItems === 'number' && totalItems > 0 && (
                        <span className="ms-2 shrink-0 tabular-nums text-white/45">{currentIndex + 1}/{totalItems}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
