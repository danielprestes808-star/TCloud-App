import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

interface CachedVariantInfo {
    quality: string;
    available: boolean;
}

const STALE_TIME = 10 * 60_000; // 10 minutes — avoid repeated disk/backend checks while browsing

/**
 * Fetches which HLS variants are cached for a given MP4 file.
 * Returns empty array for non-MP4 files or on error.
 */
export function useCachedVariants(
    messageId: number,
    folderId: number | null,
    fileName: string,
) {
    const isMp4 = fileName.toLowerCase().endsWith('.mp4');

    return useQuery({
        queryKey: ['cached-variants', folderId ?? 0, messageId],
        queryFn: async (): Promise<CachedVariantInfo[]> => {
            if (!isMp4) return [];
            try {
                return await invoke<CachedVariantInfo[]>('cmd_get_cached_variants', {
                    messageId,
                    folderId,
                });
            } catch {
                return [];
            }
        },
        enabled: isMp4,
        staleTime: STALE_TIME,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 0,
    });
}
