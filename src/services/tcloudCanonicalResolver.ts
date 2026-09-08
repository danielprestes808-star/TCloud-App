import { invoke } from "@tauri-apps/api/core";
import type { CanonicalFileRef } from "./tcloudCanonicalIdentity";

export type CanonicalResolvedFileRef = CanonicalFileRef & {
  localFileId: number;
  coreFileId: string | null;
  canonical: boolean;
};

export async function resolveCanonicalFileRef(
  localFileId: number,
  explicitCoreFileId?: string | null,
): Promise<CanonicalResolvedFileRef> {
  const explicit = explicitCoreFileId?.trim();
  if (explicit) {
    return {
      localFileId,
      coreFileId: explicit,
      canonical: true,
    };
  }

  try {
    const result = await invoke<{
      localFileId: number;
      coreFileId: string | null;
      canonical: boolean;
    }>("tcloud_resolve_core_file_id", { localFileId });

    return {
      localFileId,
      coreFileId: result.coreFileId,
      canonical: result.canonical,
    };
  } catch {
    return {
      localFileId,
      coreFileId: null,
      canonical: false,
    };
  }
}

export async function withCanonicalFirst<T>(
  ref: CanonicalFileRef,
  canonical: (coreFileId: string) => Promise<T>,
  legacy: () => Promise<T>,
): Promise<T> {
  const localFileId = Number(ref.localFileId ?? 0);
  const resolved = localFileId > 0
    ? await resolveCanonicalFileRef(localFileId, ref.coreFileId)
    : {
        localFileId,
        coreFileId: ref.coreFileId?.trim() || null,
        canonical: Boolean(ref.coreFileId?.trim()),
      };

  if (resolved.coreFileId) {
    return canonical(resolved.coreFileId);
  }

  return legacy();
}