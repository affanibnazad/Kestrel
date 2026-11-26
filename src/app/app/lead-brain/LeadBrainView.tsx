"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AudioLines,
  BrainCircuit,
  Briefcase,
  Compass,
  Cpu,
  ArrowUp,
  Eye,
  Gauge,
  GitMerge,
  Globe,
  Inbox,
  LayoutGrid,
  MailCheck,
  MapPin,
  MessageSquareText,
  Minus,
  PenLine,
  Play,
  Plus,
  Quote,
  Radar,
  Scan,
  ScanText,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import type { LeadRow } from "@/lib/leads";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  E,
  H,
  N,
  W,
  Z,
  defaultPositions,
  edgePath,
  isAiNode,
  nodeSize,
  type BrainEvent,
  type BrainLead,
  type BrainNodeDef,
} from "./graph";
import styles from "./lead-brain.module.css";

export type LeadBrainTheme = "auto" | "light" | "dark" | "gradient";

type Props = {
  teamId: string | null;
  userId?: string | null;
  isAdmin: boolean;
  editable: boolean;
  leads: LeadRow[];
  demo: boolean;
  onApproveLead: (leadId: string) => Promise<boolean>;
  /** The App's saved theme (Profile → Appearance). The Light / Dark / Gradient buttons change it for the whole App. */
  theme?: LeadBrainTheme;
  onTheme?: (theme: Exclude<LeadBrainTheme, "auto">) => void;
  /** Sends a question to Kestrel AI (opens the chat with it). */
  onAsk?: (question: string) => void;
};

// The fit leaves room for the HUD at the top and the legend + Ask bar at the bottom (same numbers as the concept's fit()).
const FIT_TOP = 120;
const FIT_BOTTOM = 140;
const FIT_SIDE = 40;
// The "leads here now" list shows this many rows; the count on the card is always the full number.
const PANEL_ROWS = 60;

type AgentNodeData = {
  def: BrainNodeDef;
  count: number;
  workingLabel: string | null;
  progressPct: number;
  isError: boolean;
  isFlash: boolean;
  isSelected: boolean;
  isTraced: boolean;
  isDimmed: boolean;
  ownerView: boolean;
  subtitle: string;
};

type BrainEdgeData = {
  isSub: boolean;
  isFlow: boolean;
  isTrace: boolean;
  isDim: boolean;
};

function NodeIcon({ name, size = 18 }: { name: string; size?: number }) {
  const props = { size, strokeWidth: 1.75, "aria-hidden": true as const };
  switch (name) {
    case "inbox":
      return <Inbox {...props} />;
    case "globe":
      return <Globe {...props} />;
    case "map-pin":
      return <MapPin {...props} />;
    case "share-2":
      return <Share2 {...props} />;
    case "youtube":
      return <Play {...props} />;
    case "briefcase":
      return <Briefcase {...props} />;
    case "git-merge":
      return <GitMerge {...props} />;
    case "radar":
      return <Radar {...props} />;
    case "scan-text":
      return <ScanText {...props} />;
    case "quote":
      return <Quote {...props} />;
    case "gauge":
      return <Gauge {...props} />;
    case "message-square-text":
      return <MessageSquareText {...props} />;
    case "user-check":
      return <UserCheck {...props} />;
    case "compass":
      return <Compass {...props} />;
    case "pen-line":
      return <PenLine {...props} />;
    case "shield-check":
      return <ShieldCheck {...props} />;
    case "mail-check":
      return <MailCheck {...props} />;
    case "send":
      return <Send {...props} />;
    case "zap":
      return <Zap {...props} />;
    case "sliders-horizontal":
      return <SlidersHorizontal {...props} />;
    case "cpu":
      return <Cpu {...props} />;
    case "audio-lines":
      return <AudioLines {...props} />;
    default:
      return <BrainCircuit {...props} />;
  }
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { def, count, workingLabel, progressPct, isError, isFlash, isSelected, isTraced, isDimmed, ownerView, subtitle } =
    data;
  const size = nodeSize(def);
  const ai = isAiNode(def);
  const isWait = def.k.includes("wait");
  const isDone = def.k.includes("done");

  const cls = [
    styles.node,
    size === "sm" ? styles.nodeSm : "",
    ai ? styles.nodeAi : "",
    isWait ? styles.nodeWait : "",
    isDone ? styles.nodeDone : "",
    workingLabel ? styles.working : "",
    isError ? styles.errorNode : "",
    isFlash ? styles.flashNode : "",
    isSelected ? styles.selected : "",
    isTraced ? styles.traced : "",
    isDimmed ? styles.dimmed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {def.id !== "new" ? (
        <Handle type="target" position={Position.Left} id="in" className={styles.handle} isConnectable={false} />
      ) : null}
      {def.id !== "camp" ? (
        <Handle type="source" position={Position.Right} id="out" className={styles.handle} isConnectable={false} />
      ) : null}
      {ai && ownerView ? (
        <Handle
          type="target"
          position={Position.Bottom}
          id="model"
          className={styles.handleDiamond}
          isConnectable={false}
        />
      ) : null}

      <span className={styles.ico}>
        <NodeIcon name={def.ic} size={size === "sm" ? 15 : 18} />
      </span>
      <span className={styles.tx}>
        <b>{def.n}</b>
        <small>{workingLabel || subtitle}</small>
      </span>
      {count > 0 ? <span className={styles.countBadge}>{count}</span> : null}
      {workingLabel ? (
        <span className={styles.progressBar}>
          <i className={styles.progressBarFill} style={{ width: `${progressPct}%` }} />
        </span>
      ) : null}
    </div>
  );
}

function SubNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { def, isSelected, isDimmed } = data;
  const ai = isAiNode(def);
  const cls = [
    styles.node,
    styles.nodeSub,
    ai ? styles.nodeAi : "",
    isSelected ? styles.selected : "",
    isDimmed ? styles.dimmed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <Handle type="source" position={Position.Top} id="top" className={styles.handleDiamond} isConnectable={false} />
      <span className={styles.ico}>
        <NodeIcon name={def.ic} size={16} />
      </span>
      <span className={styles.tx}>
        <b>{def.n}</b>
        {data.subtitle ? <small>{data.subtitle}</small> : null}
      </span>
    </div>
  );
}

function BrainEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<BrainEdgeData>>) {
  const d = edgePath(sourceX, sourceY, targetX, targetY, Boolean(data?.isSub));
  const cls = [
    styles.edgeBase,
    data?.isSub ? styles.edgeSub : "",
    data?.isFlow ? styles.edgeFlow : "",
    data?.isTrace ? styles.edgeTrace : "",
    data?.isDim ? styles.edgeDim : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <path d={d} className={cls} />;
}

const NODE_TYPES = { agent: AgentNode, sub: SubNode };
const EDGE_TYPES = { brain: BrainEdge };

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 8);
}

function LeadBrainInner({ teamId, userId, isAdmin, editable, leads, demo, onApproveLead, theme = "auto", onTheme, onAsk }: Props) {
  const { zoomIn, zoomOut, setViewport } = useReactFlow();
  const [ownerView, setOwnerView] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"now" | "track" | "setup">("now");
  const [traceLeadId, setTraceLeadId] = useState<string | null>(null);
  const [events, setEvents] = useState<BrainEvent[]>([]);
  const [flowingEdges, setFlowingEdges] = useState<Record<string, boolean>>({});
  const [flashNodes, setFlashNodes] = useState<Record<string, boolean>>({});
  const [errorNodes, setErrorNodes] = useState<Record<string, boolean>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => defaultPositions());
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<BrainEdgeData>>([]);
  const didFitRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layoutKey = `kestrel_lead_brain_layout_${teamId || "anon"}_${userId || "anon"}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey) || "null") as Record<
        string,
        { x: number; y: number }
      > | null;
      if (saved && typeof saved === "object") {
        const base = defaultPositions();
        for (const k of Object.keys(base)) {
          if (saved[k] && typeof saved[k].x === "number" && typeof saved[k].y === "number") {
            base[k] = saved[k];
          }
        }
        setPositions(base);
      }
    } catch {
      // ignore storage errors
    }
  }, [layoutKey]);

  // Fit every visible card into the canvas, like the concept's fit(): never above 100 %, never below 30 %.
  const fitCanvas = useCallback(
    (duration = 0) => {
      const el = wrapRef.current;
      if (!el) return;
      const ids = N.filter((n) => (isAdmin && ownerView) || !n.own);
      if (!ids.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ids) {
        const p = positions[n.id];
        if (!p) continue;
        const size = nodeSize(n);
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y - 40);
        x1 = Math.max(x1, p.x + W[size]);
        y1 = Math.max(y1, p.y + H[size] + (size === "sub" ? 30 : 0));
      }
      const r = el.getBoundingClientRect();
      const aw = r.width - FIT_SIDE * 2;
      const ah = r.height - FIT_TOP - FIT_BOTTOM;
      const zoom = Math.max(0.3, Math.min(1, aw / (x1 - x0), ah / (y1 - y0)));
      void setViewport(
        {
          x: FIT_SIDE + (aw - (x1 - x0) * zoom) / 2 - x0 * zoom,
          y: FIT_TOP + (ah - (y1 - y0) * zoom) / 2 - y0 * zoom,
          zoom,
        },
        { duration }
      );
    },
    [isAdmin, ownerView, positions, setViewport]
  );

  const savePositions = useCallback(
    (next: Record<string, { x: number; y: number }>) => {
      try {
        localStorage.setItem(layoutKey, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [layoutKey]
  );

  const leadsRef = useRef(leads);
  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  // Load real lead_brain_events if the table exists (AI-4b); otherwise gracefully remain empty.
  useEffect(() => {
    if (!teamId || demo) return;
    let alive = true;
    const sb = supabaseBrowser();

    sb.from("lead_brain_events")
      .select("id,lead_id,agent,from_agent,status,ms,ai_run_id,summary,created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!alive || error || !Array.isArray(data)) return;
        const leadNameById = new Map(leadsRef.current.map((l) => [l.id, l.name || "Unnamed lead"]));
        const mapped: BrainEvent[] = data.map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ""),
          lead_id: row.lead_id ? String(row.lead_id) : null,
          lead_name: row.lead_id ? leadNameById.get(String(row.lead_id)) || "Lead" : "Lead",
          agent: String(row.agent ?? ""),
          from_agent: row.from_agent ? String(row.from_agent) : null,
          status: (row.status as BrainEvent["status"]) ?? "ok",
          ms: Number(row.ms ?? 0) || 0,
          ai_run_id: row.ai_run_id ? Number(row.ai_run_id) : null,
          source: row.ai_run_id ? "kestrel" : "code",
          summary: String(row.summary ?? ""),
          created_at: String(row.created_at ?? new Date().toISOString()),
        }));
        setEvents(mapped);
      });

    const channel = sb
      .channel(`lead-brain-${teamId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_brain_events", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const lid = row.lead_id ? String(row.lead_id) : null;
          const leadName = (lid && leadsRef.current.find((l) => l.id === lid)?.name) || "Lead";
          const ev: BrainEvent = {
            id: String(row.id ?? `${Date.now()}`),
            lead_id: lid,
            lead_name: leadName,
            agent: String(row.agent ?? ""),
            from_agent: row.from_agent ? String(row.from_agent) : null,
            status: (row.status as BrainEvent["status"]) ?? "ok",
            ms: Number(row.ms ?? 0) || 0,
            ai_run_id: row.ai_run_id ? Number(row.ai_run_id) : null,
            source: row.ai_run_id ? "kestrel" : "code",
            summary: String(row.summary ?? ""),
            created_at: String(row.created_at ?? new Date().toISOString()),
          };
          setEvents((prev) => [ev, ...prev].slice(0, 200));

          if (ev.status === "started" && ev.from_agent) {
            const eid = `e_${ev.from_agent}_${ev.agent}`;
            setFlowingEdges((p) => ({ ...p, [eid]: true }));
            setTimeout(() => {
              setFlowingEdges((p) => {
                const copy = { ...p };
                delete copy[eid];
                return copy;
              });
            }, 800);
          } else if (ev.status === "ok") {
            setFlashNodes((p) => ({ ...p, [ev.agent]: true }));
            setTimeout(() => {
              setFlashNodes((p) => {
                const copy = { ...p };
                delete copy[ev.agent];
                return copy;
              });
            }, 900);
          } else if (ev.status === "error") {
            setErrorNodes((p) => ({ ...p, [ev.agent]: true }));
            setTimeout(() => {
              setErrorNodes((p) => {
                const copy = { ...p };
                delete copy[ev.agent];
                return copy;
              });
            }, 2000);
          }
        }
      )
      .subscribe();

    return () => {
      alive = false;
      void sb.removeChannel(channel);
    };
  }, [teamId, demo]);

  // Compute current lead positions from events, and keep leads without events visible in their zone.
  const brainLeads = useMemo<BrainLead[]>(() => {
    const latestByLead = new Map<string, BrainEvent>();
    for (const ev of events) {
      const key = ev.lead_id || ev.lead_name;
      if (!latestByLead.has(key)) latestByLead.set(key, ev);
    }
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const out: BrainLead[] = Array.from(latestByLead.entries()).map(([key, ev]) => {
      const lead = ev.lead_id ? leadById.get(ev.lead_id) : undefined;
      return {
        id: key,
        name: lead?.name || lead?.email || ev.lead_name,
        at: ev.agent,
        phase: ev.status === "started" ? "work" : "idle",
        summary: ev.summary,
        outreach_approved: Boolean(lead?.outreach_approved),
      };
    });

    // Every lead the App has loaded (the same list the sidebar badge counts), not only the newest 100.
    for (const l of leads) {
      if (l.status === "removed" || latestByLead.has(l.id)) continue;
      let at = "new";
      let summary = "Collected lead";
      if (l.outreach_approved) {
        at = "ready";
        summary = "Approved for outreach";
      } else if (l.verdict === "Good") {
        at = "approve";
        summary = l.reason || "Waiting for your approval";
      } else if (l.verdict === "Maybe" || l.verdict === "No") {
        at = "score";
        summary = l.reason || `Scored: ${l.verdict}`;
      } else if (l.website) {
        at = "read";
        summary = "Website ready to read";
      }
      out.push({
        id: l.id,
        name: l.name || l.email || "Lead",
        at,
        phase: "idle" as const,
        summary,
        outreach_approved: Boolean(l.outreach_approved),
      });
    }
    return out;
  }, [events, leads]);

  // One pass over all leads: how many sit at each node and who is working there.
  const byNode = useMemo(() => {
    const m = new Map<string, BrainLead[]>();
    for (const l of brainLeads) {
      const arr = m.get(l.at);
      if (arr) arr.push(l);
      else m.set(l.at, [l]);
    }
    return m;
  }, [brainLeads]);

  const traceNodeIds = useMemo(() => {
    if (!traceLeadId) return new Set<string>();
    const set = new Set<string>();
    for (const ev of events) {
      if ((ev.lead_id || ev.lead_name) === traceLeadId) {
        set.add(ev.agent);
        if (ev.from_agent) set.add(ev.from_agent);
      }
    }
    const cur = brainLeads.find((l) => l.id === traceLeadId);
    if (cur) set.add(cur.at);
    return set;
  }, [traceLeadId, events, brainLeads]);

  const effectiveOwnerView = isAdmin && ownerView;

  const visibleDefs = useMemo(
    () => N.filter((n) => effectiveOwnerView || !n.own),
    [effectiveOwnerView]
  );

  // Sync React Flow nodes & edges
  useEffect(() => {
    const nextNodes: Node<AgentNodeData>[] = visibleDefs.map((def) => {
      const here = byNode.get(def.id) ?? [];
      const working = here.filter((l) => l.phase === "work");
      const workingLabel = working.length
        ? `Working · ${working[working.length - 1].name}${working.length > 1 ? ` +${working.length - 1}` : ""}`
        : null;
      const ai = isAiNode(def);
      const subtitle = def.own
        ? effectiveOwnerView
          ? def.w
          : ""
        : ai
          ? "Kestrel AI"
          : def.k.includes("wait")
            ? "Waits for you"
            : def.k.includes("done")
              ? "Done"
              : "Code";

      return {
        id: def.id,
        type: nodeSize(def) === "sub" ? "sub" : "agent",
        position: positions[def.id] ?? { x: 0, y: 0 },
        draggable: true,
        data: {
          def,
          count: here.length,
          workingLabel,
          progressPct: working.length ? 65 : 0,
          isError: Boolean(errorNodes[def.id]),
          isFlash: Boolean(flashNodes[def.id]),
          isSelected: selectedNodeId === def.id,
          isTraced: traceLeadId !== null && traceNodeIds.has(def.id),
          isDimmed: traceLeadId !== null && !traceNodeIds.has(def.id),
          ownerView: effectiveOwnerView,
          subtitle,
        },
      };
    });

    const visibleIds = new Set(visibleDefs.map((d) => d.id));
    const nextEdges: Edge<BrainEdgeData>[] = E.filter(
      ([src, tgt]) => visibleIds.has(src) && visibleIds.has(tgt)
    ).map(([src, tgt, isSub]) => {
      const id = `e_${src}_${tgt}`;
      const isTrace = traceLeadId !== null && traceNodeIds.has(src) && traceNodeIds.has(tgt);
      return {
        id,
        source: src,
        target: tgt,
        sourceHandle: isSub ? "top" : "out",
        targetHandle: isSub ? "model" : "in",
        type: "brain",
        data: {
          isSub: Boolean(isSub),
          isFlow: Boolean(flowingEdges[id]),
          isTrace,
          isDim: traceLeadId !== null && !isTrace,
        },
      };
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [
    visibleDefs,
    byNode,
    positions,
    errorNodes,
    flashNodes,
    selectedNodeId,
    traceLeadId,
    traceNodeIds,
    effectiveOwnerView,
    flowingEdges,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    if (!didFitRef.current && nodes.length > 0) {
      didFitRef.current = true;
      requestAnimationFrame(() => {
        fitCanvas(0);
      });
    }
  }, [nodes.length, fitCanvas]);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      setPositions((prev) => {
        const next = { ...prev, [node.id]: { x: node.position.x, y: node.position.y } };
        savePositions(next);
        return next;
      });
    },
    [savePositions]
  );

  const handleResetLayout = useCallback(() => {
    const def = defaultPositions();
    setPositions(def);
    try {
      localStorage.removeItem(layoutKey);
    } catch {
      // ignore
    }
    requestAnimationFrame(() => {
      fitCanvas(200);
    });
  }, [layoutKey, fitCanvas]);

  // Same meaning as the concept: "Working" = leads inside the brain (not new, not waiting for you, not ready or sent).
  const workingCount = useMemo(
    () => brainLeads.filter((l) => !["new", "approve", "ready", "camp"].includes(l.at)).length,
    [brainLeads]
  );
  const waitingCount = byNode.get("approve")?.length ?? 0;
  const readyCount = byNode.get("ready")?.length ?? 0;

  const selectedDef = useMemo(
    () => (selectedNodeId ? N.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId]
  );

  const selectedLeads = useMemo(
    () => (selectedNodeId ? byNode.get(selectedNodeId) ?? [] : []),
    [byNode, selectedNodeId]
  );

  const selectedEvents = useMemo(
    () => (selectedNodeId ? events.filter((e) => e.agent === selectedNodeId).slice(0, 50) : []),
    [events, selectedNodeId]
  );

  const traceLead = useMemo(
    () => (traceLeadId ? brainLeads.find((l) => l.id === traceLeadId) ?? null : null),
    [brainLeads, traceLeadId]
  );

  const traceEvents = useMemo(
    () =>
      traceLeadId
        ? events.filter((e) => (e.lead_id || e.lead_name) === traceLeadId).slice().reverse()
        : [],
    [events, traceLeadId]
  );

  const avgSec = useMemo(() => {
    const okEvs = selectedEvents.filter((e) => e.status === "ok" && e.ms > 0);
    if (!okEvs.length) return "2.0 s";
    const avg = okEvs.reduce((a, b) => a + b.ms, 0) / okEvs.length / 1000;
    return `${avg.toFixed(1)} s`;
  }, [selectedEvents]);

  const [ask, setAsk] = useState("");
  // Fill the window below the App's top bar (and the demo banner), so the Ask bar is never cut off.
  const [wrapHeight, setWrapHeight] = useState<number | null>(null);
  useEffect(() => {
    const fitHeight = () => {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setWrapHeight(Math.max(580, Math.round(window.innerHeight - top - 16)));
    };
    fitHeight();
    window.addEventListener("resize", fitHeight);
    return () => window.removeEventListener("resize", fitHeight);
  }, []);
  // "auto" shows the theme the computer picked, so one button is always lit.
  const [shownTheme, setShownTheme] = useState<Exclude<LeadBrainTheme, "auto">>("light");
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.dataset.theme;
      setShownTheme(t === "dark" || t === "gradient" ? t : "light");
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, [theme]);

  // Fit again once the canvas has its final height (the first fit ran before it was measured).
  useEffect(() => {
    if (!wrapHeight || !didFitRef.current) return;
    const id = requestAnimationFrame(() => fitCanvas(0));
    return () => cancelAnimationFrame(id);
    // Only when the height changes, not after every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapHeight]);

  async function handleApprove(leadId: string) {
    setApprovingId(leadId);
    await onApproveLead(leadId);
    setApprovingId(null);
  }

  return (
    <div ref={wrapRef} className={`${styles.stagewrap} ds-root`} style={wrapHeight ? { height: wrapHeight } : undefined}>
      <div className={styles.nebula} aria-hidden="true" />
      <div className={styles.stars} aria-hidden="true" />
      <div className={styles.hud}>
        <div className={styles.title}>
          Lead Brain
          <span className={styles.live}>
            <i className={styles.liveDot} />
            Live
          </span>
        </div>
        <div className={styles.stat}>
          <span>
            Working <b>{workingCount}</b>
          </span>
          <span>
            Waiting for you <b>{waitingCount}</b>
          </span>
          <span>
            Ready to send <b>{readyCount}</b>
          </span>
        </div>
        <div className={styles.spacer} />
        <button type="button" className={styles.pill} onClick={handleResetLayout}>
          <LayoutGrid size={15} aria-hidden="true" />
          Reset layout
        </button>
        {isAdmin ? (
          <button
            type="button"
            className={styles.pill}
            aria-pressed={ownerView}
            onClick={() => setOwnerView((v) => !v)}
          >
            <Eye size={15} aria-hidden="true" />
            Owner view
          </button>
        ) : null}
      </div>

      <div className={styles.themeBar} role="group" aria-label="Theme">
        {(["light", "dark", "gradient"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={styles.themeBtn}
            aria-pressed={shownTheme === t}
            onClick={() => onTheme?.(t)}
          >
            {t === "light" ? "Light" : t === "dark" ? "Dark" : "Gradient"}
          </button>
        ))}
      </div>

      <div className={styles.src} role="status">
        {demo
          ? "Demo leads · sign in to see your live runs"
          : events.length
            ? `${events.length} recent ${events.length === 1 ? "step" : "steps"} · live events stream in`
            : "No runs yet · counts come from your leads"}
      </div>

      <ReactFlow
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => {
          setTraceLeadId(null);
          setSelectedNodeId(node.id);
          setTab("now");
        }}
        snapToGrid
        snapGrid={[13, 13]}
        minZoom={0.3}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="var(--lb-dot)" />
        <ViewportPortal>
          {Z.map((zone) => {
            const zoneNodes = visibleDefs.filter((n) => n.z === zone.id);
            if (!zoneNodes.length) return null;
            const minX = Math.min(...zoneNodes.map((n) => positions[n.id]?.x ?? 0));
            const minY = Math.min(...zoneNodes.map((n) => positions[n.id]?.y ?? 0));
            const countInZone = brainLeads.filter((l) => {
              const def = N.find((n) => n.id === l.at);
              return def?.z === zone.id;
            }).length;
            return (
              <div
                key={zone.id}
                className={styles.zoneLabel}
                style={{ left: minX, top: minY - 34 }}
                title={zone.d}
              >
                <b>{zone.n}</b>
                <span>
                  {countInZone} {countInZone === 1 ? "lead" : "leads"}
                </span>
              </div>
            );
          })}
        </ViewportPortal>
      </ReactFlow>

      <div className={styles.zoom}>
        <button type="button" aria-label="Zoom in" onClick={() => void zoomIn({ duration: 150 })}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => void zoomOut({ duration: 150 })}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit view" onClick={() => fitCanvas(200)}>
          <Scan size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.legend}>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchAi}`} />
          Kestrel AI
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchCode}`} />
          Code
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchWait}`} />
          Waits for you
        </span>
        <span>
          <i className={`${styles.legendSwatch} ${styles.swatchDone}`} />
          Done
        </span>
        <span>Drag a node to move it · drag empty space to pan · scroll to zoom · click to open</span>
      </div>

      <div className={styles.chat}>
        <form
          className={`${styles.chatForm} lb-ask-search`}
          onSubmit={(e) => {
            e.preventDefault();
            const q = ask.trim();
            if (!q || !onAsk) return;
            onAsk(q);
            setAsk("");
          }}
        >
          <span className={styles.chatSpark}>
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <input
            className={styles.chatInput}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask Kestrel AI — e.g. “research 40 video agencies in Texas”"
            aria-label="Ask Kestrel AI"
          />
          <button type="submit" aria-label="Send" disabled={!ask.trim() || !onAsk}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </form>
      </div>

      {traceLead || selectedDef ? (
        <aside className={styles.panel} aria-label="Node details">
          {traceLead ? (
            <>
              <div className={styles.panelHead}>
                <span className={styles.avatar}>{initials(traceLead.name)}</span>
                <div>
                  <b>{traceLead.name}</b>
                  <small>
                    Now at: {N.find((n) => n.id === traceLead.at)?.n ?? traceLead.at} · path in yellow
                  </small>
                </div>
                <button
                  type="button"
                  className={styles.panelClose}
                  aria-label="Close"
                  onClick={() => {
                    setTraceLeadId(null);
                    setSelectedNodeId(null);
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.panelBody}>
                <div className={styles.sectionTitle}>Full track of this lead</div>
                <div className={styles.timeline}>
                  {traceEvents.length ? (
                    traceEvents.map((ev) => (
                      <div key={ev.id} className={styles.eventCard}>
                        <div className={styles.eventTop}>
                          <b>{N.find((n) => n.id === ev.agent)?.n ?? ev.agent}</b>
                          <span
                            className={
                              ev.status === "ok"
                                ? styles.statusOk
                                : ev.status === "error"
                                  ? styles.statusErr
                                  : styles.statusSkip
                            }
                          >
                            {ev.status}
                          </span>
                        </div>
                        <div className={styles.eventMeta}>
                          {formatTime(ev.created_at)}
                          {ev.ms ? ` · ${(ev.ms / 1000).toFixed(1)} s` : ""} ·{" "}
                          {ev.source === "code" ? "Code" : "Kestrel AI"}
                        </div>
                        <div className={styles.eventOut}>{ev.summary}</div>
                      </div>
                    ))
                  ) : (
                    <p className={styles.sectionTitle}>Its steps will appear here as they happen.</p>
                  )}
                </div>
              </div>
            </>
          ) : selectedDef ? (
            <>
              <div className={styles.panelHead}>
                <span
                  className={`${styles.ico} ${
                    isAiNode(selectedDef)
                      ? styles.kindAi
                      : selectedDef.k.includes("wait")
                        ? styles.kindWait
                        : selectedDef.k.includes("done")
                          ? styles.kindDone
                          : styles.kindCode
                  }`}
                >
                  <NodeIcon name={selectedDef.ic} size={20} />
                </span>
                <div>
                  <b>{selectedDef.n}</b>
                  <small>{selectedDef.w}</small>
                </div>
                <button
                  type="button"
                  className={styles.panelClose}
                  aria-label="Close"
                  onClick={() => setSelectedNodeId(null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.panelBody}>
                <div className={styles.tabs} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "now"}
                    onClick={() => setTab("now")}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "track"}
                    onClick={() => setTab("track")}
                  >
                    Track
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "setup"}
                    onClick={() => setTab("setup")}
                  >
                    Setup
                  </button>
                </div>

                {tab === "now" ? (
                  <>
                    <div className={styles.sectionTitle}>
                      {selectedLeads.length.toLocaleString()} {selectedLeads.length === 1 ? "lead" : "leads"} here now
                    </div>
                    {selectedLeads.length ? (
                      selectedLeads.slice(0, PANEL_ROWS).map((l) => (
                        <div key={l.id} className={styles.leadRow}>
                          <span className={styles.avatar}>{initials(l.name)}</span>
                          <div className={styles.leadText}>
                            <button
                              type="button"
                              className={styles.leadLink}
                              onClick={() => setTraceLeadId(l.id)}
                            >
                              {l.name}
                            </button>
                            <div className={styles.leadSub}>
                              {l.phase === "work" ? "Working now…" : l.summary || "Waiting"}
                            </div>
                          </div>
                          {selectedDef.id === "approve" && editable ? (
                            <button
                              type="button"
                              className={styles.approveBtn}
                              disabled={approvingId === l.id}
                              onClick={() => void handleApprove(l.id)}
                            >
                              {approvingId === l.id ? "Saving…" : "Approve"}
                            </button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className={styles.sectionTitle}>Nobody here right now.</p>
                    )}
                    {selectedLeads.length > PANEL_ROWS ? (
                      <p className={styles.more}>
                        Showing {PANEL_ROWS} of {selectedLeads.length.toLocaleString()}. Open Leads to see them all.
                      </p>
                    ) : null}
                  </>
                ) : tab === "track" ? (
                  <>
                    <div className={styles.sectionTitle}>Every lead this agent processed (newest first)</div>
                    {selectedEvents.length ? (
                      selectedEvents.map((ev) => (
                        <div key={ev.id} className={styles.eventCard}>
                          <div className={styles.eventTop}>
                            <button
                              type="button"
                              className={styles.leadLink}
                              onClick={() => setTraceLeadId(ev.lead_id || ev.lead_name)}
                            >
                              {ev.lead_name}
                            </button>
                            <span
                              className={
                                ev.status === "ok"
                                  ? styles.statusOk
                                  : ev.status === "error"
                                    ? styles.statusErr
                                    : styles.statusSkip
                              }
                            >
                              {ev.status}
                            </span>
                          </div>
                          <div className={styles.eventMeta}>
                            {formatTime(ev.created_at)}
                            {ev.ms ? ` · ${(ev.ms / 1000).toFixed(1)} s` : ""} ·{" "}
                            {ev.source === "code" ? "Code" : "Kestrel AI"}
                            {ev.tokens_in !== undefined && ev.tokens_out !== undefined
                              ? ` · ${ev.tokens_in} in / ${ev.tokens_out} out`
                              : ""}
                          </div>
                          <div className={styles.eventOut}>{ev.summary}</div>
                        </div>
                      ))
                    ) : (
                      <p className={styles.sectionTitle}>No runs yet in this session.</p>
                    )}
                  </>
                ) : (
                  <dl className={styles.kv}>
                    <dt>Agent</dt>
                    <dd>{selectedDef.w || selectedDef.n}</dd>
                    <dt>Who</dt>
                    <dd>
                      <span
                        className={`${styles.whoPill} ${isAiNode(selectedDef) ? styles.whoAi : ""}`}
                      >
                        {isAiNode(selectedDef)
                          ? "Kestrel AI"
                          : selectedDef.k.includes("wait")
                            ? "You"
                            : "Code"}
                      </span>
                    </dd>
                    <dt>Time limit</dt>
                    <dd>{selectedDef.timeoutLabel || "10 s"}</dd>
                    <dt>Runs</dt>
                    <dd>
                      {selectedEvents.length} loaded · {avgSec} average
                    </dd>
                  </dl>
                )}
              </div>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

export default function LeadBrainView(props: Props) {
  return (
    <ReactFlowProvider>
      <LeadBrainInner {...props} />
    </ReactFlowProvider>
  );
}
