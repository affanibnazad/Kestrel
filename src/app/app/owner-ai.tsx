"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, Input, Pill } from "@/ui";
import { AI_SLOTS, SLOT_PROVIDERS, type AiSlotId } from "@/lib/ai-slots";
import styles from "./owner-ai.module.css";

type SlotRow = {
  slot: AiSlotId;
  provider: string;
  base_url: string | null;
  model: string;
  secret_id: string | null;
  max_tokens: number | null;
  enabled: boolean;
  updated_at: string | null;
};

type SlotFormState = {
  provider: string;
  baseUrl: string;
  model: string;
  newKey: string;
  hasKey: boolean;
  enabled: boolean;
  models: { id: string; label: string }[];
  useFreeText: boolean;
  testing: boolean;
  loadingModels: boolean;
  saving: boolean;
  testResult?: { ok: boolean; text: string } | null;
};

type SlotStats = {
  slot: AiSlotId;
  runs: number;
  errors: number;
  avgMs: number;
  cost: number;
};

function defaultSlotState(): SlotFormState {
  return {
    provider: "groq",
    baseUrl: "",
    model: "",
    newKey: "",
    hasKey: false,
    enabled: true,
    models: [],
    useFreeText: false,
    testing: false,
    loadingModels: false,
    saving: false,
    testResult: null,
  };
}

export default function OwnerAi({
  toast,
  demo = false,
  onSlotsStatus,
}: {
  toast: (t: string) => void;
  demo?: boolean;
  onSlotsStatus?: (allConfigured: boolean) => void;
}) {
  const [slots, setSlots] = useState<Record<AiSlotId, SlotFormState>>({
    swift: defaultSlotState(),
    talon: defaultSlotState(),
    nest: defaultSlotState(),
  });
  const [stats, setStats] = useState<SlotStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      setStats([
        { slot: "swift", runs: 142, errors: 1, avgMs: 620, cost: 0.0124 },
        { slot: "talon", runs: 38, errors: 0, avgMs: 1180, cost: 0.0312 },
        { slot: "nest", runs: 2, errors: 0, avgMs: 840, cost: 0.0011 },
      ]);
      return;
    }

    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [slotsRes, runsRes] = await Promise.all([
        sb.from("ai_slots").select("slot,provider,base_url,model,secret_id,max_tokens,enabled,updated_at"),
        sb
          .from("ai_runs")
          .select("slot,status,ms,cost_usd")
          .gte("created_at", since)
          .limit(2000),
      ]);

      if (slotsRes.error) {
        if (/ai_slots|schema cache|does not exist/i.test(slotsRes.error.message)) {
          setMigrationMissing(true);
        } else {
          toast(slotsRes.error.message);
        }
        setLoading(false);
        return;
      }

      setMigrationMissing(false);
      const rows = (slotsRes.data ?? []) as SlotRow[];
      const next: Record<AiSlotId, SlotFormState> = {
        swift: defaultSlotState(),
        talon: defaultSlotState(),
        nest: defaultSlotState(),
      };

      for (const r of rows) {
        if (r.slot === "swift" || r.slot === "talon" || r.slot === "nest") {
          next[r.slot] = {
            ...next[r.slot],
            provider: r.provider || "groq",
            baseUrl: r.base_url || "",
            model: r.model || "",
            hasKey: Boolean(r.secret_id),
            enabled: r.enabled !== false,
            useFreeText: true,
          };
        }
      }
      setSlots(next);

      const allReady = (["swift", "talon", "nest"] as AiSlotId[]).every(
        (id) => next[id].hasKey && next[id].model.trim().length > 0 && next[id].enabled
      );
      onSlotsStatus?.(allReady);

      // Aggregate 24h ai_runs per slot
      const runRows = (runsRes.data ?? []) as {
        slot: string | null;
        status: string;
        ms: number;
        cost_usd: number | null;
      }[];
      const agg: Record<AiSlotId, { runs: number; errors: number; totalMs: number; cost: number }> = {
        swift: { runs: 0, errors: 0, totalMs: 0, cost: 0 },
        talon: { runs: 0, errors: 0, totalMs: 0, cost: 0 },
        nest: { runs: 0, errors: 0, totalMs: 0, cost: 0 },
      };
      for (const r of runRows) {
        if (r.slot === "swift" || r.slot === "talon" || r.slot === "nest") {
          const b = agg[r.slot];
          b.runs += 1;
          if (r.status === "error" || r.status === "timeout") b.errors += 1;
          b.totalMs += Number(r.ms || 0);
          b.cost += Number(r.cost_usd || 0);
        }
      }
      setStats(
        (["swift", "talon", "nest"] as AiSlotId[]).map((s) => ({
          slot: s,
          runs: agg[s].runs,
          errors: agg[s].errors,
          avgMs: agg[s].runs ? Math.round(agg[s].totalMs / agg[s].runs) : 0,
          cost: agg[s].cost,
        }))
      );
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to load AI slots.");
    } finally {
      setLoading(false);
    }
  }, [demo, toast, onSlotsStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchSlot(id: AiSlotId, patch: Partial<SlotFormState>) {
    setSlots((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function loadModels(id: AiSlotId) {
    const s = slots[id];
    patchSlot(id, { loadingModels: true });
    try {
      const res = await fetch("/api/owner/ai-slots/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slot: id,
          provider: s.provider,
          baseUrl: s.provider === "custom" ? s.baseUrl : undefined,
          key: s.newKey.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        models?: { id: string; label: string }[];
        error?: string;
      };
      if (!res.ok || json.error) {
        toast(json.error || "Could not load models. You can type the model name manually.");
        patchSlot(id, { loadingModels: false, useFreeText: true });
        return;
      }
      const list = json.models || [];
      patchSlot(id, {
        loadingModels: false,
        models: list,
        useFreeText: list.length === 0,
        model: s.model || list[0]?.id || "",
      });
      toast(`Loaded ${list.length} models for ${id}.`);
    } catch {
      toast("Network error loading models.");
      patchSlot(id, { loadingModels: false, useFreeText: true });
    }
  }

  async function saveSlot(id: AiSlotId) {
    const s = slots[id];
    if (!s.model.trim()) {
      toast("Choose or type a model name.");
      return;
    }
    if (s.provider === "custom" && !/^https?:\/\//i.test(s.baseUrl.trim())) {
      toast("Enter a valid Base URL starting with http:// or https://.");
      return;
    }
    if (!s.hasKey && !s.newKey.trim()) {
      toast("Paste an API key before saving.");
      return;
    }

    patchSlot(id, { saving: true });
    try {
      const { error } = await supabaseBrowser().rpc("set_ai_slot", {
        p_slot: id,
        p_provider: s.provider,
        p_base_url: s.provider === "custom" ? s.baseUrl.trim() : null,
        p_model: s.model.trim(),
        p_new_key: s.newKey.trim() || null,
        p_enabled: s.enabled,
      });
      if (error) {
        toast(error.message);
        patchSlot(id, { saving: false });
        return;
      }
      patchSlot(id, { saving: false, newKey: "", hasKey: true });
      toast(`${AI_SLOTS.find((x) => x.id === id)?.name} slot saved.`);
      void load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to save slot.");
      patchSlot(id, { saving: false });
    }
  }

  async function testSlot(id: AiSlotId) {
    const s = slots[id];
    patchSlot(id, { testing: true, testResult: null });
    try {
      const res = await fetch("/api/owner/ai-slots/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slot: id,
          provider: s.provider,
          baseUrl: s.provider === "custom" ? s.baseUrl.trim() : undefined,
          model: s.model.trim() || undefined,
          key: s.newKey.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ms?: number;
        model?: string;
        error?: string;
      };
      if (json.ok) {
        patchSlot(id, {
          testing: false,
          testResult: { ok: true, text: `ok · ${json.ms} ms · ${json.model}` },
        });
      } else {
        patchSlot(id, {
          testing: false,
          testResult: { ok: false, text: json.error || "Test failed." },
        });
      }
      void load();
    } catch (err: unknown) {
      patchSlot(id, {
        testing: false,
        testResult: { ok: false, text: err instanceof Error ? err.message : "Network error." },
      });
    }
  }

  if (loading && !migrationMissing) {
    return <p className="plan-msg">Loading AI slots…</p>;
  }

  if (migrationMissing) {
    return (
      <Card className={styles.wrap}>
        <p className={styles.empty}>
          AI slots require database migration <code>077_ai_slots.sql</code>. Apply it first, then reload this page.
        </p>
      </Card>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        {AI_SLOTS.map((meta) => {
          const s = slots[meta.id];
          const preset = SLOT_PROVIDERS.find((p) => p.id === s.provider) ?? SLOT_PROVIDERS[0];
          const ready = s.hasKey && s.model.trim().length > 0 && s.enabled;

          return (
            <Card key={meta.id} className={styles.slotCard}>
              <div className={styles.cardHead}>
                <div>
                  <h2 className={styles.slotTitle}>
                    {meta.name} — {meta.role}
                  </h2>
                  <p className={styles.slotSub}>{meta.description}</p>
                </div>
                <Pill variant={ready ? "good" : "neutral"}>
                  {ready ? "Ready" : "Not set"}
                </Pill>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`slot-provider-${meta.id}`}>
                  AI company
                </label>
                <select
                  id={`slot-provider-${meta.id}`}
                  className={styles.select}
                  value={s.provider}
                  onChange={(e) =>
                    patchSlot(meta.id, {
                      provider: e.target.value,
                      models: [],
                      useFreeText: true,
                      testResult: null,
                    })
                  }
                >
                  {SLOT_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {s.provider === "custom" ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`slot-url-${meta.id}`}>
                    Base URL
                  </label>
                  <Input
                    id={`slot-url-${meta.id}`}
                    value={s.baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => patchSlot(meta.id, { baseUrl: e.target.value })}
                  />
                </div>
              ) : null}

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`slot-key-${meta.id}`}>
                  API key
                </label>
                <Input
                  id={`slot-key-${meta.id}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={s.newKey}
                  placeholder={s.hasKey ? "•••• saved (leave blank to keep)" : "Paste API key"}
                  onChange={(e) => patchSlot(meta.id, { newKey: e.target.value })}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={`slot-model-${meta.id}`}>
                  Model
                </label>
                <div className={styles.modelRow}>
                  <div className={styles.modelInputWrap}>
                    {s.models.length > 0 && !s.useFreeText ? (
                      <select
                        id={`slot-model-${meta.id}`}
                        className={styles.select}
                        value={s.models.some((m) => m.id === s.model) ? s.model : ""}
                        onChange={(e) => patchSlot(meta.id, { model: e.target.value })}
                      >
                        {!s.models.some((m) => m.id === s.model) && (
                          <option value="">{s.model || "Choose a model"}</option>
                        )}
                        {s.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={`slot-model-${meta.id}`}
                        value={s.model}
                        spellCheck={false}
                        placeholder={preset.placeholderModel}
                        onChange={(e) => patchSlot(meta.id, { model: e.target.value })}
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={s.loadingModels}
                    onClick={() => loadModels(meta.id)}
                  >
                    {s.loadingModels ? "Loading…" : "Load models"}
                  </Button>
                </div>
              </div>

              {s.testResult ? (
                <div
                  className={`${styles.testNote} ${s.testResult.ok ? styles.testOk : styles.testErr}`}
                  role="status"
                >
                  {s.testResult.text}
                </div>
              ) : null}

              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="main"
                  size="sm"
                  disabled={s.saving}
                  onClick={() => saveSlot(meta.id)}
                >
                  {s.saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={s.testing}
                  onClick={() => testSlot(meta.id)}
                >
                  {s.testing ? "Testing…" : "Test"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className={styles.statsCard}>
        <div className={styles.statsHead}>
          <h2 className={styles.statsTitle}>Last 24 hours by slot</h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => load()}>
            Refresh
          </Button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Runs</th>
                <th>Errors</th>
                <th>Avg ms</th>
                <th>Cost (USD)</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={row.slot}>
                  <td>{AI_SLOTS.find((x) => x.id === row.slot)?.name ?? row.slot}</td>
                  <td>{row.runs}</td>
                  <td>{row.errors}</td>
                  <td>{row.avgMs ? `${row.avgMs} ms` : "—"}</td>
                  <td>{row.cost ? `$${row.cost.toFixed(4)}` : "$0.0000"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
