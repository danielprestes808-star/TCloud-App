import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder, FolderPlus, Link2, Trash2, RefreshCw, MessageCircle } from "lucide-react";
import {
  createTCloudLogicalFolder,
  deleteTCloudLogicalFolder,
  listTCloudFolderTree,
  updateTCloudFolderGroup,
  type TCloudFolderNode,
} from "../services/tcloudFolders";
import { listTCloudTelegramChats, type TCloudTelegramChat } from "../services/tcloudTelegramChats";
import { createTCloudStorageChat } from "../services/tcloudStorageChat";

function depthOf(path: string) {
  if (path === "/") return 0;
  return path.split("/").filter(Boolean).length;
}

export default function TCloudFoldersPage() {
  const [folders, setFolders] = useState<TCloudFolderNode[]>([]);
  const [telegramChats, setTelegramChats] = useState<TCloudTelegramChat[]>([]);
  const [selectedParent, setSelectedParent] = useState<number | null>(1);
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refreshFolders = useCallback(async () => {
    const folderItems = await listTCloudFolderTree();
    setFolders(folderItems);
    const rootFolder = folderItems.find((folder) => folder.parent_id === null);
    setSelectedParent((current) => {
      if (current && folderItems.some((folder) => folder.id === current)) return current;
      return rootFolder?.id ?? null;
    });
    return folderItems;
  }, []);

  const refreshChats = useCallback(async () => {
    try {
      const chatItems = await listTCloudTelegramChats();
      setTelegramChats(
        chatItems.filter((chat) =>
          ["group", "channel", "supergroup"].includes(chat.kind),
        ),
      );
    } catch (error) {
      console.warn("TCloud: não foi possível atualizar os chats do Telegram", error);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshFolders();
      void refreshChats();
    } catch (error) {
      setMessage(String(error));
    }
  }, [refreshFolders, refreshChats]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const root = useMemo(
    () => folders.find((folder) => folder.parent_id === null) ?? null,
    [folders],
  );

  async function createFolder() {
    if (!name.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const created = await createTCloudLogicalFolder({
        parent_id: selectedParent,
        name: name.trim(),
        telegram_chat_id: chatId.trim() ? Number(chatId) : null,
      });
      setFolders((current) => {
        const withoutDuplicate = current.filter((folder) => folder.id !== created.id);
        return [...withoutDuplicate, created].sort((a, b) => a.path.localeCompare(b.path));
      });
      setName("");
      setChatId("");
      setMessage(`Pasta "${created.name}" criada.`);
      await refreshFolders();
      void refreshChats();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function changeGroup(folderId: number, value: string) {
    setBusy(true);
    setMessage("");
    try {
      await updateTCloudFolderGroup(
        folderId,
        value.trim() ? Number(value) : null,
      );
      setMessage("Local atualizado.");
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createStorageChat(folder: TCloudFolderNode) {
    setBusy(true);
    setMessage("");
    try {
      const result = await createTCloudStorageChat({
        folder_id: folder.id,
        title: `TCloud - ${folder.name}`,
        kind: "group",
      });
      setFolders((current) =>
        current.map((item) =>
          item.id === folder.id
            ? { ...item, telegram_chat_id: result.chat_id }
            : item,
        ),
      );
      setTelegramChats((current) => {
        if (current.some((chat) => chat.id === result.chat_id)) return current;
        return [
          ...current,
          { id: result.chat_id, title: result.title, kind: result.kind, username: null },
        ];
      });
      setMessage(`Local "${result.title}" preparado para esta pasta.`);
      await refreshFolders();
      void refreshChats();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeFolder(folderId: number) {
    setBusy(true);
    setMessage("");
    try {
      await deleteTCloudLogicalFolder(folderId);
      setMessage("Pasta removida.");
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tcloud-folder-page">
      <header className="tcloud-folder-page__header">
        <div>
          <span className="tcloud-settings__eyebrow">TCloud</span>
          <h1>Armazenamento e pastas</h1>
          <p>Organize as pastas usadas pelo TCloud e escolha onde elas devem guardar os arquivos. Você também pode criar e organizar pastas diretamente no TCloud ou no Explorador do Windows.</p>
        </div>
        <button className="tcloud-button" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>

      {message && <div className="tcloud-settings__message">{message}</div>}

      <section className="tcloud-card">
        <div className="tcloud-card__title">
          <div>
            <h2>Nova pasta</h2>
            <p>Crie uma pasta e, se quiser, escolha um local específico na nuvem. O TCloud pode cuidar disso automaticamente.</p>
          </div>
          <FolderPlus size={20} />
        </div>

        <div className="tcloud-row">
          <label className="tcloud-field">
            <span>Pasta pai</span>
            <select
              className="tcloud-input"
              value={selectedParent ?? ""}
              onChange={(event) =>
                setSelectedParent(event.target.value ? Number(event.target.value) : null)
              }
            >
              {root && <option value={root.id}>TCloud /</option>}
              {folders
                .filter((folder) => folder.parent_id !== null)
                .map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path}
                  </option>
                ))}
            </select>
          </label>

          <label className="tcloud-field">
            <span>Nome</span>
            <input
              className="tcloud-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Faculdade"
            />
          </label>

          <label className="tcloud-field">
            <span>Local na nuvem (opcional)</span>
            <select
              className="tcloud-input"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
            >
              <option value="">Automático</option>
              {telegramChats.map((chat) => (
                <option key={chat.id} value={String(chat.id)}>
                  {chat.title}
                </option>
              ))}
            </select>
          </label>

          <button
            className="tcloud-button tcloud-button--primary"
            disabled={busy || !name.trim()}
            onClick={() => void createFolder()}
          >
            Criar pasta
          </button>
        </div>
      </section>

      <section className="tcloud-card">
        <div className="tcloud-card__title">
          <div>
            <h2>Pastas configuradas</h2>
            <p>Veja onde cada pasta guarda seus arquivos. Se estiver em Automático, o TCloud escolhe o melhor local para você.</p>
          </div>
          <Folder size={20} />
        </div>

        <div className="tcloud-folder-list">
          {folders
            .filter((folder) => folder.parent_id !== null)
            .map((folder) => (
              <div
                key={folder.id}
                className="tcloud-folder-row"
                style={{ paddingLeft: `${Math.max(0, depthOf(folder.path) - 1) * 22}px` }}
              >
                <div className="tcloud-folder-row__main">
                  <Folder size={17} />
                  <div>
                    <strong>{folder.name}</strong>
                    <span>{folder.path}</span>
                    {folder.telegram_chat_id && (
                      <span>
                        <MessageCircle size={11} style={{ display: "inline", marginRight: 4 }} />
                        {telegramChats.find((chat) => chat.id === folder.telegram_chat_id)?.title ?? "Local automático"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="tcloud-folder-row__group">
                  <Link2 size={15} />
                  <select
                    className="tcloud-input"
                    value={folder.telegram_chat_id ?? ""}
                    disabled={busy}
                    onChange={(event) => void changeGroup(folder.id, event.target.value)}
                  >
                    <option value="">Automático</option>
                    {telegramChats.map((chat) => (
                      <option key={chat.id} value={String(chat.id)}>
                        {chat.title}
                      </option>
                    ))}
                  </select>
                </div>

                {!folder.telegram_chat_id && (
                  <button
                    className="tcloud-button"
                    disabled={busy}
                    onClick={() => void createStorageChat(folder)}
                    title="Preparar local na nuvem"
                  >
                    Preparar local
                  </button>
                )}

                <button
                  className="tcloud-button tcloud-button--danger"
                  disabled={busy}
                  onClick={() => void removeFolder(folder.id)}
                  title="Excluir pasta vazia"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

          {folders.filter((folder) => folder.parent_id !== null).length === 0 && (
            <div className="tcloud-folder-empty">
              Nenhuma pasta criada ainda.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
