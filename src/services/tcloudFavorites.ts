import { invoke } from '@tauri-apps/api/core';

const KEY = 'tcloud:favorites:v2';
const LEGACY_KEY = 'tcloud:favorites:v1';
const EVENT = 'tcloud:favorites-changed';
let applyingRemote = false;
let pushTimer: number | null = null;

export type FavoriteKey = string;
export function favoriteKey(id:number, folderId:number|null|undefined):FavoriteKey {
  return `${folderId ?? 0}:${id}`;
}

function readRaw(): FavoriteKey[] {
  try {
    const value = localStorage.getItem(KEY);
    if (value) {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    }
    // One-time compatibility with the old message-id-only representation.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map(Number).filter(Number.isFinite).map((id)=>favoriteKey(id,0));
    writeRaw(migrated,false);
    return migrated;
  } catch { return []; }
}

function writeRaw(values:FavoriteKey[], emit=true) {
  const unique=Array.from(new Set(values.map(String).filter(Boolean)));
  localStorage.setItem(KEY, JSON.stringify(unique));
  if(emit) window.dispatchEvent(new CustomEvent(EVENT,{detail:unique}));
  return unique;
}

function scheduleRemotePush(values:FavoriteKey[]) {
  if(applyingRemote) return;
  if(pushTimer!==null) window.clearTimeout(pushTimer);
  pushTimer=window.setTimeout(()=>{
    pushTimer=null;
    void invoke<boolean>('tcloud_completion_favorites_push',{ids:values}).catch(()=>{});
  },700);
}

export function getFavoriteIds(): FavoriteKey[] { return readRaw(); }
export function isFavorite(id:number, folderId:number|null|undefined=0): boolean { return readRaw().includes(favoriteKey(id,folderId)); }
export function setFavorite(id:number, folderId:number|null|undefined, favorite:boolean): FavoriteKey[] {
  const key=favoriteKey(id,folderId);
  const next = new Set(readRaw());
  if (favorite) next.add(key); else next.delete(key);
  const values=writeRaw(Array.from(next)); scheduleRemotePush(values); return values;
}
export function toggleFavorite(id:number, folderId:number|null|undefined=0): boolean {
  const next = !isFavorite(id,folderId); setFavorite(id,folderId,next); return next;
}

interface FavoritesRemoteState { found:boolean; ids:FavoriteKey[]; }
export async function syncFavoritesFromTelegram():Promise<FavoriteKey[]> {
  try {
    const remote=await invoke<FavoritesRemoteState>('tcloud_completion_favorites_pull');
    if(!remote.found){const local=readRaw();if(local.length>0)scheduleRemotePush(local);return local;}
    applyingRemote=true; return writeRaw(remote.ids);
  } finally { applyingRemote=false; }
}
export async function pushFavoritesToTelegram():Promise<void>{await invoke<boolean>('tcloud_completion_favorites_push',{ids:readRaw()});}
export function subscribeFavorites(listener:(ids:FavoriteKey[])=>void){
  const handler=(event:Event)=>{const detail=(event as CustomEvent<FavoriteKey[]>).detail;listener(Array.isArray(detail)?detail:readRaw());};
  window.addEventListener(EVENT,handler); return()=>window.removeEventListener(EVENT,handler);
}
