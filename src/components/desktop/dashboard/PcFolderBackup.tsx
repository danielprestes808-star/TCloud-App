import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { CheckCircle2, CloudUpload, Folder, FolderPlus, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteBackup,
  listBackups,
  listPcKnownFolders,
  runBackupsNow,
  saveBackup,
  type PcKnownFolder,
  type ProBackupSource,
} from '../../../services/tcloudProductivity';
import { createTCloudForum, createTCloudForumTopic, deleteTCloudMainFolder, listTCloudForumTree, refreshTCloudForumTreeFromTelegram } from '../../../services/tcloudForums';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

function samePath(left: string, right: string) {
  return left.replace(/[\\/]+$/, '').toLocaleLowerCase() === right.replace(/[\\/]+$/, '').toLocaleLowerCase();
}

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'Outra pasta';
}

function lastRunLabel(source?: ProBackupSource) {
  if (!source) return 'Não está no backup';
  if (!source.enabled) return 'Backup pausado';
  if (!source.last_success_at) return 'Aguardando primeira sincronização';
  return `Atualizado ${new Date(source.last_success_at * 1000).toLocaleString('pt-BR')}`;
}

export function PcFolderBackup() {
  const [knownFolders, setKnownFolders] = useState<PcKnownFolder[]>([]);
  const [backups, setBackups] = useState<ProBackupSource[]>([]);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

  const refresh = useCallback(async () => {
    const [folders, sources] = await Promise.all([listPcKnownFolders(), listBackups()]);
    setKnownFolders(folders);
    setBackups(sources);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => toast.error(`Não foi possível carregar o backup: ${String(error)}`));
  }, [refresh]);

  const backupByPath = useMemo(() => {
    const result = new Map<string, ProBackupSource>();
    for (const source of backups) result.set(source.local_path.replace(/[\\/]+$/, '').toLocaleLowerCase(), source);
    return result;
  }, [backups]);

  const getCloudDestination = async (label: string) => {
    setProvisioning(true);
    // Use the local SQLite tree for the interactive action. A full Telegram
    // refresh can take minutes on large accounts and must never block a toggle.
    const tree = await listTCloudForumTree();
    const computerMatches = tree.filter((item) => normalize(item.name) === normalize('Meu computador'));
    let computer = computerMatches.slice().sort((left, right) => right.topics.length - left.topics.length || left.id - right.id)[0];
    if (!computer) {
      const created = await createTCloudForum('Meu computador');
      computer = { ...created, topics: [] };
    }
    if (!computer) throw new Error('não foi possível criar Meu computador');
    const existing = computer.topics.find((item) => normalize(item.name) === normalize(label));
    const destination = existing?.id ?? (await createTCloudForumTopic(label, computer.id)).id;
    setProvisioning(false);
    return destination;
  };

  const cleanupEmptyComputerDuplicates = useCallback(async () => {
    const tree = await refreshTCloudForumTreeFromTelegram();
    const matches = tree.filter((item) => normalize(item.name) === normalize('Meu computador'));
    const primary = matches.slice().sort((left, right) => right.topics.length - left.topics.length || left.id - right.id)[0];
    if (!primary) return;
    await Promise.all(matches
      .filter((item) => item.id !== primary.id && item.topics.length === 0)
      .map((item) => deleteTCloudMainFolder(item.id).catch(() => undefined)));
    window.dispatchEvent(new Event('tcloud-forums-changed'));
  }, []);

  const enablePath = async (path: string, label: string) => {
    setBusyPath(path);
    try {
      const existing = backups.find((item) => samePath(item.local_path, path));
      const targetFolderId = existing?.target_folder_id ?? await getCloudDestination(label);
      const backupId = await saveBackup({
        id: existing?.id,
        local_path: path,
        target_folder_id: targetFolderId,
        enabled: true,
        interval_minutes: 15,
      });
      await refresh();
      toast.success(`${label} ativada. Procurando arquivos agora…`);
      window.dispatchEvent(new Event('tcloud-forums-changed'));
      // Do not wait for the periodic scheduler after enabling a source. The scan
      // runs in Rust and the durable upload queue keeps going from the tray.
      void runBackupsNow(backupId)
        .then((queued) => {
          toast.success(queued > 0 ? `${queued} arquivo(s) de ${label} entraram na fila.` : `${label} já está atualizada.`);
          window.dispatchEvent(new Event('tcloud-files-changed'));
          return refresh();
        })
        .catch((error) => toast.error(`A primeira sincronização de ${label} falhou: ${String(error)}`));
      // Maintenance is deliberately detached from the button response.
      window.setTimeout(() => void cleanupEmptyComputerDuplicates(), 500);
    } catch (error) {
      toast.error(`Não foi possível ativar ${label}: ${String(error)}`);
    } finally {
      setBusyPath(null);
      setProvisioning(false);
    }
  };

  const disablePath = async (source: ProBackupSource) => {
    setBusyPath(source.local_path);
    try {
      await deleteBackup(source.id);
      await refresh();
      toast.success('Backup desativado. Os arquivos já enviados foram mantidos na nuvem.');
    } catch (error) {
      toast.error(`Não foi possível desativar: ${String(error)}`);
    } finally {
      setBusyPath(null);
    }
  };

  const addCustomFolder = async () => {
    const picked = await open({ directory: true, multiple: false, title: 'Escolha uma pasta deste computador' });
    if (!picked || Array.isArray(picked)) return;
    const label = folderName(picked);
    await enablePath(picked, label);
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const queued = await runBackupsNow();
      await refresh();
      toast.success(queued > 0 ? `${queued} arquivo(s) entraram na fila.` : 'As pastas já estão atualizadas.');
    } catch (error) {
      toast.error(`Não foi possível sincronizar agora: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  const customBackups = backups.filter((source) => !knownFolders.some((folder) => samePath(folder.path, source.local_path)));

  return (
    <section className="tcloud-pc-backup" aria-labelledby="pc-backup-title">
      <div className="tcloud-simple-section-heading">
        <div>
          <h3 id="pc-backup-title">Pastas deste computador</h3>
          <p>Proteja seus arquivos automaticamente em Meu computador. Novas pastas são verificadas imediatamente e o TCloud continua com a janela fechada.</p>
        </div>
        <button type="button" className="tcloud-pc-backup-run" onClick={() => void runNow()} disabled={running || backups.length === 0}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sincronizar agora
        </button>
      </div>

      <div className="tcloud-pc-backup-list">
        {knownFolders.map((folder) => {
          const source = backupByPath.get(folder.path.replace(/[\\/]+$/, '').toLocaleLowerCase());
          const busy = busyPath === folder.path;
          return (
            <div className={`tcloud-pc-backup-row ${source?.enabled ? 'is-enabled' : ''}`} key={folder.key}>
              <div className="tcloud-pc-backup-icon">{source?.enabled ? <CheckCircle2 /> : <Folder />}</div>
              <span><strong>{folder.label}</strong><small>{folder.available ? lastRunLabel(source) : 'Pasta não encontrada neste computador'}</small></span>
              <button
                type="button"
                disabled={!folder.available || busy || provisioning}
                onClick={() => void (source ? disablePath(source) : enablePath(folder.path, folder.label))}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : source ? 'Ativado' : 'Ativar'}
              </button>
            </div>
          );
        })}
        {customBackups.map((source) => (
          <div className="tcloud-pc-backup-row is-enabled" key={source.id}>
            <div className="tcloud-pc-backup-icon"><CloudUpload /></div>
            <span><strong>{folderName(source.local_path)}</strong><small>{lastRunLabel(source)}</small></span>
            <button type="button" disabled={busyPath === source.local_path} onClick={() => void disablePath(source)}>Ativado</button>
          </div>
        ))}
      </div>

      <button type="button" className="tcloud-pc-backup-add" disabled={provisioning} onClick={() => void addCustomFolder()}>
        <FolderPlus className="h-4 w-4" /> Escolher outra pasta
      </button>
      <div className="tcloud-pc-backup-note"><Monitor className="h-4 w-4" /><span>Na nuvem, cada origem aparece como uma subpasta única dentro de <strong>Meu computador</strong>.</span></div>
    </section>
  );
}
