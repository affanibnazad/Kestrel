"use client";

import { useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { CONNECT_FILES, CONNECT_RELEASES } from "@/lib/site";
import { mcpAllowed } from "@/lib/plans";

// Integrations → AI apps (plan: Outreach Engine/14-kestrel-mcp-plan.md). Kestrel Connect, one download for this computer:
// it signs in and adds Kestrel to Claude Desktop, Claude Code or Codex with one click each. Paid plans (or free access).
// The hand set-up (Node.js + terminal) is kept, closed, for developers. The AI kit (no account link) is the second card.
type Acct = { plan?: string; active?: boolean; role?: string; access_until?: string | null } | null;
type Os = "macArm" | "macIntel" | "windows";
const OS_NAMES: Record<Os, string> = { macArm: "Mac (Apple chip)", macIntel: "Mac (Intel)", windows: "Windows" };

function Copy({ text, toast }: { text: string; toast: (t: string) => void }) {
  return <button type="button" className="link-btn" onClick={() => { navigator.clipboard.writeText(text); toast("Copied."); }}>Copy</button>;
}
function Logo({ src, name }: { src: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="cn-mark logo" title={name}><img src={src} alt={name} /></span>;
}

// Which computer this is. Chrome, Edge and Brave say if a Mac has an Apple chip; Safari does not (most Macs sold since
// 2021 have one, so that is the guess, and the other files are one click away).
function useOs(): Os | null {
  const [os, setOs] = useState<Os | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) { Promise.resolve().then(() => setOs("windows")); return; }
    if (!/Mac OS X|Macintosh/i.test(ua)) return;
    const hint = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    (hint?.getHighEntropyValues ? hint.getHighEntropyValues(["architecture"]).catch(() => ({ architecture: "" })) : Promise.resolve({ architecture: "" }))
      .then((v) => setOs(v.architecture === "x86" ? "macIntel" : "macArm"));
  }, []);
  return os;
}

export default function McpView({ account, email, demo, toast }: { account: Acct; email: string; demo: boolean; toast: (t: string) => void }) {
  const [hand, setHand] = useState<"mac" | "win">("mac");
  const paid = demo || mcpAllowed(account);
  const os = useOs();
  const main: Os = os ?? "macArm";
  const others = (Object.keys(OS_NAMES) as Os[]).filter((o) => o !== main);
  const file = hand === "mac" ? "~/Downloads/kestrel-mcp.mjs" : "%USERPROFILE%\\Downloads\\kestrel-mcp.mjs";
  const login = `node ${file} login ${email || "you@company.com"}`;
  const claude = `claude mcp add kestrel -- node ${hand === "mac" ? "$HOME/Downloads/kestrel-mcp.mjs" : "%USERPROFILE%\\Downloads\\kestrel-mcp.mjs"}`;
  const codex = `[mcp_servers.kestrel]\ncommand = "node"\nargs = ["${hand === "mac" ? "/Users/YOU/Downloads/kestrel-mcp.mjs" : "C:\\\\Users\\\\YOU\\\\Downloads\\\\kestrel-mcp.mjs"}"]`;
  return (
    <>
      <section className="join-card int-card">
        <div className="int-top">
          <span className="int-logos"><Logo src="/logos/claude-desktop.svg" name="Claude Desktop" /><Logo src="/logos/claude-code.svg" name="Claude Code" /><Logo src="/logos/codex.svg" name="Codex" /></span>
          <div><b>Kestrel Connect <Tip text="Lets Claude Desktop, Claude Code or Codex work in your Kestrel account: find and judge leads, write emails, run campaigns and answer replies. Your own Claude or ChatGPT plan does the thinking, so there is no AI cost in Kestrel. It signs in as you, so it sees only your team, with your role, and asks before each change. It keeps itself up to date: new Kestrel tools arrive by themselves, no new download." /></b>
            <p>Use Kestrel from Claude or Codex. One download, then one click.</p></div>
        </div>
        {!paid ? <p className="plan-msg" style={{ margin: 0 }}>Part of Starter, Pro and Agency. Choose a plan in Plan and billing.</p>
          : CONNECT_RELEASES ? (
            <>
              <div className="join-row int-dl">
                <a className="btn go get-btn" href={`${CONNECT_RELEASES}/${CONNECT_FILES[main]}`}>Download for {OS_NAMES[main]}</a>
                <span className="dr-muted">Other: {others.map((o, i) => <span key={o}>{i ? " · " : ""}<a className="link-btn" href={`${CONNECT_RELEASES}/${CONNECT_FILES[o]}`}>{OS_NAMES[o]}</a></span>)}</span>
              </div>
              <ol className="int-steps">
                <li><b>Open</b> the download <Tip text="Mac: drag Kestrel Connect into Applications and open it. If macOS says it cannot check the app: System Settings → Privacy & Security → Open Anyway (once). Windows: run it; if Windows says it protected your PC, click More info → Run anyway." /></li>
                <li><b>Sign in</b> with {email || "your Kestrel email"} <Tip text="Kestrel emails you a sign-in link. Open it on this computer." /></li>
                <li><b>Click</b> Claude Desktop, Claude Code or Codex <Tip text="Then restart that app and ask: “Show my Kestrel overview”." /></li>
              </ol>
            </>
          ) : <p className="dr-muted">The Kestrel Connect app is on its way. Until then, use the set-up by hand below.</p>}
        {paid ? (
          <details className="mcp-dev" open={!CONNECT_RELEASES}>
            <summary>Set up by hand (developers: Node.js and a terminal)</summary>
            <div className="seg" role="group" aria-label="Computer">{([["mac", "Mac / Linux"], ["win", "Windows"]] as const).map(([id, l]) => <button key={id} type="button" className={hand === id ? "on" : ""} aria-pressed={hand === id} onClick={() => setHand(id)}>{l}</button>)}</div>
            <ol className="ap-how">
              <li><b>Download the program</b><span>Needs Node.js 18 or newer. Keep it in Downloads, or change the paths below.</span>
                <a className="btn glass small" href={demo ? undefined : "/app/download/mcp"} onClick={(e) => { if (demo) { e.preventDefault(); toast("Downloads need a signed-in team (example)."); } }}>Download kestrel-mcp.mjs</a></li>
              <li><b>Sign this computer in</b><code className="mcp-code">{login}</code> <Copy text={login} toast={toast} /></li>
              <li><b>Claude Code</b><code className="mcp-code">{claude}</code> <Copy text={claude} toast={toast} /></li>
              <li><b>Codex</b> (~/.codex/config.toml)<pre className="mcp-code">{codex}</pre> <Copy text={codex} toast={toast} /></li>
            </ol>
            <p className="dr-muted">Sign out: <code>node {file} logout</code></p>
          </details>
        ) : null}
      </section>
      <section className="join-card int-card">
        <div className="int-top">
          <span className="int-logos"><Logo src="/logos/claude-code.svg" name="Claude Code" /><Logo src="/logos/codex.svg" name="Codex" /></span>
          <div><b>Kestrel AI Kit <Tip text="A small folder for Claude Code or Codex that scores leads and writes first emails from job files, without signing in to your account. Nothing in it sends emails. All plans." /></b>
            <p>Score leads and write emails with your Claude Code plan. No key, all plans.</p></div>
        </div>
        <div className="join-row int-dl">
          <a className="btn glass get-btn" href="/app/download/kit" download onClick={() => { try { localStorage.setItem("kestrel-ai-kit-downloaded", "1"); } catch { /* fine */ } }}>Download the AI kit</a>
          <span className="dr-muted">Then: Kestrel AI → Score and write → Connect folder</span>
        </div>
      </section>
    </>
  );
}
