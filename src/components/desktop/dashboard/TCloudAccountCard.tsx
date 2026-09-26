import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircle2,
  Copy,
  Link2,
  LoaderCircle,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Monitor,
  Smartphone,
  Trash2,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createTCloudPairingCode,
  disconnectTCloudAccount,
  getTCloudAccountStatus,
  pairTCloudAccount,
  registerTCloudAccount,
  getRemoteProfile,
  listTCloudDevices,
  revokeTCloudDevice,
  type TCloudDevice,
  type TCloudAccountStatus,
  type TCloudPairingCode,
} from '../../../services/tcloudAccount';
import { getLocalProfile, saveLocalProfile } from '../../../services/tcloudProfile';

export function TCloudAccountCard() {
  const [status, setStatus] = useState<TCloudAccountStatus | null>(null);
  const [pairing, setPairing] = useState<TCloudPairingCode | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const initialProfile = getLocalProfile();
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? '');
  const [username, setUsername] = useState(initialProfile?.username ?? '');
  const [avatar, setAvatar] = useState<string>('');
  const [verified, setVerified] = useState(false);
  const [devices, setDevices] = useState<TCloudDevice[]>([]);

  const refresh = async () => {
    try {
      const currentStatus = await getTCloudAccountStatus();
      setStatus(currentStatus);
    } catch {
      setStatus({ connected: false, deviceId: null, message: 'Não foi possível verificar a conta.' });
    }
  };

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      await refresh();
      try {
        const [profile, list] = await Promise.all([
          getRemoteProfile(),
          listTCloudDevices().catch(() => []),
        ]);
        if (!active) return;
        if (profile) {
          setDisplayName(profile.displayName);
          setUsername(profile.username || '');
          setAvatar(profile.avatarUrl || '');
          setVerified(profile.verified);
        }
        setDevices(list);
      } catch {
        // Ignora erros não críticos de carregamento inicial
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await pairTCloudAccount(code);
      setCode('');
      await refresh();
      toast.success('Dispositivo conectado com sucesso!');
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setPairing(await createTCloudPairingCode());
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setError('');
    try {
      const profile = saveLocalProfile(displayName, username);
      await registerTCloudAccount(profile.displayName, profile.username, avatar || undefined);
      setDisplayName(profile.displayName);
      setUsername(profile.username);
      toast.success('Perfil atualizado com sucesso!');
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setRevokingId(deviceId);
    setError('');
    try {
      await revokeTCloudDevice(deviceId);
      setDevices(await listTCloudDevices());
      setConfirmRevokeId(null);
      toast.success('Dispositivo revogado com sucesso!');
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      setError(msg);
      toast.error(msg);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyCode = async (codeToCopy: string) => {
    await navigator.clipboard.writeText(codeToCopy);
    toast.success('Código copiado para a área de transferência!');
  };

  return (
    <section className="tcloud-settings-friendly-note space-y-4">
      {/* Seção de Perfil */}
      <div className="space-y-3 border-b border-app-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-app-border bg-app-surface">
            {avatar ? (
              <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg font-bold">{displayName.slice(0, 1).toUpperCase() || 'U'}</span>
            )}
          </div>
          <div>
            <strong className="flex items-center gap-1">
              Seu perfil TCloud {verified && <ShieldCheck className="h-4 w-4 text-app-accent" />}
            </strong>
            <span className="text-xs text-app-muted">
              {verified ? 'Identidade confirmada pelo Telegram.' : 'Conecte o Telegram para verificar a identidade.'}
            </span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus:border-app-accent"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Seu nome"
            maxLength={60}
          />
          <input
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text outline-none focus:border-app-accent"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="@seu_usuario"
            maxLength={32}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="quiet-control px-4 cursor-pointer inline-flex items-center gap-2">
            <Camera className="h-4 w-4" /> Alterar foto
            <input
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 500000) {
                  setError('A foto deve ter até 500 KB.');
                  toast.error('A foto deve ter até 500 KB.');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setAvatar(String(reader.result || ''));
                reader.readAsDataURL(file);
              }}
            />
          </label>

          <button
            className="quiet-control is-primary px-4 inline-flex items-center gap-2"
            disabled={savingProfile}
            onClick={() => void handleSaveProfile()}
          >
            {savingProfile && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Salvar perfil
          </button>
        </div>
      </div>

      {/* Seção de Status e Conexão */}
      <div className="flex items-start gap-3">
        {status?.connected ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <Link2 className="h-5 w-5 text-app-accent shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <strong>{status?.connected ? 'Conta TCloud conectada' : 'Conectar ao seu ecossistema'}</strong>
          <span className="block text-xs text-app-muted">
            {status?.message ?? 'Verificando este computador…'}
          </span>
        </div>
        {!status && <LoaderCircle className="h-4 w-4 animate-spin shrink-0" />}
      </div>

      {status && !status.connected && (
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[220px] flex-1 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm uppercase text-app-text outline-none focus:border-app-accent"
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Código de 10 caracteres"
          />
          <button
            className="quiet-control is-primary px-4 inline-flex items-center gap-2"
            disabled={busy || code.trim().length < 10}
            onClick={() => void connect()}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Conectar
          </button>
        </div>
      )}

      {status?.connected && (
        <div className="flex flex-wrap gap-2">
          <button
            className="quiet-control px-3 py-2 inline-flex items-center gap-2"
            disabled={busy}
            onClick={() => void generate()}
          >
            <QrCode className="h-4 w-4" /> Conectar outro dispositivo
          </button>
          <button
            className="quiet-control px-3 py-2 inline-flex items-center gap-2"
            onClick={() => {
              disconnectTCloudAccount();
              setPairing(null);
              void refresh();
              toast.success('Computador desconectado da conta');
            }}
          >
            <LogOut className="h-4 w-4" /> Desconectar este PC
          </button>
          <button
            className="quiet-control px-3 py-2"
            onClick={() => void refresh()}
            aria-label="Atualizar estado"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* QR Code de Pareamento */}
      {pairing && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-app-border bg-white p-4 text-slate-950">
          <QRCodeSVG value={`tcloud://pair?code=${pairing.code}`} size={128} />
          <div>
            <strong className="block text-lg tracking-[0.18em]">{pairing.code}</strong>
            <span className="block text-xs text-slate-600">Válido por alguns minutos</span>
            <button
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:text-sky-700"
              onClick={() => void handleCopyCode(pairing.code)}
            >
              <Copy className="h-4 w-4" /> Copiar código
            </button>
          </div>
        </div>
      )}

      {/* Lista de Dispositivos Conectados */}
      {status?.connected && (
        <div className="space-y-2 border-t border-app-border pt-4">
          <div>
            <strong className="block text-sm">Dispositivos e acessos</strong>
            <span className="block text-xs text-app-muted">Revogue aparelhos que você não reconhece.</span>
          </div>

          <div className="space-y-2">
            {devices.map((device) => {
              const isDesktop = device.platform?.toLowerCase() === 'windows';
              const isRevoking = revokingId === device.id;
              const isAwaitingConfirmation = confirmRevokeId === device.id;

              return (
                <div
                  key={device.id}
                  className="flex items-center gap-3 rounded-lg border border-app-border bg-app-surface/50 p-3"
                >
                  <div className="text-app-muted shrink-0">
                    {isDesktop ? <Monitor className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <strong className="block text-sm text-app-text truncate">
                      {device.name}
                      {device.current ? ' · Este dispositivo' : ''}
                    </strong>
                    <span className="block text-xs text-app-muted">
                      {device.active ? 'Ativo' : 'Sessão encerrada'} ·{' '}
                      {device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString('pt-BR')
                        : 'Sem atividade recente'}
                    </span>
                  </div>

                  {device.active && !device.current && (
                    <div>
                      {isAwaitingConfirmation ? (
                        <div className="flex items-center gap-1">
                          <button
                            className="quiet-control px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 border-red-500/30"
                            disabled={isRevoking}
                            onClick={() => void handleRevokeDevice(device.id)}
                          >
                            {isRevoking ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            Confirmar
                          </button>
                          <button
                            className="quiet-control px-2 py-1 text-xs"
                            onClick={() => setConfirmRevokeId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          className="quiet-control px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                          disabled={isRevoking}
                          onClick={() => setConfirmRevokeId(device.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Revogar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
