import { invoke } from '@tauri-apps/api/core';
import type { TelegramFolder } from '../types';

// Internal Telegram forums are presented to the product as ordinary first-level
// TCloud folders. The frontend intentionally does not expose any "default forum"
// concept; destination is determined by the folder the user is currently using.
export interface TCloudForum {
  id: number;
  telegram_chat_id: number;
  name: string;
}

export interface TCloudForumTreeTopic {
  id: number;
  name: string;
}

export interface TCloudForumTree extends TCloudForum {
  topics: TCloudForumTreeTopic[];
}

export const listTCloudForumTree = () =>
  invoke<TCloudForumTree[]>('tcloud_forum_list_tree_cached');

export const refreshTCloudForumTreeFromTelegram = () =>
  invoke<TCloudForumTree[]>('tcloud_forum_list_tree');

export const createTCloudForum = (name: string, makeDefault = false) =>
  invoke<TCloudForum>('tcloud_forum_create', { name, makeDefault });

export const renameTCloudMainFolder = (forumId: number, newName: string) =>
  invoke<void>('tcloud_forum_rename', { forumId, newName });

export const deleteTCloudMainFolder = (forumId: number) =>
  invoke<void>('tcloud_forum_delete_empty', { forumId });

export const createTCloudForumTopic = (name: string, forumId?: number | null) =>
  invoke<TelegramFolder>('tcloud_forum_create_topic', { name, forumId: forumId ?? null });

export const transferTCloudForumTopic = (
  folderId: number,
  targetForumId: number,
  moveTopic: boolean,
) => invoke<TelegramFolder>('tcloud_forum_transfer_topic', { folderId, targetForumId, moveTopic });

// Legacy migration stays available to the advanced maintenance surface, but it
// is no longer part of the normal folder-management experience.
export interface LegacyTCloudChannel {
  channel_id: number;
  name: string;
}

export interface ForumMigrationResult {
  source_channel_id: number;
  source_name: string;
  topic_folder_id: number;
  migrated_messages: number;
  skipped_messages: number;
  source_deleted: boolean;
}

export const listLegacyTCloudChannels = () =>
  invoke<LegacyTCloudChannel[]>('tcloud_forum_list_legacy_channels');

export const migrateLegacyChannelToForum = (
  sourceChannelId: number,
  forumId?: number | null,
  deleteSourceAfter = false,
) => invoke<ForumMigrationResult>('tcloud_forum_migrate_channel', {
  sourceChannelId,
  forumId: forumId ?? null,
  deleteSourceAfter,
});
