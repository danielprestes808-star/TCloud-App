import { FolderOpen, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui';

interface EmptyStateProps {
    onUpload: () => void;
}

export function EmptyState({ onUpload }: EmptyStateProps) {
    const { t } = useTranslation();

    return (
        <div className="tcloud-empty-state tcloud-empty-state-114 flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
            <div className="tcloud-empty-state-icon" aria-hidden="true">
                <FolderOpen className="h-7 w-7" strokeWidth={1.55} />
            </div>

            <h3>Nenhum item nesta pasta</h3>
            <p>Arraste arquivos para cá, use <strong>Upload</strong> ou crie uma nova pasta para começar.</p>

            <Button
                variant="secondary"
                onClick={onUpload}
                leadingIcon={<UploadCloud className="h-3.5 w-3.5" />}
                className="tcloud-empty-upload"
            >
                {t('common.upload_file')}
            </Button>

            <span className="tcloud-empty-state-hint">Dica: Ctrl + F pesquisa na pasta atual</span>
        </div>
    );
}
