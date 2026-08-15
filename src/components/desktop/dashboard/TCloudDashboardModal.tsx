import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud,
  Folder,
  Files,
  HardDrive,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  X,
  Database,
  Monitor,
  Settings,
  Eye,
} from "lucide-react";
import { getTCloudDashboardStats, type TCloudDashboardStats } from "../../../services/tcloudDashboard";
import { getTCloudCacheStatus, type TCloudCacheStatus } from "../../../services/tcloudCacheManager";
import { getTCloudWatcherStatus, type TCloudWatcherStatus } from "../../../services/tcloudSyncSettings";
import { getCfapiStatus, type CfapiStatus } from "../../../services/tcloudCompletion";
import { formatBytes } from "../../../utils";
import type { TCloudRecentFile } from "../../../services/tcloudDashboard";

const TCloudFilePreviewModal = lazy(() => import("./TCloudFilePreviewModal").then((m) => ({ default: m.TCloudFilePreviewModal })));

function syncStatusLabel(value: string) {
  switch (value) {
    case 'synced':
    case 'completed': return 'Atualizado';
    case 'pending': return 'Aguardando';
    case 'running': return 'Sincronizando';
    case 'failed': return 'Com problema';
    case 'paused': return 'Pausado';
    default: return value || 'Atualizado';
  }
}

interface TCloudDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function TCloudDashboardModal({
  isOpen,
  onClose,
  onOpenSettings,
}: TCloudDashboardModalProps) {
  const [stats, setStats] = useState<TCloudDashboardStats | null>(null);
  const [cache, setCache] = useState<TCloudCacheStatus | null>(null);
  const [watcher, setWatcher] = useState<TCloudWatcherStatus | null>(null);
  const [cfapi, setCfapi] = useState<CfapiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<TCloudRecentFile | null>(null);

  const refresh = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const [nextStats, nextCache, nextWatcher, nextCfapi] = await Promise.all([
        getTCloudDashboardStats(),
        getTCloudCacheStatus(),
        getTCloudWatcherStatus(),
        getCfapiStatus(),
      ]);
      setStats(nextStats);
      setCache(nextCache);
      setWatcher(nextWatcher);
      setCfapi(nextCfapi);
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    void refresh();
    if (!isOpen) return;
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [isOpen, refresh]);

  const cachePercent = useMemo(() => {
    if (!cache || cache.limit_bytes <= 0) return 0;
    return Math.min(100, Math.round((cache.current_bytes / cache.limit_bytes) * 100));
  }, [cache]);

  if (!isOpen) return null;

  const cards = [
    { label: "Arquivos", value: stats?.files ?? 0, icon: Files },
    { label: "Pastas", value: stats?.folders ?? 0, icon: Folder },
    { label: "Sincronizados", value: stats?.synced_files ?? 0, icon: CheckCircle2 },
    { label: "Pendentes", value: stats?.pending_jobs ?? 0, icon: Clock3 },
    { label: "Falhas", value: stats?.failed_jobs ?? 0, icon: AlertTriangle },
    { label: "Conflitos", value: stats?.conflicts ?? 0, icon: AlertTriangle },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <motion.div
          className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl"
          initial={{ opacity: 0, scale: 0.97, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 10 }}
        >
          <header className="flex items-center justify-between border-b border-app-border-subtle px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-app-selected text-app-accent">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-app-text">TCloud</h2>
                <p className="text-sm text-app-text-secondary">Visão geral da sua nuvem</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refresh()}
                className="quiet-control flex h-9 w-9 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-hover hover:text-app-text"
                title="Atualizar"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="quiet-control flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-app-text-secondary hover:bg-app-hover hover:text-app-text"
              >
                <Settings className="h-4 w-4" />
                Configurações
              </button>
              <button
                onClick={onClose}
                className="quiet-control flex h-9 w-9 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-hover hover:text-app-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="overflow-y-auto p-6">
            <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-app-border-subtle bg-app-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-app-text-tertiary">Arquivos no Windows</span>
                  <Monitor className="h-4 w-4 text-app-text-tertiary" />
                </div>
                <strong className="block text-lg text-app-text">{cfapi?.provider_connected ? "Conectado" : cfapi?.registered ? "Reconectando" : "Desconectado"}</strong>
                <span className="truncate text-xs text-app-text-secondary">{cfapi?.root_path || "Pasta TCloud no Explorer"}</span>
              </div>

              <div className="rounded-xl border border-app-border-subtle bg-app-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-app-text-tertiary">Sincronização automática</span>
                  <RefreshCw className="h-4 w-4 text-app-text-tertiary" />
                </div>
                <strong className="block text-lg text-app-text">{watcher?.running ? "Ativa" : "Pausada"}</strong>
                <span className="truncate text-xs text-app-text-secondary">{watcher?.root || "Aguardando a pasta TCloud"}</span>
              </div>

              <div className="rounded-xl border border-app-border-subtle bg-app-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-app-text-tertiary">Na nuvem</span>
                  <Database className="h-4 w-4 text-app-text-tertiary" />
                </div>
                <strong className="block text-lg text-app-text">{formatBytes(stats?.total_bytes ?? 0)}</strong>
                <span className="text-xs text-app-text-secondary">{stats?.online_only_files ?? 0} somente online</span>
              </div>

              <div className="rounded-xl border border-app-border-subtle bg-app-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-app-text-tertiary">No computador</span>
                  <HardDrive className="h-4 w-4 text-app-text-tertiary" />
                </div>
                <strong className="block text-lg text-app-text">{cachePercent}%</strong>
                <span className="text-xs text-app-text-secondary">
                  {formatBytes(cache?.current_bytes ?? 0)} / {formatBytes(cache?.limit_bytes ?? 0)}
                </span>
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {cards.map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-app-border-subtle bg-app-canvas p-3">
                  <Icon className="mb-3 h-4 w-4 text-app-text-tertiary" />
                  <strong className="block text-xl text-app-text">{value}</strong>
                  <span className="text-xs text-app-text-secondary">{label}</span>
                </div>
              ))}
            </div>

            <section className="rounded-xl border border-app-border-subtle bg-app-canvas">
              <div className="flex items-center justify-between border-b border-app-border-subtle px-4 py-3">
                <div>
                  <h3 className="font-medium text-app-text">Arquivos recentes</h3>
                  <p className="text-xs text-app-text-secondary">Arquivos usados ou atualizados recentemente</p>
                </div>
              </div>
              <div className="divide-y divide-app-border-subtle">
                {(stats?.recent_files ?? []).length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-app-text-secondary">
                    Nenhum arquivo recente ainda.
                  </div>
                ) : (
                  stats?.recent_files.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-selected text-app-accent">
                        <Files className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-app-text">{file.name}</div>
                        <div className="truncate text-xs text-app-text-tertiary">{file.path}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-xs text-app-text-secondary">{formatBytes(file.size)}</div>
                        <div className="text-[11px] text-app-text-tertiary">
                          {file.local_status === "cached" ? "Disponível offline" : "Na nuvem"} · {syncStatusLabel(file.sync_status)}
                        </div>
                      </div>
                      <button
                        className="quiet-control flex h-9 items-center gap-2 rounded-lg px-3 text-xs text-app-text-secondary hover:bg-app-hover hover:text-app-text"
                        onClick={() => setPreviewFile(file)}
                        title="Pré-visualizar"
                      >
                        <Eye className="h-4 w-4" />
                        Visualizar
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </motion.div>
      </motion.div>
      {previewFile && (
        <Suspense fallback={null}>
          <TCloudFilePreviewModal
            file={previewFile}
            onClose={() => setPreviewFile(null)}
          />
        </Suspense>
      )}
    </AnimatePresence>
  );
}
