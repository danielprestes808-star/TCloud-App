import { invoke } from "@tauri-apps/api/core";

export interface TCloudTelegramChat {
  id: number;
  title: string;
  kind: "user" | "group" | "channel" | "supergroup" | string;
  username: string | null;
}

export function listTCloudTelegramChats() {
  return invoke<TCloudTelegramChat[]>("tcloud_list_telegram_chats");
}
