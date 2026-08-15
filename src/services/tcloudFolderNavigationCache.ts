import type { TelegramFile } from '../types';
import { formatBytes } from '../utils';
import { listIndexedFiles } from './tcloudProductivity';

const MAX_CACHED_FOLDERS = 6;
const MAX_TOTAL_FILES = 30_000;
const MAX_SINGLE_FOLDER_FILES = 25_000;
const CACHE_TTL_MS = 20 * 60_000;
const LOCAL_INDEX_AGE_MS = 6 * 60_000;

export type FolderNavigationSnapshot = {
    files: TelegramFile[];
    updatedAt: number;
};

type CacheEntry = FolderNavigationSnapshot & {
    key: string;
    lastAccess: number;
};

const cache = new Map<string, CacheEntry>();
const warmInFlight = new Map<string, Promise<TelegramFile[]>>();

function keyFor(folderId: number | null) {
    return folderId === null ? 'saved' : String(folderId);
}

function pruneExpired(now = Date.now()) {
    for (const [key, entry] of cache) {
        if (now - entry.lastAccess > CACHE_TTL_MS) cache.delete(key);
    }
}

function pruneToBudget() {
    pruneExpired();
    let totalFiles = Array.from(cache.values()).reduce((sum, entry) => sum + entry.files.length, 0);
    while (cache.size > MAX_CACHED_FOLDERS || totalFiles > MAX_TOTAL_FILES) {
        let oldest: CacheEntry | null = null;
        for (const entry of cache.values()) {
            if (!oldest || entry.lastAccess < oldest.lastAccess) oldest = entry;
        }
        if (!oldest) break;
        cache.delete(oldest.key);
        totalFiles -= oldest.files.length;
    }
}

export function getFolderNavigationSnapshot(folderId: number | null): FolderNavigationSnapshot | null {
    const key = keyFor(folderId);
    const entry = cache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now - entry.lastAccess > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    entry.lastAccess = now;
    // Refresh insertion order so the Map also behaves like an LRU for inspection/debugging.
    cache.delete(key);
    cache.set(key, entry);
    return { files: entry.files, updatedAt: entry.updatedAt };
}

export function setFolderNavigationSnapshot(
    folderId: number | null,
    files: TelegramFile[],
    updatedAt = Date.now(),
) {
    const key = keyFor(folderId);
    if (files.length > MAX_SINGLE_FOLDER_FILES) {
        cache.delete(key);
        return;
    }
    const entry: CacheEntry = {
        key,
        files,
        updatedAt,
        lastAccess: Date.now(),
    };
    cache.delete(key);
    cache.set(key, entry);
    pruneToBudget();
}

export function invalidateFolderNavigationSnapshot(folderId: number | null) {
    cache.delete(keyFor(folderId));
}

export async function warmFolderNavigationSnapshot(folderId: number | null): Promise<TelegramFile[]> {
    const cached = getFolderNavigationSnapshot(folderId);
    if (cached) return cached.files;

    const key = keyFor(folderId);
    const existing = warmInFlight.get(key);
    if (existing) return existing;

    const request = listIndexedFiles(folderId)
        .then((rows) => {
            const files: TelegramFile[] = rows.map((row) => ({
                id: row.message_id,
                name: row.name,
                size: row.size,
                sizeStr: formatBytes(row.size),
                created_at: row.created_at ?? undefined,
                type: 'file' as const,
                folder_id: folderId,
                sync_status: row.sync_status,
                local_status: row.local_status,
                is_pinned: row.is_pinned,
            }));
            if (files.length > 0) setFolderNavigationSnapshot(folderId, files, Date.now() - LOCAL_INDEX_AGE_MS);
            return files;
        })
        .finally(() => warmInFlight.delete(key));

    warmInFlight.set(key, request);
    return request;
}


export function trimFolderNavigationCacheForBackground(maxFolders = 2, maxFiles = 10_000) {
    pruneExpired();
    const entries = Array.from(cache.values())
        .sort((a, b) => b.lastAccess - a.lastAccess);

    const keepKeys = new Set<string>();
    let keptFiles = 0;
    for (const entry of entries) {
        if (keepKeys.size >= Math.max(1, maxFolders)) break;
        if (keepKeys.size > 0 && keptFiles + entry.files.length > Math.max(1_000, maxFiles)) continue;
        keepKeys.add(entry.key);
        keptFiles += entry.files.length;
    }

    for (const key of Array.from(cache.keys())) {
        if (!keepKeys.has(key)) cache.delete(key);
    }
}

export function getFolderNavigationCacheStats() {
    pruneExpired();
    return {
        folders: cache.size,
        files: Array.from(cache.values()).reduce((sum, entry) => sum + entry.files.length, 0),
        maxFolders: MAX_CACHED_FOLDERS,
        maxFiles: MAX_TOTAL_FILES,
    };
}
