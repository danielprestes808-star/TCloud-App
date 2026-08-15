import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FolderPlus,
  HardDrive,
  Image,
  MonitorUp,
  Music,
  Send,
  ShieldCheck,
  Video,
  X,
} from 'lucide-react';
import { createTCloudDefaultFolders } from '../services/tcloudSetup';
import { createTCloudForum } from '../services/tcloudForums';
import { connectThisComputer, getCfapiStatus, type CfapiStatus } from '../services/tcloudCompletion';

interface TCloudSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

const defaultItems = [
  { name: 'Documentos', icon: FolderPlus, selected: true },
  { name: 'Fotos', icon: Image, selected: true },
  { name: 'Vídeos', icon: Video, selected: true },
  { name: 'Música', icon: Music, selected: true },
  { name: 'Backup', icon: HardDrive, selected: true },
];

const steps = ['Conta', 'Pastas', 'Windows', 'Pronto'];

export default function TCloudSetupWizard({
  isOpen,
  onClose,
  onCompleted,
}: TCloudSetupWizardProps) {
  const [step, setStep] = useState(0);
  const [items, setItems] = useState(defaultItems);
  const [connectWindows, setConnectWindows] = useState(true);
  const [cfapi, setCfapi] = useState<CfapiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(() => items.filter((item) => item.selected), [items]);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setMessage('');
    void getCfapiStatus().then((status) => {
      setCfapi(status);
      if (status.provider_connected) setConnectWindows(true);
    }).catch(() => setCfapi(null));
  }, [isOpen]);

  if (!isOpen) return null;

  async function finish() {
    setBusy(true);
    setMessage('');
    try {
      await createTCloudDefaultFolders({ folders: [] });

      for (const item of selected) {
        try {
          await createTCloudForum(item.name, false);
        } catch (error) {
          console.warn('TCloud folder creation failed', error);
        }
      }

      if (connectWindows && cfapi?.platform_supported !== false && !cfapi?.provider_connected) {
        try {
          setMessage('Conectando o TCloud ao Windows…');
          const next = await connectThisComputer();
          setCfapi(next);
        } catch (error) {
          console.warn('Windows integration setup failed', error);
          setMessage('Seus arquivos foram configurados. A integração com o Windows pode ser ativada depois em Configurações.');
        }
      }

      onCompleted();
      onClose();
    } catch (error) {
      setMessage(`Não foi possível concluir a configuração: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const canContinue = step !== 1 || selected.length > 0;

  return (
    <div className="tcloud-onboarding-backdrop fixed inset-0 z-[120] flex items-center justify-center p-5">
      <div className="tcloud-onboarding-card w-full max-w-3xl overflow-hidden">
        <header className="tcloud-onboarding-header">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" className="h-10 w-10" alt="TCloud" />
            <div>
              <h2>Bem-vindo ao TCloud</h2>
              <p>Deixe sua nuvem pronta em poucos passos.</p>
            </div>
          </div>
          <button className="tcloud-onboarding-close" onClick={onClose} disabled={busy} title="Configurar depois">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="tcloud-onboarding-steps" aria-label="Etapas da configuração">
          {steps.map((label, index) => (
            <div key={label} className={`${index === step ? 'is-active' : ''} ${index < step ? 'is-done' : ''}`}>
              <span>{index < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>

        <main className="tcloud-onboarding-body">
          {step === 0 && (
            <section className="tcloud-onboarding-intro">
              <div className="tcloud-onboarding-feature-icon"><Send className="h-7 w-7" /></div>
              <h3>Sua conta já está conectada</h3>
              <p>O TCloud usa o Telegram como armazenamento, mas você não precisa lidar com chats, tópicos ou termos técnicos. Na interface, tudo aparece como arquivos e pastas.</p>
              <div className="tcloud-onboarding-points">
                <span><Cloud className="h-4 w-4" /> Arquivos na nuvem</span>
                <span><ShieldCheck className="h-4 w-4" /> Sessão mantida com segurança</span>
                <span><MonitorUp className="h-4 w-4" /> Integração com o Windows</span>
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              <div className="tcloud-onboarding-title">
                <h3>Escolha suas pastas iniciais</h3>
                <p>Você poderá criar, renomear ou mover pastas depois normalmente.</p>
              </div>
              <div className="tcloud-onboarding-folder-grid">
                {items.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <label key={item.name} className={item.selected ? 'is-selected' : ''}>
                      <div>
                        <Icon className="h-5 w-5" />
                        <input
                          type="checkbox"
                          checked={item.selected}
                          disabled={busy}
                          onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, selected: event.target.checked } : entry))}
                        />
                      </div>
                      <strong>{item.name}</strong>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <div className="tcloud-onboarding-title">
                <h3>Usar o TCloud no Explorador do Windows</h3>
                <p>Se ativado, seus arquivos aparecem como uma pasta normal do Windows e são baixados quando você precisar.</p>
              </div>
              {cfapi?.platform_supported === false ? (
                <div className="tcloud-onboarding-windows-card is-disabled">
                  <MonitorUp className="h-6 w-6" />
                  <div><strong>Integração indisponível neste sistema</strong><span>Você ainda pode usar todos os arquivos pelo aplicativo TCloud.</span></div>
                </div>
              ) : (
                <label className={`tcloud-onboarding-windows-card ${connectWindows ? 'is-selected' : ''}`}>
                  <MonitorUp className="h-6 w-6" />
                  <div>
                    <strong>{cfapi?.provider_connected ? 'TCloud já está conectado ao Windows' : 'Ativar integração com o Windows'}</strong>
                    <span>Recomendado. Mantém os arquivos visíveis no Explorer sem ocupar espaço até serem abertos.</span>
                  </div>
                  <input type="checkbox" checked={connectWindows} disabled={busy || Boolean(cfapi?.provider_connected)} onChange={(event) => setConnectWindows(event.target.checked)} />
                </label>
              )}
              <div className="tcloud-onboarding-tip"><Cloud className="h-4 w-4" /><span>Arquivos somente na nuvem continuam aparecendo no Explorer. Você escolhe quais devem ficar sempre disponíveis.</span></div>
            </section>
          )}

          {step === 3 && (
            <section className="tcloud-onboarding-intro">
              <div className="tcloud-onboarding-feature-icon is-success"><CheckCircle2 className="h-7 w-7" /></div>
              <h3>Pronto para começar</h3>
              <p>O TCloud vai criar {selected.length} {selected.length === 1 ? 'pasta inicial' : 'pastas iniciais'}{connectWindows ? ' e preparar a integração com o Windows' : ''}.</p>
              <div className="tcloud-onboarding-summary">
                <div><FolderPlus className="h-4 w-4" /><span><strong>{selected.length} pastas</strong><small>{selected.map((item) => item.name).join(', ')}</small></span></div>
                <div><MonitorUp className="h-4 w-4" /><span><strong>Windows</strong><small>{connectWindows ? 'Integração ativada' : 'Pode ser ativada depois'}</small></span></div>
              </div>
            </section>
          )}

          {message && <div className="tcloud-onboarding-message">{message}</div>}
        </main>

        <footer className="tcloud-onboarding-footer">
          <div>
            {step > 0 && <button type="button" className="is-secondary" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={busy}><ChevronLeft className="h-4 w-4" />Voltar</button>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="is-quiet" onClick={onClose} disabled={busy}>Configurar depois</button>
            {step < 3 ? (
              <button type="button" className="is-primary" onClick={() => setStep((value) => Math.min(3, value + 1))} disabled={busy || !canContinue}>Continuar<ChevronRight className="h-4 w-4" /></button>
            ) : (
              <button type="button" className="is-primary" onClick={() => void finish()} disabled={busy}>{busy ? 'Preparando…' : 'Concluir configuração'}<CheckCircle2 className="h-4 w-4" /></button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
