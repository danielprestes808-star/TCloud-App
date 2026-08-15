import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface TCloudPreviewInfo {
  file_id: number;
  name: string;
  mime_type: string | null;
  ready: boolean;
  local_path: string | null;
  queued: boolean;
  message: string;
}

export async function prepareTCloudPreview(fileId: number) {
  return invoke<TCloudPreviewInfo>("tcloud_prepare_preview", { fileId });
}

export function tcloudLocalFileUrl(path: string) {
  return convertFileSrc(path);
}
