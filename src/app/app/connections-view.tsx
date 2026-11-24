"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Badge,
  Search,
  ListGroup,
  ListRow,
  SidePanel,
} from "@/components/ui";
import {
  SERVICES,
  AI_SERVICES,
  type ServiceId,
  type TeamKey,
} from "@/lib/connections";
import { PROVIDERS, type Provider } from "@/lib/ai";
import { AUTO } from "@/lib/ai-models";
import { supabaseBrowser } from "@/lib/supabase/client";
import { askConfirm } from "@/components/dialog";
import { EXTENSION, storeUrl } from "@/lib/site";
import McpView from "./mcp-view";
import Webhooks from "./webhooks-card";
import type { Account } from "./shell";

type Acct = Account | null;
type Model = { id: string; label: string };

interface ConnectionItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  washIndex: 1 | 2 | 3 | 4 | 5 | 6;
  actionType: "panel" | "link" | "extension";
  btnLabel?: string;
  onClick?: () => void;
}

const EXTENSION_IDS = [EXTENSION.storeId, EXTENSION.devId].filter(Boolean);
type ExtReply = { ok: boolean; version?: string; connected?: boolean; team?: string; email?: string; error?: string };

function askOne(id: string, msg: object): Promise<ExtReply | null> {
  return new Promise((resolve) => {
    const rt = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (id: string, m: object, cb: (r: ExtReply) => void) => void; lastError?: unknown } } }).chrome?.runtime;
    if (!rt?.sendMessage) return resolve(null);
    try { rt.sendMessage(id, msg, (r) => resolve(rt.lastError ? null : r ?? null)); } catch { resolve(null); }
    setTimeout(() => resolve(null), 2500);
  });
}

async function askExtension(msg: object): Promise<ExtReply | null> {
  for (const id of EXTENSION_IDS) { const r = await askOne(id, msg); if (r) return r; }
  return null;
}

export interface ConnectionsViewProps {
  account: Acct;
  email: string;
  demo: boolean;
  toast: (t: string) => void;
  go?: (view: string, tab?: string) => void;
}

export default function ConnectionsView({
  account,
  email,
  demo,
  toast,
  go,
}: ConnectionsViewProps) {
  const [search, setSearch] = useState("");
  const [savedKeys, setSavedKeys] = useState<TeamKey[]>([]);
  const [mailboxCount, setMailboxCount] = useState<number>(0);
  const [webhookCount, setWebhookCount] = useState<number>(0);
  const [extStatus, setExtStatus] = useState<ExtReply | null | undefined>(undefined);
  const [extBusy, setExtBusy] = useState(false);
  const [extMsg, setExtMsg] = useState("");
  const [selectedService, setSelectedService] = useState<string | null>(null);

  // Key editing inside SidePanel
  const [panelKeyValue, setPanelKeyValue] = useState("");
  const [panelBusy, setPanelBusy] = useState("");

  // AI models & Advanced section
  const [models, setModels] = useState<Partial<Record<ServiceId, Model[]>>>({});
  const [ai, setAi] = useState<{ provider: Provider; model: string } | null>(null);
  const [aiDraft, setAiDraft] = useState<{ provider: Provider; model: string } | null>(null);
  const [advOpen, setAdvOpen] = useState(false);

  const manage = Boolean(account && ["owner", "manager"].includes(account.role));
  const editable = Boolean(account && account.role !== "viewer");

  // Load real data
  const load = useCallback(async () => {
    if (demo || !account) {
      setSavedKeys([]);
      setMailboxCount(0);
      setWebhookCount(0);
      setExtStatus(null);
      setAi({ provider: "anthropic", model: AUTO });
      return;
    }

    const sb = supabaseBrowser();
    const [k, t, mb, wh, ext] = await Promise.all([
      sb.rpc("list_team_keys"),
      sb.from("team_ai").select("provider,model").maybeSingle(),
      sb.from("mailboxes").select("id").eq("team_id", account.team_id),
      sb.from("team_webhooks").select("id").eq("team_id", account.team_id),
      askExtension({ type: "kestrel-ping" }),
    ]);

    setSavedKeys((k.data as TeamKey[] | null) ?? []);
    const cur = (t.data as { provider: Provider; model: string } | null) ?? { provider: "anthropic" as Provider, model: AUTO };
    setAi(cur);
    setMailboxCount((mb.data as { id: string }[] | null)?.length ?? 0);
    setWebhookCount((wh.data as { id: string }[] | null)?.length ?? 0);
    setExtStatus(ext);
  }, [account, demo]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const draft = aiDraft ?? ai;
  const connectedAi = AI_SERVICES.filter((x) => savedKeys.some((k) => k.service === x));
  const listed: Model[] = draft ? (models[draft.provider as ServiceId] ?? PROVIDERS[draft.provider].models.map((m) => ({ id: m.id, label: m.label }))) : [];
  const modelList: Model[] = draft?.provider === "anthropic" && !listed.some((m) => m.id === AUTO)
    ? [{ id: AUTO, label: "Auto by job (Haiku 5.5 judges, Sonnet 5.5 writes)" }, ...listed]
    : listed;

  async function saveAi() {
    if (!draft || !account) return;
    if (demo) { toast("Saving needs a signed-in team."); return; }
    const { error } = await supabaseBrowser().from("team_ai").upsert({
      team_id: account.team_id,
      provider: draft.provider,
      model: draft.model.trim(),
      updated_at: new Date().toISOString(),
    });
    if (error) { toast(error.message); return; }
    setAi(draft);
    setAiDraft(null);
    toast(`Score and write now uses ${SERVICES[draft.provider as ServiceId].name} · ${draft.model === AUTO ? "Auto by job" : draft.model}.`);
  }

  // Key operations for SidePanel
  async function testKey(id: ServiceId) {
    if (demo) { toast("Testing needs a signed-in team."); return; }
    setPanelBusy("test");
    const r = await fetch("/api/connections/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: id }),
    }).then((x) => x.json()).catch(() => ({ error: "No connection. Try again." })) as { ok?: boolean; note?: string; models?: Model[]; error?: string };
    setPanelBusy("");
    if (r.error) { toast(r.error); return; }
    if (r.models?.length) setModels((x) => ({ ...x, [id]: r.models }));
    toast(r.note || (r.ok ? "Working." : "Not working."));
    await load();
  }

  async function saveKey(id: ServiceId) {
    const v = panelKeyValue.trim();
    if (v.length < 8) { toast("That does not look like a key. Copy the whole key."); return; }
    if (demo) { toast("Saving needs a signed-in team."); return; }
    setPanelBusy("save");
    const { error } = await supabaseBrowser().rpc("set_team_key", { service: id, value: v });
    setPanelBusy("");
    if (error) { toast(error.message); return; }
    setPanelKeyValue("");
    toast("Key saved. Running test…");
    await testKey(id);
    await load();
  }

  async function removeKey(id: ServiceId) {
    const s = SERVICES[id];
    if (demo || !await askConfirm(`Remove your ${s.name} key? It stops being used at once.`)) return;
    setPanelBusy("remove");
    const { error } = await supabaseBrowser().rpc("remove_team_key", { service: id });
    setPanelBusy("");
    if (error) { toast(error.message); return; }
    toast(`${s.name} key removed.`);
    await load();
  }

  // Extension connect handler
  async function connectExtension() {
    setExtBusy(true); setExtMsg("");
    try {
      const here = await askExtension({ type: "kestrel-ping" });
      if (!here) {
        setExtMsg("Extension not detected. Make sure it is installed and enabled.");
        return;
      }
      const makeKey = async () => {
        const { data, error } = await supabaseBrowser().rpc("create_extension_key", { label: "Chrome extension" });
        if (error || !data) throw new Error(error?.message || "Could not generate key");
        return data as { key: string; team_id: string; team_name: string };
      };
      const keyData = await makeKey();
      const reply = await askExtension({ type: "kestrel-connect", ...keyData });
      if (reply?.ok) {
        setExtMsg("Connected! Leads collected in your browser will now sync.");
        load();
      } else {
        setExtMsg(`Extension error: ${reply?.error || "no response"}`);
      }
    } catch (e) {
      setExtMsg((e as Error).message);
    } finally {
      setExtBusy(false);
    }
  }

  // Items definition matching reference groups
  const findLeadsItems: ConnectionItem[] = [
    {
      id: "extension",
      name: "Chrome extension",
      description: "Collect leads from LinkedIn and Google Maps",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5h8.5M8.97 13.75L4.7 6.35M15.03 13.75l-4.27 7.2" />
        </svg>
      ),
      washIndex: 1 as const,
      actionType: "panel",
    },
    {
      id: "hunter",
      name: "Hunter",
      description: "Find and verify email addresses",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
        </svg>
      ),
      washIndex: 2 as const,
      actionType: "panel",
    },
    {
      id: "apollo",
      name: "Apollo",
      description: "Work emails when Hunter finds none",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4" />
        </svg>
      ),
      washIndex: 3 as const,
      actionType: "panel",
    },
    {
      id: "findymail",
      name: "Findymail",
      description: "Finds verified emails when Hunter and Apollo find none",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
        </svg>
      ),
      washIndex: 4 as const,
      actionType: "panel",
    },
    {
      id: "companiesHouse",
      name: "Companies House",
      description: "UK companies and their directors",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 21h18M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7H3l2-4h14l2 4" />
        </svg>
      ),
      washIndex: 5 as const,
      actionType: "panel",
    },
    {
      id: "listenNotes",
      name: "Listen Notes",
      description: "Podcast search to find podcasts and their hosts",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      ),
      washIndex: 6 as const,
      actionType: "panel",
    },
  ];

  const sendAndTrackItems: ConnectionItem[] = [
    {
      id: "emailAccounts",
      name: "Email accounts",
      description: "Sending mailboxes, warming, and deliverability",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 17H2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2z" /><polyline points="22 4 12 13 2 4" />
        </svg>
      ),
      washIndex: 4 as const,
      actionType: "link",
      onClick: () => go?.("settings", "mailboxes"),
    },
    {
      id: "hubspot",
      name: "HubSpot",
      description: "Interested leads become contacts and deals",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
        </svg>
      ),
      washIndex: 5 as const,
      actionType: "panel",
    },
    {
      id: "pipedrive",
      name: "Pipedrive",
      description: "Interested leads become people, organisations and deals",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v12M12 12h4a3 3 0 0 0 0-6h-4" />
        </svg>
      ),
      washIndex: 6 as const,
      actionType: "panel",
    },
    {
      id: "webhooks",
      name: "Webhooks",
      description: "Send Kestrel events to Zapier, Make, n8n, or your server",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1M6 8H5a4 4 0 0 0 0 8h1M2 12h20" />
        </svg>
      ),
      washIndex: 1 as const,
      actionType: "panel",
    },
  ];

  const useElsewhereItems: ConnectionItem[] = [
    {
      id: "mcp",
      name: "Kestrel MCP",
      description: "Use your Kestrel data in Claude or Codex",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
        </svg>
      ),
      washIndex: 5 as const,
      btnLabel: "Set up",
      actionType: "panel",
    },
    {
      id: "aiKit",
      name: "AI Kit",
      description: "Score leads and write emails with your Claude Code plan",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
      washIndex: 2 as const,
      btnLabel: "Set up",
      actionType: "panel",
    },
  ];

  const q = search.trim().toLowerCase();
  const filterList = (list: typeof findLeadsItems) =>
    list.filter((item) => !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));

  const filteredFindLeads = filterList(findLeadsItems);
  const filteredSendAndTrack = filterList(sendAndTrackItems);
  const filteredUseElsewhere = filterList(useElsewhereItems);

  function renderItemAction(item: {
    id: string;
    btnLabel?: string;
    actionType?: string;
    onClick?: () => void;
  }) {
    // 1. Chrome extension: real status only
    if (item.id === "extension") {
      if (extStatus?.connected) {
        return <Badge variant="connected">Connected</Badge>;
      }
      return (
        <Button
          variant="solid"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedService("extension");
          }}
        >
          Install
        </Button>
      );
    }

    // 2. Email accounts
    if (item.id === "emailAccounts") {
      if (mailboxCount > 0) {
        return <Badge variant="connected">Connected</Badge>;
      }
      return (
        <Button
          variant="solid"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go?.("settings", "mailboxes");
          }}
        >
          Set up
        </Button>
      );
    }

    // 3. Webhooks: show Connected when at least one webhook exists
    if (item.id === "webhooks") {
      if (webhookCount > 0) {
        return <Badge variant="connected">Connected</Badge>;
      }
      return (
        <Button
          variant="solid"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedService("webhooks");
          }}
        >
          Connect
        </Button>
      );
    }

    // 4. Kestrel MCP
    if (item.id === "mcp") {
      return (
        <Button
          variant="solid"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedService("mcp");
          }}
        >
          Set up
        </Button>
      );
    }

    // 5. AI Kit
    if (item.id === "aiKit") {
      return (
        <Button
          variant="solid"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedService("aiKit");
          }}
        >
          Set up
        </Button>
      );
    }

    // 6. Key-backed services (Hunter, Apollo, Findymail, Companies House, Listen Notes, HubSpot, Pipedrive)
    const keyData = savedKeys.find((k) => k.service === item.id);
    if (keyData) {
      if (keyData.check_ok === true) {
        return <Badge variant="connected">Connected</Badge>;
      }
      if (keyData.check_ok === null) {
        return <Badge variant="untested">Saved, not tested</Badge>;
      }
      if (keyData.check_ok === false) {
        return <Badge variant="error">Key not working</Badge>;
      }
    }

    return (
      <Button
        variant="solid"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedService(item.id);
        }}
      >
        {item.btnLabel || "Connect"}
      </Button>
    );
  }

  // Current active service for SidePanel
  const activeKeyData = selectedService && (selectedService in SERVICES) ? savedKeys.find((k) => k.service === selectedService) : null;
  const activeServiceDef = selectedService && (selectedService in SERVICES) ? SERVICES[selectedService as ServiceId] : null;

  return (
    <>
      <h1 style={{ margin: "0 0 4px", fontSize: "24px", fontWeight: 600, lineHeight: 1.2 }}>Connections</h1>
      <p style={{ margin: "0 0 24px", color: "var(--u-text-secondary)", fontSize: "15px" }}>
        Tools that work with Kestrel. Kestrel AI is included, no setup needed.
      </p>

      <div style={{ maxWidth: 480, marginBottom: 32 }}>
        <Search
          placeholder="Search connections"
          aria-label="Search connections"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredFindLeads.length > 0 && (
        <ListGroup label="Find leads">
          {filteredFindLeads.map((item) => (
            <ListRow
              key={item.id}
              washIndex={item.washIndex}
              icon={item.icon}
              name={item.name}
              description={item.description}
              action={renderItemAction(item)}
              clickable
              onClick={() => {
                if (item.id === "extension") {
                  setSelectedService("extension");
                } else {
                  setSelectedService(item.id);
                }
              }}
            />
          ))}
        </ListGroup>
      )}

      {filteredSendAndTrack.length > 0 && (
        <ListGroup label="Send and track">
          {filteredSendAndTrack.map((item) => (
            <ListRow
              key={item.id}
              washIndex={item.washIndex}
              icon={item.icon}
              name={item.name}
              description={item.description}
              action={renderItemAction(item)}
              clickable
              onClick={() => {
                if (item.actionType === "link" && item.onClick) {
                  item.onClick();
                } else {
                  setSelectedService(item.id);
                }
              }}
            />
          ))}
        </ListGroup>
      )}

      {filteredUseElsewhere.length > 0 && (
        <ListGroup label="Use Kestrel elsewhere">
          {filteredUseElsewhere.map((item) => (
            <ListRow
              key={item.id}
              washIndex={item.washIndex}
              icon={item.icon}
              name={item.name}
              description={item.description}
              action={renderItemAction(item)}
              clickable
              onClick={() => setSelectedService(item.id)}
            />
          ))}
        </ListGroup>
      )}

      {/* Advanced Row Collapsible */}
      <div style={{ marginTop: 28, marginBottom: 40 }}>
        <button
          className="adv u-adv"
          type="button"
          aria-expanded={advOpen}
          onClick={() => setAdvOpen(!advOpen)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            height: "36px",
            padding: "0 16px 0 12px",
            borderRadius: "9999px",
            border: "1px solid var(--u-border)",
            background: "var(--u-btn-bg, #ffffff)",
            color: "var(--u-text)",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              transform: advOpen ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          Advanced: use your own AI key
        </button>

        {advOpen && (
          <div
            style={{
              marginTop: 16,
              padding: "20px 24px",
              borderRadius: "16px",
              border: "1px solid var(--u-border)",
              background: "var(--u-panel)",
              maxWidth: 640,
            }}
          >
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: "var(--u-text-secondary)" }}>
              Kestrel AI is included with your plan. If you prefer to score leads and write emails with your own key, configure your AI provider below.
            </p>

            {/* AI Provider selection & Model configuration */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: 6 }}>
                  AI company
                </label>
                <select
                  value={draft?.provider || "anthropic"}
                  disabled={!editable}
                  onChange={(e) => {
                    const p = e.target.value as Provider;
                    setAiDraft({
                      provider: p,
                      model: p === "anthropic" ? AUTO : (models[p as ServiceId]?.[0]?.id) ?? PROVIDERS[p].models[0]?.id ?? "",
                    });
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "9999px",
                    border: "1px solid var(--u-border)",
                    padding: "0 14px",
                    background: "var(--u-row, #fff)",
                    color: "var(--u-text)",
                    fontSize: "14px",
                  }}
                >
                  {AI_SERVICES.map((id) => (
                    <option key={id} value={id}>
                      {SERVICES[id].name}{connectedAi.includes(id) ? " (connected)" : " (no key yet)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 500, marginBottom: 6 }}>
                  Model (advanced)
                </label>
                {modelList.length ? (
                  <select
                    value={modelList.some((m) => m.id === draft?.model) ? draft?.model : ""}
                    disabled={!editable}
                    onChange={(e) => draft && setAiDraft({ ...draft, model: e.target.value })}
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "9999px",
                      border: "1px solid var(--u-border)",
                      padding: "0 14px",
                      background: "var(--u-row, #fff)",
                      color: "var(--u-text)",
                      fontSize: "14px",
                    }}
                  >
                    {modelList.some((m) => m.id === draft?.model) ? null : <option value="">{draft?.model || "Choose a model"}</option>}
                    {modelList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                ) : (
                  <input
                    value={draft?.model || ""}
                    disabled={!editable}
                    onChange={(e) => draft && setAiDraft({ ...draft, model: e.target.value })}
                    placeholder="Test key to load models"
                    style={{
                      width: "100%",
                      height: "38px",
                      borderRadius: "9999px",
                      border: "1px solid var(--u-border)",
                      padding: "0 14px",
                      background: "var(--u-row, #fff)",
                      color: "var(--u-text)",
                      fontSize: "14px",
                    }}
                  />
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <Button
                  variant="primary"
                  type="button"
                  disabled={!editable || !aiDraft || !draft?.model.trim()}
                  onClick={saveAi}
                >
                  Save selection
                </Button>
                {draft && (
                  <Button
                    variant="default"
                    type="button"
                    onClick={() => setSelectedService(draft.provider)}
                  >
                    Manage {SERVICES[draft.provider as ServiceId].name} key
                  </Button>
                )}
              </div>
            </div>

            {/* List of AI Keys */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--u-border)" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--u-text-muted)", marginBottom: 12 }}>
                AI Keys
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {AI_SERVICES.map((id) => {
                  const s = SERVICES[id];
                  const saved = savedKeys.find((k) => k.service === id);
                  return (
                    <div
                      key={id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: "12px",
                        border: "1px solid var(--u-border)",
                        background: "var(--u-row, #fff)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 500 }}>{s.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--u-text-secondary)" }}>
                          {saved ? `Key ····${saved.last4}` : "No key connected"}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {saved && <Badge variant="connected">Connected</Badge>}
                        <Button
                          variant="solid"
                          type="button"
                          onClick={() => setSelectedService(id)}
                        >
                          {saved ? "Manage" : "Connect"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SidePanel for Service Details & Actions */}
      <SidePanel
        open={Boolean(selectedService)}
        onClose={() => {
          setSelectedService(null);
          setPanelKeyValue("");
        }}
        title={
          selectedService === "extension"
            ? "Chrome Extension"
            : selectedService === "webhooks"
            ? "Webhooks"
            : selectedService === "mcp"
            ? "Kestrel MCP"
            : selectedService === "aiKit"
            ? "Kestrel AI Kit"
            : activeServiceDef?.name || "Service Details"
        }
        description={
          selectedService === "extension"
            ? "Collect leads directly from LinkedIn, Sales Navigator, and Google Maps."
            : selectedService === "webhooks"
            ? "Send events to Zapier, Make, n8n, or your webhook server."
            : selectedService === "mcp"
            ? "Connect Claude Desktop, Claude Code, or Codex to your Kestrel account."
            : selectedService === "aiKit"
            ? "Score leads and write emails with Claude Code without account keys."
            : activeServiceDef?.use || ""
        }
      >
        {selectedService === "extension" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ padding: 14, borderRadius: 12, background: "var(--u-selected)", border: "1px solid var(--u-border)" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: 4 }}>Status</div>
              <div style={{ fontSize: "13px", color: "var(--u-text-secondary)" }}>
                {extStatus === undefined
                  ? "Checking browser extension…"
                  : extStatus?.connected
                  ? `Connected · version ${extStatus.version || "latest"}`
                  : extStatus
                  ? `Installed (version ${extStatus.version}) · ready to link`
                  : "Not detected in this browser."}
              </div>
            </div>

            {extMsg && (
              <div style={{ padding: 10, borderRadius: 8, background: "var(--u-selected)", fontSize: "13px" }}>
                {extMsg}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {extStatus?.connected ? (
                <Badge variant="connected" style={{ alignSelf: "flex-start" }}>Connected</Badge>
              ) : (
                <>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={extBusy || !editable}
                    onClick={connectExtension}
                  >
                    {extBusy ? "Connecting…" : "Connect Extension"}
                  </Button>
                  <a
                    href={storeUrl() || "/app/download/extension"}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none" }}
                  >
                    <Button variant="default" type="button" style={{ width: "100%" }}>
                      Install Extension
                    </Button>
                  </a>
                </>
              )}
            </div>
          </div>
        ) : selectedService === "webhooks" ? (
          <Webhooks manage={manage} demo={demo} toast={toast} />
        ) : selectedService === "mcp" || selectedService === "aiKit" ? (
          <McpView account={account} email={email} demo={demo} toast={toast} />
        ) : activeServiceDef ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {activeKeyData ? (
              <div style={{ padding: "14px 16px", borderRadius: 12, background: "var(--u-selected)", border: "1px solid var(--u-border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>Status</span>
                  {activeKeyData.check_ok === true ? (
                    <Badge variant="connected">Connected</Badge>
                  ) : activeKeyData.check_ok === null ? (
                    <Badge variant="untested">Saved, not tested</Badge>
                  ) : (
                    <Badge variant="error">Key not working</Badge>
                  )}
                </div>
                <div style={{ fontSize: "13px", color: "var(--u-text-secondary)" }}>
                  Key ending in <b>····{activeKeyData.last4}</b>
                </div>
                {activeKeyData.check_note && (
                  <div style={{ marginTop: 8, fontSize: "12px", color: "var(--u-text-muted)" }}>
                    {activeKeyData.check_note}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "14px", color: "var(--u-text-secondary)" }}>
                No key connected yet. Add your key from {activeServiceDef.name} to connect.
              </p>
            )}

            {manage && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontSize: "13px", fontWeight: 500 }}>
                  {activeKeyData ? "Replace API Key" : "Paste API Key"}
                </label>
                <input
                  type="password"
                  placeholder={`Paste your ${activeServiceDef.name} key (${activeServiceDef.looks})`}
                  value={panelKeyValue}
                  onChange={(e) => setPanelKeyValue(e.target.value)}
                  style={{
                    width: "100%",
                    height: "40px",
                    borderRadius: "9999px",
                    border: "1px solid var(--u-border)",
                    padding: "0 16px",
                    background: "var(--u-row, #fff)",
                    color: "var(--u-text)",
                    fontSize: "14px",
                    boxSizing: "border-box",
                  }}
                />
                <Button
                  variant="primary"
                  type="button"
                  disabled={panelBusy !== "" || !panelKeyValue.trim()}
                  onClick={() => saveKey(selectedService as ServiceId)}
                >
                  {panelBusy === "save" ? "Saving…" : "Save and test"}
                </Button>
              </div>
            )}

            {activeKeyData && manage && (
              <div style={{ display: "flex", gap: 10, paddingTop: 12, borderTop: "1px solid var(--u-border)" }}>
                <Button
                  variant="default"
                  type="button"
                  disabled={panelBusy !== ""}
                  onClick={() => testKey(selectedService as ServiceId)}
                >
                  {panelBusy === "test" ? "Testing…" : "Test Key"}
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  disabled={panelBusy !== ""}
                  onClick={() => removeKey(selectedService as ServiceId)}
                >
                  Remove Key
                </Button>
              </div>
            )}

            <div style={{ paddingTop: 16, borderTop: "1px solid var(--u-border)", fontSize: "13px" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>How to get a key</div>
              <p style={{ margin: "0 0 10px", color: "var(--u-text-secondary)", lineHeight: 1.5 }}>
                {activeServiceDef.how}
              </p>
              <a
                href={activeServiceDef.keyUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--u-accent)", textDecoration: "none", fontWeight: 500 }}
              >
                Get a key on {activeServiceDef.maker} →
              </a>
            </div>
          </div>
        ) : null}
      </SidePanel>
    </>
  );
}
