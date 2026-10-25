"use client";

// Agent's own online/offline switch for lead distribution
// (docs/saas/setores-e-distribuicao.md). Online = working now; going
// offline sends unstarted leads back to the sector queue. Shown only to
// people in at least one sector — nobody else receives leads.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export function AvailabilityToggle() {
  const t = useTranslations("Header.availability");
  const { user, accountId } = useAuth();
  const [inSector, setInSector] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    const supabase = createClient();
    const [{ data: sectors }, { data: settings }] = await Promise.all([
      supabase.from("sector_members").select("sector_id").eq("user_id", user.id).limit(1),
      supabase.from("agent_settings").select("is_online").eq("user_id", user.id).maybeSingle(),
    ]);
    setInSector(!!sectors?.length);
    setOnline(settings?.is_online ?? false);
  }, [user, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!inSector) return null;

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/agents/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_online: !online }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setOnline(!online);
      toast.success(
        online
          ? data.requeued
            ? t("offlineRequeued", { count: data.requeued })
            : t("nowOffline")
          : t("nowOnline"),
      );
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={online}
      title={t("hint")}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-60",
        online
          ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-500"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      <span
        className={cn("size-2 rounded-full", online ? "bg-emerald-500" : "bg-muted-foreground/50")}
      />
      {online ? t("online") : t("offline")}
    </button>
  );
}
