'use client';

// What a QR-code (Evolution) account can't use, and why —
// docs/saas/w4-regras.md. Shown instead of the Meta-only screen.
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function QrAccountNotice({ feature }: { feature: 'templates' | 'broadcasts' }) {
  const t = useTranslations('QrAccountNotice');
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(`${feature}.title`)}</p>
        <p className="text-sm text-muted-foreground">{t(`${feature}.body`)}</p>
      </div>
    </div>
  );
}
