import { useState } from 'react';
import { ChevronDown, ChevronUp, Download, RotateCcw, UploadCloud, X, CheckCircle2, CircleAlert, ListChecks } from 'lucide-react';
import type { DownloadItem, QueueItem } from '../../../types';

interface TransferCenterProps {
  uploads: QueueItem[];
  downloads: DownloadItem[];
  onClearUploads: () => void;
  onCancelUploads: () => void;
  onCancelUpload: (id: string) => void;
  onRetryUpload: (id: string) => void;
  onSetUploadPriority: (id: string, priority: 'high' | 'normal' | 'low') => void;
  onClearDownloads: () => void;
  onCancelDownloads: () => void;
  onCancelDownload: (id: string) => void;
  onRetryDownload: (id: string) => void;
  onOpenDetails?: () => void;
}

function TransferProgress({ value, tone = 'accent' }: { value?: number; tone?: 'accent' | 'info' }) {
  return (
    <div className="tcloud-transfer-progress-track" aria-hidden="true">
      <div
        className={`tcloud-transfer-progress-value ${tone === 'accent' ? 'is-accent' : 'is-info'}`}
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </div>
  );
}

function friendlyStatus(status: QueueItem['status'] | DownloadItem['status']) {
  switch (status) {
    case 'success': return 'Concluído';
    case 'error': return 'Precisa de atenção';
    case 'cancelled': return 'Cancelado';
    case 'pending': return 'Aguardando';
    case 'uploading': return 'Enviando';
    case 'downloading': return 'Baixando';
    case 'decrypting': return 'Preparando arquivo';
    case 'verifying': return 'Verificando';
    case 'waiting_for_unlock': return 'Aguardando desbloqueio';
    default: return 'Processando';
  }
}

function StatusLabel({ status }: { status: QueueItem['status'] | DownloadItem['status'] }) {
  const tone = status === 'success'
    ? 'is-success'
    : status === 'error'
      ? 'is-danger'
      : status === 'cancelled'
        ? 'is-muted'
        : 'is-active';
  return <span className={`tcloud-transfer-status ${tone}`}>{friendlyStatus(status)}</span>;
}

export function TransferCenter({
  uploads,
  downloads,
  onClearUploads,
  onCancelUploads,
  onCancelUpload,
  onRetryUpload,
  onSetUploadPriority,
  onClearDownloads,
  onCancelDownloads,
  onCancelDownload,
  onRetryDownload,
  onOpenDetails,
}: TransferCenterProps) {
  const [expanded, setExpanded] = useState(() => uploads.some((item) => item.status === 'uploading' || item.status === 'error') || downloads.some((item) => item.status === 'downloading' || item.status === 'error'));
  const activeUploads = uploads.filter((item) => item.status === 'pending' || item.status === 'uploading' || item.status === 'downloading');
  const activeDownloads = downloads.filter((item) => item.status === 'pending' || item.status === 'downloading' || item.status === 'decrypting' || item.status === 'verifying');
  const activeCount = activeUploads.length + activeDownloads.length;
  const failedCount = uploads.filter((item) => item.status === 'error' || item.status === 'waiting_for_unlock').length
    + downloads.filter((item) => item.status === 'error' || item.status === 'waiting_for_unlock').length;
  const totalCount = uploads.length + downloads.length;
  const completedCount = uploads.filter((item) => item.status === 'success').length + downloads.filter((item) => item.status === 'success').length;

  const activeTransfers = [...activeUploads, ...activeDownloads];
  const overallProgress = activeTransfers.length === 0
    ? (completedCount > 0 ? 100 : 0)
    : Math.round(activeTransfers.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress ?? 0)), 0) / activeTransfers.length);

  if (uploads.length === 0 && downloads.length === 0) return null;

  const headline = failedCount > 0
    ? `${failedCount} ${failedCount === 1 ? 'arquivo precisa' : 'arquivos precisam'} de atenção`
    : activeCount > 0
      ? `Sincronizando ${activeCount} ${activeCount === 1 ? 'arquivo' : 'arquivos'}`
      : 'Tudo concluído';
  const detail = failedCount > 0
    ? 'Abra os detalhes para tentar novamente.'
    : activeCount > 0
      ? `${overallProgress}% · você pode continuar usando o TCloud`
      : `${completedCount} de ${totalCount} concluídos`;

  return (
    <aside className={`tcloud-transfer-center ${expanded ? 'is-expanded' : 'is-collapsed'} fixed z-50 overflow-hidden`} aria-label="Transferências">
      <div className="tcloud-transfer-summary">
        <button onClick={() => setExpanded((value) => !value)} className="tcloud-transfer-header flex w-full items-center gap-3 text-start">
          <div className={`tcloud-transfer-header-icon ${failedCount > 0 ? 'is-danger' : ''}`}>
            {failedCount > 0 ? <CircleAlert className="h-4 w-4" /> : activeCount > 0 ? <UploadCloud className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3>{headline}</h3>
            <p>{detail}</p>
          </div>
          {expanded ? <ChevronDown className="h-4 w-4 text-app-text-secondary" /> : <ChevronUp className="h-4 w-4 text-app-text-secondary" />}
        </button>
        {activeCount > 0 && <TransferProgress value={overallProgress} />}
      </div>

      {expanded && (
        <div className="tcloud-transfer-body overflow-y-auto">
          {uploads.length > 0 && (
            <section>
              <div className="tcloud-transfer-section-head">
                <span>Uploads</span>
                <div>
                  {activeUploads.length > 0 && <button onClick={onCancelUploads}>Cancelar ativos</button>}
                  <button onClick={onClearUploads}>Limpar concluídos</button>
                </div>
              </div>
              {uploads.map((item) => (
                <div key={item.id} className="tcloud-transfer-item">
                  <div className="flex items-center gap-3">
                    <UploadCloud className="h-4 w-4 shrink-0 text-app-accent" />
                    <div className="min-w-0 flex-1">
                      <p title={item.url || item.path}>{(item.url || item.path).split(/[\\/]/).pop()}</p>
                      <StatusLabel status={item.status} />
                    </div>
                    {item.status === 'pending' && (
                      <button
                        onClick={() => onSetUploadPriority(item.id, item.priority === 'high' ? 'low' : item.priority === 'low' ? 'normal' : 'high')}
                        className="tcloud-transfer-priority"
                        title="Alterar prioridade"
                      >
                        {item.priority === 'high' ? 'Alta' : item.priority === 'low' ? 'Baixa' : 'Normal'}
                      </button>
                    )}
                    {(item.status === 'pending' || item.status === 'uploading' || item.status === 'downloading') && <button onClick={() => onCancelUpload(item.id)} className="tcloud-transfer-icon-action" title="Cancelar"><X className="h-3.5 w-3.5" /></button>}
                    {(item.status === 'error' || item.status === 'cancelled' || item.status === 'waiting_for_unlock') && <button onClick={() => onRetryUpload(item.id)} className="tcloud-transfer-icon-action" title="Tentar novamente"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  </div>
                  {(item.status === 'uploading' || item.status === 'downloading') && <TransferProgress value={item.progress} />}
                  {item.error && <p className="tcloud-transfer-error">{item.error}</p>}
                </div>
              ))}
            </section>
          )}

          {downloads.length > 0 && (
            <section>
              <div className="tcloud-transfer-section-head">
                <span>Downloads</span>
                <div>
                  {activeDownloads.length > 0 && <button onClick={onCancelDownloads}>Cancelar ativos</button>}
                  <button onClick={onClearDownloads}>Limpar concluídos</button>
                </div>
              </div>
              {downloads.map((item) => (
                <div key={item.id} className="tcloud-transfer-item">
                  <div className="flex items-center gap-3">
                    <Download className="h-4 w-4 shrink-0 text-app-info" />
                    <div className="min-w-0 flex-1"><p title={item.filename}>{item.filename}</p><StatusLabel status={item.status} /></div>
                    {(item.status === 'pending' || item.status === 'downloading') && <button onClick={() => onCancelDownload(item.id)} className="tcloud-transfer-icon-action" title="Cancelar"><X className="h-3.5 w-3.5" /></button>}
                    {(item.status === 'error' || item.status === 'cancelled' || item.status === 'waiting_for_unlock') && <button onClick={() => onRetryDownload(item.id)} className="tcloud-transfer-icon-action" title="Tentar novamente"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  </div>
                  {(item.status === 'downloading' || item.status === 'decrypting' || item.status === 'verifying') && <TransferProgress value={item.progress} tone="info" />}
                  {item.error && <p className="tcloud-transfer-error">{item.error}</p>}
                </div>
              ))}
            </section>
          )}

          <div className="tcloud-transfer-footer">
            <span>{activeCount > 0 ? 'As transferências continuam em segundo plano.' : 'O histórico pode ser limpo sem apagar seus arquivos.'}</span>
            {onOpenDetails && <button type="button" onClick={onOpenDetails}><ListChecks className="h-3.5 w-3.5" />Ver sincronização</button>}
          </div>
        </div>
      )}
    </aside>
  );
}
