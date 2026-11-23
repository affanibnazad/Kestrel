"use client";

import { DialogHost, askConfirm, askText } from "@/components/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand, Line, Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import LeadPanel from "./lead-panel";
import PipelineView, { type PipelineMove } from "./pipeline-view";
import AboutView from "./about-view";
import { aboutReady, cleanAbout } from "@/lib/about";
import { parseMoney, type ConvStage } from "@/lib/pipeline";
import AiView from "./ai-view";
import AssistantView from "./assistant-view";
import type { ChatQuestion } from "./assistant-chat";
import ConnectionsKeys from "./connections-keys";
import SideDrawer from "./side-drawer";
import { SpamCheckPanel } from "./spam-check";
import OwnerView from "./owner-view";
import CreatorPage from "./creator-page";
import McpView from "./mcp-view";
import Review from "./review";
import DncView from "./dnc-view";
import RulesView from "./rules-view";
import MailboxesView from "./mailboxes-view";
import PlacementView from "./placement-view";
import TasksView from "./tasks-view";
import SequencesView from "./sequences-view";
import CampaignsView from "./campaigns-view";
import InboxView from "./inbox-view";
import ViewErrorBoundary from "@/components/view-error-boundary";
import { Globe } from "lucide-react";
import { BizAvatar, PersonAvatar, Socials, siteOfEmail } from "./biz";
import { ACCENTS, applyLayout, applyLook, openPhoto, readLook, saveLook, type Look } from "@/lib/look";
import { noteRecent, readRecent, type RecentItem } from "@/lib/recent";
import PhotoCrop from "./photo-crop";
import AnalyticsView from "./analytics-view";
import CsvImport from "./csv-import";
import { useReplyAlerts } from "./reply-alerts";
import { useKitResults } from "./kit-watch";
import HomeToday from "./home-today";
import HomeKit from "./home-kit";
import AutopilotView from "./autopilot-view";
import { dncBlocks, dncIndex, normalizeDnc, type DncRow } from "@/lib/dnc";
import { PENDING, claim } from "../redeem/redeem";
import { EXAMPLE_LEADS, LEAD_COLUMNS, LEAD_COLUMNS_STATUS, LEAD_COLUMNS_VERIFY, LEADS_DRAG, leadsCsv, placeOf, searchGroups, searchKey, leadsFromBackup, toRow, type LeadRow } from "@/lib/leads";
import downloads from "@/lib/downloads";
import { EXTENSION, storeUrl } from "@/lib/site";
import { LAUNCH as INTRO, PLANS, TRIAL_DAYS, introPrice, money, planName, type PlanId } from "@/lib/plans";
import OfferBanner from "@/components/offer-banner";
import OfferCode from "@/components/offer-code";

export type Account = {
  team_id: string; team_name: string; role: string; full_name: string | null; job_title?: string | null;
  plan: string; chosen_plan: PlanId | null; trial_ends_at: string; join_code: string | null;
  website?: string | null; team_size?: string | null; country?: string | null;
  active?: boolean; paid_until?: string | null; billing_status?: string | null; billing_portal?: string | null;
  access_until?: string | null; access_plan?: PlanId | null; is_admin?: boolean; news_ok?: boolean; avatar?: string | null;
  members: { name: string | null; email: string; role: string; joined_at: string; avatar?: string | null }[] | null;
};

type SavedView = { name: string; view: string; query: string };
// YYYY-MM-DD in the viewer's own time zone (so a lead added at 8:00 in Dhaka counts on that day).
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The plan whose team size applies: an active paid plan, else a valid access code's plan, else Pro (the trial is Pro).
const seatPlan = (a: Account | null) => {
  if (!a) return "pro";
  if (a.plan !== "trial" && a.paid_until && a.active !== false) return a.plan;
  if (a.access_until && new Date(a.access_until) > new Date()) return a.access_plan ?? "pro";
  return "pro";
};
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

// Left bar: the same lists as the extension's Workspace, with Apple-style line icons in one colour.
const SMART = [
  ["all", "All leads", "grid"], ["new", "New, to review", "eye"], ["good", "Good fit", "okcircle"],
  ["named", "Named contacts", "idcard"], ["hiring", "Hiring now", "briefcase"],
  ["kept", "Kept", "bookmark"], ["removed", "Removed", "trash"],
];
// Which leads each list shows. Removed leads only appear under Removed (like the extension).
const live = (l: LeadRow) => l.status !== "removed";
const MATCH: Record<string, (l: LeadRow) => boolean> = {
  all: live, good: (l) => live(l) && l.verdict === "Good", named: (l) => live(l) && l.named,
  hiring: (l) => live(l) && l.hiring, new: (l) => live(l) && !l.verdict, kept: (l) => l.status === "kept", removed: (l) => l.status === "removed",
};
// Quick filters above the table (like the extension's Filters).
const FILTERS: [string, string, (l: LeadRow) => boolean][] = [
  ["good", "Good", (l) => l.verdict === "Good"], ["maybe", "Maybe", (l) => l.verdict === "Maybe"], ["no", "No", (l) => l.verdict === "No"],
  ["email", "Has email", (l) => Boolean(l.email)], ["phone", "Has phone", (l) => Boolean(l.phone)], ["site", "Has website", (l) => Boolean(l.website)],
  ["valid", "Valid email", (l) => l.email_status === "valid"], ["risky", "Risky email", (l) => l.email_status === "risky"], ["invalid", "Invalid email", (l) => l.email_status === "invalid"],
];
const SOURCES = [["maps", "Google Maps", "map"], ["search", "Google Search", "search"], ["youtube", "YouTube", "play"], ["osm", "OpenStreetMap", "globe"],
["jobs", "Job boards", "job"], ["companies", "Companies House", "building"], ["podcasts", "Listen Notes", "mic"], ["page", "Any web page", "doc"], ["sites", "Website lists", "list"]];
const PAGES: Record<string, string> = { about: "Your business", pipeline: "Pipeline", ai: "Kestrel AI", autopilot: "Autopilot", mailboxes: "Email accounts", campaigns: "Campaigns", inbox: "Replies", tasks: "Tasks", analytics: "Analytics", sequences: "Sequences", rules: "Rules", dnc: "Do-not-contact", get: "Integrations", mcp: "Integrations", profile: "Your profile", home: "Home", progress: "Search progress", team: "Team", plan: "Plan and billing", import: "Import and examples", connections: "Integrations", activity: "Leads added" };

// The left bar's groups; the group of the page you are on opens (one at a time, see kgroup).
type GroupId = "leads" | "mail" | "find" | "settings";
const MAIL_VIEWS = ["campaigns", "inbox", "tasks", "sequences", "mailboxes", "analytics", "placement"];
const SETTINGS_VIEWS = ["team", "plan", "connections", "get", "mcp", "dnc", "import"];
function groupOf(view: string): GroupId | null {
  if (SMART.some((x) => x[0] === view) || view === "rules" || view === "activity" || view === "pipeline" || view.startsWith("list:")) return "leads";
  if (MAIL_VIEWS.includes(view)) return "mail";
  if (view === "progress" || SOURCES.some((x) => x[0] === view)) return "find";
  if (SETTINGS_VIEWS.includes(view)) return "settings";
  return null;
}

const VALID_VIEWS = new Set([
  ...SMART.map(([id]) => id),
  ...SOURCES.map(([id]) => id),
  ...Object.keys(PAGES),
  "owner", "creator", "placement", "assistant",
]);

export function isValidView(v: string | null | undefined): boolean {
  if (!v) return false;
  if (VALID_VIEWS.has(v)) return true;
  if (/^list:[0-9a-f-]{36}$/i.test(v)) return true;
  return false;
}
const SIDE_W = 260, SIDE_MIN = 200, SIDE_MAX = 400, SIDE_FOLD = 150; // sidebar width in px (drag the edge)

// Page buttons to show: first, last, and two either side of the current one; -1 = a gap (…).
function pageList(page: number, pages: number) {
  const out: number[] = [];
  for (let i = 0; i < pages; i++) if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 2) out.push(i); else if (out[out.length - 1] !== -1) out.push(-1);
  return out;
}

// Design v2 side bar items (the Figma kit's): icon + label, a filled block and an edge bar when on; sub items with a dot.
function KNav({ icon, label, count, on, onClick }: { icon: string; label: string; count?: number; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`knav${on ? " on" : ""}`} onClick={onClick} aria-current={on ? "page" : undefined} title={label}>
      <span className="knav-ic"><Line name={icon} filled={on} /></span><span className="knav-lb">{label}</span>
      {count ? <span className="knav-badge">{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}
function KSub({ label, count, on, onClick }: { label: string; count?: number; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`ksub${on ? " on" : ""}`} onClick={onClick} aria-current={on ? "page" : undefined}>
      <span className="ksub-dot" aria-hidden="true" /><span className="knav-lb">{label}</span>{count ? <small>{count.toLocaleString()}</small> : null}
    </button>
  );
}


export default function AppShell({ email, loading = false, preview = false, account: initialAccount = null, demo, initialView = "home", isDemoMode = false }: { email: string; loading?: boolean; preview?: boolean; account?: Account | null; demo?: LeadRow[]; initialView?: string; isDemoMode?: boolean }) {
  const [account, setAccount] = useState<Account | null>(initialAccount);
  useEffect(() => {
    Promise.resolve().then(() => setAccount(initialAccount));
  }, [initialAccount]);

  const nextLeadsRef = useRef<LeadRow[] | null>(null);
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const detail = (e as CustomEvent<Account | null | { account: Account | null; leads?: LeadRow[] }>).detail;
      if (!detail) return;
      if ("account" in detail) {
        if (detail.leads) nextLeadsRef.current = detail.leads;
        setAccount(detail.account);
      } else {
        setAccount(detail);
      }
    };
    window.addEventListener("kestrel-switch-team", onSwitch);
    return () => window.removeEventListener("kestrel-switch-team", onSwitch);
  }, []);

  const [view, setView] = useState(() => (isValidView(initialView) ? initialView : "home"));
  useEffect(() => {
    if (initialView && initialView !== "home" && isValidView(initialView)) Promise.resolve().then(() => setView(initialView));
    else if (typeof window !== "undefined") {
      const v = new URLSearchParams(window.location.search).get("view");
      if (v && isValidView(v)) Promise.resolve().then(() => setView(v));
    }
  }, [initialView]);
  const [userMenu, setUserMenu] = useState(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("menu") === "1"));     // the avatar menu at the bottom of the sidebar
  const [, setRecent] = useState<RecentItem[]>([]);
  const [open, setOpen] = useState(false);          // phone: the left bar slides over the page
  const touchStartX = useRef(0);                    // swipe to open/close the sidebar (no collapse button)
  const [collapsed, setCollapsed] = useState(false); // computer: the left bar folds to a slim row of icons
  const [kitFilters, setKitFilters] = useState(false);   // v2 Leads: the filter row under the search box   // the new design (?look=v2): the Figma kit's layouts
  const [look, setLook] = useState<Look>(readLook);   // read once from localStorage
  useEffect(() => { applyLook(look); applyLayout(); }, [look]);   // Profile → Appearance (theme, accent, reduce motion)
  const [leads, setLeads] = useState<LeadRow[]>(demo ?? []);
  const [query, setQuery] = useState("");
  const [searchQ, setSearchQ] = useState("");
  // A question sent from the search box at the top: it opens the AI chat in the
  // App and asks it there. The id keeps two identical questions apart.
  const [chatAsk, setChatAsk] = useState<ChatQuestion | null>(null);
  const chatAskId = useRef(0);
  // True while the AI chat tab is open: then the App is exactly one screen tall,
  // the conversation scrolls inside the chat and the composer sits at the bottom.
  const [chatFrame, setChatFrame] = useState(false);
  const [loaded, setLoaded] = useState(Boolean(demo));
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState("");   // leads could not be loaded (19 Nov 2026: was a silent 0)
  const [toast, setToast] = useState("");
  const [pg, setPg] = useState({ key: "", n: 0 });
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [inList, setInList] = useState<Record<string, string[]>>({}); // list id -> lead ids
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [views, setViews] = useState<SavedView[]>([]);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [spam, setSpam] = useState<{ subject: string; body: string; mode?: "email" | "template" | "reply"; sent?: boolean } | null>(null);
  // Kestrel creators (database 040) get a "Creator" page with their own numbers. Before 040 the check fails quietly.
  const [isCreator, setIsCreator] = useState(false);
  useEffect(() => {
    if (!account || account.team_id === "demo" || preview) return;
    supabaseBrowser().rpc("my_creator").then(({ data, error }) => { if (!error && data) setIsCreator(true); });
  }, [account, preview]);
  useEffect(() => {
    const open = (e: Event) => setSpam(((e as CustomEvent).detail as typeof spam) ?? { subject: "", body: "" });
    window.addEventListener("kestrel-spam-check", open);
    return () => window.removeEventListener("kestrel-spam-check", open);
  }, []);
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [source, setSource] = useState("");   // Leads: one source (instead of a page per source)
  const [added, setAdded] = useState(0);      // Leads: added in the last N days (0 = any time)
  const [search, setSearch] = useState("");
  const [mailState, setMailState] = useState<Record<string, "queued" | "emailed" | "replied">>({});
  const [convStage, setConvStage] = useState<Record<string, ConvStage>>({});   // the newest reply status per lead (Replies)
  const [mailed, setMailed] = useState("");   // Leads: "" any, "emailed", "queued", "none" (not in a campaign)   // Leads: one search (keyword + place), see searchGroups
  const [nowMs, setNowMs] = useState(0);   // set after the first render (no clock during prerender)
  useEffect(() => { Promise.resolve().then(() => setNowMs(Date.now())); }, []);
  const [review, setReview] = useState<LeadRow[] | null>(null);
  const [dnc, setDnc] = useState<DncRow[]>([]);
  const [finding, setFinding] = useState<{ done: number; total: number; found: number } | null>(null);
  const [verifying, setVerifying] = useState<{ done: number; total: number } | null>(null);
  const stopFind = useRef(false);
  const dncIdx = useMemo(() => dncIndex(dnc), [dnc]);
  const blocked = useCallback((l: LeadRow) => dncBlocks(l, dncIdx), [dncIdx]);
  // Anyone who can change leads may add to Do-not-contact, even after the trial: a "no" must always be kept.
  const canBlock = Boolean(account && account.role !== "viewer");
  const reload = useCallback(() => {
    setLoadError("");
    setVersion((v) => v + 1);
  }, []);
  const editable = Boolean(account && account.role !== "viewer" && account.active !== false);
  // Locked by a Kestrel admin (database 050): show why, instead of "choose a plan".
  const [lock, setLock] = useState<{ at: string; reason: string | null } | null>(null);
  useEffect(() => {
    if (!account || account.active !== false || account.team_id === "demo") return;
    supabaseBrowser().rpc("my_team_lock").then(({ data }) => setLock((data as { at: string; reason: string | null } | null) ?? null));
  }, [account]);
  // Saved views live in this browser (yours only).
  useEffect(() => { try { Promise.resolve().then(() => setViews(JSON.parse(localStorage.getItem("kestrel-views") || "[]"))); } catch { /* ignore */ } }, []);
  const keepViews = (v: SavedView[]) => { setViews(v); try { localStorage.setItem("kestrel-views", JSON.stringify(v)); } catch { /* ignore */ } };
  // Open a page straight from the address, for example /app?view=get or /app?view=all.
  // Every page has its own address (/app?view=…), so reload, Back and bookmarks work (UX audit row 37).
  useEffect(() => {
    const read = () => {
      const sp = new URLSearchParams(location.search);
      const raw = sp.get("view");
      const v = isValidView(raw) ? raw! : "home";
      setView(v);
      setOpenLead(null);
      setSpam(null);
      setReview(null);
      setPicked(new Set());
      if (raw && !isValidView(raw)) {
        try {
          const u = new URL(location.href);
          u.searchParams.set("view", "home");
          history.replaceState(null, "", `${u.pathname}${u.search}`);
        } catch { /* fine */ }
      }
    };
    if (new URLSearchParams(location.search).get("view")) read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // Request generation tracking and active tenant context validation
  const activeTeamIdRef = useRef(account?.team_id ?? (demo ? "demo" : ""));
  const requestGenRef = useRef(0);

  // Flush client state immediately when switching teams or between demo and authenticated
  const prevTeamRef = useRef(account?.team_id);
  useEffect(() => {
    if (account?.team_id !== prevTeamRef.current) {
      prevTeamRef.current = account?.team_id;
      activeTeamIdRef.current = account?.team_id ?? (demo ? "demo" : "");
      requestGenRef.current += 1;
      stopFind.current = true;
      try {
        const u = new URL(location.href);
        if (u.searchParams.has("c")) {
          u.searchParams.delete("c");
          history.replaceState(null, "", `${u.pathname}${u.search}`);
        }
      } catch { /* fine */ }
      const isDemo = !account || account.team_id === "demo";
      const incomingLeads = nextLeadsRef.current;
      nextLeadsRef.current = null;
      Promise.resolve().then(() => {
        setLeads(incomingLeads ?? (isDemo ? (demo ?? []) : []));
        setLists([]);
        setInList({});
        setMailState({});
        setConvStage({});
        setDnc([]);
        setPicked(new Set());
        setOpenLead(null);
        setSpam(null);
        setReview(null);
        setLoaded(false);
        setLoadError("");
        setQuery("");
        setSearchQ("");
        setFilters(new Set());
        setSource("");
        setAdded(0);
        setSearch("");
        setMailed("");
        setFinding(null);
        setVerifying(null);
        setLock(null);
        setIsCreator(false);
        setPg({ key: "", n: 0 });
      });
    }
  }, [account, demo]);
  // Remember the left bar as you left it; ⌘\ or Ctrl+\ folds it (like Claude).
  useEffect(() => { try { Promise.resolve().then(() => setCollapsed(localStorage.getItem("kestrel-side") === "1")); } catch { /* private window */ } }, []);
  const toggle = useCallback(() => setCollapsed((c) => { try { localStorage.setItem("kestrel-side", c ? "0" : "1"); } catch { /* ignore */ } return !c; }), []);
  // Design v2, like the kit's Mail page: on Replies the left bar shows icons only, so the three mail columns have room.
  // The menu button opens it for this visit (railPeek); it folds again next time Replies opens. Not saved.
  const [railPeek, setRailPeek] = useState(false);
  const [kOpen, setKOpen] = useState<string | null | undefined>(undefined);   // design v2: the side bar group opened by hand
  useEffect(() => { Promise.resolve().then(() => setKOpen(undefined)); }, [view]);
  useEffect(() => { Promise.resolve().then(() => setRailPeek(false)); }, [view]);
  const autoRail = view === "inbox" && !railPeek;
  const folded = collapsed || autoRail;
  const toggleSide = useCallback(() => { if (autoRail) setRailPeek(true); else toggle(); }, [autoRail, toggle]);
  // Drag the sidebar's right edge to make it wider or narrower (like Claude). Dragging it far left folds it;
  // double-click puts it back to the normal width. Arrow keys work on the edge too. Saved in this browser.
  const [sideW, setSideW] = useState(SIDE_W);
  const [dragging, setDragging] = useState(false);
  const lastDown = useRef(0);
  useEffect(() => { Promise.resolve().then(() => { try { const w = Number(localStorage.getItem("kestrel-side-w")); if (w >= SIDE_MIN && w <= SIDE_MAX) setSideW(w); } catch { /* none saved */ } }); }, []);
  const saveW = (w: number) => { try { localStorage.setItem("kestrel-side-w", String(w)); } catch { /* ignore */ } };
  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const now = Date.now();
    if (now - lastDown.current < 400 || e.detail === 2) {
      setCollapsed(false);
      setSideW(SIDE_W);
      saveW(SIDE_W);
      try { localStorage.setItem("kestrel-side", "0"); } catch { /* ignore */ }
      lastDown.current = 0;
      return;
    }
    lastDown.current = now;
    e.preventDefault();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    let last = e.clientX;
    const move = (ev: PointerEvent) => {
      last = ev.clientX;
      if (ev.clientX >= SIDE_MIN) {
        setCollapsed(false);
        setSideW(Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(ev.clientX))));
      }
    };
    const up = (ev: PointerEvent) => {
      try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      if (last && last < SIDE_FOLD) {
        setCollapsed(true);
        try { localStorage.setItem("kestrel-side", "1"); } catch { /* ignore */ }
      } else {
        try { localStorage.setItem("kestrel-side", "0"); } catch { /* ignore */ }
        setSideW((w) => { saveW(w); return w; });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, []);
  const keyDrag = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    setSideW((w) => { const n = Math.max(SIDE_MIN, Math.min(SIDE_MAX, w + step)); saveW(n); return n; });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggle(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggle]);
  // Load this team's leads (newest first); runs again after an import.
  useEffect(() => {
    const isDemo = !account || account.team_id === "demo";
    if (isDemo) return;
    let live = true;
    const currentGen = requestGenRef.current;
    const currentTeam = account.team_id;
    const isCurrent = () => live && requestGenRef.current === currentGen && activeTeamIdRef.current === currentTeam;

    // Page by 1000 (the API's row cap), newest first, up to 50,000 leads.
    const load = (cols: string) => fetchAll<LeadRow>((from, to) => supabaseBrowser().from("leads").select(cols).eq("team_id", account.team_id)
      .order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: LeadRow[] | null; error: { message: string } | null }>, 50_000, 1000,
      // Show leads as they arrive (19 Nov 2026: 5,700 leads looked like 0 until the last batch came).
      (sofar) => { if (isCurrent() && sofar.length) setLeads(sofar); });
    // A missing column means database 044 or 006 has not been run: only then load again without it. A timeout or a
    // network error is not retried here (19 Nov 2026: three heavy loads in a row made a slow database slower) and is
    // shown, never turned into "0 leads".
    const missing = (e: { message: string } | null) => Boolean(e && /does not exist|column|schema cache/i.test(e.message));
    load(LEAD_COLUMNS_VERIFY).then(async (res) => {
      if (!isCurrent()) return;
      const r2 = missing(res.error) ? await load(LEAD_COLUMNS_STATUS) : res;
      if (!isCurrent()) return;
      const r3 = missing(r2.error) ? await load(LEAD_COLUMNS) : r2;
      if (!isCurrent()) return;
      if (r3.error) { setLoadError(r3.error.message); if (r3.data.length) setLeads(r3.data as LeadRow[]); return; }
      setLoadError(""); setLeads((r3.data as LeadRow[] | null) ?? []); setLoaded(true);
    });
    // Team lists and which leads are in each.
    const sb = supabaseBrowser();
    Promise.all([sb.from("lists").select("id,name").eq("team_id", account.team_id).order("name"), fetchAll<{ list_id: string; lead_id: string }>((from, to) => sb.from("list_leads").select("list_id,lead_id").eq("team_id", account.team_id).order("list_id").order("lead_id").range(from, to))])
      .then(([l, m]) => {
        if (!isCurrent()) return;
        setLists((l.data as { id: string; name: string }[] | null) ?? []);
        const map: Record<string, string[]> = {};
        for (const r of (m.data as { list_id: string; lead_id: string }[] | null) ?? []) (map[r.list_id] ||= []).push(r.lead_id);
        setInList(map);
      });
    // Which leads are in a campaign and whether their first email went (Batch 001 feedback #8: "2 sent", but every lead
    // still looked new). Best emailed state per lead: replied > emailed > queued.
    fetchAll<{ lead_id: string | null; status: string; first_sent_at: string | null; stage?: ConvStage | null; stage_at?: string | null }>((from, to) => sb.from("campaign_leads").select("lead_id,status,first_sent_at,stage,stage_at").eq("team_id", account.team_id).order("id").range(from, to))
      .then(({ data }) => {
        if (!isCurrent()) return;
        const rank = { queued: 1, emailed: 2, replied: 3 } as const, map: Record<string, keyof typeof rank> = {};
        for (const r of data ?? []) {
          if (!r.lead_id) continue;
          const s: keyof typeof rank | null = r.status === "replied" ? "replied" : r.first_sent_at ? "emailed" : r.status === "active" ? "queued" : null;
          if (!s) continue;   // stopped, blocked or failed before the first email
          if (!map[r.lead_id] || rank[s] > rank[map[r.lead_id]]) map[r.lead_id] = s;
        }
        setMailState(map);
        const conv: Record<string, ConvStage> = {}, at: Record<string, string> = {};
        for (const r of data ?? []) if (r.lead_id && r.stage && (!at[r.lead_id] || (r.stage_at ?? "") > at[r.lead_id])) { conv[r.lead_id] = r.stage; at[r.lead_id] = r.stage_at ?? ""; }
        setConvStage(conv);
      });
    // The team's Do-not-contact list (database 011; before it is run the table is missing and the list stays empty).
    fetchAll<DncRow>((from, to) => sb.from("do_not_contact").select("entry,reason,created_at").eq("team_id", account.team_id).order("created_at", { ascending: false }).order("entry").range(from, to))
      .then(({ data }) => { if (isCurrent()) setDnc(data); });
    return () => { live = false; };
  }, [account, version, demo]);
  // An invitation link opened before signing in: claim it now (team owners only).
  useEffect(() => {
    if (!account || demo || account.role !== "owner") return;
    let code = ""; try { code = localStorage.getItem(PENDING) || ""; } catch { }
    if (!code) return;
    try { localStorage.removeItem(PENDING); } catch { }
    claim(code).then((r) => { setToast(r.text); if (r.ok) setTimeout(() => location.reload(), 1800); });
  }, [account, demo]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);
  const testFor = useCallback((id: string) => {
    if (id.startsWith("list:")) { const ids = new Set(inList[id.slice(5)] ?? []); return (l: LeadRow) => ids.has(l.id); }
    // New, to review (Affan, 18 Nov 2026): only leads nobody has looked at yet. Kept, marked Good / Maybe / No, or already
    // in a campaign all count as reviewed, so new arrivals never mix with leads you already worked on.
    if (id === "new") return (l: LeadRow) => live(l) && !l.verdict && l.status !== "kept" && !mailState[l.id];
    return MATCH[id] ?? ((l: LeadRow) => l.source === id || (id === "sites" && l.source === "site"));
  }, [inList, mailState]);
  const count = (id: string) => leads.filter(testFor(id)).length;
  const shown = useMemo(() => {
    const test = testFor(view);
    const q = query.trim().toLowerCase();
    // Filters: within a group (fit, contact, tier) any may match; across groups all must match.
    const groups = [["good", "maybe", "no"], ["email", "phone", "site"]].map((g) => g.filter((id) => filters.has(id))).filter((g) => g.length);
    const byFilter = (l: LeadRow) => groups.every((g) => g.some((id) => FILTERS.find((x) => x[0] === id)![2](l)));
    return leads.filter(test).filter(byFilter).filter((l) => !source || l.source === source || (source === "sites" && l.source === "site")).filter((l) => !added || Date.parse(l.created_at) > nowMs - added * 864e5).filter((l) => !search || searchKey(l) === search).filter((l) => !mailed || (mailed === "none" ? !mailState[l.id] : mailed === "emailed" ? mailState[l.id] === "emailed" || mailState[l.id] === "replied" : mailState[l.id] === mailed)).filter((l) => !q || [l.name, l.category, l.location, l.email, l.website, l.reason].some((x) => (x || "").toLowerCase().includes(q)));
  }, [leads, view, query, testFor, filters, source, added, search, mailed, mailState, nowMs]);
  const searches = useMemo(() => searchGroups(leads), [leads]);
  // Page numbers under the Leads table (the kit's pagination). Before this only the first 500 leads could be reached.
  // The page goes back to 1 whenever the list changes (another view, search or filter).
  const [perPage, setPerPage] = useState(50);
  const pageKey = `${view}|${query}|${[...filters].join()}|${source}|${added}|${search}|${mailed}|${perPage}`;
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const page = pg.key === pageKey ? Math.min(pg.n, pages - 1) : 0;
  const goPage = (n: number) => setPg({ key: pageKey, n: Math.max(0, Math.min(pages - 1, n)) });
  // Column sorting (the kit's ▾ headings). Off = the usual order (newest first).
  const [sortBy] = useState<{ k: "name" | "email" | "place" | "added" | "source" | "fit"; up: boolean } | null>(null);
  const sorted = useMemo(() => {
    if (!sortBy) return shown;
    const val = (l: LeadRow): string | number => sortBy.k === "name" ? (l.name ?? "").toLowerCase() : sortBy.k === "email" ? (l.email ?? "~").toLowerCase()
      : sortBy.k === "place" ? placeOf(l).toLowerCase() : sortBy.k === "added" ? l.created_at : sortBy.k === "source" ? (l.source ?? "") : ((({ Good: 3, Maybe: 2, No: 1 }) as Record<string, number>)[l.verdict ?? ""] ?? 0);
    return [...shown].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortBy.up ? 1 : -1); });
  }, [shown, sortBy]);
  const rows = sorted.slice(page * perPage, page * perPage + perPage);
  function exportCsv() {
    const all = picked.size ? shown.filter((l) => picked.has(l.id)) : shown;
    const rows = all.filter((l) => !blocked(l)); // Do-not-contact leads never leave Kestrel.
    const held = all.length - rows.length;
    const blob = new Blob([leadsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `kestrel-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setToast(`Exported ${rows.filter((l) => l.status !== "removed").length} leads.${held ? ` ${held} on Do-not-contact left out.` : ""}`);
  }
  const listName = view.startsWith("list:") ? lists.find((l) => `list:${l.id}` === view)?.name : undefined;
  const title = listName ?? PAGES[view] ?? (SMART.some((s) => s[0] === view) ? "Leads" : (SOURCES.find((s) => s[0] === view) || [, "Leads"])[1]);
  const pick = (id: string) => {
    const validId = isValidView(id) ? id : "home";
    setView(validId);
    setOpen(false);
    setPicked(new Set());
    setOpenLead(null);
    setSpam(null);
    setReview(null);
    // Remember what was opened, so the sidebar can show the last few campaigns and lists.
    const label = validId.startsWith("list:") ? lists.find((l) => l.id === validId.slice(5))?.name : PAGES[validId];
    if (label) { noteRecent(label, validId); setRecent(readRecent()); }
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("view") !== validId || u.searchParams.has("c")) {
        u.searchParams.set("view", validId);
        u.searchParams.delete("c");
        if ((isDemoMode || demo) && !u.searchParams.has("demo")) {
          u.searchParams.set("demo", "true");
        }
        history.pushState(null, "", `${u.pathname}${u.search}`);
      }
    } catch { /* address bar not available */ }
  };
  // The sidebar: Ctrl/Cmd+B folds it, Ctrl/Cmd+K goes to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); toggleSide(); }
      if (k === "k") { e.preventDefault(); document.querySelector<HTMLInputElement>(".kside-search input")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // A campaign opened inside the Campaigns page tells the sidebar its name, so it can join "Recent".
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { name?: string; id?: string } | null;
      if (d?.name && d.id) { noteRecent(d.name, "campaigns", d.id); setRecent(readRecent()); }
    };
    window.addEventListener("kestrel-open-campaign", on);
    return () => window.removeEventListener("kestrel-open-campaign", on);
  }, []);
  // Inbox Pro: a new reply anywhere in the App → message, sound, browser notification (if allowed).
  useReplyAlerts(Boolean(account && !demo && !preview), setToast, () => pick("inbox"));
  const kitWaiting = useKitResults(account?.team_id ?? null, Boolean(account && !demo && !preview && view !== "ai"));

  async function newList(suggest = ""): Promise<string | null> {
    if (!account || !editable) { setToast("Viewers cannot make lists."); return null; }
    const name = ((await askText("Name the new list", suggest.slice(0, 60))) || "").trim().slice(0, 60);
    if (!name) return null;
    if (demo) { const id = `demo-${Date.now()}`; setLists([...lists, { id, name }]); return id; }
    const { data, error } = await supabaseBrowser().from("lists").insert({ team_id: account.team_id, name }).select("id").single();
    if (error) { setToast(/duplicate|unique/i.test(error.message) ? "A list with that name already exists." : error.message); return null; }
    setLists([...lists, { id: data.id as string, name }].sort((a, b) => a.name.localeCompare(b.name)));
    return data.id as string;
  }
  async function addToList(listId: string, only?: string[], listName?: string) {
    const ids = only ?? [...picked];
    if (!account || !ids.length) return;
    if (!demo) for (let i = 0; i < ids.length; i += 500) {
      const { error } = await supabaseBrowser().from("list_leads").upsert(ids.slice(i, i + 500).map((lead_id) => ({ list_id: listId, lead_id, team_id: account.team_id })), { onConflict: "list_id,lead_id", ignoreDuplicates: true });
      if (error) { setToast(error.message); return; }
    }
    setInList({ ...inList, [listId]: [...new Set([...(inList[listId] ?? []), ...ids])] });
    setPicked(new Set());
    setToast(`Added ${ids.length} ${ids.length === 1 ? "lead" : "leads"} to ${listName ?? lists.find((l) => l.id === listId)?.name ?? "the list"}.`);
  }
  // Keep one search's leads apart for good: a list named after the search, with every lead it shows now.
  async function searchToList() {
    const g = searches.find((x) => x.key === search);
    if (!g || !shown.length) return;
    const name = `${g.label} · ${new Date(g.newest).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
    const id = await newList(name);
    if (id) await addToList(id, shown.map((l) => l.id), "the new list");
  }
  async function removeFromList() {
    const listId = view.slice(5), ids = [...picked];
    if (!account || !ids.length) return;
    if (!demo) {
      const { error } = await supabaseBrowser().from("list_leads").delete().eq("list_id", listId).in("lead_id", ids);
      if (error) { setToast(error.message); return; }
    }
    setInList({ ...inList, [listId]: (inList[listId] ?? []).filter((id) => !picked.has(id)) });
    setPicked(new Set());
  }
  // Lead panel → "Skip this kind": adds the category to the team's "Leave out" words (Rules), which every
  // connected extension uses when it collects (UX audit row 7). The lead itself is marked No.
  async function skipCategory(category: string, leadId: string) {
    const word = category.trim().toLowerCase().slice(0, 60);
    if (!account || !word) return;
    if (!(await askConfirm(`Skip “${word}” from now on?\nThe extension leaves out businesses with this word in their name or category, for your whole team (Rules → Collection filters → Leave out). This lead is marked No.`, { ok: "Skip it" }))) return;
    if (!demo) {
      const sb = supabaseBrowser();
      const { data, error } = await sb.from("team_rules").select("weights,tiers,rules,refine").eq("team_id", account.team_id).maybeSingle();
      if (error) { setToast(/team_rules|schema cache/i.test(error.message) ? "Rules are coming soon to your workspace." : error.message); return; }
      const r = (data ?? { weights: {}, tiers: {}, rules: [], refine: {} }) as { refine: Record<string, unknown> } & Record<string, unknown>;
      const words = String(r.refine?.excludeWords ?? "").split(",").map((w) => w.trim()).filter(Boolean);
      if (!words.map((w) => w.toLowerCase()).includes(word)) words.push(word);
      const { error: e2 } = await sb.from("team_rules").upsert({ ...r, team_id: account.team_id, refine: { ...(r.refine ?? {}), excludeWords: words.join(", ") }, updated_at: new Date().toISOString() }, { onConflict: "team_id" });
      if (e2) { setToast(e2.message); return; }
      await sb.from("leads").update({ verdict: "No" }).eq("id", leadId);
    }
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, verdict: "No" } : l)));
    setToast(`“${word}” is skipped from now on. Connected extensions use it the next time they open.`);
  }
  // Bulk Keep, Remove and verdicts for the ticked leads (UX audit row 50).
  async function bulk(patch: { status?: "kept" | "removed" | "new"; verdict?: "Good" | "Maybe" | "No" }, done: string) {
    const ids = [...picked];
    if (!account || !ids.length || !editable) return;
    if (!demo) for (let i = 0; i < ids.length; i += 300) {
      const { error } = await supabaseBrowser().from("leads").update(patch).in("id", ids.slice(i, i + 300));
      if (error) { setToast(error.message); return; }
    }
    const set = new Set(ids);
    setLeads((ls) => ls.map((l) => (set.has(l.id) ? { ...l, ...patch } : l)));
    setPicked(new Set());
    if (patch.status === "removed" && openLead && set.has(openLead)) {
      setOpenLead(null);
    }
    setToast(`${done} ${ids.length} ${ids.length === 1 ? "lead" : "leads"}.`);
  }
  // Pipeline moves (Leads → Pipeline): Good / Not a fit / back to review change the lead's mark; Meeting, Won and Lost are
  // saved on the lead with set_lead_result (database 058), which also updates its reply status in Replies.
  async function movePipeline(l: LeadRow, to: PipelineMove) {
    if (!editable) return;
    if (to === "review" || to === "good" || to === "nofit") {
      const patch = to === "review" ? { verdict: null, status: "new" as const } : { verdict: (to === "good" ? "Good" : "No") as "Good" | "No" };
      if (!demo) { const { error } = await supabaseBrowser().from("leads").update(patch).eq("id", l.id); if (error) { setToast(error.message); return; } }
      setLeads((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...patch } : x)));
      setToast(to === "review" ? `${l.name ?? "Lead"} is back in To review.` : to === "good" ? `${l.name ?? "Lead"} marked Good.` : `${l.name ?? "Lead"} marked Not a fit.`);
      return;
    }
    let value: number | null = null, reason: string | null = null;
    if (to === "won") {
      const t = await askText(`Deal value for ${l.name ?? "this lead"} (optional, for example 1500)`, "", { ok: "Mark Won", placeholder: "1500" });
      if (t === null) return;
      value = parseMoney(t);
      if (Number.isNaN(value)) { setToast("Type a number, for example 1500."); return; }
    }
    if (to === "lost") {
      const t = await askText(`Why was ${l.name ?? "this lead"} lost? (Not interested, Not now, Wrong person, Too expensive, Chose someone else, No answer…)`, "Not interested", { ok: "Mark Lost" });
      if (t === null) return;
      reason = t.trim().slice(0, 120) || null;
    }
    if (!demo) {
      const { error } = await supabaseBrowser().rpc("set_lead_result", { lead: l.id, result: to, deal_value: value, currency: value === null ? null : "USD", reason });
      if (error) { setToast(/set_lead_result|schema cache/i.test(error.message) ? "Meeting, Won and Lost need database update 058." : error.message); return; }
    }
    const result = { stage: to, value, currency: value === null ? null : "USD", reason, at: new Date().toISOString() };
    setLeads((ls) => ls.map((x) => (x.id === l.id ? { ...x, result } : x)));
    setToast(`${l.name ?? "Lead"} moved to ${to === "won" ? "Won" : to === "lost" ? "Lost" : "Meeting"}.`);
  }
  // Delete for good (database 052): only leads already in Removed. Campaign history keeps the email it sent to; the
  // extension will not add these businesses back (a CSV import or backup upload in the App still can).
  async function deleteForGood(all: boolean) {
    const ids = leads.filter((l) => l.status === "removed" && (all || picked.has(l.id))).map((l) => l.id);
    if (!account || !ids.length || !editable) return;
    const n = ids.length.toLocaleString(), one = ids.length === 1;
    if (!await askConfirm(`Delete ${n} ${one ? "lead" : "leads"} for good?\nThis cannot be undone. ${one ? "It leaves" : "They leave"} the App, your lists and your team's exports. Campaign history keeps the email it sent to, and the extension will not add ${one ? "it" : "them"} back.`, { ok: "Delete for good", danger: true })) return;
    let done = 0, failed = "";
    const gone = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const part = ids.slice(i, i + 1000);
      if (!demo) {
        const { data, error } = await supabaseBrowser().rpc("delete_leads", { ids: part });
        if (error) { failed = /delete_leads|PGRST202|schema cache/i.test(error.message) ? "Delete for good needs the newest database update (052)." : error.message; break; }
        done += Number(data) || 0;
      } else done += part.length;
      part.forEach((id) => gone.add(id));
    }
    if (gone.size) setLeads((ls) => ls.filter((l) => !gone.has(l.id)));
    if (failed || !done) { setToast(failed || "Nothing was deleted. Your role or plan may not allow it."); return; }
    setPicked(new Set());
    setToast(`Deleted ${done.toLocaleString()} ${done === 1 ? "lead" : "leads"} for good.`);
  }
  async function deleteList() {
    const listId = view.slice(5);
    if (!await askConfirm(`Delete the list "${listName}"? The leads stay; only the list goes.`)) return;
    if (!demo) { const { error } = await supabaseBrowser().from("lists").delete().eq("id", listId); if (error) { setToast(error.message); return; } }
    setLists(lists.filter((l) => l.id !== listId)); pick("all");
  }
  // Find Emails with the team's Hunter.io key (on the App's server), 10 leads per call, like the extension.
  async function findEmails(list: LeadRow[]) {
    if (!editable) { setToast("Your role or plan cannot change leads."); return; }
    if (demo) { setToast("Find Emails needs a signed-in team with a Hunter.io key."); return; }
    const todo = list.filter((l) => l.status !== "removed" && !l.email && !blocked(l) && (l.website || l.name));
    if (!todo.length) { setToast("These leads already have emails, or are on Do-not-contact."); return; }
    const info = await fetch("/api/emails").then((r) => r.json()).catch(() => ({ error: "No connection." })) as { left?: number | null; error?: string };
    if (info.error) { setToast(info.error); if (/Integrations|Connections/.test(info.error)) pick("connections"); return; }
    const left = typeof info.left === "number" ? ` You have about ${info.left.toLocaleString()} Hunter credits left this month.` : "";
    if (!await askConfirm(`Look up emails for ${todo.length.toLocaleString()} ${todo.length === 1 ? "lead" : "leads"} with Hunter.io? Each lookup that finds emails uses a Hunter credit.${left}`)) return;
    stopFind.current = false;
    let done = 0, found = 0;
    setFinding({ done, total: todo.length, found });
    for (let i = 0; i < todo.length && !stopFind.current; i += 10) {
      const r = await fetch("/api/emails", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: todo.slice(i, i + 10).map((l) => l.id) }) })
        .then((x) => x.json()).catch(() => ({ error: "No connection. Stopped." })) as { done?: { id: string; email: string | null; named: boolean; website: string | null }[]; skipped?: unknown[]; error?: string };
      const got = r.done ?? [];
      if (got.length) setLeads((all) => all.map((l) => { const g = got.find((x) => x.id === l.id); return g ? { ...l, email: g.email, named: g.named, website: l.website || g.website } : l; }));
      done += got.length + (r.skipped?.length ?? 0); found += got.filter((x) => x.email).length;
      setFinding({ done: Math.min(done, todo.length), total: todo.length, found });
      if (r.error) { setToast(r.error); break; }
    }
    setFinding(null);
    setToast(`Hunter: ${found.toLocaleString()} of ${done.toLocaleString()} ${done === 1 ? "lead" : "leads"} now have an email.`);
  }
  // Verify emails (database 044): Valid / Invalid / Risky before outreach, 25 leads per call. Kestrel's own checks first,
  // then the team's verifier server (when set up) and Hunter (with the team's key) for whether the mailbox exists.
  async function verifyEmails(list: LeadRow[]) {
    if (!editable) { setToast("Your role or plan cannot change leads."); return; }
    if (demo) { setToast("Verify emails needs a signed-in team."); return; }
    const todo = list.filter((l) => l.status !== "removed" && l.email && !blocked(l));
    if (!todo.length) { setToast("None of these leads has an email to check."); return; }
    if (!await askConfirm(`Check ${todo.length.toLocaleString()} ${todo.length === 1 ? "email" : "emails"}? Kestrel checks the format and domain, then asks your verifier server (or Hunter, which uses a credit per check) whether each mailbox exists. Nothing is sent.`)) return;
    stopFind.current = false;
    let done = 0, valid = 0, invalid = 0, risky = 0, note = "";
    setVerifying({ done, total: todo.length });
    for (let i = 0; i < todo.length && !stopFind.current; i += 25) {
      const r = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: todo.slice(i, i + 25).map((l) => l.id) }) })
        .then((x) => x.json()).catch(() => ({ error: "No connection. Stopped." })) as { done?: { id: string; status: LeadRow["email_status"]; reason: string }[]; skipped?: unknown[]; note?: string; error?: string };
      const got = r.done ?? [];
      if (got.length) setLeads((all) => all.map((l) => { const g = got.find((x) => x.id === l.id); return g ? { ...l, email_status: g.status, email_check: { reason: g.reason } } : l; }));
      done += got.length + (r.skipped?.length ?? 0);
      valid += got.filter((x) => x.status === "valid").length; invalid += got.filter((x) => x.status === "invalid").length; risky += got.filter((x) => x.status === "risky").length;
      if (r.note) note = r.note;
      setVerifying({ done: Math.min(done, todo.length), total: todo.length });
      if (r.error) { setToast(r.error); break; }
    }
    setVerifying(null);
    const unchecked = Math.max(0, done - valid - invalid - risky);
    setToast(`Checked ${done.toLocaleString()}: ${valid} valid, ${invalid} invalid, ${risky} risky${unchecked ? `, ${unchecked} not confirmed (format and domain fine)` : ""}.${note ? ` ${note}` : ""}`);
  }
  // Add emails or domains to the team's Do-not-contact list. Returns how many were new.
  async function addDnc(items: { entry: string; reason?: string }[]): Promise<number> {
    if (!account || !canBlock) { setToast("Viewers cannot change the Do-not-contact list."); return 0; }
    const have = new Set(dnc.map((r) => r.entry));
    const fresh = [...new Map(items.map((x) => [normalizeDnc(x.entry), (x.reason || "").trim().slice(0, 200) || null] as const)).entries()]
      .filter(([e]) => e && !have.has(e));
    if (!fresh.length) return 0;
    const now = new Date().toISOString();
    if (!demo) {
      for (let i = 0; i < fresh.length; i += 1000) {
        const { error } = await supabaseBrowser().from("do_not_contact").upsert(fresh.slice(i, i + 1000).map(([entry, reason]) => ({ team_id: account.team_id, entry, reason })), { onConflict: "team_id,entry", ignoreDuplicates: true });
        if (error) { setToast(/do_not_contact|schema cache/i.test(error.message) ? "Do-not-contact is coming soon to your workspace." : error.message); return 0; }
      }
    }
    setDnc((d) => [...fresh.map(([entry, reason]) => ({ entry, reason, created_at: now })), ...d]);
    return fresh.length;
  }
  async function removeDnc(entry: string) {
    if (!account || !editable) return;
    if (!demo) { const { error } = await supabaseBrowser().from("do_not_contact").delete().eq("team_id", account.team_id).eq("entry", entry); if (error) { setToast(error.message); return; } }
    setDnc((d) => d.filter((r) => r.entry !== entry));
  }
  async function saveView() {
    const name = ((await askText("Name this view", title)) || "").trim().slice(0, 40);
    if (!name) return;
    keepViews([...views.filter((v) => v.name !== name), { name, view, query }]);
    setToast(`Saved "${name}".`);
  }

  // One collapsible group of the left bar.
  // The Leads filters (chips, search, source, added, campaign state) and actions: one piece for both designs.
  const filterBar = leads.length ? <div className="filter-bar">
    {FILTERS.map(([id, label]) => (
      <button key={id} type="button" className={filters.has(id) ? "on" : ""} onClick={() => { const n = new Set(filters); if (n.has(id)) n.delete(id); else n.add(id); setFilters(n); }}>{label}</button>
    ))}
    {searches.length > 1 ? (
      <select className="src-filter search-filter" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)}>
        <option value="">All searches ({searches.length.toLocaleString()})</option>
        {searches.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.count.toLocaleString()}) · {new Date(g.newest).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</option>)}
      </select>) : null}
    <select className="src-filter" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
      <option value="">All sources</option>
      {SOURCES.filter(([id]) => count(id)).map(([id, label]) => <option key={id} value={id}>{label} ({count(id).toLocaleString()})</option>)}
    </select>
    {Object.keys(mailState).length ? (
      <select className="src-filter" aria-label="Campaign" value={mailed} onChange={(e) => setMailed(e.target.value)}>
        <option value="">Any campaign state</option><option value="emailed">Emailed</option><option value="queued">Waiting to send</option><option value="none">Not in a campaign</option>
      </select>) : null}
    <select className="src-filter" aria-label="Added" value={added} onChange={(e) => setAdded(Number(e.target.value))}>
      <option value={0}>Added any time</option><option value={1}>Added today</option><option value={7}>Added in 7 days</option><option value={30}>Added in 30 days</option>
    </select>
    {search && editable && shown.length ? <button type="button" className="link-btn" onClick={searchToList}>Save as a list</button> : null}
    {filters.size || source || added || search || mailed ? <button type="button" className="link-btn" onClick={() => { setFilters(new Set()); setSource(""); setAdded(0); setSearch(""); setMailed(""); }}>Clear filters</button> : null}
    <button type="button" className="btn small glass export-btn" disabled={Boolean(finding) || !shown.some((l) => !l.email)} onClick={() => findEmails(picked.size ? shown.filter((l) => picked.has(l.id)) : shown)} title="Look up missing emails with Hunter.io">{picked.size ? `Find emails for ${picked.size}` : "Find emails"}</button>
    <button type="button" className="btn small glass" disabled={Boolean(finding) || Boolean(verifying) || !shown.some((l) => l.email)} onClick={() => verifyEmails(picked.size ? shown.filter((l) => picked.has(l.id)) : shown)} title="Check that each email exists before outreach (nothing is sent)">{picked.size ? `Verify ${picked.size} selected` : "Verify emails"}</button>
    <button type="button" className="btn small go" disabled={!shown.length} onClick={() => setReview((picked.size ? shown.filter((l) => picked.has(l.id)) : shown).slice(0, 2000))} title="Review these leads one by one (keys 1, 2, 3)">{picked.size ? `Review ${picked.size} selected` : "Review"}</button>
    <button type="button" className="btn small glass" disabled={!shown.length} onClick={exportCsv}>{picked.size ? `Export ${picked.size} selected` : "Export CSV"}</button>
  </div> : null;
  // Design v2 groups: an item with a chevron that opens into dot-bullet sub items (the kit's E-Commerce).
  // Like Claude's sidebar: one group open at a time (the page you are on, unless you open another), sliding open and shut.
  const kgroup = (id: GroupId, icon: string, label: string, items: React.ReactNode) => {
    const here = groupOf(view) === id, isOpen = (kOpen === undefined ? groupOf(view) : kOpen) === id;
    const flip = () => { if (folded) { toggleSide(); return; } setKOpen(isOpen ? null : id); };
    return (
      <div className={`kside-g${isOpen ? " open" : ""}${here ? " here" : ""}`}>
        <button type="button" className={`knav${here ? " on" : ""}`} aria-expanded={isOpen} onClick={flip} title={label}>
          <span className="knav-ic"><Line name={icon} filled={here} /></span><span className="knav-lb">{label}</span><span className="knav-chev" aria-hidden="true"><Line name="chevron" /></span>
        </button>
        <div className="kside-subwrap" inert={!isOpen}><div className="kside-sub">{items}</div></div>
      </div>
    );
  };

  return (
    <div className={`app${open ? " open" : ""}${folded ? " collapsed" : ""}${dragging ? " resizing" : ""}${chatFrame ? " chat-frame" : ""}`} style={{ "--side-w": `${sideW}px` } as React.CSSProperties}>
      <div className="side-resize" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={collapsed ? 68 : sideW}
        tabIndex={0} title="Drag to resize · double-click to reset" onPointerDown={startDrag} onKeyDown={keyDrag}
        onDoubleClick={() => { setCollapsed(false); setSideW(SIDE_W); saveW(SIDE_W); try { localStorage.setItem("kestrel-side", "0"); } catch { /* ignore */ } }} />
      <a className="skip-link" href="#content">Skip to content</a>
      <aside className="side kside" aria-label="Menu"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (Math.abs(dx) > 70) { setOpen(dx > 0); }
        }}
      >
        <div className="kside-logo">
          <button type="button" className="brand-btn" onClick={() => pick("home")} aria-label="Kestrel home"><Brand /></button>
          <button type="button" className="side-collapse" onClick={toggleSide} aria-label={folded ? "Expand sidebar" : "Collapse sidebar"} title={folded ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)"}>
            <Line name="sidebar" />
          </button>
        </div>
        <div className="kside-scroll">
          <div className="kside-sec">Outreach</div>
          <nav className="kside-nav" aria-label="Outreach">
            <KNav icon="home" label="Home" on={view === "home"} onClick={() => pick("home")} />
            {kgroup("leads", "grid", "Leads", <>
              <KSub label="All leads" count={count("all")} on={SMART.some((x) => x[0] === view)} onClick={() => pick(SMART.some((x) => x[0] === view) ? view : "all")} />
              {lists.map((l) => <KSub key={l.id} label={l.name} count={(inList[l.id] ?? []).length} on={view === `list:${l.id}`} onClick={() => pick(`list:${l.id}`)} />)}
              {views.map((v) => <KSub key={v.name} label={v.name} onClick={() => { pick(v.view); setQuery(v.query); }} />)}
              <KSub label="Rules" on={view === "rules"} onClick={() => pick("rules")} />
              <KSub label="Leads added" on={view === "activity"} onClick={() => pick("activity")} />
            </>)}
            <KNav icon="send" label="Campaigns" on={view === "campaigns"} onClick={() => pick("campaigns")} />
            <KNav icon="steps" label="Sequences" on={view === "sequences"} onClick={() => pick("sequences")} />
            <KNav icon="inbox" label="Replies" on={view === "inbox"} onClick={() => pick("inbox")} />
            <KNav icon="chart" label="Pipeline" on={view === "pipeline"} onClick={() => pick("pipeline")} />
          </nav>
          <div className="kside-sec">Setup</div>
          <nav className="kside-nav" aria-label="Setup">
            <KNav icon="at" label="Email accounts" on={view === "mailboxes"} onClick={() => pick("mailboxes")} />
            <KNav icon="building" label="Your business" on={view === "about"} onClick={() => pick("about")} />
            <KNav icon="shield" label="Deliverability" on={view === "placement"} onClick={() => pick("placement")} />
            <KNav icon="plug" label="Integrations" on={INTEGRATION_TABS.some((t) => t[0] === view)} onClick={() => pick("get")} />
          </nav>
          <div className="kside-sec">AI</div>
          <nav className="kside-nav" aria-label="AI">
            <KNav icon="sparkle" label="Kestrel AI" on={view === "ai" || view === "assistant"} onClick={() => pick("ai")} />
            <KNav icon="bolt" label="Autopilot" on={view === "autopilot"} onClick={() => pick("autopilot")} />
          </nav>
          <div className="kside-sec">More</div>
          <nav className="kside-nav" aria-label="More">
            <KNav icon="clipboard" label="Tasks" on={view === "tasks"} onClick={() => pick("tasks")} />
            <KNav icon="chart" label="Analytics" on={view === "analytics"} onClick={() => pick("analytics")} />
            {kgroup("find", "gauge", "Find leads", <>
              <KSub label="Search progress" on={view === "progress"} onClick={() => pick("progress")} />
              {SOURCES.filter(([id]) => count(id) || view === id).map(([id, label]) => <KSub key={id} label={label} count={count(id)} on={view === id} onClick={() => pick(id)} />)}
            </>)}
            {kgroup("settings", "settings", "Settings", <>
              <KSub label="Team" on={view === "team"} onClick={() => pick("team")} />
              <KSub label="Plan and billing" on={view === "plan"} onClick={() => pick("plan")} />
              <KSub label="Do-not-contact" count={dnc.length} on={view === "dnc"} onClick={() => pick("dnc")} />
              <KSub label="Import and examples" on={view === "import"} onClick={() => pick("import")} />
            </>)}
            <KNav icon="crown" label="Owner" on={view === "owner"} onClick={() => pick("owner")} />
            {isCreator ? <KNav icon="star" label="Creator" on={view === "creator"} onClick={() => pick("creator")} /> : null}
            <KNav icon="book" label="Guide" onClick={() => window.open("/help", "_blank")} />
          </nav>
        </div>
        {account ? (
          <div className="kside-user">
            <button type="button" className="kside-user-btn" onClick={() => setUserMenu((v) => !v)} aria-expanded={userMenu} aria-haspopup="menu">
              <PersonAvatar name={account.full_name || email || "You"} photo={account.avatar} size={28} />
              <span className="kside-user-txt">
                <b>{account.full_name || email || "You"}</b>
                <small>{account.plan === "trial" ? `Pro · trial ${daysLeft(account.trial_ends_at)} days` : `${planName(account.plan as PlanId)} · ${account.active === false ? "read only" : "active"}`}</small>
              </span>
              <i className="kcaret" aria-hidden="true" />
            </button>
            {userMenu ? (
              <div className="kmenu kside-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setUserMenu(false); pick("profile"); }}><Line name="person" /> Profile</button>
                <button type="button" role="menuitem" onClick={() => { setUserMenu(false); pick("team"); }}><Line name="users" /> Team</button>
                <button type="button" role="menuitem" onClick={() => { setUserMenu(false); pick("plan"); }}><Line name="card" /> Plan and billing</button>
                <button type="button" role="menuitem" onClick={() => { setUserMenu(false); pick("profile"); }}><Line name="sliders" /> Settings</button>
                <div className="kmenu-sep" role="separator" />
                <p className="kmenu-h">Theme</p>
                <div className="kside-theme" role="group" aria-label="Theme">
                  {(["auto", "light", "dark", "gradient"] as const).map((t) => (
                    <button type="button" key={t} role="menuitemradio" aria-checked={look.theme === t} className={look.theme === t ? "on" : ""}
                      onClick={() => { const l = { ...look, theme: t }; setLook(l); saveLook(l); }}>{t === "auto" ? "Automatic" : t === "light" ? "Light" : t === "dark" ? "Dark" : "Gradient"}</button>
                  ))}
                </div>
                <div className="kmenu-sep" role="separator" />
                <form action="/auth/signout" method="post" style={{ display: "contents" }}>
                  <button type="button" role="menuitem" className="form-signout" onClick={(e) => { setUserMenu(false); e.currentTarget.form?.requestSubmit(); }}><Line name="logout" /> Log out</button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
      <button type="button" className="side-scrim" aria-label="Close the menu" onClick={() => setOpen(false)} />

      <main className="pane" id="content" tabIndex={-1}>
        <div className="app-band" aria-hidden="true" />
        {(isDemoMode || account?.team_id === "demo") ? (
          <div className="demo-mode-band" role="status" style={{
            background: "var(--card, #ffffff)",
            borderBottom: "1px solid var(--line, #e2e8f0)",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "var(--text-dim, #64748b)",
            zIndex: 40,
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{
                background: "#D97706",
                color: "#ffffff",
                padding: "2px 8px",
                borderRadius: "9999px",
                fontWeight: 600,
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.5px"
              }}>Demo Sandbox</span>
              <span>You are viewing Kestrel with synthetic demo data. Outbound email sending and live integrations are disabled.</span>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <a href="/login" className="btn small" style={{ borderRadius: "9999px", textDecoration: "none", fontSize: "12px", padding: "4px 12px" }}>Sign In</a>
              <a href="/signup" className="btn go small" style={{ borderRadius: "9999px", textDecoration: "none", fontSize: "12px", padding: "4px 12px" }}>Start Free Trial</a>
            </div>
          </div>
        ) : null}
        <div className="app-top">
          <button type="button" className="btn small" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><span className="ic" style={{ width: 18, height: 18, display: "inline-flex" }}><Line name="sidebar" /></span></button>
          <Brand />
          <form className="ai-search" role="search" onSubmit={(e) => {
            e.preventDefault();
            const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value;
            if (q.trim()) {
              chatAskId.current += 1;
              setChatAsk({ text: q.trim(), id: chatAskId.current });
              setSearchQ("");
              pick("ai");
            }
          }}>
            <Line name="sparkle" />
            <input name="q" type="search" placeholder="Ask Kestrel anything…" aria-label="AI search" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          </form>
        </div>
        {false ? (
          <div className="lock-band kit-band" role="status">
            <div><b>{kitWaiting} AI kit {kitWaiting === 1 ? "result is" : "results are"} waiting</b><span>Claude Code or Codex finished. Import the verdicts or emails into Kestrel.</span></div>
            <button type="button" className="btn go" onClick={() => pick("ai")}>Import now</button>
          </div>
        ) : null}
        {account && account.active === false && lock ? (
          <div className="lock-band" role="status">
            <div><b>Your team is locked by Kestrel</b><span>Kestrel is read-only now: no sending, no AI and no new leads. Reason: {lock.reason || "a breach of the Kestrel rules"}. Write to us from the Contact page to sort it out.</span></div>
          </div>
        ) : account && account.active === false && view !== "plan" ? (
          <div className="lock-band" role="status">
            <div><b>Your free trial has ended</b><span>Kestrel is read-only now: you can still see and export your leads, but the extension cannot add new ones. {account.role === "owner" ? "Choose a plan to carry on." : "Ask your team owner to choose a plan."}</span></div>
            <button type="button" className="btn go" onClick={() => pick("plan")}>Choose a plan</button>
          </div>
        ) : null}
        <ViewErrorBoundary key={`${account?.team_id ?? (demo ? "demo" : "anon")}-${view}`} viewName={view} onReset={reload} onNavigateHome={() => pick("home")}>
        {view === "home" ? <HomeView account={account} leads={leads} loaded={loaded || (!account && !loading)} email={email} go={pick} demo={Boolean(demo) || !account} onSpam={() => setSpam({ subject: "", body: "" })} onLead={setOpenLead} />
          : (view === "ai" || view === "assistant") ? <AssistantView account={account} demo={Boolean(demo)} editable={editable} toast={setToast} go={pick} addDnc={addDnc} onChanged={reload} dnc={dnc}
            question={chatAsk} onAsked={() => setChatAsk(null)} onChatFrame={setChatFrame}
            tools={<AiView account={account} leads={leads} demo={Boolean(demo)} editable={editable} toast={setToast} go={pick} blocked={blocked}
              onLeads={(p) => setLeads((ls) => ls.map((l) => (p[l.id] ? { ...l, ...p[l.id] } : l)))} />} />
            : view === "mailboxes" ? <MailboxesView account={account} demo={Boolean(demo)} toast={setToast} />
              : view === "analytics" ? <AnalyticsView demo={Boolean(demo)} />
                : view === "tasks" ? <TasksView account={account} demo={Boolean(demo)} toast={setToast} go={pick} />
                  : view === "placement" ? <PlacementView account={account} demo={Boolean(demo)} toast={setToast} go={pick} />
                    : view === "inbox" ? <InboxView account={account} demo={Boolean(demo)} editable={editable} toast={setToast} />
                      : view === "campaigns" ? <CampaignsView account={account} leads={leads} demo={Boolean(demo)} editable={editable} toast={setToast} blocked={blocked} go={pick} me={email} lists={lists} inList={inList} />
                        : view === "sequences" ? <SequencesView account={account} leads={leads} demo={Boolean(demo)} editable={editable} toast={setToast} blocked={blocked} go={pick} />
                          : view === "about" ? <AboutView account={account} demo={Boolean(demo) || !account} editable={editable} toast={setToast} />
                            : view === "pipeline" ? (
                              <div className="app-page kpage">
                                <header className="khead"><h1>Pipeline <Tip text="Every lead is in one stage, worked out from what Kestrel knows (reviewed, email found, email written, in a campaign, replied). Drag a card to another column, or use its Move menu. Meeting, Won and Lost are saved on the lead." /></h1></header>
                                <PipelineView leads={leads} mailState={mailState} convStage={convStage} editable={editable} onMove={movePipeline} onOpen={setOpenLead} onView={pick} />
                              </div>
                            ) : view === "rules" ? <RulesView account={account} leads={leads} demo={Boolean(demo)} toast={setToast} onLeads={(p) => setLeads((ls) => ls.map((l) => (p[l.id] ? { ...l, ...p[l.id] } : l)))} />
                              : view === "dnc" ? <DncView rows={dnc} leads={leads} canBlock={canBlock} canRemove={editable} add={addDnc} remove={removeDnc} />
                                : view === "owner" ? <OwnerView toast={setToast} />
                                  : view === "creator" && isCreator ? <CreatorPage toast={setToast} />
                                    : view === "plan" ? <PlanView account={account} />
                                      : view === "team" ? <TeamView account={account} go={pick} />
                                        : view === "import" ? <ImportView account={account} onDone={reload} dnc={dnc} demo={Boolean(demo)} />
                                          : view === "profile" ? <ProfileView account={account} email={email} />
                                            : INTEGRATION_TABS.some((t) => t[0] === view) ? <IntegrationsView tab={view} go={pick} account={account} email={email} demo={Boolean(demo)} toast={setToast} />
                                              : view === "progress" ? <ProgressView account={account} go={pick} />
                                                : view === "activity" ? <ActivityView leads={leads} />
                                                  : view === "autopilot" ? <AutopilotView account={account} leads={leads} demo={Boolean(demo)} editable={editable} toast={setToast} go={pick} blocked={blocked} lists={lists} inList={inList} onChanged={reload} /> : (
                                                    // Design v2: Leads laid out exactly like the Flower kit's "E-Commerce - Orders V.1".
                                                    <div className="kpage">
                                                      <header className="khead">
                                                        <h1>{title}</h1>
                                                        <details className="kdrop kdrop-right">
                                                          <summary className="kbtn"><Line name="down" /> Export <i className="kcaret" aria-hidden="true" /></summary>
                                                          <div className="kmenu" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
                                                            <button type="button" disabled={!shown.length} onClick={exportCsv}>{picked.size ? `Export ${picked.size} selected (CSV)` : `Export ${shown.length.toLocaleString()} leads (CSV)`}</button>
                                                            <button type="button" onClick={saveView}>Save this view in the menu</button>
                                                            <button type="button" onClick={async () => { const id = await newList(); if (id) pick(`list:${id}`); }}>New list</button>
                                                          </div>
                                                        </details>
                                                      </header>
                                                      {account && !demo && !loaded && !loadError ? <p className="plan-msg" role="status">Loading your leads…{leads.length ? ` ${leads.length.toLocaleString()} so far.` : ""}</p> : null}
                                                      {loadError ? <p className="plan-msg lock-msg" role="alert">Your leads did not load (the database answered: “{loadError.slice(0, 160)}”). Nothing is lost. <button type="button" className="link-btn" onClick={reload}>Try again</button></p> : null}
                                                      {SMART.some((x) => x[0] === view) ? (
                                                        <div className="ktabs" role="tablist" aria-label="Lead lists">
                                                          {SMART.map(([id, label]) => (
                                                            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => pick(id)}>{label} <small>{count(id).toLocaleString()}</small></button>
                                                          ))}
                                                        </div>
                                                      ) : null}
                                                      <section className="kcard klead-view-card">
                                                        <div className="kcard-tools">
                                                          <label className="kinput">
                                                            <Line name="search" />
                                                            <input type="search" placeholder="Search leads..." aria-label="Search leads" value={query} onChange={(e) => setQuery(e.target.value)} />
                                                            <button type="button" className={`kinput-btn${kitFilters ? " on" : ""}`} aria-label="Filters" aria-expanded={kitFilters} onClick={() => setKitFilters(!kitFilters)}><Line name="sliders" /></button>
                                                          </label>
                                                          <details className="kdrop kdrop-right">
                                                            <summary className="kbtn">Actions <i className="kcaret" aria-hidden="true" /></summary>
                                                            <div className="kmenu" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
                                                              <p className="kmenu-h">{picked.size ? `${picked.size.toLocaleString()} selected` : `All ${shown.length.toLocaleString()} shown`}</p>
                                                              {picked.size ? <>
                                                                <button type="button" disabled={!editable} onClick={() => bulk({ verdict: "Good" }, "Marked Good:")}>Mark Good</button>
                                                                <button type="button" disabled={!editable} onClick={() => bulk({ verdict: "Maybe" }, "Marked Maybe:")}>Mark Maybe</button>
                                                                <button type="button" disabled={!editable} onClick={() => bulk({ verdict: "No" }, "Marked No:")}>Mark No</button>
                                                                <button type="button" disabled={!editable} onClick={() => bulk({ status: "kept" }, "Kept")}>Keep</button>
                                                                {view === "removed" ? <button type="button" disabled={!editable} onClick={() => bulk({ status: "new" }, "Put back")}>Put back</button>
                                                                  : <button type="button" disabled={!editable} onClick={() => bulk({ status: "removed" }, "Removed")}>Remove</button>}
                                                                {lists.map((l) => <button key={l.id} type="button" disabled={!editable} onClick={() => addToList(l.id)}>Add to “{l.name}”</button>)}
                                                                <button type="button" disabled={!editable} onClick={async () => { const id = await newList(); if (id) addToList(id); }}>Add to a new list…</button>
                                                                {view.startsWith("list:") ? <button type="button" disabled={!editable} onClick={removeFromList}>Remove from this list</button> : null}
                                                                <hr />
                                                              </> : null}
                                                              <button type="button" disabled={Boolean(finding) || !shown.some((l) => !l.email)} onClick={() => findEmails(picked.size ? shown.filter((l) => picked.has(l.id)) : shown)}>Find emails</button>
                                                              <button type="button" disabled={Boolean(finding) || Boolean(verifying) || !shown.some((l) => l.email)} onClick={() => verifyEmails(picked.size ? shown.filter((l) => picked.has(l.id)) : shown)}>Verify emails</button>
                                                              <button type="button" disabled={!shown.length} onClick={() => setReview((picked.size ? shown.filter((l) => picked.has(l.id)) : shown).slice(0, 2000))}>Review one by one</button>
                                                              {shown.length > rows.length && picked.size < shown.length ? <button type="button" onClick={() => setPicked(new Set(shown.map((l) => l.id)))}>Select all {shown.length.toLocaleString()}</button> : null}
                                                              {picked.size ? <button type="button" onClick={() => setPicked(new Set())}>Clear selection</button> : null}
                                                              {search && editable && shown.length ? <button type="button" onClick={searchToList}>Save this search as a list</button> : null}
                                                              {view.startsWith("list:") && editable ? <><hr /><button type="button" className="danger" onClick={deleteList}>Delete this list</button></> : null}
                                                              {view === "removed" && editable ? <><hr /><button type="button" className="danger" onClick={() => deleteForGood(picked.size === 0)}>{picked.size ? "Delete selected for good" : "Empty Removed"}</button></> : null}
                                                            </div>
                                                          </details>
                                                        </div>
                                                        {kitFilters ? <div className="kfilters">{filterBar}</div> : null}
                                                        {finding || verifying ? <p className="kstatus" role="status">{finding ? `Finding emails: ${finding.done.toLocaleString()} of ${finding.total.toLocaleString()}` : `Verifying emails: ${verifying!.done.toLocaleString()} of ${verifying!.total.toLocaleString()}`} <button type="button" className="link-btn" onClick={() => { stopFind.current = true; }}>Stop</button></p> : null}
                                                        {/* Header / Sub-bar with select-all and column labels */}
                                                        <div className="klead-list-head">
                                                          <div className="klead-head-chk-col">
                                                            <div
                                                              className="klead-chk-box klead-head-chk-lbl"
                                                              role="button"
                                                              tabIndex={0}
                                                              aria-label="Select all on this page"
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPicked((prev) => {
                                                                  const allSelected = rows.length > 0 && rows.every((l) => prev.has(l.id));
                                                                  const n = new Set(prev);
                                                                  if (allSelected) {
                                                                    rows.forEach((l) => n.delete(l.id));
                                                                  } else {
                                                                    rows.forEach((l) => n.add(l.id));
                                                                  }
                                                                  return n;
                                                                });
                                                              }}
                                                              onKeyDown={(e) => {
                                                                if (e.key === "Enter" || e.key === " ") {
                                                                  e.preventDefault();
                                                                  e.currentTarget.click();
                                                                }
                                                              }}
                                                            >
                                                              <input
                                                                type="checkbox"
                                                                aria-label="Select this page"
                                                                checked={rows.length > 0 && rows.every((l) => picked.has(l.id))}
                                                                readOnly
                                                                style={{ pointerEvents: "none" }}
                                                              />
                                                            </div>
                                                          </div>
                                                          <div className="klead-col-biz">Business & Online</div>
                                                          <div className="klead-col-contact">Contact (Email & Phone)</div>
                                                          <div className="klead-col-socials">Social Media</div>
                                                          <div className="klead-col-fit">Evaluation / Fit</div>
                                                          <div className="klead-col-action">Action</div>
                                                        </div>

                                                        {/* Individual Lead Cards: separately one by one */}
                                                        <div className="klead-cards-wrap" role="list">
                                                          {rows.map((l) => {
                                                            const isGood = l.verdict === "Good";
                                                            const isMaybe = l.verdict === "Maybe";
                                                            const isNo = l.verdict === "No";

                                                            return (
                                                              <div
                                                                key={l.id}
                                                                role="listitem"
                                                                className={`klead-card${picked.has(l.id) ? " sel" : ""}`}
                                                                draggable
                                                                onDragStart={(e) => {
                                                                  const list = picked.has(l.id) ? leads.filter((x) => picked.has(x.id)).slice(0, 50) : [l];
                                                                  e.dataTransfer.effectAllowed = "copy";
                                                                  e.dataTransfer.setData(LEADS_DRAG, JSON.stringify(list.map((x) => ({ id: x.id, name: x.name ?? "Lead" }))));
                                                                }}
                                                                onClick={() => setOpenLead(l.id)}
                                                                tabIndex={0}
                                                                onKeyDown={(e) => {
                                                                  if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                                                                    e.preventDefault();
                                                                    setOpenLead(l.id);
                                                                  }
                                                                }}
                                                              >
                                                                {/* Checkbox */}
                                                                <div
                                                                  className="klead-chk-box"
                                                                  role="button"
                                                                  tabIndex={0}
                                                                  aria-label={`Select ${l.name}`}
                                                                  onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setPicked((prev) => {
                                                                      const n = new Set(prev);
                                                                      if (n.has(l.id)) n.delete(l.id);
                                                                      else n.add(l.id);
                                                                      return n;
                                                                    });
                                                                  }}
                                                                  onKeyDown={(e) => {
                                                                    if (e.key === "Enter" || e.key === " ") {
                                                                      e.preventDefault();
                                                                      e.currentTarget.click();
                                                                    }
                                                                  }}
                                                                >
                                                                  <input
                                                                    type="checkbox"
                                                                    aria-label={`Select ${l.name}`}
                                                                    checked={picked.has(l.id)}
                                                                    readOnly
                                                                    style={{ pointerEvents: "none" }}
                                                                  />
                                                                </div>

                                                                {/* Business & Online Profile */}
                                                                <div className="klead-biz-section">
                                                                  <BizAvatar name={l.name} website={l.website || siteOfEmail(l.email)} size={42} />
                                                                  <div className="klead-biz-info">
                                                                    <div className="klead-biz-name-row">
                                                                      <b className="klead-biz-title">{l.name}</b>
                                                                    </div>
                                                                    <div className="klead-biz-meta">
                                                                      {l.category ? <span className="klead-cat">{l.category}</span> : null}
                                                                      {placeOf(l) ? <span className="klead-place">· {placeOf(l)}</span> : null}
                                                                      {l.website ? (
                                                                        <a
                                                                          href={l.website.startsWith("http") ? l.website : `https://${l.website}`}
                                                                          target="_blank"
                                                                          rel="noreferrer"
                                                                          className="klead-online-link"
                                                                          onClick={(e) => e.stopPropagation()}
                                                                          title={l.website}
                                                                          aria-label="Website"
                                                                        >
                                                                          <Globe size={13.5} strokeWidth={1.8} />
                                                                        </a>
                                                                      ) : null}
                                                                    </div>
                                                                  </div>
                                                                </div>

                                                                {/* Contact: Email & Phone Number */}
                                                                <div className="klead-contact-section">
                                                                  <div className="klead-contact-item klead-email">
                                                                    <Line name="mail" />
                                                                    <span className="klead-email-txt" title={l.email || undefined}>
                                                                      {l.email || <em className="klead-missing">No email yet</em>}
                                                                    </span>
                                                                    {blocked(l) ? (
                                                                      <em className="kpill no">Do not contact</em>
                                                                    ) : mailState[l.id] ? (
                                                                      <em className={`kpill ${mailState[l.id] === "queued" ? "mute" : "blue"}`}>
                                                                        {mailState[l.id] === "queued" ? "Waiting" : mailState[l.id] === "replied" ? "Replied" : "Emailed"}
                                                                      </em>
                                                                    ) : null}
                                                                  </div>
                                                                  <div className="klead-contact-item klead-phone">
                                                                    <Line name="phone" />
                                                                    <span className="klead-phone-txt">
                                                                      {l.phone || <em className="klead-missing">No phone</em>}
                                                                    </span>
                                                                  </div>
                                                                </div>

                                                                {/* Social Media Links */}
                                                                <div className="klead-social-section" onClick={(e) => e.stopPropagation()}>
                                                                  {l.socials && Object.keys(l.socials).length > 0 ? (
                                                                    <Socials socials={l.socials} max={4} />
                                                                  ) : (
                                                                    <span className="klead-no-social">—</span>
                                                                  )}
                                                                </div>

                                                                {/* Fit / Evaluation / Review */}
                                                                <div className="klead-fit-section">
                                                                  {isGood ? (
                                                                    <span className="klead-verdict good">
                                                                      <span className="klead-verdict-dot" />
                                                                      <span>Good fit</span>
                                                                    </span>
                                                                  ) : isMaybe ? (
                                                                    <span className="klead-verdict maybe">
                                                                      <span className="klead-verdict-dot" />
                                                                      <span>Maybe</span>
                                                                    </span>
                                                                  ) : isNo ? (
                                                                    <span className="klead-verdict no">
                                                                      <span className="klead-verdict-dot" />
                                                                      <span>Bad fit</span>
                                                                    </span>
                                                                  ) : (
                                                                    <span className="klead-verdict review">
                                                                      <span className="klead-verdict-dot" />
                                                                      <span>To review</span>
                                                                    </span>
                                                                  )}
                                                                </div>

                                                                {/* Actions: Review button + More */}
                                                                <div className="klead-actions-section" onClick={(e) => e.stopPropagation()}>
                                                                  <button
                                                                    type="button"
                                                                    className="klead-review-btn"
                                                                    onClick={() => setOpenLead(l.id)}
                                                                    title={`Review ${l.name}`}
                                                                  >
                                                                    Review
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    className="klead-more-btn"
                                                                    aria-label={`Open ${l.name}`}
                                                                    onClick={() => setOpenLead(l.id)}
                                                                  >
                                                                    <Line name="more" />
                                                                  </button>
                                                                </div>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                        {loaded && !shown.length ? <div className="empty"><div><b>{leads.length ? "No leads match" : "No leads yet"}</b></div></div> : null}
                                                        <nav className="kpager" aria-label="Pages">
                                                          <label className="kpager-size"><span className="sr-only">Leads per page</span><select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                                                          <span className="kpager-info">Showing {shown.length ? (page * perPage + 1).toLocaleString() : 0} - {Math.min(shown.length, page * perPage + perPage).toLocaleString()} of {shown.length.toLocaleString()}</span>
                                                          <span className="kpager-btns">
                                                            <button type="button" className="kpg-arrow" aria-label="First page" disabled={page === 0} onClick={() => goPage(0)}>«</button>
                                                            <button type="button" className="kpg-arrow" aria-label="Previous page" disabled={page === 0} onClick={() => goPage(page - 1)}>‹</button>
                                                            {pageList(page, pages).map((n, i) => n < 0 ? <span key={`g${i}`} className="kpg-gap">...</span> : <button key={n} type="button" className={n === page ? "on" : ""} aria-current={n === page ? "page" : undefined} onClick={() => goPage(n)}>{n + 1}</button>)}
                                                            <button type="button" className="kpg-arrow next" aria-label="Next page" disabled={page >= pages - 1} onClick={() => goPage(page + 1)}>›</button>
                                                            <button type="button" className="kpg-arrow next" aria-label="Last page" disabled={page >= pages - 1} onClick={() => goPage(pages - 1)}>»</button>
                                                          </span>
                                                        </nav>
                                                      </section>
                                                    </div>
                                                  )}
        </ViewErrorBoundary>
      </main>
      {review?.length ? (
        <Review list={review} editable={editable} demo={Boolean(demo)}
          onChange={(id, patch) => setLeads((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l)))}
          onClose={(n) => { setReview(null); if (n) setToast(`Reviewed ${n} ${n === 1 ? "lead" : "leads"}.`); }} />
      ) : null}
      {spam ? <SpamCheckPanel key={`${spam.subject}|${spam.body.length}|${spam.mode}`} onClose={() => setSpam(null)} demo={Boolean(demo)} toast={setToast} start={spam} /> : null}
      {toast ? <div className="app-toast" role="status">{toast}</div> : null}
      <DialogHost />
      {openLead && leads.find((l) => l.id === openLead) ? (
        <LeadPanel lead={leads.find((l) => l.id === openLead)!} editable={editable} demo={Boolean(demo)} onClose={() => setOpenLead(null)}
          onChange={(patch) => setLeads((all) => all.map((l) => (l.id === openLead ? { ...l, ...patch } : l)))}
          blocked={blocked(leads.find((l) => l.id === openLead)!)} canBlock={canBlock} finding={Boolean(finding)} onFind={() => findEmails([leads.find((l) => l.id === openLead)!])}
          onBlock={async (entry) => { const n = await addDnc([{ entry, reason: "marked in the App" }]); if (n) setToast("Added to Do-not-contact."); }}
          onSkipCategory={editable && account?.role !== "researcher" ? skipCategory : undefined} />
      ) : null}
    </div>
  );
}

// Home: what Kestrel is doing for you today, and what to do next.
function HomeView({ account, leads, loaded, email, go, demo, onSpam, onLead }: { account: Account | null; leads: LeadRow[]; loaded: boolean; email: string; go: (id: string) => void; demo: boolean; onSpam: () => void; onLead: (id: string) => void }) {
  // Get started ticks the extension steps off when this team has a connected extension (UX audit row 29).
  const [ext, setExt] = useState<{ installed: boolean; connected: boolean }>({ installed: false, connected: false });
  const [setup, setSetup] = useState({ business: false, offer: false, mailbox: false });
  useEffect(() => {
    if (demo || !account) return;
    supabaseBrowser().from("extension_keys").select("id,last_used_at").limit(5).then(({ data }) => {
      const keys = (data ?? []) as { last_used_at: string | null }[];
      setExt({ installed: keys.length > 0, connected: keys.length > 0 });
    });
    // Setup wizard (Phase 2): business described (059), an offer saved, an email account that passed its tests.
    const sb = supabaseBrowser();
    Promise.all([sb.from("team_about").select("about").maybeSingle(), sb.from("offer_profiles").select("id").limit(1), sb.from("mailboxes").select("status,imap_ok").limit(20)])
      .then(([a, o, m]) => setSetup({
        business: aboutReady(a.data ? cleanAbout(a.data) : null), offer: (o.data ?? []).length > 0,
        mailbox: ((m.data ?? []) as { status: string; imap_ok: boolean | null }[]).some((x) => x.status === "ok" && x.imap_ok === true)
      }));
  }, [demo, account]);
  const fromExtension = leads.some((l) => ["maps", "search", "youtube", "osm", "jobs", "companies", "podcasts", "page", "sites", "site"].includes(l.source ?? ""));
  const steps: { done: boolean; label: string; help: string; action?: [string, () => void]; soon?: boolean }[] = [
    { done: demo || setup.business, label: "Describe your business", help: "What you do, your website, sender details, proof and tone, on the Your business page. Kestrel's AI reads it for everything.", action: ["Open", () => go("about")] },
    { done: demo || setup.offer, label: "Save your offer", help: "What you sell and who buys it. The AI judges every lead against it and writes for it.", action: ["Add offer", () => go("about")] },
    { done: demo || setup.mailbox, label: "Add an email account", help: "The inbox Kestrel sends from and reads replies in. Add it, then click Send test to me.", action: ["Add", () => go("mailboxes")] },
    { done: ext.installed || fromExtension, label: "Install the Kestrel extension", help: "The extension collects leads in your own browser from Google Maps, Search, YouTube, OpenStreetMap and more. Download it, unzip, and load it in Brave or Chrome (about one minute).", action: ["Download", () => go("get")] },
    { done: ext.connected, label: "Connect the extension to this App", help: "Your leads then arrive here by themselves, and your team shares one search progress.", action: ["Connect", () => go("get")] },
    { done: leads.length > 0, label: "Run your first search", help: "Open the extension on Google Maps or Search and collect your first leads, or import leads or examples to try the App.", action: ["Find leads", () => go("import")] },
    { done: Boolean(account?.chosen_plan) || (account?.plan ?? "trial") !== "trial", label: "Choose a plan", help: `Your ${TRIAL_DAYS}-day trial includes everything. Pick the plan you want to keep.`, action: ["See plans", () => go("plan")] },
    { done: (account?.members?.length ?? 0) > 1, label: "Invite your team", help: "Send your team's join link. Everyone works on the same leads.", action: ["Invite", () => go("team")] },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.soon);   // the one step to do now (main button)
  return (
    <div className={`app-page home${" home-v2"}`}>
      {/* Design v2: the kit's Dashboard #1 on top; Kestrel's own Home parts (notices, Get started) stay below it. */}
      <HomeKit leads={leads} demo={demo} go={go} onLead={onLead} teamId={account?.team_id} />
      <div className="home-top-actions">
        <button type="button" className="btn go" onClick={() => { go("campaigns"); setTimeout(() => window.dispatchEvent(new CustomEvent("kestrel-new-campaign")), 0); }}><Line name="plus" /> New campaign</button>
      </div>


      {account && !demo && loaded && !leads.length && (account.members?.length ?? 1) <= 1 && account.role === "owner" ? (
        <p className="plan-msg home-new">This is a new workspace, <b>{account.team_name}</b>, for {email}. Meant to join your team&apos;s workspace instead? Sign out and sign in with the email your team uses, or ask your team owner for the join link.</p>
      ) : null}
      <HomeToday demo={demo} go={go} onSpam={onSpam} compact teamId={account?.team_id} />
      <div className="home-grid">
        {done < steps.length ? <section className="home-card">
          <div className="home-card-head"><b>Set up Kestrel</b><span className="sub-dark">{done} of {steps.length} done</span></div>
          {next ? <p className="setup-next">Next: <b>{next.label}</b></p> : null}
          <div className="bar"><i style={{ width: `${(100 * done) / steps.length}%` }} /></div>
          <ol className="steps-list">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? "done" : ""}>
                <span className="dot">{s.done ? <Line name="check" /> : null}</span>
                <span className="t">{s.label} <Tip text={s.help} /></span>
                {s.soon ? <span className="soon">Next update</span> : !s.done && s.action ? <button type="button" className={`btn small ${s === next ? "go" : "glass"}`} onClick={s.action[1]}>{s.action[0]}</button> : null}
              </li>
            ))}
          </ol>
        </section> : null}

      </div>
    </div>
  );
}

// The extension's IDs: the store copy (when listed) and the Developer-mode copy. The App asks each in turn.
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
type ExtKey = { id: string; label: string; created_at: string; last_used_at: string | null };

// Integrations (Affan: clean, modern, organized SaaS hub):
// Browser extension, AI apps (MCP), and connected services.
const INTEGRATION_TABS = [
  ["get", "Browser Extension"],
  ["mcp", "AI Apps (MCP)"],
  ["connections", "API & Services"],
] as const;
function IntegrationsView({ tab, go, account, email, demo, toast }: { tab: string; go: (v: string) => void; account: Account | null; email: string; demo: boolean; toast: (t: string) => void }) {
  return (
    <div className="app-page">
      <header className="head"><div><h1>Integrations <Tip text="Everything Kestrel connects to, in one place. Extension: collects leads in your browser. AI apps: use Kestrel from Claude or Codex. Services: your team's own keys for AI companies, email finders and CRMs (stored encrypted; only owners and managers can add them)." /></h1>
        <span className="sub">Browser extension, AI tools, and connected services</span></div></header>
      <div className="int-tabs seg" role="tablist" aria-label="Integrations">
        {INTEGRATION_TABS.map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => go(id)}>
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="int-panel">
        {tab === "get" ? <ExtensionPanel account={account} email={email} />
          : tab === "mcp" ? <div className="import-grid get-grid"><McpView account={account} email={email} demo={demo} toast={toast} /></div>
            : <ConnectionsKeys account={account} demo={demo} toast={toast} />}
      </div>
    </div>
  );
}

// Extension → Connect: status in this browser, Connect button, connection code, and the team's connected extensions.
function ExtensionConnect({ account, email }: { account: Account | null; email: string }) {
  const [ext, setExt] = useState<ExtReply | null | undefined>(undefined); // undefined = still checking
  const [keys, setKeys] = useState<ExtKey[]>([]);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const canConnect = account && account.role !== "viewer";
  const load = useCallback(async () => {
    setExt(await askExtension({ type: "kestrel-ping" }));
    const { data } = await supabaseBrowser().from("extension_keys").select("id,label,created_at,last_used_at").order("created_at", { ascending: false });
    setKeys((data as ExtKey[] | null) ?? []);
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  // Which browser this page is open in (Brave hides itself in the user agent, so ask it).
  const [browser, setBrowser] = useState("this browser");
  useEffect(() => {
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    (nav.brave?.isBrave ? nav.brave.isBrave() : Promise.resolve(false)).then((b) => setBrowser(b ? "Brave" : /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : "this browser"));
  }, []);
  async function makeKey() {
    const { data, error } = await supabaseBrowser().rpc("create_extension_key", { label: `${browser} · ${new Date().toLocaleDateString()}` });
    if (error || typeof data !== "string") throw new Error(error?.message ?? "Could not make a connection key.");
    return { token: data, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  }
  // Connect directly when the extension is in this browser; a key is only made when it will be used.
  async function connect() {
    setBusy(true); setMsg(""); setCode("");
    try {
      const here = await askExtension({ type: "kestrel-ping" });
      if (!here) { setMsg(`The Kestrel extension is not in ${browser}. Open kestrelleads.com in the browser where Kestrel is installed (for example Brave), or get a connection code below.`); return; }
      const reply = await askExtension({ type: "kestrel-connect", ...(await makeKey()) });
      setMsg(reply?.ok ? `Connected. New leads from ${browser} now go to ${reply.team || "your team"}.` : `The extension said: ${reply?.error ?? "no answer"}. Try again, or use a connection code.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); load(); }
  }
  // Opened from the extension's "Sign In to Kestrel" (…/app?view=get&connect=1): never connect by itself (a link from
  // someone else must not connect this browser to their team). Show who and which team, and connect only on a click.
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!canConnect || new URLSearchParams(location.search).get("connect") !== "1") return;
    history.replaceState(null, "", "/app?view=get");
    Promise.resolve().then(() => setAsk(true));
  }, [canConnect]);
  async function getCode() {
    setBusy(true); setMsg("");
    try { setCode(`kestrel:${btoa(JSON.stringify(await makeKey()))}`); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); load(); }
  }
  async function remove(id: string) {
    if (!await askConfirm("Disconnect this extension? It stops sending leads at once. Leads already here stay.")) return;
    await supabaseBrowser().rpc("remove_extension_key", { key_id: id });
    await askExtension({ type: "kestrel-disconnect" });
    load();
  }
  return (
    <>
      {ask ? (
        <section className="join-card ext-ask" role="alertdialog" aria-label="Connect the extension">
          <b>Connect the Kestrel extension in this browser?</b>
          <p>It will send leads to the team <b>{account?.team_name ?? "your team"}</b>, as <b>{email || "you"}</b>. Only continue if you opened this from your own Kestrel extension.</p>
          <div className="join-row"><button className="btn go" type="button" disabled={busy} onClick={() => { setAsk(false); connect(); }}>Connect</button>
            <button className="btn glass" type="button" onClick={() => setAsk(false)}>Not now</button></div>
        </section>
      ) : null}
      <section className="join-card int-connect-card" id="ext-connect">
        <div className="int-connect-header">
          <div>
            <b>Team Connection Status <Tip text="Connect once. Then every lead the extension collects, scores or changes arrives here by itself, and your team shares one search progress. The connection key can only add leads and progress to your team; Do-not-contact leads are never sent." /></b>
            <p className="int-connect-status-text">
              {ext === undefined ? `Checking ${browser}…` : ext ? (
                ext.connected ? `Connected in ${browser}${ext.team ? ` to ${ext.team}` : ""} · version ${ext.version}` : `Installed in ${browser} (version ${ext.version}) · ready to link.`
              ) : `Not detected in ${browser}. Open this page in the browser where Kestrel is installed, or use a connection code below.`}
            </p>
          </div>
          <div className="join-row int-connect-actions">
            <button className="btn go" type="button" disabled={!canConnect || busy} onClick={connect}>
              {busy ? "Working…" : ext?.connected ? "Sync Connection" : "Connect Extension"}
            </button>
            <button className="btn glass" type="button" disabled={!canConnect || busy} onClick={getCode}>
              Get Connection Code
            </button>
          </div>
        </div>
        {msg ? <p className="plan-msg" role="status" style={{ margin: "10px 0 0" }}>{msg}</p> : null}
        {code ? (
          <div className="code-box" style={{ marginTop: 14 }}>
            <b>Connection code <Tip text="Use this when the extension is in another browser or on another computer. Copy this code, open the extension’s side panel → Using the App in another browser?, paste it and click Connect. It works once; keep it private." /></b>
            <div className="join-row"><input readOnly value={code} onFocus={(e) => e.target.select()} aria-label="Connection code" /><button className="btn" type="button" onClick={() => navigator.clipboard.writeText(code)}>Copy</button></div>
          </div>
        ) : null}
        {!canConnect && account ? <p className="plan-msg" style={{ margin: "10px 0 0" }}>Viewers cannot connect an extension.</p> : null}
      </section>
      {keys.length ? (
        <div className="table-card members" style={{ marginTop: 16 }}>
          <table className="leads">
            <thead><tr><th>Your connected extensions</th><th>Connected</th><th>Last used</th><th /></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id}><td>{k.label}</td><td>{new Date(k.created_at).toLocaleDateString()}</td><td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Not yet"}</td>
                <td style={{ textAlign: "right" }}><button className="link-btn" type="button" onClick={() => remove(k.id)}>Disconnect</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

// The team's search progress (shared by every connected extension): mode | site | keyword | place.
type ProgressRow = { key: string; status: string; found: number | null; saved: number | null; at: string };
const MODE_NAMES: Record<string, string> = { maps: "Google Maps", search: "Google Search", osm: "OpenStreetMap", companies: "Companies House", youtube: "YouTube" };
function ProgressView({ account, go }: { account: Account | null; go: (v: string) => void }) {
  const [rows, setRows] = useState<ProgressRow[] | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "done" | "partial">("all");
  useEffect(() => {
    if (!account || account.team_id === "demo") { Promise.resolve().then(() => setRows([])); return; }
    supabaseBrowser().from("progress").select("key,status,found,saved,at").eq("team_id", account.team_id).order("at", { ascending: false }).limit(1000)
      .then(({ data }) => setRows((data as ProgressRow[] | null) ?? []));
  }, [account]);
  const list = rows ?? [];
  const done = list.filter((r) => r.status === "done").length;
  const saved = list.reduce((n, r) => n + (r.saved ?? 0), 0);
  const shown = list.filter((r) => (show === "all" || (show === "done") === (r.status === "done")) && (!q || r.key.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="app-page">
      <header className="head"><div><h1>Search progress <Tip text="Every keyword and place your team has searched with the extension. A search marked Done is skipped by everyone's extension, so nobody searches it twice." /></h1>
        <span className="sub">{done.toLocaleString()} done · {(list.length - done).toLocaleString()} part done · {saved.toLocaleString()} leads saved</span></div></header>
      <div className="acct-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keywords and places" aria-label="Search keywords and places" />
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["done", "Done"], ["partial", "Part done"]] as const).map(([id, name]) => (
            <button key={id} type="button" className={show === id ? "on" : ""} aria-pressed={show === id} onClick={() => setShow(id)}>{name}</button>
          ))}
        </div>
      </div>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Keyword</th><th>Place</th><th>Source</th><th>Status</th><th>Saved</th><th>When</th></tr></thead>
          <tbody>{shown.map((r) => {
            const [mode, site, keyword, place] = r.key.split("|");
            return <tr key={r.key}><td className="cap"><b>{keyword}</b></td><td className="cap">{place}</td><td>{MODE_NAMES[mode] ?? mode}{site ? ` · ${site}` : ""}</td>
              <td><em className={`pill ${r.status === "done" ? "good" : "maybe"}`}>{r.status === "done" ? "Done" : "Part done"}</em></td><td>{(r.saved ?? 0).toLocaleString()}</td><td>{new Date(r.at).toLocaleDateString()}</td></tr>;
          })}</tbody>
        </table>
        {rows && !list.length ? <div className="empty"><div><b>No searches yet</b><Tip text="Connect the extension (Settings → Integrations), then run a search. Each finished keyword and place shows here." /><button type="button" className="btn go small" onClick={() => go("get")}>Get the extension</button></div></div>
          : rows && !shown.length ? <div className="empty"><div><b>No searches match</b></div></div> : null}
      </div>
    </div>
  );
}

// Your profile: photo, name and job, news choice, and how the App looks (Appearance). Team details are on Team.
function ProfileView({ account, email }: { account: Account | null; email: string }) {
  const [me, setMe] = useState({ name: account?.full_name ?? "", job: account?.job_title ?? "" });
  const [msg, setMsg] = useState("");
  const [news, setNews] = useState(Boolean(account?.news_ok));
  const [photo, setPhoto] = useState<string | null>(account?.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState<Look>({ theme: "auto", accent: "peri", reduceMotion: false });
  useEffect(() => { Promise.resolve().then(() => setLook(readLook())); }, []);
  const demo = !account || account.team_id === "demo";
  const changeLook = (patch: Partial<Look>) => { const n = { ...look, ...patch }; setLook(n); saveLook(n); };
  async function saveNews(ok: boolean) {
    setNews(ok);
    const { error } = await supabaseBrowser().rpc("set_marketing", { ok });
    setMsg(error ? error.message : ok ? "You will get Kestrel news and special offers." : "You will not get news or offers. Account emails still arrive.");
  }
  async function saveMe(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabaseBrowser().rpc("update_my_profile", { name: me.name, job: me.job });
    setMsg(error ? error.message : "Your profile is saved."); if (!error) setTimeout(() => location.reload(), 600);
  }
  // Pick a file → the cropper (move and zoom) → save the chosen square.
  const [cropImg, setCropImg] = useState<ImageBitmap | null>(null);
  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setMsg("");
    try { setCropImg(await openPhoto(f)); } catch (err) { setMsg((err as Error).message); }
  }
  async function savePhoto(url: string) {
    setCropImg(null);
    setBusy(true); setMsg("");
    try {
      if (!demo) { const { error } = await supabaseBrowser().rpc("set_my_avatar", { img: url }); if (error) throw new Error(/set_my_avatar|schema cache/i.test(error.message) ? "Photos are coming soon to your workspace." : error.message); }
      setPhoto(url); setMsg(demo ? "Photo shown here only (preview)." : "Photo saved. Your team sees it too.");
      if (!demo) setTimeout(() => location.reload(), 700);
    } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
  }
  async function removePhoto() {
    if (!demo) { const { error } = await supabaseBrowser().rpc("set_my_avatar", { img: null }); if (error) { setMsg(error.message); return; } }
    setPhoto(null); setMsg("Photo removed."); if (!demo) setTimeout(() => location.reload(), 600);
  }
  return (
    <div className="app-page">
      <header className="head"><div><h1>Your profile</h1><span className="sub">{email}{account ? ` · ${account.role[0].toUpperCase()}${account.role.slice(1)} of ${account.team_name}` : ""}</span></div>
        <form action="/auth/signout" method="post" className="head-actions"><button className="btn glass small" type="submit">Log out</button></form></header>
      <div className="import-grid">
        <form className="join-card prof-form" onSubmit={saveMe}>
          <b>You</b>
          <div className="prof-photo">
            <PersonAvatar name={me.name || email} photo={photo} size={72} />
            <div className="join-row">
              <label className={`btn glass small${busy ? " off" : ""}`}>
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={pickPhoto} />{busy ? "Saving…" : photo ? "Change photo" : "Upload photo"}</label>
              {photo ? <button type="button" className="link-btn" onClick={removePhoto}>Remove</button> : null}
              <Tip text="After you choose a picture you can move and zoom it. Kestrel makes it small (192×192) before saving. Your team sees it next to your name." />
              {cropImg ? <PhotoCrop img={cropImg} onSave={savePhoto} onCancel={() => setCropImg(null)} /> : null}
            </div>
          </div>
          <label className="in"><span>Full name</span><input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} required /></label>
          <label className="in"><span>Job title</span><input value={me.job} onChange={(e) => setMe({ ...me, job: e.target.value })} placeholder="Founder, Marketing lead…" /></label>
          <label className="in"><span>Email <Tip text="Your login. It cannot be changed here." /></span><input value={email} readOnly /></label>
          <label className="agree"><input type="checkbox" checked={news} onChange={(e) => saveNews(e.target.checked)} /> <span>Send me Kestrel news and special offers</span></label>
          <div className="join-row"><button className="btn go" type="submit">Save profile</button></div>
        </form>
        <section className="join-card prof-form">
          <b>Appearance <Tip text="How the App looks on this computer. Saved in this browser only." /></b>
          <div className="in"><span>Theme</span>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {([["auto", "Automatic"], ["light", "Light"], ["dark", "Dark"], ["gradient", "SaaS Gradient"]] as const).map(([id, name]) => (
                <button key={id} type="button" role="radio" aria-checked={look.theme === id} className={look.theme === id ? "on" : ""} onClick={() => changeLook({ theme: id })}>{name}</button>
              ))}
            </div></div>
          <div className="in"><span>Accent colour</span>
            <div className="look-swatches" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map(([id, name, colour]) => (
                <button key={id} type="button" role="radio" aria-checked={look.accent === id} aria-label={name} title={name} className="look-swatch" style={{ background: colour }} onClick={() => changeLook({ accent: id })} />
              ))}
            </div></div>
          <label className="agree"><input type="checkbox" checked={look.reduceMotion} onChange={(e) => changeLook({ reduceMotion: e.target.checked })} /> <span>Reduce motion</span></label>
        </section>
      </div>
      {msg ? <p className="plan-msg" role="status">{msg}</p> : null}
    </div>
  );
}

// Integrations → Extension: get the extension, install it, connect it to the team and see connected copies.
function ExtensionPanel({ account, email }: { account: Account | null; email: string }) {
  const [copied, setCopied] = useState(false);
  const kb = (name: string) => `${Math.round(((downloads.sizes as Record<string, number>)[name] ?? 0) / 1024)} KB`;
  async function copy() { await navigator.clipboard.writeText("brave://extensions"); setCopied(true); setTimeout(() => setCopied(false), 1800); }
  return (
    <div className="int-extension-container">
      <section className="join-card int-hero-card">
        <div className="int-hero-top">
          <div className="int-hero-content">
            <div className="int-hero-tags">
              <span className="pill good">v{downloads.version}</span>
              <span className="pill neutral">Official Extension</span>
            </div>
            <h2 className="int-hero-title">Kestrel Lead Collector Extension</h2>
            <p className="int-hero-desc">Collect, score, and verify leads in real time directly from LinkedIn, Sales Navigator, and Google Maps with your browser.</p>
            <div className="int-supported-row">
              <span className="int-browser-tag"><Line name="check" /> Brave</span>
              <span className="int-browser-tag"><Line name="check" /> Google Chrome</span>
              <span className="int-browser-tag"><Line name="check" /> Microsoft Edge</span>
            </div>
          </div>
          <div className="int-hero-download">
            {storeUrl() ? (
              <a className="btn go get-btn" href={storeUrl()} target="_blank" rel="noreferrer">
                <Line name="extension" /> Add to Brave or Chrome <small>one click</small>
              </a>
            ) : (
              <a className="btn go get-btn" href="/app/download/extension" download>
                <Line name="down" /> Download Extension <small>({kb(downloads.extension)})</small>
              </a>
            )}
          </div>
        </div>

        <div className="int-steps-container">
          <div className="int-step-item">
            <div className="int-step-num">1</div>
            <div className="int-step-body">
              <b>Unpack Archive</b>
              <span>Download and unzip the package to reveal the <code>Kestrel</code> folder.</span>
            </div>
          </div>
          <div className="int-step-item">
            <div className="int-step-num">2</div>
            <div className="int-step-body">
              <b>Load in Browser</b>
              <span>Open <code>brave://extensions</code> <button type="button" className="link-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>, turn on <b>Developer mode</b>, and choose <b>Load unpacked</b>.</span>
            </div>
          </div>
          <div className="int-step-item">
            <div className="int-step-num">3</div>
            <div className="int-step-body">
              <b>Link Team</b>
              <span>Click <b>Connect Extension</b> below to instantly sync collected leads to your team.</span>
            </div>
          </div>
        </div>
      </section>

      <ExtensionConnect account={account} email={email} />
    </div>
  );
}

function ActivityView({ leads }: { leads: LeadRow[] }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  // Leads added per day (newest first), counted by the day the lead reached the team.
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) { if (!l.created_at) continue; const d = localDay(new Date(l.created_at)); m.set(d, (m.get(d) ?? 0) + 1); }
    return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [leads]);
  const since = (n: number) => { const t = new Date(); t.setDate(t.getDate() - n + 1); return localDay(t); };
  const sum = (n: number) => byDay.filter(([d]) => d >= since(n)).reduce((a, [, c]) => a + c, 0);
  const days = byDay.filter(([d]) => d >= since(range));
  const top = Math.max(1, ...days.map(([, c]) => c));
  return (
    <div className="app-page">
      <header className="head"><div><h1>Leads added <Tip text="Every import and every lead the extension sends, day by day. Campaign, email and AI numbers are in Analytics." /></h1><span className="sub">By day</span></div>
        <div className="seg" role="group" aria-label="Period">
          {([7, 30, 90] as const).map((n) => <button key={n} type="button" className={range === n ? "on" : ""} aria-pressed={range === n} onClick={() => setRange(n)}>{n} days</button>)}
        </div></header>
      <div className="kpis">
        <div><small>Last 7 days</small><b>{sum(7).toLocaleString()}</b></div>
        <div><small>Last 30 days</small><b>{sum(30).toLocaleString()}</b></div>
        <div><small>All time</small><b>{leads.length.toLocaleString()}</b></div>
      </div>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Day</th><th>Leads added</th></tr></thead>
          <tbody>{days.map(([d, n]) => (
            <tr key={d}><td>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</td>
              <td><span className="acct-sent"><span className="acct-meter" aria-hidden="true"><i style={{ width: `${Math.round((n / top) * 100)}%` }} /></span>{n.toLocaleString()}</span></td></tr>
          ))}</tbody>
        </table>
        {!days.length ? <div className="empty"><div><b>{byDay.length ? `Nothing in the last ${range} days` : "Nothing yet"}</b></div></div> : null}
      </div>
    </div>
  );
}

function PlanView({ account }: { account: Account | null }) {
  const owner = account?.role === "owner";
  const [note] = useState(() => {
    const b = typeof window === "undefined" ? "" : new URLSearchParams(location.search).get("billing") ?? "";
    return ({
      thanks: "Thank you. Your payment is being confirmed: your plan unlocks within a minute. Reload this page if it still shows the trial.",
      "not-ready": "Card payments are being switched on. Please try again soon, or contact us.", "owner-only": "Only the team owner can choose and pay for a plan.",
      "unknown-plan": "That plan was not found."
    } as Record<string, string>)[b] ?? "";
  });
  const paid = account && account.plan !== "trial" && account.paid_until;
  const status = !account ? "Sign in to see your plan"
    : paid && account.active !== false ? `${planName(account.plan)} plan · ${account.billing_status === "cancelled" ? "ends" : "renews"} ${new Date(account.paid_until!).toLocaleDateString()}`
      : account.active === false ? "Trial ended · choose a plan to carry on"
        : `Free trial, ${daysLeft(account.trial_ends_at)} days left (${TRIAL_DAYS}-day trial)`;
  const current = paid && account?.active !== false ? account?.plan : null;
  const free = account?.access_until && new Date(account.access_until) > new Date() ? `Free ${planName(account.access_plan ?? "pro")} access until ${new Date(account.access_until).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : "";
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const planNow = current ? planName(current) : account?.access_until && new Date(account.access_until) > new Date() ? `${planName(account.access_plan ?? "pro")} (access code)` : account?.active === false ? "None" : "Free trial";
  const seats = PLANS.find((p) => p.id === seatPlan(account))?.seats ?? "";
  async function useCode(e: React.FormEvent) {
    e.preventDefault(); setCodeMsg("Checking…");
    const r = await claim(code.trim());
    setCodeMsg(r.text); if (r.ok) setTimeout(() => location.reload(), 1800);
  }
  return (
    <div className="app-page">
      <header className="head"><div><h1>Plan and billing <Tip text="Your free trial includes everything. After it ends, choose a plan to keep collecting leads and using AI. Payments are handled by Lemon Squeezy: cards, VAT and receipts. Cancel any time." /></h1><span className="sub">{free || status}</span></div>
        <div className="head-actions">
          {owner && account?.billing_portal ? <a className="btn glass small" href={account.billing_portal} target="_blank" rel="noreferrer">Manage billing</a> : null}
          {owner ? <button type="button" className="btn glass small" onClick={() => { setCodeMsg(""); setCodeOpen(true); }}>Have an access code?</button> : null}
        </div></header>
      {account ? (
        <div className="kpis plan-kpis">
          <div><small>Plan</small><b>{planNow}</b></div>
          <div><small>Status</small><b>{account.active === false ? "Read-only" : paid ? (account.billing_status === "cancelled" ? "Ends" : "Active") : "Trial"}</b>
            <i className="kpi-note">{paid ? new Date(account.paid_until!).toLocaleDateString() : account.active === false ? "Choose a plan" : `${daysLeft(account.trial_ends_at)} days left`}</i></div>
          <div><small>Team</small><b>{(account.members?.length ?? 1).toLocaleString()} {account.members?.length === 1 ? "person" : "people"}</b><i className="kpi-note">{seats}</i></div>
          {free ? <div><small>Free access</small><b>Until</b><i className="kpi-note">{new Date(account.access_until!).toLocaleDateString()}</i></div> : null}
        </div>
      ) : null}
      {account?.active === false ? <p className="plan-msg lock-msg">Your trial has ended, so Kestrel is read-only. Your leads are safe and you can still export them. Pick a plan below to unlock adding leads, the extension and AI again.</p> : null}
      <OfferBanner />
      {account?.role === "owner" ? <OfferCode demo={false} /> : null}
      <div className="plan-grid">
        {PLANS.map((p) => (
          <article key={p.id} className={`price${current === p.id || (!current && p.id === "pro") ? " pop" : ""}`}>
            {current === p.id ? <span className="price-tag">Your plan</span> : !current && p.id === "pro" ? <span className="price-tag">Most popular</span> : null}
            <h3>{p.name}</h3>
            <p className="price-line">{p.tagline}</p>
            {INTRO.percent ? (
              <>
                <p className="price-amount"><b>{money(introPrice(p.price, INTRO))}</b><s>{money(p.price)}</s><span>per month</span></p>
                <p className="price-offer">{INTRO.percent}% off for {INTRO.months} months, then {money(p.price)}</p>
              </>
            ) : <p className="price-amount"><b>{money(p.price)}</b><span>per month</span></p>}
            <p className="price-seats">{p.seats}</p>
            <ul className="checks">{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
            {current === p.id ? <button className="btn glass" type="button" disabled>Current plan</button>
              : !owner ? <button className="btn glass" type="button" disabled>Owner chooses the plan</button>
                : current && account?.billing_portal ? <a className="btn glass" href={account.billing_portal} target="_blank" rel="noreferrer">Switch in billing</a>
                  : <a className={`btn ${p.id === "pro" ? "go" : "glass"}`} href={`/api/billing/checkout?plan=${p.id}`}>Choose {p.name}</a>}
          </article>
        ))}
      </div>
      {note ? <p className="plan-msg" role="status">{note}</p> : null}
      {codeOpen ? (
        <SideDrawer label="Access code" onClose={() => setCodeOpen(false)}>
          <header className="dr-head"><div><h2>Access code</h2><p>{free ? `${free}. Another code adds more days.` : "Free access for a limited time"}</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setCodeOpen(false)}>×</button></header>
          <form className="dr-block prof-form" onSubmit={useCode}>
            <label className="in"><span>Code</span><input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KST-XXXX-XXXX" maxLength={40} /></label>
            <div className="join-row"><button className="btn go small" type="submit" disabled={code.trim().length < 6}>Use code</button></div>
            {codeMsg ? <p className="plan-msg" role="status" style={{ margin: 0 }}>{codeMsg}</p> : null}
          </form>
        </SideDrawer>
      ) : null}
    </div>
  );
}

function TeamView({ account, go }: { account: Account | null; go: (view: string) => void }) {
  const [code, setCode] = useState(account?.join_code ?? null);
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const link = code && typeof window !== "undefined" ? `${window.location.origin}/signup?team=${code}` : "";
  const members = account?.members ?? [];
  const seats = PLANS.find((p) => p.id === seatPlan(account))?.seats ?? "";
  async function copy() { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  // Team details (moved here from Profile): only the owner can change them.
  const owner = account?.role === "owner";
  const [team, setTeam] = useState({ name: account?.team_name ?? "", site: account?.website ?? "", size: account?.team_size ?? "", place: account?.country ?? "" });
  const [teamMsg, setTeamMsg] = useState("");
  // Seats used and allowed (database 036; before it the plan text is shown).
  const [seatsNow, setSeatsNow] = useState<{ used: number; limit: number } | null>(null);
  useEffect(() => {
    if (!account || account.team_id === "demo") return;
    supabaseBrowser().rpc("my_team_seats").then(({ data, error }) => { if (!error && data) setSeatsNow(data as { used: number; limit: number }); });
  }, [account]);
  const teamFull = Boolean(seatsNow && seatsNow.used >= seatsNow.limit);
  async function saveTeam(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabaseBrowser().rpc("update_team", { name: team.name, site: team.site, size: team.size, place: team.place });
    setTeamMsg(error ? error.message : "Team details are saved."); if (!error) setTimeout(() => location.reload(), 600);
  }
  async function renew() {
    if (!await askConfirm("Make a new join link? The old link stops working.")) return;
    const { data, error } = await supabaseBrowser().rpc("new_join_code");
    if (!error && typeof data === "string") setCode(data);
  }
  return (
    <div className="app-page">
      <header className="head"><div><h1>Team <Tip text="Everyone here shares the team's leads, lists, rules, sequences and campaigns. Owners and managers change settings and email accounts; researchers change leads; viewers can only look." /></h1>
        <span className="sub">{account?.team_name ?? ""} · {members.length.toLocaleString()} {members.length === 1 ? "person" : "people"}{seatsNow ? ` · ${seatsNow.used} of ${seatsNow.limit} seats used` : seats ? ` · plan allows ${seats.toLowerCase()}` : ""}</span></div>
        {code ? <div className="head-actions">
          {teamFull ? <button type="button" className="link-btn" onClick={() => go("plan")}>Bigger plan</button> : null}
          <button type="button" className="btn go small" disabled={teamFull} title={teamFull ? "Your plan's seats are all used. Choose a bigger plan to add people." : undefined} onClick={() => setInviting(true)}>Invite</button></div> : null}</header>
      <div className="table-card members acct-table">
        <table className="leads">
          <thead><tr><th>Member</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.email}>
                <td><span className="biz"><PersonAvatar name={m.name || m.email} photo={m.avatar} size={32} /><span className="biz-txt"><b>{m.name || m.email}</b>{m.name ? <small>{m.email}</small> : null}</span></span></td>
                <td><em className="pill cap">{m.role}</em></td><td>{new Date(m.joined_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="join-card prof-form team-details" onSubmit={saveTeam}>
        <b>Team details <Tip text="Only the team owner can change these." /></b>
        <div className="row2">
          <label className="in"><span>Team name</span><input value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} disabled={!owner} required /></label>
          <label className="in"><span>Website</span><input value={team.site} onChange={(e) => setTeam({ ...team, site: e.target.value })} disabled={!owner} placeholder="company.com" /></label>
        </div>
        <div className="row2">
          <label className="in"><span>Team size</span><input value={team.size} onChange={(e) => setTeam({ ...team, size: e.target.value })} disabled={!owner} placeholder="2–5" /></label>
          <label className="in"><span>Country</span><input value={team.place} onChange={(e) => setTeam({ ...team, place: e.target.value })} disabled={!owner} /></label>
        </div>
        {owner ? <div className="join-row"><button className="btn go small" type="submit">Save team</button></div> : null}
        {teamMsg ? <p className="plan-msg" role="status" style={{ margin: 0 }}>{teamMsg}</p> : null}
      </form>
      {inviting && code ? (
        <SideDrawer label="Invite to the team" onClose={() => setInviting(false)}>
          <header className="dr-head"><div><h2>Invite to the team</h2><p>{account?.team_name}</p></div><button type="button" className="dr-x" aria-label="Close" onClick={() => setInviting(false)}>×</button></header>
          <section className="dr-block prof-form">
            <h3>Join link <Tip text="Send this link to your teammates. They create their account with it and join this team as researchers (they can add and change leads)." /></h3>
            <div className="join-row"><input readOnly value={link} aria-label="Team join link" onFocus={(e) => e.target.select()} /><button className="btn go small" type="button" onClick={copy}>{copied ? "Copied" : "Copy link"}</button></div>
            <button className="link-btn" type="button" onClick={renew}>Make a new link</button>
          </section>
        </SideDrawer>
      ) : null}
    </div>
  );
}

// Import a Kestrel backup file, or add made-up example leads to try the App.
function ImportView({ account, onDone, dnc, demo }: { account: Account | null; onDone: () => void; dnc: DncRow[]; demo: boolean }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = account && account.role !== "viewer";
  async function save(rows: ReturnType<typeof toRow>[]) {
    const sb = supabaseBrowser();
    const unique = [...new Map(rows.map((r) => [r.dedupe_key, r])).values()];
    for (let i = 0; i < unique.length; i += 500) {
      const { error } = await sb.from("leads").upsert(unique.slice(i, i + 500), { onConflict: "team_id,dedupe_key" });
      if (error) throw error;
    }
    return unique.length;
  }
  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !account) return;
    setBusy(true); setMsg("Reading the file…");
    try {
      const list = leadsFromBackup(JSON.parse(await file.text()));
      if (!list.length) { setMsg("That file has no leads. Choose a Kestrel backup file (kestrel_…json)."); return; }
      const n = await save(list.map((l) => toRow(l, account.team_id)));
      setMsg(`Imported ${n} leads. Leads that were already here were updated, not copied.`); onDone();
    } catch (err) { setMsg(`Import stopped: ${(err as Error).message}`); } finally { setBusy(false); }
  }
  async function addExamples() {
    if (!account) return;
    setBusy(true);
    try { const n = await save(EXAMPLE_LEADS.map((l) => toRow(l, account.team_id, true))); setMsg(`Added ${n} example leads. They are made up and marked "(example)".`); onDone(); }
    catch (err) { setMsg(`Could not add examples: ${(err as Error).message}`); } finally { setBusy(false); }
  }
  async function removeExamples() {
    if (!account) return;
    setBusy(true);
    const { error } = await supabaseBrowser().from("leads").delete().eq("team_id", account.team_id).eq("sample", true);
    setMsg(error ? `Could not remove examples: ${error.message}` : "Example leads removed."); setBusy(false); onDone();
  }
  return (
    <div className="app-page">
      <header className="head"><div><h1>Import and examples</h1><span className="sub">Bring your leads into the team workspace</span></div></header>
      <div className="import-grid">
        <CsvImport account={account} dnc={dnc} demo={demo} onDone={onDone} />
        <section className="join-card">
          <div><b>Import a Kestrel backup <Tip text="For leads kept in an older extension (before 2.9): Workspace → Import, Export and Backup → Back Up Now. Then choose that file here. Duplicates are merged." /></b></div>
          <label className={`btn go${!canEdit || busy ? " off" : ""}`}><input type="file" accept=".json,application/json" hidden disabled={!canEdit || busy} onChange={importFile} />Choose backup file</label>
        </section>
        <section className="join-card">
          <div><b>Try with example leads</b><p>Eight made-up businesses so you can see how lists, scores and search work. Remove them any time.</p></div>
          <div className="join-row"><button className="btn go" type="button" disabled={!canEdit || busy} onClick={addExamples}>Add example leads</button><button className="btn glass" type="button" disabled={!canEdit || busy} onClick={removeExamples}>Remove examples</button></div>
        </section>
      </div>
      {msg ? <p className="plan-msg" role="status">{msg}</p> : null}
      {!canEdit && account ? <p className="plan-msg">Viewers can read leads but not import them.</p> : null}
    </div>
  );
}
