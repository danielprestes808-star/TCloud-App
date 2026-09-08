import { getTCloudDeviceAccessToken } from "./tcloudCoreSession";

const CORE_URL =
  (import.meta.env.VITE_TCLOUD_CORE_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://127.0.0.1:8787";

export type CanonicalFileRef = {
  localFileId?: number | null;
  coreFileId?: string | null;
};

export function hasCoreFileId(ref: CanonicalFileRef): ref is CanonicalFileRef & {
  coreFileId: string;
} {
  return typeof ref.coreFileId === "string" && ref.coreFileId.trim().length > 0;
}

export function canonicalMediaUrl(ref: CanonicalFileRef): string | null {
  if (!hasCoreFileId(ref)) return null;
  return `${CORE_URL}/api/v1/media/${encodeURIComponent(ref.coreFileId.trim())}`;
}

export function canonicalFileUrl(ref: CanonicalFileRef): string | null {
  if (!hasCoreFileId(ref)) return null;
  return `${CORE_URL}/api/v1/files/${encodeURIComponent(ref.coreFileId.trim())}`;
}

async function coreMutation(
  route: "rename" | "move" | "trash" | "restore" | "delete",
  coreFileId: string,
  extra: Record<string, unknown> = {},
) {
  const accessToken = getTCloudDeviceAccessToken();
  const response = await fetch(`${CORE_URL}/api/v1/files/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken
        ? { authorization: `Bearer ${accessToken}` }
        : {}),
    },
    body: JSON.stringify({ id: coreFileId, ...extra }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Core ${route} HTTP ${response.status}`,
    );
  }
  return payload;
}

export async function renameCanonicalFile(coreFileId: string, name: string) {
  return coreMutation("rename", coreFileId, { name });
}

export async function moveCanonicalFile(coreFileId: string, parentId: string) {
  return coreMutation("move", coreFileId, { parentId });
}

export async function trashCanonicalFile(coreFileId: string) {
  return coreMutation("trash", coreFileId);
}

export async function restoreCanonicalFile(coreFileId: string) {
  return coreMutation("restore", coreFileId);
}

export async function deleteCanonicalFile(coreFileId: string) {
  return coreMutation("delete", coreFileId);
}
