import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTCloudSyncConfig,
  getTCloudWatcherStatus,
} from "../services/tcloudSyncSettings";
import { resetTCloudSetupState } from "../services/tcloudSetup";
import { getTCloudTransferLimits, setTCloudTransferLimits } from "../services/tcloudTransferLimits";
import { getTCloudNetworkSettings, setTCloudNetworkSettings } from "../services/tcloudNetworkSettings";
import {
  cleanupTCloudCache,
  getTCloudCacheStatus,
  setTCloudCacheLimit,
} from "../services/tcloudCacheManager";

const GIB = 1024 * 1024 * 1024;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 GB";
  return `${(value / GIB).toFixed(2)} GB`;
}

export default function TCloudSettingsPage() {
  const [syncFolder, setSyncFolder] = useState("");
  const [watcherRunning, setWatcherRunning] = useState(false);
  const [cacheUsed, setCacheUsed] = useState(0);
  const [cacheLimitGb, setCacheLimitGb] = useState(10);
  const [busy, setBusy] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [economyMode, setEconomyMode] = useState(false);
  const [uploadLimitMbps, setUploadLimitMbps] = useState(0);
  const [downloadLimitMbps, setDownloadLimitMbps] = useState(0);
  const [message, setMessage] = useState("");
  const [recoveredPreviousSession, setRecoveredPreviousSession] = useState(false);
  const [databaseHealthy, setDatabaseHealthy] = useState(true);
  const [lastMaintenanceAt, setLastMaintenanceAt] = useState<number | null>(null);
  const [lastDeepMaintenanceAt, setLastDeepMaintenanceAt] = useState<number | null>(null);
  const [lastResumeAt, setLastResumeAt] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const [sync, watcher, cache, limits, network] = await Promise.all([
        getTCloudSyncConfig(),
        getTCloudWatcherStatus(),
        getTCloudCacheStatus(),
        getTCloudTransferLimits(),
        getTCloudNetworkSettings(),
      ]);

      setSyncFolder(sync.local_root ?? "");
      setRecoveredPreviousSession(sync.recovered_previous_session);
      setDatabaseHealthy(sync.database_healthy);
      setLastMaintenanceAt(sync.last_maintenance_at);
      setLastDeepMaintenanceAt(sync.last_deep_maintenance_at);
      setLastResumeAt(sync.last_resume_at);
      setWatcherRunning(watcher.running);
      setCacheUsed(cache.current_bytes);
      setCacheLimitGb(Math.max(0.5, cache.limit_bytes / GIB));
      setMaxConcurrent(limits.max_concurrent);
      setEconomyMode(network.economy_mode);
      setUploadLimitMbps(network.upload_limit_bps / 1024 / 1024);
      setDownloadLimitMbps(network.download_limit_bps / 1024 / 1024);
    } catch (error) {
      setMessage(`Não foi possível carregar algumas configurações: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const cachePercent = useMemo(() => {
    const limitBytes = cacheLimitGb * GIB;
    if (limitBytes <= 0) return 0;
    return Math.min(100, Math.round((cacheUsed / limitBytes) * 100));
  }, [cacheUsed, cacheLimitGb]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await loadStatus();
    } catch (error) {
      setMessage(`Não foi possível concluir: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tcloud-settings tcloud-settings--embedded">
      <div className="tcloud-settings__header">
        <div>
          <span className="tcloud-settings__eyebrow">SINCRONIZAÇÃO</span>
          <h1>Seus arquivos no computador e na nuvem</h1>
          <p>O TCloud cuida da parte técnica automaticamente. Aqui você controla apenas o que realmente importa.</p>
        </div>
        <div className={`tcloud-status ${watcherRunning ? "is-online" : ""}`}>
          <span className="tcloud-status__dot" />
          {watcherRunning ? "Tudo funcionando" : "Reconectando"}
        </div>
      </div>

      {message && <div className="tcloud-settings__message">{message}</div>}

      <section className="tcloud-card">
        <div className="tcloud-card__title">
          <div>
            <h2>Pasta do TCloud</h2>
            <p>Tudo que você colocar nesta pasta é sincronizado automaticamente.</p>
          </div>
          <span className={`tcloud-badge ${watcherRunning ? "is-success" : ""}`}>{watcherRunning ? "Ativa" : "Aguardando"}</span>
        </div>

        <div className="tcloud-row">
          <input className="tcloud-input" value={syncFolder} readOnly aria-label="Pasta do TCloud" placeholder={"C:\\Users\\SeuUsuario\\TCloud"} />
          <span className="tcloud-badge">Pronta para usar</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Sincronização automática</strong>
            <span>Você pode criar, editar, mover ou excluir arquivos normalmente pelo Explorer. O TCloud cuida do resto.</span>
          </div>
          <span className="tcloud-badge">Sempre ativa</span>
        </div>
      </section>

      <section className="tcloud-card">
        <div className="tcloud-card__title">
          <div>
            <h2>Proteção e recuperação</h2>
            <p>O TCloud verifica e recupera automaticamente os dados locais depois de reinícios, atualizações ou encerramentos inesperados.</p>
          </div>
          <span className={`tcloud-badge ${databaseHealthy ? "is-success" : ""}`}>{databaseHealthy ? "Tudo certo" : "Precisa de atenção"}</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Banco local</strong>
            <span>{databaseHealthy ? "Verificado e pronto para uso." : "A verificação encontrou algo que precisa ser analisado."}</span>
          </div>
          <span className={`tcloud-badge ${databaseHealthy ? "is-success" : ""}`}>{databaseHealthy ? "Saudável" : "Atenção"}</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Recuperação após interrupção</strong>
            <span>{recoveredPreviousSession ? "A última sessão foi recuperada automaticamente." : "Pronta para retomar a sincronização depois de uma interrupção."}</span>
          </div>
          <span className="tcloud-badge is-success">{recoveredPreviousSession ? "Recuperada" : "Ativa"}</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Manutenção automática</strong>
            <span>{lastMaintenanceAt ? `Última manutenção: ${new Date(lastMaintenanceAt * 1000).toLocaleString()}` : "O TCloud fará a manutenção quando ficar ocioso."}</span>
          </div>
          <span className="tcloud-badge">Automática</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Uso prolongado</strong>
            <span>{lastDeepMaintenanceAt ? `Limpeza profunda concluída em ${new Date(lastDeepMaintenanceAt * 1000).toLocaleString()}.` : "O histórico e o banco são compactados automaticamente durante períodos ociosos."}</span>
          </div>
          <span className="tcloud-badge is-success">Otimizado</span>
        </div>

        <div className="tcloud-switch-row">
          <div>
            <strong>Suspensão e hibernação</strong>
            <span>{lastResumeAt ? `O TCloud se recuperou automaticamente de uma suspensão em ${new Date(lastResumeAt * 1000).toLocaleString()}.` : "Ao voltar do modo de suspensão, a rede e a sincronização são retomadas automaticamente."}</span>
          </div>
          <span className="tcloud-badge is-success">Protegida</span>
        </div>
      </section>

      <section className="tcloud-card">
        <div className="tcloud-card__title">
          <div>
            <h2>Espaço usado neste computador</h2>
            <p>O TCloud guarda alguns arquivos localmente para abrir mais rápido e funcionar offline.</p>
          </div>
          <span className="tcloud-badge">{cachePercent}% do limite</span>
        </div>

        <div className="tcloud-cache-bar"><div style={{ width: `${cachePercent}%` }} /></div>
        <div className="tcloud-cache-summary"><span>{formatBytes(cacheUsed)} usados</span><span>Limite de {cacheLimitGb.toFixed(1)} GB</span></div>

        <div className="tcloud-row">
          <label className="tcloud-field">
            <span>Quanto o TCloud pode usar neste computador</span>
            <select className="tcloud-input" value={cacheLimitGb} onChange={(event) => setCacheLimitGb(Number(event.target.value))}>
              {[2,5,10,20,50,100,200].map((value) => <option key={value} value={value}>{value} GB</option>)}
            </select>
          </label>
          <button className="tcloud-button" disabled={busy || cacheLimitGb < 0.5} onClick={() => run(() => setTCloudCacheLimit(Math.round(cacheLimitGb * GIB)), "Limite de espaço atualizado.")}>Salvar</button>
          <button className="tcloud-button" disabled={busy} onClick={() => run(() => cleanupTCloudCache(), "Espaço extra liberado.")}>Liberar espaço extra</button>
        </div>
      </section>

      <details className="tcloud-settings-advanced-details">
        <summary>Ajustes de velocidade e internet</summary>
        <p>Essas opções normalmente podem ficar no automático.</p>

        <section className="tcloud-card">
          <label className="tcloud-switch-row">
            <div>
              <strong>Usar menos internet</strong>
              <span>Útil em redes lentas ou quando você não quer que a sincronização use toda a conexão.</span>
            </div>
            <input type="checkbox" checked={economyMode} disabled={busy} onChange={(event) => setEconomyMode(event.target.checked)} />
          </label>

          <div className="tcloud-row">
            <label className="tcloud-field">
              <span>Velocidade máxima de envio</span>
              <select className="tcloud-input" value={uploadLimitMbps} onChange={(event) => setUploadLimitMbps(Number(event.target.value))}>
                {[0,1,5,10,25,50].map((value) => <option key={value} value={value}>{value === 0 ? 'Sem limite' : `${value} MB/s`}</option>)}
              </select>
            </label>
            <label className="tcloud-field">
              <span>Velocidade máxima de download</span>
              <select className="tcloud-input" value={downloadLimitMbps} onChange={(event) => setDownloadLimitMbps(Number(event.target.value))}>
                {[0,1,5,10,25,50].map((value) => <option key={value} value={value}>{value === 0 ? 'Sem limite' : `${value} MB/s`}</option>)}
              </select>
            </label>
            <button className="tcloud-button" disabled={busy} onClick={() => run(() => setTCloudNetworkSettings(economyMode, Math.max(0, Math.round(uploadLimitMbps * 1024 * 1024)), Math.max(0, Math.round(downloadLimitMbps * 1024 * 1024))), "Configurações de internet atualizadas.")}>Salvar</button>
          </div>

          <div className="tcloud-row">
            <label className="tcloud-field">
              <span>Arquivos transferidos ao mesmo tempo</span>
              <select className="tcloud-input" value={maxConcurrent} onChange={(event) => setMaxConcurrent(Number(event.target.value))}>
                {[1,2,4,6,8].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button className="tcloud-button" disabled={busy} onClick={() => run(() => setTCloudTransferLimits(maxConcurrent), "Quantidade de transferências atualizada.")}>Salvar</button>
          </div>
        </section>
      </details>

      <details className="tcloud-settings-advanced-details">
        <summary>Reiniciar configuração inicial</summary>
        <p>Use apenas se quiser executar novamente o assistente de preparação do TCloud.</p>
        <button className="tcloud-button" disabled={busy} onClick={() => run(async () => { await resetTCloudSetupState(); }, "Assistente redefinido. Reabra o TCloud para executá-lo novamente.")}>Redefinir assistente</button>
      </details>
    </div>
  );
}
