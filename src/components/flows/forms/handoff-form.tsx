"use client";

// Handoff node settings with sector routing — docs/saas/setores-e-distribuicao.md.
// The node sends the lead to a sector (fixed, or the sector whose name is
// in a flow variable) where it is distributed among the agents, or queued
// with a one-time message. Without a sector it behaves as before.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import type { HandoffNodeConfig } from "@/lib/flows/types";
import { TextRow } from "./fields";

type Mode = "none" | "fixed" | "variable";

const selectClass =
  "block h-8 w-full rounded-md border border-input bg-muted px-2 text-sm";

export function HandoffForm({
  cfg,
  onUpdateConfig,
}: {
  cfg: HandoffNodeConfig;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations("Flows.builder.form.handoff");
  const tf = useTranslations("Flows.builder.form");
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("sectors")
        .select("id, name")
        .order("name", { ascending: true });
      if (!cancelled) setSectors(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mode: Mode = cfg.sector_id ? "fixed" : cfg.sector_var !== undefined ? "variable" : "none";

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("routeTo")}</label>
        <select
          value={mode}
          className={selectClass}
          onChange={(e) => {
            const next = e.target.value as Mode;
            onUpdateConfig({
              sector_id: next === "fixed" ? sectors[0]?.id : undefined,
              sector_var: next === "variable" ? "" : undefined,
            });
          }}
        >
          <option value="none">{t("modeNone")}</option>
          <option value="fixed">{t("modeFixed")}</option>
          <option value="variable">{t("modeVariable")}</option>
        </select>
      </div>

      {mode === "fixed" && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("sector")}</label>
          {sectors.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noSectors")}</p>
          ) : (
            <select
              value={cfg.sector_id ?? ""}
              className={selectClass}
              onChange={(e) => onUpdateConfig({ sector_id: e.target.value })}
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {mode === "variable" && (
        <TextRow
          label={t("variable")}
          value={cfg.sector_var ?? ""}
          onChange={(v) => onUpdateConfig({ sector_var: v })}
        />
      )}

      {mode !== "none" && (
        <>
          <TextRow
            label={t("queueMessage")}
            value={cfg.queue_message ?? ""}
            onChange={(v) => onUpdateConfig({ queue_message: v })}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">{t("queueMessageHint")}</p>
          <p className="text-xs text-muted-foreground">{t("distributionHint")}</p>
        </>
      )}

      <TextRow
        label={tf("internalNote")}
        value={cfg.note ?? ""}
        onChange={(v) => onUpdateConfig({ note: v })}
        rows={2}
      />
    </div>
  );
}
