import { useCallback, useRef } from 'react';
import { showFileDialogFallback, pickWithFallback, sanitizeFilename } from '../utils';
import { invoke } from '@tauri-apps/api/core';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFile } from '../types';

export function useFileOperations(
    activeFolderId: number | null,
    selectedIds: number[],
    setSelectedIds: (ids: number[]) => void,
    displayedFiles: TelegramFile[],
    queueBulkDownload?: (files: TelegramFile[], folderId: number | null) => void,
) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();

    // Refs to keep callbacks stable even when selection/file list changes
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const displayedFilesRef = useRef(displayedFiles);
    displayedFilesRef.current = displayedFiles;

    const handleDelete = useCallback(async (id: number) => {
        if (!await confirm({ title: "Mover para a Lixeira", message: "O arquivo ficará recuperável na Lixeira do TCloud.", confirmText: "Mover", variant: 'danger' })) return;
        try {
            const file = displayedFilesRef.current.find((item) => item.id === id);
            await invoke('tcloud_pro_trash_add', {
                messageId: id,
                folderId: file?.folder_id ?? activeFolderId,
                name: file?.name || `Arquivo ${id}`,
                size: file?.size || 0,
            });
            window.dispatchEvent(new Event('tcloud-trash-changed'));
            toast.success("Arquivo movido para a Lixeira");
        } catch (e) {
            toast.error(`Falha ao mover para a Lixeira: ${e}`);
        }
    }, [activeFolderId, confirm]);

    const handleBulkDelete = useCallback(async () => {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        const targetFiles = displayedFilesRef.current.filter((file) => ids.includes(file.id) && file.type !== 'folder');
        if (targetFiles.length === 0) {
            toast.info('Selecione arquivos para mover para a Lixeira.');
            return;
        }
        if (!await confirm({ title: "Mover para a Lixeira", message: `Mover ${targetFiles.length} arquivo${targetFiles.length === 1 ? '' : 's'} para a Lixeira?`, confirmText: "Mover", variant: 'danger' })) return;
        let success = 0;
        for (const file of targetFiles) {
            try {
                await invoke('tcloud_pro_trash_add', {
                    messageId: file.id,
                    folderId: file.folder_id ?? activeFolderId,
                    name: file.name || `Arquivo ${file.id}`,
                    size: file.size || 0,
                });
                success++;
            } catch { /* continue */ }
        }
        setSelectedIds([]);
        window.dispatchEvent(new Event('tcloud-trash-changed'));
        if (success > 0) toast.success(`${success} arquivo${success === 1 ? '' : 's'} movido${success === 1 ? '' : 's'} para a Lixeira.`);
        if (targetFiles.length < ids.length) toast.info('Pastas selecionadas foram mantidas; esta ação em lote afeta somente arquivos.');
    }, [activeFolderId, confirm, setSelectedIds]);

    const handleBulkDownload = useCallback(async () => {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        const currentFiles = displayedFilesRef.current;
        const targetFiles = currentFiles.filter((f) => ids.includes(f.id) && f.type !== 'folder');
        if (targetFiles.length === 0) return;
        if (queueBulkDownload) {
            queueBulkDownload(targetFiles, activeFolderId);
            setSelectedIds([]);
            return;
        }
        // Fallback: direct download if queue not provided
        const downloadToDir = async (dirPath: string) => {
            let successCount = 0;
            const sep = dirPath.includes('\\') ? '\\' : '/';
            for (const file of targetFiles) {
                const sanitizedName = sanitizeFilename(file.name);
                const filePath = dirPath.endsWith(sep) ? `${dirPath}${sanitizedName}` : `${dirPath}${sep}${sanitizedName}`;
                try {
                    await invoke('cmd_download_file', { req: { message_id: file.id, save_path: filePath, folder_id: activeFolderId } });
                    successCount++;
                } catch (e) { }
            }
            toast.success(`Downloaded ${successCount} files.`);
            setSelectedIds([]);
        };
        try {
            const dirPath = await pickWithFallback(
                () => import('@tauri-apps/plugin-dialog').then(({ open }) => open({ directory: true, multiple: false, title: "Select Download Destination" })),
                () => handleBulkDownload(),
                {
                    errorTitle: 'Folder picker failed',
                    onBrowserPicker: async () => {
                        const paths = await showFileDialogFallback({ directory: true, multiple: false });
                        if (paths.length === 0) return null;
                        const sep = paths[0].includes('\\') ? '\\' : '/';
                        return paths[0].substring(0, paths[0].lastIndexOf(sep));
                    },
                },
            );
            if (!dirPath) return;
            await downloadToDir(dirPath);
        } catch (e) {
            toast.error(`Bulk download failed: ${e}`);
        }
    }, [activeFolderId, setSelectedIds, queueBulkDownload]);

    const handleBulkMove = useCallback(async (targetFolderId: number | null, onSuccess?: () => void) => {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        const fileIds = displayedFilesRef.current.filter((file) => ids.includes(file.id) && file.type !== 'folder').map((file) => file.id);
        if (fileIds.length === 0) {
            toast.info('Selecione arquivos para mover.');
            return;
        }
        try {
            await invoke('cmd_move_files', {
                messageIds: fileIds,
                sourceFolderId: activeFolderId,
                targetFolderId: targetFolderId
            });
            // Clean up stale thumbnail and preview cache entries for the old message IDs.
            // After a move (forward+delete), the message gets a new ID in the
            // target folder, so old cached thumbnails are orphaned.
            await Promise.all(fileIds.flatMap(id => [
                invoke('cmd_delete_image_thumbnail', { messageId: id, folderId: activeFolderId }).catch(() => {}),
                invoke('cmd_delete_preview_for_message', { messageId: id, folderId: activeFolderId }).catch(() => {}),
            ]));
            toast.success(`${fileIds.length} arquivo${fileIds.length === 1 ? '' : 's'} movido${fileIds.length === 1 ? '' : 's'}.`);
            queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] });
            setSelectedIds([]);
            if (onSuccess) onSuccess();
        } catch {
            toast.error('Failed to move files');
        }
    }, [activeFolderId, queryClient, setSelectedIds]);

    const handleDownloadFolder = useCallback(async () => {
        const files = displayedFilesRef.current;
        if (files.length === 0) {
            toast.info("Folder is empty.");
            return;
        }
        if (queueBulkDownload) {
            queueBulkDownload(files, activeFolderId);
            return;
        }
        // Fallback: direct download if queue not provided
        const downloadToDir = async (dirPath: string) => {
            let successCount = 0;
            toast.info(`Downloading folder contents (${files.length} files)...`);
            const sep = dirPath.includes('\\') ? '\\' : '/';
            for (const file of files) {
                const sanitizedName = sanitizeFilename(file.name);
                const filePath = dirPath.endsWith(sep) ? `${dirPath}${sanitizedName}` : `${dirPath}${sep}${sanitizedName}`;
                try {
                    await invoke('cmd_download_file', { req: { message_id: file.id, save_path: filePath, folder_id: activeFolderId } });
                    successCount++;
                } catch (e) { }
            }
            toast.success(`Folder Download Complete: ${successCount} files.`);
        };
        try {
            const dirPath = await pickWithFallback(
                () => import('@tauri-apps/plugin-dialog').then(d => d.open({
                    directory: true, multiple: false, title: "Download Folder To..."
                })),
                () => handleDownloadFolder(),
                {
                    errorTitle: 'Folder picker failed',
                    onBrowserPicker: async () => {
                        const paths = await showFileDialogFallback({ directory: true, multiple: false });
                        if (paths.length === 0) return null;
                        const sep = paths[0].includes('\\') ? '\\' : '/';
                        return paths[0].substring(0, paths[0].lastIndexOf(sep));
                    },
                },
            );
            if (!dirPath) return;
            await downloadToDir(dirPath);
        } catch (e) {
            toast.error("Error: " + e);
        }
    }, [activeFolderId, queueBulkDownload]);

    const handleGlobalSearch = useCallback(async (query: string) => {
        try {
            return await invoke<TelegramFile[]>('cmd_search_global', { query });
        } catch {
            return [];
        }
    }, []);

    return {
        handleDelete,
        handleBulkDelete,
        handleBulkDownload,
        handleBulkMove,
        handleDownloadFolder,
        handleGlobalSearch,
    };
}
