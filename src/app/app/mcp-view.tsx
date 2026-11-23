"use client";

import { useState } from "react";
import { Tip } from "@/components/ui";
import { mcpAllowed } from "@/lib/plans";

// Integrations → AI apps (plan: Outreach Engine/14-kestrel-mcp-plan.md). Kestrel Connect, one download for this computer:
// it signs in and adds Kestrel to Claude Desktop, Claude Code or Codex with one click each. Paid plans (or free access).
// The hand set-up (Node.js + terminal) is kept, closed, for developers. The AI kit (no account link) is the second card.
type Acct = { plan?: string; active?: boolean; role?: string; access_until?: string | null } | null;

function Copy({ text, toast }: { text: string; toast: (t: string) => void }) {
  return <button type="button" className="link-btn" onClick={() => { navigator.clipboard.writeText(text); toast("Copied."); }}>Copy</button>;
}
function Logo({ src, name }: { src: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="cn-mark logo" title={name}><img src={src} alt={name} /></span>;
}

export default function McpView({ account, email, demo, toast }: { account: Acct; email: string; demo: boolean; toast: (t: string) => void }) {
  const [hand, setHand] = useState<"mac" | "win">("mac");
  const paid = demo || mcpAllowed(account);
  const file = hand === "mac" ? "~/Downloads/kestrel-mcp.mjs" : "%USERPROFILE%\\Downloads\\kestrel-mcp.mjs";
  const login = `node ${file} login ${email || "you@company.com"}`;
  const claude = `claude mcp add kestrel -- node ${hand === "mac" ? "$HOME/Downloads/kestrel-mcp.mjs" : "%USERPROFILE%\\Downloads\\kestrel-mcp.mjs"}`;
  const codex = `[mcp_servers.kestrel]\ncommand = "node"\nargs = ["${hand === "mac" ? "/Users/YOU/Downloads/kestrel-mcp.mjs" : "C:\\\\Users\\\\YOU\\\\Downloads\\\\kestrel-mcp.mjs"}"]`;
  return (
    <>
      <section className="join-card int-card">
        <div className="int-top">
          <span className="int-logos"><Logo src="/logos/claude-desktop.svg" name="Claude Desktop" /><Logo src="/logos/claude-code.svg" name="Claude Code" /><Logo src="/logos/codex.svg" name="Codex" /></span>
          <div><b>Kestrel MCP <Tip text="Lets Claude Desktop, Claude Code or Codex work in your Kestrel account: find and judge leads, write emails, run campaigns and answer replies. Your own Claude or ChatGPT plan does the thinking, so there is no AI cost in Kestrel. It signs in as you, so it sees only your team, with your role, and asks before each change." /></b>
            <p>Connect Claude or Codex to your Kestrel workspace.</p></div>
        </div>
        {!paid ? <p className="plan-msg" style={{ margin: 0 }}>Part of Starter, Pro and Agency. Choose a plan in Plan and billing.</p> : (
          <div className="mcp-dev" style={{ marginTop: 16 }}>
            <div className="seg" role="group" aria-label="Computer">{([["mac", "Mac / Linux"], ["win", "Windows"]] as const).map(([id, l]) => <button key={id} type="button" className={hand === id ? "on" : ""} aria-pressed={hand === id} onClick={() => setHand(id)}>{l}</button>)}</div>
            <ol className="ap-how">
              <li><b>Download the program</b><span>Needs Node.js 18 or newer. Keep it in Downloads, or change the paths below.</span>
                <a className="btn glass small" href={demo ? undefined : "/app/download/mcp"} onClick={(e) => { if (demo) { e.preventDefault(); toast("Downloads need a signed-in team (example)."); } }}>Download kestrel-mcp.mjs</a></li>
              <li><b>Sign this computer in</b><code className="mcp-code">{login}</code> <Copy text={login} toast={toast} /></li>
              <li><b>Claude Code</b><code className="mcp-code">{claude}</code> <Copy text={claude} toast={toast} /></li>
              <li><b>Codex</b> (~/.codex/config.toml)<pre className="mcp-code">{codex}</pre> <Copy text={codex} toast={toast} /></li>
            </ol>
            <p className="dr-muted">Sign out: <code>node {file} logout</code></p>
          </div>
        )}
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
