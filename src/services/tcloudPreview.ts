import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { resolveCanonicalFileRef } from "./tcloudCanonicalResolver";
import { getTCloudDeviceAccessToken } from "./tcloudCoreSession";

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
  const local = await invoke<TCloudPreviewInfo>("tcloud_prepare_preview", { fileId });
  if (local.ready) return local;

  const canonical = await resolveCanonicalFileRef(fileId);
  if (!canonical.coreFileId) return local;
  try {
    return await invoke<TCloudPreviewInfo>("tcloud_prepare_canonical_preview", {
      fileId,
      coreFileId: canonical.coreFileId,
      accessToken: getTCloudDeviceAccessToken(),
    });
  } catch {
    return local;
  }
}

export function tcloudLocalFileUrl(path: string) {
  return convertFileSrc(path);
}
