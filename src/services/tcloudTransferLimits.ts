import { invoke } from "@tauri-apps/api/core";

export interface TCloudTransferLimits {
  max_concurrent: number;
}

export function getTCloudTransferLimits() {
  return invoke<TCloudTransferLimits>("tcloud_get_transfer_limits");
}

export function setTCloudTransferLimits(maxConcurrent: number) {
  return invoke<TCloudTransferLimits>("tcloud_set_transfer_limits", {
    maxConcurrent,
  });
}
