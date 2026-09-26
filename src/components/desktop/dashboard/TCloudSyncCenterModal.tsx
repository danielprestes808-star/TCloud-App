import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  FolderInput,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  cancelTCloudSyncJob,
  clearCompletedTCloudJobs,
  getTCloudSyncCenter,
  pauseTCloudSyncJob,
  resumeTCloudSyncJob,
  retryTCloudSyncJob,
  type TCloudSyncActivity,
  type TCloudSyncCenterStats,
} from "../../../services/tcloudSyncCenter";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type SyncFilter = "active" | "attention" | "completed" | "all";

function operationInfo(operation: string) {
  const normalized = operation.toLowerCase();
  if (normalized.includes("download")) return { icon: Download, label: "Baixando" };
  if (normalized.includes("delete") || normalized.includes("trash")) return { icon: Trash2, label: "Excluindo" };
  if (normalized.includes("move")) return { icon: FolderInput, label: "Movendo" };
  if (normalized.includes("rename")) return { icon: Pencil, label: "Renomeando" };
  return { icon: Upload, label: "Enviando" };
}

function statusLabel(status: string) {
  switch (status) {
    case "pending": return "Aguardando";
    case "running": return "Sincronizando";
    case "completed": return "Concluído";
    case "failed": return "Precisa de atenção";
    case "paused": return "Pausado";
    case "cancelled": return "Cancelado";
    default: return status;
  }
}

function dateLabel(value: number) {
  if (!value) return "";
  const date = new Date(value * 1000);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSpeed(value: number) {
  return value > 0 ? `${formatBytes(value)}/s` : "";
}

function formatEta(value: number | null) {
  if (value == null || value < 0) return "";
  if (value < 60) return `${value}s restantes`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min restantes`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min restantes`;
}

function progressPercent(job: TCloudSyncActivity) {
  if (job.bytes_total <= 0) return job.status === "completed" ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((job.bytes_transferred / job.bytes_total) * 100)));
}

function sameSyncSnapshot(a: TCloudSyncCenterStats | null, b: TCloudSyncCenterStats) {
  if (!a) return false;
  if (a.pending !== b.pending || a.running !== b.running || a.failed !== b.failed
      || a.completed !== b.completed || a.uploads !== b.uploads
      || a.downloads !== b.downloads || a.deletes !== b.deletes
      || a.recent.length !== b.recent.length) return false;
  return a.recent.every((left, index) => {
    const right = b.recent[index];
    return !!right && left.id === right.id && left.status === right.status
      && left.updated_at === right.updated_at
      && left.bytes_transferred === right.bytes_transferred
      && left.speed_bps === right.speed_bps
      && left.eta_seconds === right.eta_seconds
      && left.paused === right.paused
      && left.cancel_requested === right.cancel_requested
      && left.priority === right.priority
      && left.error === right.error;
  });
}

function isTerminalRemoteMissing(job: TCloudSyncActivity) {
  const error = (job.error || '').toLocaleLowerCase('pt-BR');
  return error.startsWith('arquivo remoto nao encontrado.')
    || error.startsWith('arquivo remoto não encontrado.')
    || error.includes('origem remota nao encontrada com seguranca')
    || error.includes('origem remota não encontrada com segurança');
}

export function TCloudSyncCenterModal({ isOpen, onClose }: Props) {
  const [data, setData] = useState<TCloudSyncCenterStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [filter, setFilter] = useState<SyncFilter>("active");

  const refresh = useCallback(async (silent = false) => {
    if (!isOpen) return null;
    if (!silent) setLoading(true);
    try {
      const next = await getTCloudSyncCenter();
      setData((current) => sameSyncSnapshot(current, next) ? current : next);
      return next;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    let timer: number | null = null;
    let first = true;
    const poll = async () => {
      const snapshot = await refresh(!first).catch(() => null);
      first = false;
      if (disposed) return;
      // Keep active transfers visually live, but back off hard when the center is
      // quiet or the whole app is hidden. This removes needless IPC/SQLite work
      // during long tray sessions without making progress feel sluggish.
      const delay = document.visibilityState === "hidden"
        ? 12_000
        : (snapshot?.running ?? 0) > 0
          ? 900
          : (snapshot?.pending ?? 0) > 0
            ? 2_200
            : (snapshot?.failed ?? 0) > 0
              ? 5_000
              : 8_000;
      timer = window.setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isOpen, refresh]);

  // Backend `pending` already includes paused jobs, so do not count them twice.
  const activeCount = (data?.pending ?? 0) + (data?.running ?? 0);

  const items = useMemo(() => {
    const all = data?.recent ?? [];
    if (filter === "active") return all.filter((item) => ["pending", "running", "paused"].includes(item.status));
    if (filter === "attention") return all.filter((item) => item.status === "failed");
    if (filter === "completed") return all.filter((item) => ["completed", "cancelled"].includes(item.status));
    return all;
  }, [data, filter]);

  const state = useMemo(() => {
    if ((data?.failed ?? 0) > 0) {
      return {
        tone: "danger",
        icon: AlertTriangle,
        title: `${data?.failed ?? 0} ${(data?.failed ?? 0) === 1 ? "item precisa" : "itens precisam"} de atenção`,
        detail: "O TCloud isolou estes itens para não bloquear o restante da sincronização.",
      };
    }
    if (activeCount > 0) {
      return {
        tone: "busy",
        icon: RefreshCw,
        title: "Sincronizando seus arquivos",
        detail: `${activeCount} ${activeCount === 1 ? "item está" : "itens estão"} sendo atualizado${activeCount === 1 ? "" : "s"}. Você pode continuar usando o computador normalmente.`,
      };
    }
    return {
      tone: "ok",
      icon: CheckCircle2,
      title: "Tudo atualizado",
      detail: "Não há nada que precise da sua atenção agora.",
    };
  }, [activeCount, data?.failed]);

  if (!isOpen) return null;

  async function retry(job: TCloudSyncActivity) {
    await retryTCloudSyncJob(job.id);
    await refresh();
  }

  async function retryAllFailed() {
    const failed = (data?.recent ?? []).filter((job) => job.status === "failed" && !isTerminalRemoteMissing(job));
    if (failed.length === 0) return;
    setRetryingAll(true);
    try {
      await Promise.allSettled(failed.map((job) => retryTCloudSyncJob(job.id)));
      setFilter("active");
      await refresh();
    } finally {
      setRetryingAll(false);
    }
  }

  async function pause(job: TCloudSyncActivity) {
    await pauseTCloudSyncJob(job.id);
    await refresh();
  }

  async function resume(job: TCloudSyncActivity) {
    await resumeTCloudSyncJob(job.id);
    await refresh();
  }

  async function cancel(job: TCloudSyncActivity) {
    await cancelTCloudSyncJob(job.id);
    await refresh();
  }

  async function clearCompleted() {
    await clearCompletedTCloudJobs();
    await refresh();
  }

  const retryableFailedCount = (data?.recent ?? []).filter((job) => job.status === 'failed' && !isTerminalRemoteMissing(job)).length;
  const StateIcon = state.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm">
      <div className="tcloud-sync-window">
        <header className="tcloud-sync-window-header">
          <div>
            <h2>Sincronização</h2>
            <p>Veja apenas o que está acontecendo e o que precisa de você.</p>
          </div>
          <div className="tcloud-sync-window-header-actions">
            <button type="button" onClick={() => void refresh()} title="Atualizar">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" onClick={onClose} title="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="tcloud-sync-window-body">
          <section className={`tcloud-sync-overview is-${state.tone}`}>
            <div className="tcloud-sync-overview-icon">
              <StateIcon className={`h-5 w-5 ${state.tone === "busy" ? "animate-spin" : ""}`} />
            </div>
            <div className="min-w-0 flex-1">
              <strong>{state.title}</strong>
              <span>{state.detail}</span>
            </div>
            {retryableFailedCount > 0 && (
              <button type="button" className="tcloud-sync-primary-action" disabled={retryingAll} onClick={() => void retryAllFailed()}>
                <RotateCcw className={`h-3.5 w-3.5 ${retryingAll ? "animate-spin" : ""}`} />
                Tentar novamente
              </button>
            )}
          </section>

          <div className="tcloud-sync-summary-grid">
            <button type="button" className={filter === "active" ? "is-active" : ""} onClick={() => setFilter("active")}>
              <RefreshCw className="h-4 w-4" />
              <span><strong>{activeCount}</strong><small>Em andamento</small></span>
            </button>
            <button type="button" className={`${filter === "attention" ? "is-active" : ""} ${(data?.failed ?? 0) > 0 ? "is-danger" : ""}`} onClick={() => setFilter("attention")}>
              <AlertTriangle className="h-4 w-4" />
              <span><strong>{data?.failed ?? 0}</strong><small>Precisam de atenção</small></span>
            </button>
            <button type="button" className={filter === "completed" ? "is-active" : ""} onClick={() => setFilter("completed")}>
              <CheckCircle2 className="h-4 w-4" />
              <span><strong>{data?.completed ?? 0}</strong><small>Concluídos</small></span>
            </button>
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              <Clock3 className="h-4 w-4" />
              <span><strong>{data?.recent?.length ?? 0}</strong><small>Atividade recente</small></span>
            </button>
          </div>

          <div className="tcloud-sync-list-heading">
            <div>
              <h3>{filter === "active" ? "Agora" : filter === "attention" ? "Precisa de atenção" : filter === "completed" ? "Finalizados" : "Atividade recente"}</h3>
              <p>{filter === "attention" ? "Só mostramos aqui o que o TCloud não conseguiu resolver automaticamente." : "As ações mais recentes aparecem abaixo."}</p>
            </div>
            {filter === "completed" && (data?.completed ?? 0) > 0 && (
              <button type="button" onClick={() => void clearCompleted()}>Limpar histórico</button>
            )}
          </div>

          <div className="tcloud-sync-list">
            {items.length === 0 ? (
              <div className="tcloud-sync-empty">
                {filter === "attention" ? <CheckCircle2 className="h-6 w-6" /> : <Clock3 className="h-6 w-6" />}
                <strong>{filter === "attention" ? "Nenhum problema" : "Nada para mostrar"}</strong>
                <span>{filter === "attention" ? "O TCloud está cuidando de tudo automaticamente." : "Quando houver atividade, ela aparecerá aqui."}</span>
              </div>
            ) : items.map((job) => {
              const operation = operationInfo(job.operation);
              const Icon = operation.icon;
              const failed = job.status === "failed";
              const running = job.status === "running";
              const paused = job.status === "paused";
              const progress = progressPercent(job);

              return (
                <article key={job.id} className={`tcloud-sync-item ${failed ? "is-danger" : ""}`}>
                  <div className="tcloud-sync-item-icon"><Icon className="h-4 w-4" /></div>
                  <div className="tcloud-sync-item-main">
                    <div className="tcloud-sync-item-title-row">
                      <div className="min-w-0">
                        <strong title={job.file_name}>{job.file_name}</strong>
                        <span>{operation.label} · {job.cancel_requested ? "Cancelando…" : statusLabel(job.status)}</span>
                      </div>
                      <time>{dateLabel(job.updated_at)}</time>
                    </div>

                    {["pending", "running", "paused", "completed"].includes(job.status) && job.bytes_total > 0 && (
                      <div className="tcloud-sync-progress">
                        <div className="tcloud-sync-progress-track"><span style={{ width: `${progress}%` }} /></div>
                        <div className="tcloud-sync-progress-meta">
                          <span>{formatBytes(job.bytes_transferred)} de {formatBytes(job.bytes_total)}</span>
                          {running && <span>{job.cancel_requested ? "Parando com segurança…" : [formatSpeed(job.speed_bps), formatEta(job.eta_seconds)].filter(Boolean).join(" · ")}</span>}
                        </div>
                      </div>
                    )}

                    {paused && ["upload", "refresh"].includes(job.operation.toLowerCase()) && job.bytes_transferred > 0 && (
                      <small className="tcloud-sync-resume-note">Ao continuar, o envio recomeça do início por segurança. Downloads retomam do ponto já baixado.</small>
                    )}

                    {failed && job.error && (
                      <details className="tcloud-sync-error-details">
                        <summary>Ver detalhes</summary>
                        <p>{job.error}</p>
                      </details>
                    )}
                  </div>

                  <div className="tcloud-sync-item-actions">
                    {running && !job.cancel_requested && <button type="button" onClick={() => void pause(job)}><Pause className="h-3.5 w-3.5" /> Pausar</button>}
                    {paused && <button type="button" onClick={() => void resume(job)}><Play className="h-3.5 w-3.5" /> Continuar</button>}
                    {failed && !isTerminalRemoteMissing(job) && <button type="button" className="is-primary" onClick={() => void retry(job)}><RotateCcw className="h-3.5 w-3.5" /> Tentar novamente</button>}
                    {failed && isTerminalRemoteMissing(job) && <span className="tcloud-terminal-attention">Não encontrado na nuvem</span>}
                    {!["completed", "cancelled", "failed"].includes(job.status) && !job.cancel_requested && (
                      <button type="button" className="is-icon" title="Cancelar" onClick={() => void cancel(job)}><Square className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
