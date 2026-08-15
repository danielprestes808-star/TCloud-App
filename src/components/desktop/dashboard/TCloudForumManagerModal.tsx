import { useState } from 'react';
import { Folder, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTCloudForum,
  deleteTCloudMainFolder,
  listTCloudForumTree,
  refreshTCloudForumTreeFromTelegram,
  renameTCloudMainFolder,
  type TCloudForumTree,
} from '../../../services/tcloudForums';

export function TCloudForumManagerModal({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const { data: locations = [], isFetching: refreshing } = useQuery<TCloudForumTree[]>({
    queryKey: ['tcloud-forum-tree'],
    queryFn: listTCloudForumTree,
    enabled: isOpen,
    staleTime: 15_000,
  });

  const refresh = async () => {
    try {
      const remoteTree = await refreshTCloudForumTreeFromTelegram();
      queryClient.setQueryData<TCloudForumTree[]>(['tcloud-forum-tree'], remoteTree);
    } catch (error) {
      console.warn('Could not refresh TCloud folders', error);
      toast.error('Não foi possível atualizar as pastas agora.');
    }
  };

  if (!isOpen) return null;

  const refreshEverywhere = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tcloud-forum-tree'] });
    onChanged?.();
    window.dispatchEvent(new Event('tcloud-forums-changed'));
  };

  const rename = async (id: number, oldName: string) => {
    const clean = editingName.trim();
    if (!clean || clean === oldName || busy) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await renameTCloudMainFolder(id, clean);
      setEditingId(null);
      await refreshEverywhere();
      toast.success(`Renomeado para "${clean}".`);
    } catch (error) {
      toast.error(`Não foi possível renomear: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, folderName: string) => {
    if (busy) return;
    if (!window.confirm(`Excluir a pasta "${folderName}"?

Ela precisa estar vazia.`)) return;
    setBusy(true);
    try {
      await deleteTCloudMainFolder(id);
      await refreshEverywhere();
      toast.success(`Pasta "${folderName}" excluída.`);
    } catch (error) {
      const message = String(error);
      toast.error(message.includes('TCLOUD_FOLDER_NOT_EMPTY')
        ? 'Esta pasta ainda contém arquivos ou subpastas. Mova ou exclua o conteúdo primeiro.'
        : `Não foi possível excluir a pasta: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const created = await createTCloudForum(value, false);
      setName('');
      queryClient.setQueryData<TCloudForumTree[]>(['tcloud-forum-tree'], (current = []) => {
        if (current.some((folder) => folder.id === created.id)) return current;
        return [...current, { ...created, topics: [] }]
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
      });
      onChanged?.();
      toast.success(`Pasta "${created.name}" criada.`);
    } catch (error) {
      toast.error(`Não foi possível criar a pasta: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-app-overlay p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="tcloud-forum-modal tcloud-forum-modal-wide" onClick={(event) => event.stopPropagation()}>
        <header className="tcloud-forum-header">
          <div className="flex items-center gap-3">
            <span className="tcloud-forum-logo">
              <Folder className="h-5 w-5" />
            </span>
            <div>
              <span>TCLOUD</span>
              <h2>Pastas principais</h2>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void refresh()} title="Atualizar pastas" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} title="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="tcloud-forum-body">
          <div className="tcloud-forum-intro">
            <Folder className="h-5 w-5 text-app-accent" />
            <div>
              <strong>Suas pastas principais</strong>
              <p>
                Crie, renomeie ou exclua pastas daqui. A mesma estrutura aparece no TCloud e no Explorer.
              </p>
            </div>
          </div>

          <div className="tcloud-forum-list">
            {locations.length === 0 && !refreshing ? (
              <div className="rounded-xl border border-dashed border-app-border p-5 text-center text-sm text-app-text-tertiary">
                Nenhuma pasta principal ainda. Crie a primeira abaixo.
              </div>
            ) : locations.map((location) => (
              <article key={location.id} className="tcloud-forum-card">
                <span className="tcloud-forum-card-icon">
                  <Folder className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === location.id ? (
                    <input
                      autoFocus
                      className="tcloud-folder-manager-inline-input"
                      value={editingName}
                      disabled={busy}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') { setEditingId(null); event.currentTarget.blur(); }
                      }}
                      onBlur={() => void rename(location.id, location.name)}
                    />
                  ) : <strong>{location.name}</strong>}
                  <small>
                    {location.topics.length === 0
                      ? 'Nenhuma subpasta'
                      : `${location.topics.length} ${location.topics.length === 1 ? 'subpasta' : 'subpastas'}`}
                  </small>
                </div>
                <div className="tcloud-folder-manager-actions">
                  <button type="button" title="Renomear" disabled={busy} onClick={() => { setEditingId(location.id); setEditingName(location.name); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title="Excluir pasta vazia" disabled={busy} onClick={() => void remove(location.id, location.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="tcloud-forum-create">
            <div>
              <strong>Criar pasta</strong>
              <span>Ex.: Trabalho, Faculdade, Fotos</span>
            </div>
            <div className="tcloud-forum-create-row">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void create(); }}
                placeholder="Nome da pasta"
              />
              <button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
                {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-app-text-tertiary">
            Dica: Ctrl+Shift+N também cria uma nova pasta na tela principal.
          </p>
        </div>
      </div>
    </div>
  );
}
