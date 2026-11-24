"use client";

import React, { useState } from "react";
import {
  Button,
  StatusPill,
  Input,
  Search,
  Tabs,
  Row,
  Card,
  Avatar,
  IconCircle,
  Checkbox,
  Toggle,
  Menu,
  SidePanel,
  PageHeader,
  EmptyState,
  Tooltip,
} from "@/ui";
import {
  Sparkles,
  Globe,
  Mail,
  Phone,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
  ExternalLink,
  Inbox,
  CheckCircle2,
  Clock,
  Briefcase,
} from "lucide-react";
import { GLYPH } from "@/app/app/biz";

export default function ComponentsPreview({
  initialTheme = "gradient",
}: {
  userEmail?: string;
  initialTheme?: "light" | "dark" | "gradient";
}) {
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark" | "gradient">(initialTheme);
  const [activeTab, setActiveTab] = useState("all");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [checkboxVal, setCheckboxVal] = useState(true);
  const [toggleVal, setToggleVal] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputValue, setInputValue] = useState("");

  const tabItems = [
    { id: "all", label: "All leads", count: 248 },
    { id: "review", label: "To review", count: 12 },
    { id: "approved", label: "Approved", count: 184 },
    { id: "rejected", label: "Rejected", count: 52 },
  ];

  const menuItems = [
    { id: "approve", label: "Approve lead", icon: <CheckCircle2 size={15} />, onClick: () => {} },
    { id: "snooze", label: "Snooze review", icon: <Clock size={15} />, onClick: () => {} },
    { id: "delete", label: "Remove lead", icon: <Trash2 size={15} />, danger: true, onClick: () => {} },
  ];

  return (
    <div
      className="ds-root"
      data-theme={currentTheme}
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--ds-page)",
        backgroundImage: "var(--ds-page-wash)",
        backgroundAttachment: "fixed",
        color: "var(--ds-text)",
        padding: "32px 24px 80px",
        fontFamily: "var(--ds-font-family)",
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        {/* Top Control Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 32,
            padding: "12px 16px",
            borderRadius: "var(--ds-radius-panel)",
            backgroundColor: "var(--ds-panel)",
            border: "1px solid var(--ds-border)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--ds-radius-pill)",
                backgroundColor: "var(--ds-accent)",
                color: "var(--ds-accent-text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              K
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Kestrel UI Showcase</div>
              <div style={{ fontSize: 12, color: "var(--ds-text-2)" }}>
                Standard component catalog across 3 themes
              </div>
            </div>
          </div>

          {/* Theme Switcher Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--ds-text-muted)", marginRight: 4 }}>
              Theme:
            </span>
            {(["light", "dark", "gradient"] as const).map((t) => (
              <Button
                key={t}
                variant={currentTheme === t ? "main" : "secondary"}
                size="sm"
                onClick={() => setCurrentTheme(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Page Header Component */}
        <PageHeader
          title="Design System Components (src/ui)"
          description="Clean architecture: zero !important, CSS modules only, Apple status palette, 4/8 grid."
          actions={
            <>
              <Button variant="secondary" onClick={() => setIsPanelOpen(true)}>
                <SlidersHorizontal size={15} />
                Open Side Panel
              </Button>
              <Button variant="main">
                <Plus size={15} />
                Main Action
              </Button>
            </>
          }
        />

        {/* Grid of Component Blocks */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 20,
            marginBottom: 40,
          }}
        >
          {/* Section 1: Buttons */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Buttons</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <Button variant="main">Main Button</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="icon" aria-label="Settings">
                <SlidersHorizontal size={16} />
              </Button>
            </div>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <Button variant="main" size="sm">Main SM</Button>
              <Button variant="secondary" size="sm">Secondary SM</Button>
              <Button variant="danger" size="sm">Danger SM</Button>
              <Button variant="secondary" disabled>Disabled</Button>
            </div>
          </Card>

          {/* Section 2: Pills & Status */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Status Pills</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <StatusPill variant="positive">Connected</StatusPill>
              <StatusPill variant="good">High Fit</StatusPill>
              <StatusPill variant="maybe">Medium Fit</StatusPill>
              <StatusPill variant="no">Low Fit</StatusPill>
              <StatusPill variant="review">To Review</StatusPill>
              <StatusPill variant="info">Verified</StatusPill>
              <StatusPill variant="neutral" dot={false}>Neutral Tag</StatusPill>
            </div>
          </Card>

          {/* Section 3: Inputs & Search */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Inputs & Search</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Search
                placeholder="Search leads, campaigns or accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Input
                placeholder="Enter campaign title..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <Input placeholder="Invalid input state..." error defaultValue="error@domain" />
            </div>
          </Card>

          {/* Section 4: Tabs */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Segmented Tabs</h3>
            <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} />
          </Card>

          {/* Section 5: Form Controls */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Form Controls</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <Checkbox
                  label="Select all leads"
                  checked={checkboxVal}
                  onChange={(e) => setCheckboxVal(e.target.checked)}
                />
                <Checkbox label="Disabled box" disabled checked />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <Toggle
                  label="Auto-pilot sending"
                  checked={toggleVal}
                  onChange={(e) => setToggleVal(e.target.checked)}
                />
                <Toggle label="Disabled toggle" disabled />
              </div>
            </div>
          </Card>

          {/* Section 6: Avatars, IconCircles & Menus */}
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Avatars, Icons & Menus</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Avatar name="Norven Studio" size="sm" />
              <Avatar name="Acme Corp" size="md" />
              <Avatar name="Affan Ibn Azad" size="lg" />
              <IconCircle icon={<Briefcase size={18} />} size="md" />
              <IconCircle icon={<Sparkles size={18} />} size="md" />
              <Menu
                trigger={
                  <Button variant="secondary" size="sm">
                    Actions Menu
                    <MoreHorizontal size={14} />
                  </Button>
                }
                items={menuItems}
              />
              <Tooltip content="Tooltip description info">
                <Button variant="ghost" size="sm">Hover Me</Button>
              </Tooltip>
            </div>
          </Card>
        </div>

        {/* Reference Verification: Real Leads Row from docs/ui-reference/leads.html */}
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Reference Verification: Lead Row (v4 specification)
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ds-text-2)" }}>
                Matches docs/ui-reference/leads.html: white pill row (min-height 68px), Business avatar, category/city, offer, contact check, social glyphs, fit pill, approval menu.
              </p>
            </div>
            <StatusPill variant="positive">Pixel Matched</StatusPill>
          </div>

          {/* 3 sample rows rendered in the new design system */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Row 1 */}
            <Row interactive>
              <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", flexWrap: "wrap" }}>
                <Checkbox />

                {/* Business Info */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220, flex: "1 1 220px" }}>
                  <Avatar name="Apex Motion" size="md" />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 15 }}>Apex Motion Studio</span>
                      <a
                        href="https://apexmotion.co"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--ds-text-2)", display: "inline-flex" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Globe size={13} />
                      </a>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ds-text-2)" }}>
                      Animation & Design · London, UK
                    </div>
                  </div>
                </div>

                {/* Offer */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160, flex: "0 1 180px" }}>
                  <IconCircle icon={<Briefcase size={16} />} size="sm" />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Brand Revamp 2026</span>
                </div>

                {/* Contact */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: "1 1 200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "var(--ds-radius-pill)",
                        backgroundColor: "var(--ds-status-green)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                      }}
                    >
                      <Mail size={9} strokeWidth={3} />
                    </span>
                    <span>sarah@apexmotion.co</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ds-text-2)" }}>
                    <Phone size={12} />
                    <span>+44 20 7946 0912</span>
                  </div>
                </div>

                {/* Socials */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 80 }}>
                  <span style={{ color: "var(--ds-text-2)", display: "inline-flex" }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <path d={GLYPH.instagram[1]} fillRule="evenodd" />
                    </svg>
                  </span>
                  <span style={{ color: "var(--ds-text-2)", display: "inline-flex" }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <path d={GLYPH.linkedin[1]} fillRule="evenodd" />
                    </svg>
                  </span>
                </div>

                {/* Fit */}
                <div style={{ minWidth: 110 }}>
                  <StatusPill variant="good">High Fit</StatusPill>
                </div>

                {/* Approval & Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <StatusPill variant="positive">Approved</StatusPill>
                  <Menu
                    trigger={
                      <Button variant="ghost" size="sm" aria-label="Options">
                        <MoreHorizontal size={16} />
                      </Button>
                    }
                    items={menuItems}
                  />
                </div>
              </div>
            </Row>

            {/* Row 2 */}
            <Row interactive>
              <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", flexWrap: "wrap" }}>
                <Checkbox />

                {/* Business Info */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220, flex: "1 1 220px" }}>
                  <Avatar name="Vortex Labs" size="md" />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 15 }}>Vortex Labs AI</span>
                      <a
                        href="https://vortex.ai"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--ds-text-2)", display: "inline-flex" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Globe size={13} />
                      </a>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ds-text-2)" }}>
                      AI SaaS · San Francisco, CA
                    </div>
                  </div>
                </div>

                {/* Offer */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160, flex: "0 1 180px" }}>
                  <IconCircle icon={<Sparkles size={16} />} size="sm" />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Lead Engine Growth</span>
                </div>

                {/* Contact */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: "1 1 200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "var(--ds-radius-pill)",
                        backgroundColor: "var(--ds-status-orange)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                      }}
                    >
                      <Mail size={9} strokeWidth={3} />
                    </span>
                    <span>founders@vortex.ai</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ds-text-2)" }}>
                    <Phone size={12} />
                    <span>+1 415 555 0198</span>
                  </div>
                </div>

                {/* Socials */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 80 }}>
                  <span style={{ color: "var(--ds-text-2)", display: "inline-flex" }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <path d={GLYPH.linkedin[1]} fillRule="evenodd" />
                    </svg>
                  </span>
                  <span style={{ color: "var(--ds-text-2)", display: "inline-flex" }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                      <path d={GLYPH.youtube[1]} fillRule="evenodd" />
                    </svg>
                  </span>
                </div>

                {/* Fit */}
                <div style={{ minWidth: 110 }}>
                  <StatusPill variant="maybe">Medium Fit</StatusPill>
                </div>

                {/* Approval & Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <StatusPill variant="review">To Review</StatusPill>
                  <Menu
                    trigger={
                      <Button variant="ghost" size="sm" aria-label="Options">
                        <MoreHorizontal size={16} />
                      </Button>
                    }
                    items={menuItems}
                  />
                </div>
              </div>
            </Row>
          </div>
        </div>

        {/* Empty State Component Preview */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <EmptyState
            icon={<Inbox size={22} />}
            title="No leads pending review"
            description="All your researched leads have been approved or sorted into active campaigns."
            action={
              <Button variant="secondary" size="sm">
                <ExternalLink size={14} />
                Find New Leads
              </Button>
            }
          />
        </Card>

        {/* Side Panel Component */}
        <SidePanel
          isOpen={isPanelOpen}
          onClose={() => setIsPanelOpen(false)}
          title="Lead Research Inspection"
          description="Detailed metadata extracted by Kestrel AI"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsPanelOpen(false)}>
                Cancel
              </Button>
              <Button variant="main" onClick={() => setIsPanelOpen(false)}>
                Approve & Schedule
              </Button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--ds-text-muted)", marginBottom: 4 }}>
                Target Company
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Apex Motion Studio Ltd</div>
              <div style={{ fontSize: 14, color: "var(--ds-text-2)" }}>
                Verified domain: apexmotion.co
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--ds-border)", paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: "var(--ds-text-muted)", marginBottom: 8 }}>
                AI Match Score
              </div>
              <StatusPill variant="good">94% Fit Score</StatusPill>
              <p style={{ fontSize: 13, color: "var(--ds-text-2)", marginTop: 8, lineHeight: 1.5 }}>
                Strong alignment with high-ticket 3D animation and branding services. Recent hiring signals detected for motion designers.
              </p>
            </div>
          </div>
        </SidePanel>
      </div>
    </div>
  );
}
