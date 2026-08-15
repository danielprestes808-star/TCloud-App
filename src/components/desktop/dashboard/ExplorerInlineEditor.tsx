import { useEffect, useRef } from 'react';
import { Check, FolderPlus, Pencil, X } from 'lucide-react';

interface ExplorerInlineEditorProps {
  mode: 'create' | 'rename';
  value: string;
  busy?: boolean;
  locationLabel?: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
}

export function ExplorerInlineEditor({
  mode,
  value,
  busy = false,
  locationLabel,
  onChange,
  onSubmit,
  onCancel,
}: ExplorerInlineEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (mode === 'rename') {
      const dot = value.lastIndexOf('.');
      const end = dot > 0 ? dot : value.length;
      input.setSelectionRange(0, end);
    } else {
      input.select();
    }
  }, [mode]);

  return (
    <div className="tcloud-inline-editor" role="group" aria-label={mode === 'create' ? 'Criar nova pasta' : 'Renomear item'}>
      <div className="tcloud-inline-editor-icon">
        {mode === 'create' ? <FolderPlus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="tcloud-inline-editor-title">
          {mode === 'create' ? 'Nova pasta' : 'Renomear'}
          {locationLabel ? <span> em {locationLabel}</span> : null}
        </div>
        <input
          ref={inputRef}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void onSubmit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          aria-label={mode === 'create' ? 'Nome da nova pasta' : 'Novo nome'}
        />
      </div>
      <button type="button" className="tcloud-inline-editor-action is-confirm" onMouseDown={(event) => event.preventDefault()} onClick={() => void onSubmit()} disabled={busy || !value.trim()} title="Confirmar">
        <Check className="h-4 w-4" />
      </button>
      <button type="button" className="tcloud-inline-editor-action" onMouseDown={(event) => event.preventDefault()} onClick={onCancel} disabled={busy} title="Cancelar">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
