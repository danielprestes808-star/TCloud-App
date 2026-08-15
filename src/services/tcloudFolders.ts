import { invoke } from "@tauri-apps/api/core";

export interface TCloudFolderNode {
  id: number;
  parent_id: number | null;
  name: string;
  path: string;
  telegram_chat_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface TCloudFolderCreateInput {
  parent_id: number | null;
  name: string;
  telegram_chat_id: number | null;
}

export function listTCloudFolderTree() {
  return invoke<TCloudFolderNode[]>("tcloud_list_folder_tree");
}

export function createTCloudLogicalFolder(input: TCloudFolderCreateInput) {
  return invoke<TCloudFolderNode>("tcloud_create_logical_folder", { input });
}

export function updateTCloudFolderGroup(
  folderId: number,
  telegramChatId: number | null,
) {
  return invoke<void>("tcloud_update_folder_group", {
    folderId,
    telegramChatId,
  });
}

export function deleteTCloudLogicalFolder(folderId: number) {
  return invoke<void>("tcloud_delete_logical_folder", { folderId });
}
