import { invoke } from "@tauri-apps/api/core";

export interface TCloudCreatedStorageChat {
  chat_id: number;
  title: string;
  kind: string;
  folder_id: number;
}

export interface TCloudCreateStorageChatInput {
  folder_id: number;
  title?: string | null;
  kind?: "group" | "channel";
}

export function createTCloudStorageChat(input: TCloudCreateStorageChatInput) {
  return invoke<TCloudCreatedStorageChat>("tcloud_create_storage_chat", { input });
}
