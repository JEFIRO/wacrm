"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { billingAccess, type BillingAccess, type Subscription } from "@/lib/billing/plan";

/**
 * The account's billing access on the client (docs/saas/b1-planos.md):
 * full, limited or blocked. Null while loading. The server enforces it
 * on its own (send core, campaigns, numbers, invites, AI) — this is for
 * the warning banner and the blocked screen.
 */
export function useBillingAccess(): BillingAccess | null {
  const { accountId } = useAuth();
  const [access, setAccess] = useState<BillingAccess | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("account_subscriptions")
        .select("plan_id, status, trial_ends_at, current_period_end, extra_users")
        .eq("account_id", accountId)
        .maybeSingle();
      if (!cancelled) setAccess(billingAccess((data as Subscription | null) ?? null, new Date()));
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return access;
}
