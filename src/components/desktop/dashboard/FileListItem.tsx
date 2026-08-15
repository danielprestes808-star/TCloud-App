import { memo, useCallback } from 'react';
import { Check, Folder, MoreVertical } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { TelegramFile } from '../../../types';
import { FileTypeIcon } from '../../shared/FileTypeIcon';
import { useVideoMetadata } from '../../../hooks/useVideoMetadata';
import { useCachedVariants } from '../../../hooks/useCachedVariants';
import { VideoMetaBadge } from '../../shared/VideoMetaBadge';
import { EncryptionBadge } from '../../shared/EncryptionBadge';
import { FileAvailabilityBadge } from './FileAvailabilityBadge';

interface FileListItemProps {
    file: TelegramFile;
    isSelected: boolean;
    dragFileIds?: number[];
    onFileClick: (e: React.MouseEvent, id: number) => void;
    handleContextMenu: (e: React.MouseEvent, file: TelegramFile) => void;
    onOpen?: () => void;
    variant?: 'list' | 'details';
}

function fileTypeLabel(file: TelegramFile) {
    if (file.type === 'folder') return 'Pasta de arquivos';
    const match = file.name.match(/\.([^.]+)$/);
    return match ? `${match[1].toUpperCase()} arquivo` : 'Arquivo';
}

export const FileListItem = memo(function FileListItem({
    file, isSelected, dragFileIds, onFileClick, handleContextMenu, onOpen, variant = 'list'
}: FileListItemProps) {
    const isFolder = file.type === 'folder';
    const fileIds = isSelected && dragFileIds ? dragFileIds : [file.id];
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
        setDraggableNodeRef(node);
        setDroppableNodeRef(node);
    }, [setDraggableNodeRef, setDroppableNodeRef]);
    const isFileDragOver = isFolder && isOver && dragActive?.data.current?.kind === 'telegram-files';

    const { data: videoMeta, isLoading: videoMetaLoading } = useVideoMetadata(
        file.id,
        file.folder_id ?? null,
        file.name,
    );
    const { data: cachedVariants } = useCachedVariants(
        file.id,
        file.folder_id ?? null,
        file.name,
    );
    const cachedQualities = (cachedVariants || []).filter(v => v.available).map(v => v.quality);
    const isDetails = variant === 'details';

    return (
        <div
            ref={setNodeRef}
            onClick={(e) => onFileClick(e, file.id)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen?.(); }}
            style={{ opacity: isDragging ? 0.45 : undefined }}
            {...(!isFolder ? attributes : {})}
            {...(!isFolder ? listeners : {})}
            className={`tcloud-file-row group grid cursor-pointer items-center gap-2 ${isDetails ? 'is-details' : 'is-list'}
                ${isSelected ? 'is-selected' : ''}
                ${isFileDragOver ? 'is-drop-target' : ''}
            `}
        >
            <div className="tcloud-row-icon flex justify-center">
                {isFolder ? <Folder className="h-4 w-4 text-app-accent" /> : <FileTypeIcon filename={file.name} className="h-4 w-4" />}
            </div>
            <div className="tcloud-row-name min-w-0 truncate" title={file.name}>
                <span>{file.name}</span>
                <EncryptionBadge state={file.encryption_state ?? 'plain'} className="ms-1.5 align-middle" />
                <VideoMetaBadge metadata={videoMeta} isLoading={videoMetaLoading} />
                {cachedQualities.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 ml-1.5">
                        {cachedQualities.slice(0, 1).map(q => (
                            <span key={q} className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 text-badge font-medium text-emerald-400">
                                <Check className="w-2.5 h-2.5" />
                                {q}
                            </span>
                        ))}
                    </span>
                )}
            </div>
            {isDetails && (
                <>
                    <div className="tcloud-row-meta truncate">{file.created_at || '-'}</div>
                    <div className="tcloud-row-meta truncate">{fileTypeLabel(file)}</div>
                    <div className="tcloud-row-meta truncate text-end">{isFolder ? '' : file.sizeStr}</div>
                    <div className="tcloud-row-status"><FileAvailabilityBadge file={file} /></div>
                </>
            )}
            <div className="flex justify-end">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, file);
                    }}
                    className="quiet-control flex h-7 w-7 items-center justify-center border border-transparent text-app-text-secondary opacity-0 group-hover:opacity-100 hover:text-app-text focus-visible:opacity-100"
                    aria-label="Ações do arquivo"
                >
                    <MoreVertical className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
});
