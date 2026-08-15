import { invoke } from "@tauri-apps/api/core";

export interface TCloudRecentFile {
  id: number;
  name: string;
  path: string;
  size: number;
  sync_status: string;
  local_status: string;
  updated_at: number;
}

export interface TCloudDashboardStats {
  files: number;
  folders: number;
  pending_jobs: number;
  running_jobs: number;
  failed_jobs: number;
  conflicts: number;
  synced_files: number;
  online_only_files: number;
  cached_files: number;
  total_bytes: number;
  recent_files: TCloudRecentFile[];
}

export function getTCloudDashboardStats() {
  return invoke<TCloudDashboardStats>("tcloud_get_dashboard_stats");
}
