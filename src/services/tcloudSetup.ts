import { invoke } from "@tauri-apps/api/core";

export interface TCloudSetupFolder {
  name: string;
  create_group: boolean;
}

export interface TCloudSetupPlan {
  folders: TCloudSetupFolder[];
}

export interface TCloudSetupState {
  completed: boolean;
  folder_count: number;
}

export function getTCloudSetupState() {
  return invoke<TCloudSetupState>("tcloud_get_setup_state");
}

export function createTCloudDefaultFolders(plan: TCloudSetupPlan) {
  return invoke<number[]>("tcloud_create_default_folders", { plan });
}

export function resetTCloudSetupState() {
  return invoke<void>("tcloud_reset_setup_state");
}
