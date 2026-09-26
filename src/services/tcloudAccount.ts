const CORE_URL = ((import.meta.env.VITE_TCLOUD_CORE_URL as string | undefined)
  ?? 'https://tcloud-core.onrender.com').replace(/\/+$/, '');

const TOKEN_KEY = 'tcloud.account.deviceToken.v1';
const DEVICE_KEY = 'tcloud.account.deviceId.v1';

export interface TCloudAccountStatus {
  connected: boolean;
  deviceId: string | null;
  message: string;
}

export interface TCloudPairingCode {
  code: string;
  expiresAt: string;
}
export interface TCloudRemoteProfile { id:string; displayName:string; username?:string; avatarUrl?:string; profileComplete:boolean; verified:boolean; }
export interface TCloudDevice { id:string; name:string; platform:string; appVersion?:string; lastSeenAt?:string; createdAt:string; active:boolean; current:boolean; }

function token() {
  return window.localStorage.getItem(TOKEN_KEY)?.trim() || '';
}
export function hasTCloudAccount() { return Boolean(token() && localStorage.getItem(DEVICE_KEY)?.trim()); }

async function core(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const value = token();
  if (value) headers.set('authorization', `Bearer ${value}`);
  return fetch(`${CORE_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function getTCloudAccountStatus(): Promise<TCloudAccountStatus> {
  const deviceId = window.localStorage.getItem(DEVICE_KEY)?.trim() || null;
  if (!token() || !deviceId) {
    return { connected: false, deviceId: null, message: 'Este computador ainda não foi conectado.' };
  }
  try {
    const response = await core('/api/v1/devices');
    if (response.status === 401 || response.status === 403) {
      disconnectTCloudAccount();
      return { connected: false, deviceId: null, message: 'A sessão expirou ou foi revogada.' };
    }
    if (!response.ok) return { connected: true, deviceId, message: 'Conta conectada; Core temporariamente indisponível.' };
    const devices = await response.json() as Array<{ id?: string }>;
    const connected = devices.some((device) => device.id === deviceId);
    if (!connected) disconnectTCloudAccount();
    return {
      connected,
      deviceId: connected ? deviceId : null,
      message: connected ? 'Este computador está conectado à sua conta.' : 'O acesso deste computador foi revogado.',
    };
  } catch {
    return { connected: true, deviceId, message: 'Conta conectada; verificação pendente por falta de rede.' };
  }
}

export async function registerTCloudAccount(displayName: string, username: string, avatarDataUrl?: string) {
  if (token()) {
    const response = await core('/api/v1/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName, username, avatarDataUrl }) });
    const data = await response.json() as { message?: string };
    if (!response.ok) throw new Error(data.message || 'Não foi possível atualizar seu perfil.');
    return;
  }
  const response = await fetch(`${CORE_URL}/api/v1/onboarding/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, username, deviceName: `TCloud em ${navigator.platform || 'Windows'}`, platform: 'windows', appVersion: '13.0.61' }),
  });
  const data = await response.json() as { token?: string; deviceId?: string; message?: string };
  if (!response.ok || !data.token || !data.deviceId) throw new Error(data.message || 'Não foi possível criar sua conta TCloud.');
  localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(DEVICE_KEY, data.deviceId);
}

export async function getRemoteProfile(): Promise<TCloudRemoteProfile|null> {
  if (!token()) return null; const response=await core('/api/v1/profile');
  if (!response.ok) return null; return response.json();
}
export async function listTCloudDevices(): Promise<TCloudDevice[]> {
  if (!token()) return []; const response=await core('/api/v1/devices');
  if (!response.ok) throw new Error('Não foi possível carregar os dispositivos.'); return response.json();
}
export async function revokeTCloudDevice(deviceId:string) {
  const response=await core('/api/v1/devices/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId})});
  const data=await response.json() as {message?:string}; if(!response.ok) throw new Error(data.message||'Não foi possível revogar o dispositivo.');
}

export async function pairTCloudAccount(rawCode: string) {
  const code = rawCode.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (code.length !== 10) throw new Error('Informe o código de 10 caracteres.');
  const response = await fetch(`${CORE_URL}/api/v1/device-auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      deviceName: `TCloud em ${navigator.platform || 'Windows'}`,
      platform: 'windows',
      appVersion: '13.0.61',
    }),
  });
  const data = await response.json() as { token?: string; deviceId?: string; message?: string };
  if (!response.ok || !data.token || !data.deviceId) {
    throw new Error(data.message || 'Código inválido ou expirado.');
  }
  window.localStorage.setItem(TOKEN_KEY, data.token);
  window.localStorage.setItem(DEVICE_KEY, data.deviceId);
}

export async function createTCloudPairingCode(): Promise<TCloudPairingCode> {
  const response = await core('/api/v1/devices/pairing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: 'Novo dispositivo', platform: 'unknown', appVersion: null }),
  });
  const data = await response.json() as Partial<TCloudPairingCode> & { message?: string };
  if (!response.ok || !data.code || !data.expiresAt) {
    throw new Error(data.message || 'Não foi possível gerar o código.');
  }
  return { code: data.code, expiresAt: data.expiresAt };
}

export function disconnectTCloudAccount() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(DEVICE_KEY);
}
