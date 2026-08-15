import { invoke } from "@tauri-apps/api/core";

export interface TCloudSyncActivity {
  id: number;
  file_id: number;
  file_name: string;
  file_path: string;
  operation: string;
  status: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  bytes_total: number;
  bytes_transferred: number;
  speed_bps: number;
  eta_seconds: number | null;
  paused: boolean;
  cancel_requested: boolean;
  priority: number;
}


export interface TCloudSyncOverview {
  pending: number;
  running: number;
  failed: number;
  historical_failed: number;
}

export interface TCloudAttentionCleanupResult {
  cleaned_sync_jobs: number;
  cleaned_cfapi_ops: number;
  remaining: number;
}
export interface TCloudSyncCenterStats {
  pending: number;
  running: number;
  failed: number;
  completed: number;
  uploads: number;
  downloads: number;
  deletes: number;
  recent: TCloudSyncActivity[];
}

export function getTCloudSyncCenter() {
  return invoke<TCloudSyncCenterStats>("tcloud_get_sync_center");
}

export function getTCloudSyncOverview() {
  return invoke<TCloudSyncOverview>("tcloud_get_sync_overview");
}

export function retryTCloudSyncJob(jobId: number) {
  return invoke<void>("tcloud_retry_sync_job", { jobId });
}

export function retryAllTCloudSyncFailures() {
  return invoke<number>("tcloud_retry_all_sync_failures");
}

export function cleanupStaleTCloudAttention() {
  return invoke<TCloudAttentionCleanupResult>("tcloud_cleanup_stale_attention");
}

export function clearCompletedTCloudJobs() {
  return invoke<number>("tcloud_clear_completed_jobs");
}


export function pauseTCloudSyncJob(jobId: number) {
  return invoke<void>("tcloud_pause_sync_job", { jobId });
}

export function resumeTCloudSyncJob(jobId: number) {
  return invoke<void>("tcloud_resume_sync_job", { jobId });
}

export function cancelTCloudSyncJob(jobId: number) {
  return invoke<void>("tcloud_cancel_sync_job", { jobId });
}


export function setTCloudJobPriority(
  jobId: number,
  priority: "high" | "normal" | "low",
) {
  return invoke<void>("tcloud_set_job_priority", { jobId, priority });
}
