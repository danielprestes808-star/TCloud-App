import { invoke } from "@tauri-apps/api/core";

export interface TCloudSyncConfig {
  local_root: string | null;
  watcher_enabled: boolean;
  recovered_previous_session: boolean;
  database_healthy: boolean;
  last_maintenance_at: number | null;
  last_deep_maintenance_at: number | null;
  last_resume_at: number | null;
}

export async function setTCloudSyncFolder(path: string) {
  return invoke<string>("tcloud_set_sync_folder", { path });
}

export async function setTCloudWatcherEnabled(enabled: boolean) {
  return invoke<boolean>("tcloud_set_watcher_enabled", { enabled });
}

export async function getTCloudSyncConfig() {
  return invoke<TCloudSyncConfig>("tcloud_get_sync_config");
}


export interface TCloudWatcherStatus {
  running: boolean;
  root: string | null;
}

export async function getTCloudWatcherStatus() {
  return invoke<TCloudWatcherStatus>("tcloud_get_watcher_status");
}
