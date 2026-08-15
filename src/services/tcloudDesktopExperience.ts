import { invoke } from '@tauri-apps/api/core';

export type TCloudCloseBehavior = 'background' | 'exit';

export interface TCloudDesktopPreferences {
  close_behavior: TCloudCloseBehavior;
  close_notice_seen: boolean;
  quiet_retries: boolean;
  auto_free_space_days: number;
}

export interface TCloudHealthReport {
  database_ok: boolean;
  active_transfers: number;
  waiting_transfers: number;
  attention_items: number;
  conflicts: number;
  cached_files: number;
  stalled_transfers: number;
  failed_cfapi_operations: number;
  previous_unclean_shutdown: boolean;
  stale_history_cleaned: number;
  repaired: boolean;
  summary: string;
}

export const getDesktopPreferences = () =>
  invoke<TCloudDesktopPreferences>('tcloud_get_desktop_preferences');

export const setDesktopPreferences = (
  closeBehavior: TCloudCloseBehavior,
  quietRetries: boolean,
  autoFreeSpaceDays = 0,
) => invoke<TCloudDesktopPreferences>('tcloud_set_desktop_preferences', {
  closeBehavior,
  quietRetries,
  autoFreeSpaceDays,
});

export const runTCloudHealthCheck = (repair = false) =>
  invoke<TCloudHealthReport>('tcloud_run_health_check', { repair });
