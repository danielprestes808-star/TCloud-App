import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, Link2, LoaderCircle, LogOut, QrCode, RefreshCw } from 'lucide-react';
import {
  createTCloudPairingCode,
  disconnectTCloudAccount,
  getTCloudAccountStatus,
  pairTCloudAccount,
  registerTCloudAccount,
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

  const refresh = async () => setStatus(await getTCloudAccountStatus());
  useEffect(() => { void refresh(); }, []);

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
        <div><strong>Seu perfil TCloud</strong><span>Usado para identificar sua conta e seus compartilhamentos.</span></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none" value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Seu nome" maxLength={60}/>
          <input className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none" value={username} onChange={event=>setUsername(event.target.value)} placeholder="@seu_usuario" maxLength={32}/>
        </div>
        <button className="quiet-control is-primary px-4" onClick={()=>void (async()=>{try{const profile=saveLocalProfile(displayName,username);await registerTCloudAccount(profile.displayName,profile.username);setDisplayName(profile.displayName);setUsername(profile.username);setError('');}catch(failure){setError(failure instanceof Error?failure.message:String(failure));}})()}>Salvar perfil</button>
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
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
