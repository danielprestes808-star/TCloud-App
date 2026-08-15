import { Cloud, ShieldCheck } from 'lucide-react';

interface BrandSplashProps {
  message?: string;
}

export function BrandSplash({ message = 'Preparando sua nuvem pessoal…' }: BrandSplashProps) {
  return (
    <main className="tcloud-brand-splash" aria-live="polite" aria-busy="true">
      <div className="tcloud-brand-splash-card">
        <div className="tcloud-brand-splash-mark" aria-hidden="true">
          <span className="tcloud-brand-splash-halo" />
          <img src="/logo.svg" alt="" />
        </div>
        <div className="tcloud-brand-splash-copy">
          <strong>TCloud</strong>
          <span>Personal Cloud</span>
        </div>
        <div className="tcloud-brand-splash-progress" aria-hidden="true">
          <i />
        </div>
        <p>{message}</p>
        <div className="tcloud-brand-splash-trust" aria-hidden="true">
          <span><Cloud className="h-3 w-3" /> Telegram</span>
          <span><ShieldCheck className="h-3 w-3" /> Privado</span>
        </div>
      </div>
    </main>
  );
}
