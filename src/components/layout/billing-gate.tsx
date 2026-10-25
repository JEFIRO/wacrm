'use client';

// ============================================================
// Billing banner and blocked screen — docs/saas/b1-planos.md.
// Limited (expired trial / overdue): a warning on every page with the
// block date. Blocked: the app is replaced by a "subscribe" screen,
// except Settings (to see the plan and pay).
// ============================================================
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBillingAccess } from '@/hooks/use-billing-access';
import { buttonVariants } from '@/components/ui/button';

const PLAN_URL = '/settings?tab=plan';

export function BillingGate({ children }: { children: ReactNode }) {
  const t = useTranslations('Billing');
  const access = useBillingAccess();
  const pathname = usePathname();

  if (access?.level === 'blocked' && !pathname.startsWith('/settings')) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
        <Lock className="size-10 text-destructive" />
        <h1 className="text-xl font-semibold">{t('blockedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('blockedBody')}</p>
        <Link href={PLAN_URL} className={buttonVariants()}>
          {t('subscribe')}
        </Link>
      </div>
    );
  }

  return (
    <>
      {access?.level === 'limited' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-500" />
          <p className="flex-1">
            {t(access.reason === 'past_due' ? 'limitedPastDue' : 'limitedTrial', {
              date: access.blocksAt?.toLocaleDateString() ?? '',
            })}
          </p>
          <Link href={PLAN_URL} className={buttonVariants({ size: 'sm' })}>
            {t('subscribe')}
          </Link>
        </div>
      )}
      {children}
    </>
  );
}
