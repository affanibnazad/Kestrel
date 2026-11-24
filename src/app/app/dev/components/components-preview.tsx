"use client";

import React, { useState, useEffect } from "react";
import {
  Button,
  Badge,
  Search,
  ListGroup,
  ListRow,
  SettingsShell,
  PageHeader,
} from "@/components/ui";

const ChromeIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 8.5h8.5M8.97 13.75L4.7 6.35M15.03 13.75l-4.27 7.2" />
  </svg>
);

const HunterIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);

const ApolloIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4" />
  </svg>
);

const HubspotIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
  </svg>
);

const McpIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
  </svg>
);

const SearchIconSvg = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

const ChevronRightIcon = () => (
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
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function ComponentsPreview({
  userEmail: _userEmail,
  initialTheme = "gradient",
}: {
  userEmail: string;
  initialTheme?: "dark" | "light" | "gradient";
}) {
  const [theme, setTheme] = useState<"dark" | "light" | "gradient">(initialTheme);
  const [searchVal, setSearchVal] = useState("");
  const [activeTab, setActiveTab] = useState("connections");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const switchTheme = (newTheme: "dark" | "light" | "gradient") => {
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  const navItems = [
    { id: "general", label: "General", href: "#" },
    { id: "business", label: "Your business", href: "#" },
    { id: "team", label: "Team", href: "#" },
    { id: "billing", label: "Plan and billing", href: "#" },
    { id: "connections", label: "Connections", href: "#" },
    { id: "mailboxes", label: "Email accounts", href: "#" },
    { id: "notifications", label: "Notifications", href: "#" },
    { id: "privacy", label: "Privacy and data", href: "#" },
  ];

  return (
    <div
      style={{
        margin: 0,
        minHeight: "100vh",
        background: "var(--u-page-wash, none), var(--u-page)",
        color: "var(--u-text)",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        fontSize: "16px",
        lineHeight: 1.5,
        padding: "32px",
        boxSizing: "border-box",
      }}
    >
      <div className="u-topbar" role="group" aria-label="Theme">
        <Button
          variant={theme === "light" ? "primary" : "default"}
          aria-pressed={theme === "light"}
          onClick={() => switchTheme("light")}
        >
          Light
        </Button>
        <Button
          variant={theme === "dark" ? "primary" : "default"}
          aria-pressed={theme === "dark"}
          onClick={() => switchTheme("dark")}
        >
          Dark
        </Button>
        <Button
          variant={theme === "gradient" ? "primary" : "default"}
          aria-pressed={theme === "gradient"}
          onClick={() => switchTheme("gradient")}
        >
          Gradient
        </Button>
      </div>

      <SettingsShell
        items={navItems}
        activeId={activeTab}
        onSelect={(id) => setActiveTab(id)}
        menuTitle="Settings"
      >
        <PageHeader
          title="Connections"
          lead="Tools that work with Kestrel. Kestrel AI is included, no setup needed."
        />

        <Search
          placeholder="Search connections"
          aria-label="Search connections"
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          icon={<SearchIconSvg />}
        />

        <ListGroup label="Find leads">
          <ListRow
            washIndex={1}
            icon={<ChromeIcon />}
            name="Chrome extension"
            description="Collect leads from LinkedIn and Google Maps"
            action={<Badge variant="success">Connected</Badge>}
          />
          <ListRow
            washIndex={2}
            icon={<HunterIcon />}
            name="Hunter"
            description="Find and verify email addresses"
            action={<Button variant="primary">Connect</Button>}
          />
          <ListRow
            washIndex={3}
            icon={<ApolloIcon />}
            name="Apollo"
            description="Work emails when Hunter finds none"
            action={<Button variant="primary">Connect</Button>}
          />
        </ListGroup>

        <ListGroup label="Send and track">
          <ListRow
            washIndex={4}
            icon={<HubspotIcon />}
            name="HubSpot"
            description="Interested leads become contacts and deals"
            action={<Button variant="primary">Connect</Button>}
          />
        </ListGroup>

        <ListGroup label="Use Kestrel elsewhere">
          <ListRow
            washIndex={5}
            icon={<McpIcon />}
            name="Kestrel MCP"
            description="Use your Kestrel data in Claude or Codex"
            action={<Button variant="primary">Set up</Button>}
          />
        </ListGroup>

        <Button
          variant="advanced"
          aria-expanded={false}
          icon={<ChevronRightIcon />}
        >
          Advanced: use your own AI key
        </Button>
      </SettingsShell>
    </div>
  );
}
