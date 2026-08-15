import { invoke } from "@tauri-apps/api/core";

export interface TCloudNetworkSettings {
  economy_mode: boolean;
  upload_limit_bps: number;
  download_limit_bps: number;
}

export function getTCloudNetworkSettings() {
  return invoke<TCloudNetworkSettings>("tcloud_get_network_settings");
}

export function setTCloudNetworkSettings(
  economyMode: boolean,
  uploadLimitBps: number,
  downloadLimitBps: number,
) {
  return invoke<TCloudNetworkSettings>("tcloud_set_network_settings", {
    economyMode,
    uploadLimitBps,
    downloadLimitBps,
  });
}
