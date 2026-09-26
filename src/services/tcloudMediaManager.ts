import { invoke } from '@tauri-apps/api/core';

type StreamInfo = { token: string; base_url: string };
type WarmFile = {
    id: number;
    name: string;
    size?: number | null;
    folder_id?: number | null;
};

const MAX_FULL_PREFETCH_BYTES = 48 * 1024 * 1024;
const VIDEO_HEAD_BYTES = 2 * 1024 * 1024;
const WARM_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT = 2;

let streamInfoPromise: Promise<StreamInfo> | null = null;
let active = 0;
const queue: Array<() => Promise<void>> = [];
const warmed = new Map<string, number>();

const isVideo = (name: string) =>
    /\.(mp4|mkv|mov|webm|m4v|avi|mpeg|mpg)$/i.test(name);

const isImage = (name: string) =>
    /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(name);

const isAudio = (name: string) =>
    /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(name);

function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        const task = queue.shift();
        if (!task) return;
        active += 1;
        void task().catch(() => {}).finally(() => {
            active -= 1;
            pump();
        });
    }
}

function enqueue(task: () => Promise<void>) {
    queue.push(task);
    pump();
}

async function getStreamInfo() {
    if (!streamInfoPromise) {
        streamInfoPromise = invoke<StreamInfo>('cmd_get_stream_info').catch((error) => {
            streamInfoPromise = null;
            throw error;
        });
    }
    return streamInfoPromise;
}

async function warmVideoHead(file: WarmFile, folderId: number | null) {
    const info = await getStreamInfo();
    const folder = folderId === null ? 'home' : String(folderId);
    const url =
        `${info.base_url}/stream/${folder}/${file.id}` +
        `?token=${encodeURIComponent(info.token)}`;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
        await fetch(url, {
            method: 'GET',
            headers: { Range: `bytes=0-${VIDEO_HEAD_BYTES - 1}` },
            cache: 'force-cache',
            signal: controller.signal,
        });
    } finally {
        window.clearTimeout(timeout);
    }
}

export function warmTCloudMedia(
    file: WarmFile,
    activeFolderId: number | null,
    immediate = false,
) {
    if (!file?.id) return;
    if (!(isVideo(file.name) || isImage(file.name) || isAudio(file.name))) return;

    const folderId = file.folder_id ?? activeFolderId ?? null;
    const key = `${folderId ?? 'home'}:${file.id}`;
    const now = Date.now();
    const previous = warmed.get(key) ?? 0;
    if (now - previous < WARM_TTL_MS) return;
    warmed.set(key, now);

    const run = async () => {
        const size = Number(file.size ?? 0);

        // Existing command feeds the persistent tcloud_cache and Smart Storage.
        if (size > 0 && size <= MAX_FULL_PREFETCH_BYTES) {
            await invoke('tcloud_prepare_preview', { fileId: file.id });
            return;
        }

        // Never fill the cache with a huge video just because it is near the viewport.
        if (isVideo(file.name)) {
            await warmVideoHead(file, folderId);
        }
    };

    if (immediate) {
        enqueue(run);
    } else {
        window.setTimeout(() => enqueue(run), 180);
    }
}
