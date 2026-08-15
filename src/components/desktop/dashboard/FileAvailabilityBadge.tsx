import { CheckCheck, CheckCircle2, CircleAlert, Cloud, RefreshCw } from 'lucide-react';
import type { TelegramFile } from '../../../types';

interface Props {
  file: TelegramFile;
  compact?: boolean;
}

function status(file: TelegramFile) {
  const sync = (file.sync_status || '').toLowerCase();
  const local = (file.local_status || '').toLowerCase();

  if (['failed', 'error', 'conflict'].some((value) => sync.includes(value))) {
    return { icon: CircleAlert, label: 'Precisa de atenção', className: 'is-error' };
  }
  if (['pending', 'running', 'uploading', 'downloading', 'syncing', 'pending_upload', 'pending_move', 'pending_delete'].some((value) => sync.includes(value))) {
    return { icon: RefreshCw, label: 'Sincronizando', className: 'is-syncing' };
  }
  if (file.is_pinned) {
    return { icon: CheckCheck, label: 'Sempre disponível', className: 'is-pinned' };
  }
  if (['cached', 'offline', 'local', 'available'].some((value) => local.includes(value))) {
    return { icon: CheckCircle2, label: 'Disponível neste computador', className: 'is-local' };
  }
  return { icon: Cloud, label: 'Na nuvem', className: 'is-cloud' };
}

export function FileAvailabilityBadge({ file, compact = false }: Props) {
  if (file.type === 'folder') return null;
  const current = status(file);
  const Icon = current.icon;
  return (
    <span className={`tcloud-file-availability ${current.className} ${compact ? 'is-compact' : ''}`} title={current.label}>
      <Icon className={`h-3.5 w-3.5 ${current.className === 'is-syncing' ? 'animate-spin' : ''}`} />
      {!compact && <span>{current.label}</span>}
    </span>
  );
}
