import { invoke } from '@tauri-apps/api/core';

export interface FolderCryptoPolicy { folder_id:number; mode:'inherit'|'standard'|'vault'; protect_metadata:boolean; updated_at:number; }
export interface ContentReindexResult { text_files:number; pdf_files:number; ocr_images:number; skipped:number; errors:string[]; }
export interface IndexDownloadQueueResult { candidates:number; queued:number; already_queued:number; }
export interface CfapiStatus { platform_supported:boolean; registered:boolean; root_path:string; fallback:string; detail:string; phase:string; placeholder_count:number; hydration_ready:boolean; provider_connected:boolean; active_fetches:number; completed_fetches:number; cancelled_fetches:number; failed_fetches:number; pending_operations:number; failed_operations:number; encrypted_hydration_ready:boolean; last_provider_error:string|null; platform_build:number|null; platform_integration:number|null; shell_registered:boolean; shell_pinning_enabled:boolean; shell_sync_root_id:string|null; shell_detail:string; package_identity:boolean; package_family_name:string|null; health:'unsupported'|'setup_needed'|'reconnecting'|'needs_attention'|'ready_native'|'ready_compatible'|string; native_offline_menu:boolean; fallback_menu_installed:boolean; offline_pinned_count:number; cloud_only_count:number; cached_count:number; auto_repair_active:boolean; }
export interface CfapiPopulateResult { indexed:number; created:number; existing:number; skipped:number; errors:string[]; root_path:string; }
export interface CfapiIntegrityResult { checked:number; missing_placeholders:number; stale_index:number; repaired:number; errors:string[]; root_path:string; }
export interface CfapiAvailabilityResult { action:'keep_on_device'|'free_space'|string; accepted:boolean; root_path:string; detail:string; }
export interface WindowsHelloStatus { supported:boolean; enrolled:boolean; detail:string; }
export interface MusicTrack { file_id:number; message_id:number|null; folder_id:number|null; name:string; local_path:string|null; title:string; artist:string; album:string; duration_seconds:number|null; cached:boolean; }
export interface MusicPlaylist { id:number; name:string; file_ids:number[]; created_at:number; }
export interface CleanupResult { removed_files:number; reclaimed_bytes:number; pruned_versions:number; pruned_trash_rows:number; errors:string[]; }
export interface DiagnosticCheck { name:string; status:'ok'|'warning'|'error'|string; detail:string; }
export interface ShareAuditItem { id:number; token:string; accessed_at:number; ip:string|null; user_agent:string|null; range_request:boolean; authorized:boolean; }
export interface RollbackStatus { prepared:boolean; target_version:string|null; backup_path:string|null; healthy:boolean; }
export interface UpdateStartupGuard { action:'normal'|'probation'|'rollback_scheduled'|string; detail:string; target_version:string|null; }

export const getFolderCryptoPolicy=(folderId:number)=>invoke<FolderCryptoPolicy>('tcloud_completion_folder_crypto_get',{folderId});
export const setFolderCryptoPolicy=(folderId:number,mode:FolderCryptoPolicy['mode'],protectMetadata:boolean)=>invoke<FolderCryptoPolicy>('tcloud_completion_folder_crypto_set',{folderId,mode,protectMetadata});
export const reindexFullContent=(includeOcr=true)=>invoke<ContentReindexResult>('tcloud_completion_reindex_content',{includeOcr});
export const queueIndexableDownloads=(limit=500)=>invoke<IndexDownloadQueueResult>('tcloud_completion_queue_indexable_downloads',{limit});
export const getCfapiStatus=()=>invoke<CfapiStatus>('tcloud_cfapi_status');
export const retryFailedCfapiOperations=()=>invoke<CfapiStatus>('tcloud_cfapi_retry_failed_operations');
export const setCfapiEnabled=(enabled:boolean)=>invoke<CfapiStatus>('tcloud_cfapi_set',{enabled});
export const populateCfapiPlaceholders=(limit=10000)=>invoke<CfapiPopulateResult>('tcloud_cfapi_populate',{limit});
export const finalizeCfapiExplorer=()=>invoke<CfapiStatus>('tcloud_cfapi_finalize_explorer');
export const checkCfapiIntegrity=(repair=true)=>invoke<CfapiIntegrityResult>('tcloud_cfapi_integrity_check',{repair});
export const keepCfapiOnDevice=()=>invoke<CfapiAvailabilityResult>('tcloud_cfapi_keep_on_device');
export const freeCfapiSpace=()=>invoke<CfapiAvailabilityResult>('tcloud_cfapi_free_space');
export const openCfapiRoot=()=>invoke<string>('tcloud_cfapi_open_root');
export const setCfapiItemAvailability=(messageId:number,folderId:number|null,offline:boolean)=>invoke<CfapiAvailabilityResult>('tcloud_cfapi_set_item_availability',{messageId,folderId,offline});
export const getWindowsStartupEnabled=()=>invoke<boolean>('tcloud_startup_enabled');
export const setWindowsStartupEnabled=(enabled:boolean)=>invoke<boolean>('tcloud_set_startup_enabled',{enabled});

/**
 * User-facing Windows setup. Hides CFAPI/Sync Root/Shell details behind a
 * single operation and leaves the technical commands available for the
 * advanced diagnostics screen.
 */
export async function connectThisComputer():Promise<CfapiStatus>{
  let status=await setCfapiEnabled(true);
  if(!status.shell_registered || !status.shell_pinning_enabled){
    try{status=await finalizeCfapiExplorer();}catch{/* legacy CFAPI remains usable */}
  }
  await populateCfapiPlaceholders(100_000).catch(()=>null);
  await setWindowsStartupEnabled(true).catch(()=>false);
  return getCfapiStatus();
}

/** Re-runs the safe connection path without unregistering a healthy root. */
export async function repairComputerConnection():Promise<CfapiStatus>{
  let status=await getCfapiStatus();
  if(!status.registered || !status.provider_connected){
    status=await setCfapiEnabled(true);
  }
  if(!status.shell_registered || !status.shell_pinning_enabled){
    try{status=await finalizeCfapiExplorer();}catch{/* keep existing provider */}
  }
  await populateCfapiPlaceholders(100_000).catch(()=>null);
  return getCfapiStatus();
}
export const getWindowsHelloStatus=()=>invoke<WindowsHelloStatus>('tcloud_completion_windows_hello_status');
export const enrollWindowsHello=(passphrase:string)=>invoke<WindowsHelloStatus>('tcloud_completion_windows_hello_enroll',{passphrase});
export const removeWindowsHello=()=>invoke<WindowsHelloStatus>('tcloud_completion_windows_hello_remove');
export const unlockWithWindowsHello=()=>invoke<number>('tcloud_completion_windows_hello_unlock');
export const getMusicLibrary=()=>invoke<MusicTrack[]>('tcloud_completion_music_library');
export const getMusicPlaylists=()=>invoke<MusicPlaylist[]>('tcloud_completion_music_playlists');
export const saveMusicPlaylist=(id:number|null,name:string,fileIds:number[])=>invoke<number>('tcloud_completion_music_playlist_save',{id,name,fileIds});
export const deleteMusicPlaylist=(id:number)=>invoke<boolean>('tcloud_completion_music_playlist_delete',{id});
export const applySmartCleanup=(cacheDays=30,trashDays=30,versionDays=90)=>invoke<CleanupResult>('tcloud_completion_cleanup_apply',{cacheDays,trashDays,versionDays});
export const runDeepDiagnostics=()=>invoke<DiagnosticCheck[]>('tcloud_completion_deep_diagnostics');
export const getShareAudit=(token?:string|null,limit=100)=>invoke<ShareAuditItem[]>('tcloud_completion_share_audit',{token:token??null,limit});
export const prepareRollback=(targetVersion:string)=>invoke<RollbackStatus>('tcloud_completion_prepare_rollback',{targetVersion});
export const markUpdateHealthy=()=>invoke<RollbackStatus>('tcloud_completion_mark_update_healthy');
export const cancelRollback=()=>invoke<boolean>('tcloud_completion_cancel_rollback');
export const getRollbackStatus=()=>invoke<RollbackStatus>('tcloud_completion_rollback_status');
export const forceRollback=()=>invoke<boolean>('tcloud_completion_force_rollback');
export const runUpdateStartupGuard=()=>invoke<UpdateStartupGuard>('tcloud_completion_update_startup_guard');

export function parseNaturalTCloudSearch(input:string):string {
  let q=input.trim();
  if (!q) return q;
  const lower=q.toLowerCase();
  const tokens:string[]=[];
  if (/\b(fotos?|imagens?)\b/.test(lower)) tokens.push('type:image');
  if (/\b(v[ií]deos?)\b/.test(lower)) tokens.push('type:video');
  if (/\b(m[uú]sicas?|[aá]udios?)\b/.test(lower)) tokens.push('type:audio');
  if (/\b(pdf|pdfs)\b/.test(lower)) tokens.push('type:pdf');
  if (/\b(documentos?)\b/.test(lower)) tokens.push('type:document');
  const size=lower.match(/(?:maior(?:es)?|acima)\s+(?:do?\s+)?(?:que\s+)?(\d+(?:[.,]\d+)?)\s*(kb|mb|gb|tb)/i);
  if(size) tokens.push(`size:>${size[1].replace(',','.')}${size[2].toUpperCase()}`);
  const smaller=lower.match(/(?:menor(?:es)?|abaixo)\s+(?:do?\s+)?(?:que\s+)?(\d+(?:[.,]\d+)?)\s*(kb|mb|gb|tb)/i);
  if(smaller) tokens.push(`size:<${smaller[1].replace(',','.')}${smaller[2].toUpperCase()}`);
  const lastDays=lower.match(/(?:[uú]ltimos?)\s+(\d+)\s+dias?/);
  if(lastDays){const d=new Date(Date.now()-Number(lastDays[1])*86400000);tokens.push(`after:${d.toISOString().slice(0,10)}`);}
  if(/\bhoje\b/.test(lower)) tokens.push(`after:${new Date().toISOString().slice(0,10)}`);
  if(/\besta semana\b/.test(lower)){const d=new Date(Date.now()-7*86400000);tokens.push(`after:${d.toISOString().slice(0,10)}`);}
  const before=lower.match(/antes\s+(?:de\s+)?(\d{4}-\d{2}-\d{2})/); if(before) tokens.push(`before:${before[1]}`);
  const after=lower.match(/(?:depois|ap[oó]s)\s+(?:de\s+)?(\d{4}-\d{2}-\d{2})/); if(after) tokens.push(`after:${after[1]}`);
  q=q
    .replace(/\b(fotos?|imagens?|v[ií]deos?|m[uú]sicas?|[aá]udios?|pdfs?|documentos?)\b/gi,' ')
    .replace(/(?:maior(?:es)?|acima|menor(?:es)?|abaixo)\s+(?:do?\s+)?(?:que\s+)?\d+(?:[.,]\d+)?\s*(?:kb|mb|gb|tb)/gi,' ')
    .replace(/(?:[uú]ltimos?)\s+\d+\s+dias?/gi,' ')
    .replace(/\b(?:hoje|esta semana)\b/gi,' ')
    .replace(/(?:antes|depois|ap[oó]s)\s+(?:de\s+)?\d{4}-\d{2}-\d{2}/gi,' ')
    .replace(/\s+/g,' ').trim();
  return [...tokens,q].filter(Boolean).join(' ').trim();
}
