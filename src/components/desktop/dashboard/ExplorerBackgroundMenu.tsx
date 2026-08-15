import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardPaste, FolderPlus, FolderUp, RefreshCw, UploadCloud } from 'lucide-react';

interface ExplorerBackgroundMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCreateFolder: () => void;
  onUpload?: () => void;
  onFolderUpload?: () => void;
  onPaste?: () => void;
  onRefresh?: () => void | Promise<void>;
}

export function ExplorerBackgroundMenu({ x, y, onClose, onCreateFolder, onUpload, onFolderUpload, onPaste, onRefresh }: ExplorerBackgroundMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const run = (action?: () => void | Promise<void>) => () => {
    onClose();
    void action?.();
  };

  return (
    <div ref={ref} className="tcloud-context-menu fixed z-[95]" style={{ left: position.x, top: position.y }} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" className="tcloud-context-item" onClick={run(onCreateFolder)}><FolderPlus className="h-4 w-4" /><span>Nova pasta</span><kbd>Ctrl+Shift+N</kbd></button>
      {onUpload && <button type="button" className="tcloud-context-item" onClick={run(onUpload)}><UploadCloud className="h-4 w-4" /><span>Enviar arquivo</span></button>}
      {onFolderUpload && <button type="button" className="tcloud-context-item" onClick={run(onFolderUpload)}><FolderUp className="h-4 w-4" /><span>Enviar pasta</span></button>}
      {onPaste && <button type="button" className="tcloud-context-item" onClick={run(onPaste)}><ClipboardPaste className="h-4 w-4" /><span>Colar</span><kbd>Ctrl+V</kbd></button>}
      {onRefresh && <><div className="tcloud-context-separator" /><button type="button" className="tcloud-context-item" onClick={run(onRefresh)}><RefreshCw className="h-4 w-4" /><span>Atualizar</span></button></>}
    </div>
  );
}
