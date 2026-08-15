import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Folder, Eye, Trash2, Link, Check } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TelegramFile } from '../../../types';
import { forgetThumbnail, getCachedThumbnail, loadThumbnail } from '../../../services/imagePreviewCache';
import { FileTypeIcon } from '../../shared/FileTypeIcon';
import { useVideoMetadata } from '../../../hooks/useVideoMetadata';
import { useCachedVariants } from '../../../hooks/useCachedVariants';
import { VideoMetaBadge } from '../../shared/VideoMetaBadge';
import { Skeleton } from '../../ui';
import { EncryptionBadge } from '../../shared/EncryptionBadge';
import { FileAvailabilityBadge } from './FileAvailabilityBadge';

interface FileCardProps {
    file: TelegramFile;
    onDelete: () => void;
    onDownload: () => void;
    onPreview?: () => void;
    onShare?: () => void;
    isSelected: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onOpen?: () => void;
    activeFolderId?: number | null;
    height?: number;
    onToggleSelection?: () => void;
    selectedIds?: number[];
    variant?: 'standard' | 'small' | 'gallery';
}

// Check if file is an image type that can have a thumbnail
function isImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif'].includes(ext);
}


export const FileCard = memo(function FileCard({ file, onDelete, onDownload, onPreview, onShare, isSelected, onClick, onContextMenu, onOpen, activeFolderId, height, onToggleSelection, selectedIds, variant = 'standard' }: FileCardProps) {
    const isFolder = file.type === 'folder';
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);
    const [thumbnailReady, setThumbnailReady] = useState(false);
    const cardElementRef = useRef<HTMLDivElement | null>(null);
    const [thumbnailVisible, setThumbnailVisible] = useState(false);
    const effectiveFolderId = file.folder_id ?? activeFolderId ?? null;
    const fileIds = selectedIds?.includes(file.id) ? selectedIds : [file.id];
    const {
        attributes,
        listeners,
        setNodeRef: setDraggableNodeRef,
        isDragging,
    } = useDraggable({
        id: `telegram-file-${file.id}`,
        disabled: isFolder,
        data: { kind: 'telegram-files', fileIds, label: file.name },
    });
    const {
        setNodeRef: setDroppableNodeRef,
        isOver,
        active: dragActive,
    } = useDroppable({
        id: `content-folder-${file.id}`,
        disabled: !isFolder,
        data: { kind: 'content-folder', folderId: file.id },
    });
    const setNodeRef = useCallback((node: HTMLDivElement | null) => {
        cardElementRef.current = node;
        setDraggableNodeRef(node);
        setDroppableNodeRef(node);
    }, [setDraggableNodeRef, setDroppableNodeRef]);
    const isFileDragOver = isFolder && isOver && dragActive?.data.current?.kind === 'telegram-files';

    // Lazy video metadata badge (.mp4 only)
    const { data: videoMeta, isLoading: videoMetaLoading } = useVideoMetadata(
        file.id,
        file.folder_id ?? null,
        file.name,
    );

    // Cached HLS variants
    const { data: cachedVariants } = useCachedVariants(
        file.id,
        file.folder_id ?? null,
        file.name,
    );
    const cachedQualities = (cachedVariants || []).filter(v => v.available).map(v => v.quality);

    // Only request thumbnails when a card is close to the viewport. The explorer
    // is virtualized, but this also avoids spending Telegram/cache work on the
    // overscan row before the user reaches it.
    useEffect(() => {
        if (isFolder || !isImageFile(file.name)) {
            setThumbnailVisible(false);
            return;
        }

        const element = cardElementRef.current;
        if (!element || typeof IntersectionObserver === 'undefined') {
            setThumbnailVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setThumbnailVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '220px 0px' },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [file.id, file.name, isFolder]);

    // Lazy load thumbnail for image files
    useEffect(() => {
        if (isFolder || !isImageFile(file.name) || !thumbnailVisible) return;

        let cancelled = false;
        const cached = getCachedThumbnail(file.id, effectiveFolderId);
        setThumbnail(cached);
        setThumbnailLoading(!cached);
        setThumbnailReady(Boolean(cached));

        if (cached) {
            setThumbnailLoading(false);
        } else {
            const resolveImage = async () => {
                try {
                    // cmd_get_thumbnail already knows how to derive a bounded thumbnail
                    // from a small original when Telegram did not embed one. Do not fall
                    // back to a full preview here: that could turn a quick card paint into
                    // a multi-megabyte hidden transfer while the user is only scrolling.
                    const thumb = await loadThumbnail(file.id, effectiveFolderId).catch(() => null);
                    if (cancelled) return;
                    if (thumb) {
                        setThumbnailReady(false);
                        setThumbnail(thumb);
                    }
                } finally {
                    if (!cancelled) setThumbnailLoading(false);
                }
            };
            void resolveImage();
        }

        return () => {
            cancelled = true;
        };
    }, [file.id, file.name, effectiveFolderId, isFolder, thumbnailVisible]);

    return (
        <div
            ref={setNodeRef}
            className="file-card-container relative h-full min-w-0 overflow-hidden"
            style={{ opacity: isDragging ? 0.45 : undefined }}
            {...(!isFolder ? attributes : {})}
            {...(!isFolder ? listeners : {})}
            onContextMenu={onContextMenu}
            onClick={onClick}
            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen?.(); }}
        >
            <article
                data-file-kind={isFolder ? 'folder' : 'file'}
                className={`tcloud-file-card group relative h-full w-full min-w-0 cursor-pointer overflow-hidden tcloud-file-card-${variant}
                    ${isSelected ? 'is-selected' : ''}
                    ${isFileDragOver ? 'is-drop-target' : ''}`}
                style={height ? { height: `${height}px` } : { aspectRatio: '4/3' }}
            >
                <div className="tcloud-file-visual">
                    {thumbnail ? (
                        <>
                            {!thumbnailReady && <Skeleton className="absolute inset-0 rounded-none" />}
                            <img
                                src={thumbnail}
                                alt={file.name}
                                loading="lazy"
                                decoding="async"
                                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${thumbnailReady ? 'opacity-100' : 'opacity-0'}`}
                                onLoad={() => setThumbnailReady(true)}
                                onError={() => {
                                    // A broken cached thumbnail should not trigger a full
                                    // image download from a card. Drop it and let an
                                    // explicit preview/open action fetch the original.
                                    forgetThumbnail(file.id, effectiveFolderId);
                                    setThumbnailReady(false);
                                    setThumbnailLoading(false);
                                    setThumbnail(null);
                                }}
                            />
                            <div className="tcloud-file-image-shade" />
                        </>
                    ) : (
                        <div className="tcloud-file-symbol">
                            {isFolder ? (
                                <div className="tcloud-folder-symbol">
                                    <Folder className="h-10 w-10" strokeWidth={1.65} />
                                </div>
                            ) : thumbnailLoading && isImageFile(file.name) ? (
                                <Skeleton className="h-12 w-12 rounded-xl" />
                            ) : (
                                <div className="tcloud-document-symbol">
                                    <FileTypeIcon filename={file.name} size="lg" className="h-9 w-9" />
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleSelection?.();
                        }}
                        className={`tcloud-file-select ${isSelected ? 'is-selected' : ''}`}
                        aria-label="Selecionar arquivo"
                    >
                        {isSelected ? <Check className="h-3.5 w-3.5" /> : <span />}
                    </button>

                    <div className="tcloud-file-actions">
                        {!isFolder && onPreview && (
                            <button onClick={(e) => { e.stopPropagation(); onPreview(); }} title="Visualizar">
                                <Eye className="h-3.5 w-3.5" />
                            </button>
                        )}

                        <button onClick={(e) => { e.stopPropagation(); onDownload(); }} title="Baixar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>

                        {!isFolder && onShare && (
                            <button onClick={(e) => { e.stopPropagation(); onShare(); }} title="Compartilhar">
                                <Link className="h-3.5 w-3.5" />
                            </button>
                        )}

                        <button
                            className="is-danger"
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            title="Excluir"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                <footer className="tcloud-file-footer">
                    <div className="min-w-0">
                        <h3 title={file.name}>{file.name}</h3>
                        <div className="tcloud-file-meta">
                            <span>{isFolder ? 'Pasta' : file.sizeStr}</span>
                            <EncryptionBadge
                                state={file.encryption_state ?? 'plain'}
                                className="shrink-0"
                            />
                            <VideoMetaBadge
                                metadata={videoMeta}
                                isLoading={videoMetaLoading}
                            />
                            {cachedQualities.length > 0 && (
                                <span className="tcloud-cache-quality">
                                    <Check className="h-2.5 w-2.5" />
                                    {cachedQualities[0]}
                                </span>
                            )}
                        </div>
                    </div>

                    <FileAvailabilityBadge file={file} compact />
                </footer>
            </article>
        </div>
    );
});
