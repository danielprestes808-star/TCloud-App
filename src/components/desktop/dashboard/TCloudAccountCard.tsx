import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, Link2, LoaderCircle, LogOut, QrCode, RefreshCw, ShieldCheck, Monitor, Smartphone, Trash2, Camera } from 'lucide-react';
import {
  createTCloudPairingCode,
  disconnectTCloudAccount,
  getTCloudAccountStatus,
  pairTCloudAccount,
  registerTCloudAccount,
  getRemoteProfile, listTCloudDevices, revokeTCloudDevice, type TCloudDevice,
  type TCloudAccountStatus,
  type TCloudPairingCode,
} from '../../../services/tcloudAccount';
import { getLocalProfile, saveLocalProfile } from '../../../services/tcloudProfile';

export function TCloudAccountCard() {
  const [status, setStatus] = useState<TCloudAccountStatus | null>(null);
  const [pairing, setPairing] = useState<TCloudPairingCode | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialProfile = getLocalProfile();
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? '');
  const [username, setUsername] = useState(initialProfile?.username ?? '');
  const [avatar, setAvatar] = useState<string>('');
  const [verified, setVerified] = useState(false);
  const [devices, setDevices] = useState<TCloudDevice[]>([]);

  const refresh = async () => setStatus(await getTCloudAccountStatus());
  useEffect(() => { void (async()=>{await refresh(); const [profile,list]=await Promise.all([getRemoteProfile(),listTCloudDevices().catch(()=>[])]); if(profile){setDisplayName(profile.displayName);setUsername(profile.username||'');setAvatar(profile.avatarUrl||'');setVerified(profile.verified);} setDevices(list);})(); }, []);

  const connect = async () => {
    setBusy(true); setError('');
    try { await pairTCloudAccount(code); setCode(''); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };

  const generate = async () => {
    setBusy(true); setError('');
    try { setPairing(await createTCloudPairingCode()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };

  return (
    <section className="tcloud-settings-friendly-note space-y-4">
      <div className="space-y-3 border-b border-app-border pb-4">
        <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-app-border bg-app-surface">{avatar?<img src={avatar} className="h-full w-full object-cover"/>:<span className="text-lg font-bold">{displayName.slice(0,1).toUpperCase()}</span>}</div><div><strong className="flex items-center gap-1">Seu perfil TCloud {verified&&<ShieldCheck className="h-4 w-4 text-app-accent"/>}</strong><span>{verified?'Identidade confirmada pelo Telegram.':'Conecte o Telegram para verificar a identidade.'}</span></div></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none" value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Seu nome" maxLength={60}/>
          <input className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none" value={username} onChange={event=>setUsername(event.target.value)} placeholder="@seu_usuario" maxLength={32}/>
        </div>
        <div className="flex flex-wrap gap-2"><label className="quiet-control px-4"><Camera className="h-4 w-4"/> Alterar foto<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>500000){setError('A foto deve ter até 500 KB.');return;}const reader=new FileReader();reader.onload=()=>setAvatar(String(reader.result||''));reader.readAsDataURL(file);}}/></label><button className="quiet-control is-primary px-4" onClick={()=>void (async()=>{try{const profile=saveLocalProfile(displayName,username);await registerTCloudAccount(profile.displayName,profile.username,avatar||undefined);setDisplayName(profile.displayName);setUsername(profile.username);setError('');}catch(failure){setError(failure instanceof Error?failure.message:String(failure));}})()}>Salvar perfil</button></div>
      </div>
      <div className="flex items-start gap-3">
        {status?.connected ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Link2 className="h-5 w-5 text-app-accent" />}
        <div className="min-w-0 flex-1">
          <strong>{status?.connected ? 'Conta TCloud conectada' : 'Conectar ao seu ecossistema'}</strong>
          <span>{status?.message ?? 'Verificando este computador…'}</span>
        </div>
        {!status && <LoaderCircle className="h-4 w-4 animate-spin" />}
      </div>

      {status && !status.connected && (
        <div className="flex flex-wrap gap-2">
          <input className="min-w-[220px] flex-1 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm uppercase text-app-text outline-none" maxLength={10} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código de 10 caracteres" />
          <button className="quiet-control is-primary px-4" disabled={busy || code.trim().length < 10} onClick={() => void connect()}><Link2 className="h-4 w-4" /> Conectar</button>
        </div>
      )}

      {status?.connected && (
        <div className="flex flex-wrap gap-2">
          <button className="quiet-control px-3 py-2" disabled={busy} onClick={() => void generate()}><QrCode className="h-4 w-4" /> Conectar outro dispositivo</button>
          <button className="quiet-control px-3 py-2" onClick={() => { disconnectTCloudAccount(); setPairing(null); void refresh(); }}><LogOut className="h-4 w-4" /> Desconectar este PC</button>
          <button className="quiet-control px-3 py-2" onClick={() => void refresh()} aria-label="Atualizar estado"><RefreshCw className="h-4 w-4" /></button>
        </div>
      )}

      {pairing && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-app-border bg-white p-4 text-slate-950">
          <QRCodeSVG value={`tcloud://pair?code=${pairing.code}`} size={128} />
          <div><strong className="block text-lg tracking-[0.18em]">{pairing.code}</strong><span className="block text-xs text-slate-600">Válido por alguns minutos</span><button className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" onClick={() => void navigator.clipboard.writeText(pairing.code)}><Copy className="h-4 w-4" /> Copiar código</button></div>
        </div>
      )}
      {status?.connected && <div className="space-y-2 border-t border-app-border pt-4"><div><strong>Dispositivos e acessos</strong><span>Revogue aparelhos que você não reconhece.</span></div>{devices.map(device=><div key={device.id} className="flex items-center gap-3 rounded-lg border border-app-border p-3">{device.platform==='android'?<Smartphone className="h-5 w-5"/>:<Monitor className="h-5 w-5"/>}<div className="min-w-0 flex-1"><strong>{device.name}{device.current?' · Este dispositivo':''}</strong><span>{device.active?'Ativo':'Sessão encerrada'} · {device.lastSeenAt?new Date(device.lastSeenAt).toLocaleString('pt-BR'):'Sem atividade recente'}</span></div>{device.active&&!device.current&&<button className="quiet-control px-3" onClick={()=>void (async()=>{await revokeTCloudDevice(device.id);setDevices(await listTCloudDevices());})()}><Trash2 className="h-4 w-4"/> Revogar</button>}</div>)}</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
