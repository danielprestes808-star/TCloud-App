import { FolderOpen, UploadCloud, Star, Clock3, Music2, Images, CloudDownload, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';

interface EmptyStateProps { onUpload?: () => void; }

const virtualEmpty = {
    recent: ['Nenhum arquivo recente','Os arquivos abertos ou alterados recentemente aparecem aqui.',Clock3],
    favorites: ['Nenhum favorito','Marque um arquivo com estrela para encontra-lo rapidamente aqui.',Star],
    gallery: ['Nenhuma midia encontrada','Fotos e videos da sua biblioteca aparecem aqui automaticamente.',Images],
    music: ['Nenhuma musica encontrada','Arquivos de audio da sua biblioteca aparecem aqui automaticamente.',Music2],
    offline: ['Nenhum arquivo disponivel offline','Marque arquivos como disponiveis offline para acessa-los sem internet.',CloudDownload],
    vault: ['Cofre vazio','Arquivos protegidos aparecem aqui depois que o Cofre estiver desbloqueado.',LockKeyhole],
} as const;

export function EmptyState({ onUpload }: EmptyStateProps) {
    const { t } = useTranslation();
    const view = typeof document !== 'undefined' ? document.documentElement.dataset.tcloudRootView || 'folder' : 'folder';
    if (view === 'problems') return null;
    const copy = virtualEmpty[view as keyof typeof virtualEmpty];
    const Icon = copy?.[2] ?? FolderOpen;
    const canUpload = !copy && typeof onUpload === 'function';
    return (
        <div className="tcloud-empty-state tcloud-empty-state-114 flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
            <div className="tcloud-empty-state-icon" aria-hidden="true"><Icon className="h-7 w-7" strokeWidth={1.55}/></div>
            <h3>{copy?.[0] ?? 'Nenhum item nesta pasta'}</h3>
            <p>{copy?.[1] ?? 'Envie arquivos ou crie uma pasta para comecar.'}</p>
            {canUpload && <Button variant="secondary" onClick={onUpload} leadingIcon={<UploadCloud className="h-3.5 w-3.5"/>} className="tcloud-empty-upload">{t('common.upload_file')}</Button>}
            {!copy && <span className="tcloud-empty-state-hint">Dica: Ctrl + F pesquisa na pasta atual</span>}
        </div>
    );
}
