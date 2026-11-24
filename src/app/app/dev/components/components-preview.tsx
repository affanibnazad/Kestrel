"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "@/components/ui/search";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ListGroup, ListRow } from "@/components/ui/list-group";
import { SidePanel } from "@/components/ui/side-panel";
import { SettingsShell } from "@/components/ui/settings-shell";
import { AppNav } from "@/components/ui/app-nav";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { PageHeader } from "@/components/ui/page-header";
import {
  Sun,
  Moon,
  Mail,
  Send,
  Trash2,
  Settings,
  User,
  Shield,
  Layers,
  Inbox,
  Sparkles,
  Link2,
  CheckCircle2,
  FolderOpen,
} from "lucide-react";

export default function ComponentsPreview({ userEmail }: { userEmail: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [searchVal, setSearchVal] = useState("Search leads...");
  const [switchOn, setSwitchOn] = useState(true);
  const [switchOff, setSwitchOff] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("all");
  const [settingsTab, setSettingsTab] = useState("general");

  // Sync theme with document attribute
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const navItems = [
    { id: "all", label: "All Components", icon: <Layers size={16} strokeWidth={1.5} /> },
    { id: "buttons", label: "Buttons & Inputs", icon: <Send size={16} strokeWidth={1.5} /> },
    { id: "lists", label: "Lists & Badges", icon: <Inbox size={16} strokeWidth={1.5} /> },
    { id: "shells", label: "Shell & Panels", icon: <Settings size={16} strokeWidth={1.5} /> },
  ];

  const settingsItems = [
    { id: "general", label: "General", group: "Settings", icon: <Settings size={16} strokeWidth={1.5} /> },
    { id: "business", label: "Your business", group: "Settings", icon: <Layers size={16} strokeWidth={1.5} /> },
    { id: "team", label: "Team", group: "Settings", icon: <User size={16} strokeWidth={1.5} /> },
    { id: "leads", label: "Find leads", group: "Connections", icon: <Sparkles size={16} strokeWidth={1.5} /> },
    { id: "send", label: "Send and track", group: "Connections", icon: <Mail size={16} strokeWidth={1.5} /> },
    { id: "privacy", label: "Privacy & data", group: "Security", icon: <Shield size={16} strokeWidth={1.5} /> },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--u-page)",
        color: "var(--u-text)",
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        padding: "32px 48px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* Header */}
        <PageHeader
          title="Shared Component Showcase"
          description={`TASK U0 Component Library · Logged in as ${userEmail} · Showing current theme: ${theme}`}
          actions={
            <Button
              variant="default"
              onClick={toggleTheme}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
            >
              {theme === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
              <span>Switch to {theme === "dark" ? "Light" : "Dark"} Mode</span>
            </Button>
          }
        />

        {/* Navigation Bar */}
        <AppNav items={navItems} activeId={activeNav} onSelect={setActiveNav} />

        {/* Section 1: Buttons */}
        <section
          style={{
            background: "var(--u-panel)",
            border: "1px solid var(--u-border)",
            borderRadius: "var(--u-radius-card)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 4px" }}>
              1. Buttons
            </h2>
            <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
              Default, Primary, Danger, Icon-only. Targets ≥ 40px. Press scale 0.96 (150ms).
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
            <Button variant="default">Default Button</Button>
            <Button variant="primary">Primary Button</Button>
            <Button variant="danger">
              <Trash2 size={16} strokeWidth={1.5} />
              <span>Danger Button</span>
            </Button>
            <Button variant="icon" aria-label="Mail settings">
              <Mail size={18} strokeWidth={1.5} />
            </Button>
            <Button variant="default" disabled>
              Disabled Default
            </Button>
            <Button variant="primary" disabled>
              Disabled Primary
            </Button>
          </div>
        </section>

        {/* Section 2: Form Controls (Input, Search, Select, Switch) */}
        <section
          style={{
            background: "var(--u-panel)",
            border: "1px solid var(--u-border)",
            borderRadius: "var(--u-radius-card)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 4px" }}>
              2. Form Inputs & Controls
            </h2>
            <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
              Input (40px), Search (48px), Select (40px), Switch with accessible focus ring.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", marginBottom: "6px" }}>
                Text Input (Normal)
              </label>
              <Input placeholder="Enter company name..." defaultValue="Norven Studio" />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", marginBottom: "6px" }}>
                Text Input (Error State)
              </label>
              <Input error defaultValue="invalid-email-address" />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", marginBottom: "6px" }}>
                Search (Height 48px, Lucide icon)
              </label>
              <Search value={searchVal} onChange={(e) => setSearchVal(e.target.value)} onClear={() => setSearchVal("")} />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", marginBottom: "6px" }}>
                Dropdown Select (Height 40px)
              </label>
              <Select defaultValue="agency">
                <option value="agency">Agency / Studio</option>
                <option value="b2b">B2B SaaS</option>
                <option value="consulting">Consulting / Advisor</option>
              </Select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "32px", alignItems: "center", paddingTop: "8px" }}>
            <Switch label="Active Campaign (Enabled)" checked={switchOn} onChange={setSwitchOn} />
            <Switch label="Pause Outreach (Disabled)" checked={switchOff} onChange={setSwitchOff} />
            <Switch label="Locked Feature" checked={false} disabled onChange={() => {}} />
          </div>
        </section>

        {/* Section 3: Status Badges */}
        <section
          style={{
            background: "var(--u-panel)",
            border: "1px solid var(--u-border)",
            borderRadius: "var(--u-radius-card)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 4px" }}>
              3. Status Badges
            </h2>
            <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
              Concentric radius 8px. Always paired with text (never color alone). WCAG contrast ≥ 4.5:1.
            </p>
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <Badge variant="neutral">Draft</Badge>
            <Badge variant="success">Connected</Badge>
            <Badge variant="warning">Review needed</Badge>
            <Badge variant="danger">Disconnected</Badge>
          </div>
        </section>

        {/* Section 4: ListGroup + ListRow (The Reference Pattern) */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 4px" }}>
              4. List Group & Rows (Reference 1 Pattern)
            </h2>
            <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
              Radius 12px group, 64px min-height rows, divided by 1px border. Icon 20px, Title 16px, Desc 14px secondary.
            </p>
          </div>

          <ListGroup>
            <ListRow
              icon={<Mail size={20} strokeWidth={1.5} />}
              name="Resend Email Service"
              description="Primary transactional and marketing delivery provider"
              action={<Badge variant="success">Connected</Badge>}
            />
            <ListRow
              icon={<Link2 size={20} strokeWidth={1.5} />}
              name="Google Workspace Integration"
              description="Sync outreach mailboxes and inspect sender reputation"
              action={<Button variant="default">Configure</Button>}
              clickable
              onClick={() => alert("Configure Google Workspace")}
            />
            <ListRow
              icon={<Shield size={20} strokeWidth={1.5} />}
              name="Domain Reputation Guard"
              description="Automated DNS and SPF/DKIM authentication monitoring"
              action={<Badge variant="warning">Verification Pending</Badge>}
            />
          </ListGroup>
        </section>

        {/* Section 5: Settings Shell */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 4px" }}>
              5. Settings Shell (Left Menu + Content)
            </h2>
            <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
              Concentric outer radius 20px, 240px menu with grouped categories and active pill.
            </p>
          </div>

          <SettingsShell items={settingsItems} activeId={settingsTab} onSelect={setSettingsTab}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: 0 }}>
                {settingsItems.find((s) => s.id === settingsTab)?.label}
              </h3>
              <p style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)", margin: 0 }}>
                This is the standard content area inside the SettingsShell. Spacing on 4/8 grid with 1px border separation.
              </p>
              <div style={{ marginTop: "12px" }}>
                <Button variant="primary" onClick={() => setPanelOpen(true)}>
                  Open Side Panel Preview
                </Button>
              </div>
            </div>
          </SettingsShell>
        </section>

        {/* Section 6: Empty State & Error Message */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 12px" }}>
              6. Empty State
            </h2>
            <EmptyState
              icon={<FolderOpen size={40} strokeWidth={1.5} />}
              title="No campaigns yet"
              description="Create your first targeted outreach sequence to start discovering qualified B2B leads."
              action={<Button variant="primary">Create Campaign</Button>}
            />
          </div>

          <div>
            <h2 style={{ fontSize: "var(--u-font-20)", fontWeight: "var(--u-weight-medium)", margin: "0 0 12px" }}>
              7. Error Message
            </h2>
            <ErrorMessage
              title="SMTP Connection Failed"
              message="The mail server timed out while establishing a secure TLS handshake. Verify your credentials in Email Accounts."
            />
          </div>
        </section>

        {/* Side Panel Component (Interactive) */}
        <SidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title="Lead Details Inspector"
          description="Raised surface inspection panel (#262626 dark / #ffffff light)"
          footer={
            <>
              <Button variant="default" onClick={() => setPanelOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setPanelOpen(false)}>
                Save Changes
              </Button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ margin: 0 }}>
              This is the Slide-in SidePanel component (radius 16px, raised background, 200ms ease-out).
            </p>
            <div style={{ background: "var(--u-page)", padding: "16px", borderRadius: "10px", border: "1px solid var(--u-border)" }}>
              <strong style={{ display: "block", marginBottom: "4px" }}>Status: Qualified Lead</strong>
              <span style={{ color: "var(--u-text-secondary)" }}>Verified observation quote: &quot;We make interfaces&quot;</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "var(--u-font-12)", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--u-text-muted-raised)" }}>
                Audit Note (Muted on Raised Surface · 4.99:1)
              </span>
              <span style={{ fontSize: "var(--u-font-14)", color: "var(--u-text-secondary)" }}>
                Verified by research crawler at 2026-11-24 12:00:00Z
              </span>
            </div>
          </div>
        </SidePanel>
      </div>
    </div>
  );
}
