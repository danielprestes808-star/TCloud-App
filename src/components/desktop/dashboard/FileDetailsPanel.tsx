import { useEffect, useMemo, useState } from 'react';
import {
  X, Info, Cloud, HardDrive, History, Share2, Pin, Download, Eye,
  Star, FileText, Image as ImageIcon, Film, Music,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TelegramFile } from '../../../types';
import { getCachedThumbnail, loadThumbnail } from '../../../services/imagePreviewCache';
import { isFavorite, toggleFavorite } from '../../../services/tcloudFavorites';

interface Props {
  file: TelegramFile;
  folderName: string;
  onClose: () => void;
  onShare: () => void;
  onVersion: () => void;
  onOffline: () => void;
  onDownload: () => void;
  onPreview: () => void;
}

const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|heic|avif)$/i;
const videoPattern = /\.(mp4|mkv|mov|avi|webm|m4v|mpeg|mpg)$/i;
const audioPattern = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i;

function kindFor(name: string) {
  if (imagePattern.test(name)) return 'Imagem';
  if (videoPattern.test(name)) return 'Vídeo';
  if (audioPattern.test(name)) return 'Áudio';
  if (/\.pdf$/i.test(name)) return 'Documento PDF';
  return 'Arquivo';
}

export function FileDetailsPanel({ file, folderName, onClose, onShare, onVersion, onOffline, onDownload, onPreview }: Props) {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() || 'ARQUIVO' : 'ARQUIVO';
  const [thumbnail, setThumbnail] = useState<string | null>(() => getCachedThumbnail(file.id, file.folder_id));
  const [favorite, setFavorite] = useState(() => isFavorite(file.id, file.folder_id));
  const kind = useMemo(() => kindFor(file.name), [file.name]);
  const localStatus = (file.local_status || '').toLowerCase();
  const availability = file.is_pinned
    ? 'Sempre disponível offline'
    : ['cached', 'offline', 'local', 'available'].some((value) => localStatus.includes(value))
      ? 'Disponível neste computador'
      : localStatus.includes('sync')
        ? 'Sincronizando'
        : localStatus.includes('error')
          ? 'Precisa de atenção'
          : 'Somente na nuvem';
  const locationPath = folderName && folderName !== 'Início' ? `TCloud > ${folderName}` : 'TCloud';

  useEffect(() => {
    let alive = true;
    const cached = getCachedThumbnail(file.id, file.folder_id);
    setThumbnail(cached);
    if (!cached && imagePattern.test(file.name)) {
      void loadThumbnail(file.id, file.folder_id).then((src) => {
        if (alive && src) setThumbnail(src);
      }).catch(() => {});
    }
    setFavorite(isFavorite(file.id, file.folder_id));
    return () => { alive = false; };
  }, [file.id, file.folder_id, file.name]);

  const KindIcon = imagePattern.test(file.name)
    ? ImageIcon
    : videoPattern.test(file.name)
      ? Film
      : audioPattern.test(file.name)
        ? Music
        : FileText;

  return (
    <aside className="tcloud-details-panel" data-wheel-scroll="self">
      <header className="tcloud-details-header">
        <div><Info className="h-4 w-4" /><strong>Propriedades</strong></div>
        <button type="button" onClick={onClose} title="Fechar painel"><X className="h-4 w-4" /></button>
      </header>

      <div className="tcloud-details-body">
        <button type="button" className="tcloud-details-preview" onClick={onPreview} title="Abrir visualização">
          {thumbnail ? (
            <img src={thumbnail} alt="" draggable={false} />
          ) : (
            <div className="tcloud-details-file-icon"><KindIcon className="h-10 w-10" /><span>{extension}</span></div>
          )}
        </button>

        <div className="tcloud-details-name-block">
          <strong title={file.name}>{file.name}</strong>
          <span>{kind} · {file.sizeStr}</span>
        </div>

        <div className="tcloud-details-primary-actions">
          <button type="button" onClick={onPreview}><Eye className="h-4 w-4" /><span>Abrir</span></button>
          <button type="button" onClick={onDownload}><Download className="h-4 w-4" /><span>Baixar</span></button>
          <button type="button" onClick={onShare}><Share2 className="h-4 w-4" /><span>Compartilhar</span></button>
        </div>

        <section className="tcloud-details-section">
          <h4>Geral</h4>
          <dl>
            <div><dt>Tipo</dt><dd>{kind}</dd></div>
            <div><dt>Extensão</dt><dd>{extension}</dd></div>
            <div><dt>Tamanho</dt><dd>{file.sizeStr}</dd></div>
            <div><dt>Modificado</dt><dd>{file.created_at || '—'}</dd></div>
          </dl>
        </section>

        <section className="tcloud-details-section">
          <h4>Localização</h4>
          <dl>
            <div><dt>Local</dt><dd title={locationPath}>{locationPath}</dd></div>
            <div><dt>Disponibilidade</dt><dd>{availability.startsWith('Somente') ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />} {availability}</dd></div>
          </dl>
        </section>

        <section className="tcloud-details-section">
          <h4>Ações</h4>
          <div className="tcloud-details-action-list">
            <button type="button" onClick={onOffline}><Pin className="h-4 w-4" /><span><strong>Manter neste dispositivo</strong><small>Deixa uma cópia disponível mesmo sem internet.</small></span></button>
            <button type="button" onClick={onVersion}><History className="h-4 w-4" /><span><strong>Salvar versão atual</strong><small>Guarda um ponto anterior para recuperação.</small></span></button>
            <button type="button" onClick={() => {
              const next = toggleFavorite(file.id, file.folder_id);
              setFavorite(next);
              toast.success(next ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
            }}><Star className={`h-4 w-4 ${favorite ? 'fill-current text-app-warning' : ''}`} /><span><strong>{favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</strong><small>Acesso rápido na página inicial.</small></span></button>
          </div>
        </section>
      </div>
    </aside>
  );
}
