import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { TelegramFile } from '../../../types';
import { getCachedThumbnail, loadThumbnail } from '../../../services/imagePreviewCache';

const imageExt = new Set(['jpg','jpeg','png','gif','webp','bmp','heic','avif']);

function monthKey(file: TelegramFile) {
  const raw = file.created_at;
  const date = raw ? new Date(/^\d+$/.test(raw) ? Number(raw) * 1000 : raw) : new Date(0);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

export function TCloudGallery({ files, onOpen }: { files:TelegramFile[]; onOpen:(file:TelegramFile)=>void }) {
  const groups = useMemo(() => {
    const images = files.filter((file) => file.type !== 'folder' && imageExt.has(file.name.split('.').pop()?.toLowerCase() || ''));
    const map = new Map<string, TelegramFile[]>();
    for (const file of images) {
      const key = monthKey(file);
      map.set(key, [...(map.get(key) || []), file]);
    }
    return Array.from(map.entries());
  }, [files]);

  if (groups.length === 0) return <div className="py-10 text-center text-sm text-app-text-secondary">Nenhuma imagem nesta visualização.</div>;

  return <div className="tcloud-gallery-timeline">{groups.map(([label, images]) => (
    <section key={label}>
      <div className="tcloud-gallery-month-header"><strong>{label}</strong><small>{images.length} foto(s)</small></div>
      <div className="tcloud-gallery-grid">{images.map((file) => <GalleryTile key={`${file.folder_id ?? 'root'}-${file.id}`} file={file} onOpen={onOpen} />)}</div>
    </section>
  ))}</div>;
}

function GalleryTile({ file, onOpen }: { file:TelegramFile; onOpen:(file:TelegramFile)=>void }) {
  const [src,setSrc] = useState(() => getCachedThumbnail(file.id,file.folder_id));
  useEffect(() => { if (src) return; let alive=true; void loadThumbnail(file.id,file.folder_id).then((value) => { if(alive && value) setSrc(value); }).catch(()=>{}); return ()=>{alive=false}; }, [file.id,file.folder_id,src]);
  return <button type="button" className="tcloud-gallery-tile" onClick={() => onOpen(file)} title={file.name}>{src ? <img src={src} alt={file.name} draggable={false} /> : <span><ImageIcon className="h-6 w-6" /></span>}<small>{file.name}</small></button>;
}
