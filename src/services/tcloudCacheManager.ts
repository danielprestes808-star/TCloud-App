import { invoke } from "@tauri-apps/api/core";

export interface TCloudCacheStatus {
  current_bytes: number;
  limit_bytes: number;
}

export function getTCloudCacheStatus() {
  return invoke<TCloudCacheStatus>("tcloud_get_cache_status");
}

export function setTCloudCacheLimit(limitBytes: number) {
  return invoke<TCloudCacheStatus>("tcloud_set_cache_limit", { limitBytes });
}

export function cleanupTCloudCache() {
  return invoke<TCloudCacheStatus>("tcloud_cleanup_cache");
}
