"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AccountProviderKind = "meta" | "evolution";

/**
 * How the account talks to WhatsApp — one kind per account (migration
 * 067, docs/saas/w4-regras.md). QR-code (Evolution) accounts have no 24h
 * window and no templates. Null while loading or with no number yet.
 */
export function useAccountProvider(): AccountProviderKind | null {
  const { accountId } = useAuth();
  const [kind, setKind] = useState<AccountProviderKind | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("whatsapp_config")
        .select("provider")
        .eq("account_id", accountId)
        .order("is_default", { ascending: false })
        .limit(1);
      const value = (data?.[0] as { provider?: string } | undefined)?.provider;
      if (!cancelled) setKind(value === "meta" || value === "evolution" ? value : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return kind;
}
