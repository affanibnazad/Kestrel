"use client";

import React, { useState } from "react";
import {
  Button,
  Badge,
  Search,
  ListGroup,
  ListRow,
  PageHeader,
} from "@/components/ui";
import ConnectionsKeys from "./connections-keys";
import type { Account } from "./shell";

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

const HubSpotIcon = () => (
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

export default function ConnectionsView({
  account,
  demo = false,
  toast,
}: {
  account?: Account | null;
  demo?: boolean;
  toast?: (msg: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [advOpen, setAdvOpen] = useState(false);

  const items = [
    {
      group: "Find leads",
      id: "chrome",
      name: "Chrome extension",
      description: "Collect leads from LinkedIn and Google Maps",
      icon: <ChromeIcon />,
      className: "t1",
      action: <Badge variant="success">Connected</Badge>,
    },
    {
      group: "Find leads",
      id: "hunter",
      name: "Hunter",
      description: "Find and verify email addresses",
      icon: <HunterIcon />,
      className: "t2",
      action: <Button variant="solid" onClick={() => setAdvOpen(true)}>Connect</Button>,
    },
    {
      group: "Find leads",
      id: "apollo",
      name: "Apollo",
      description: "Work emails when Hunter finds none",
      icon: <ApolloIcon />,
      className: "t3",
      action: <Button variant="solid" onClick={() => setAdvOpen(true)}>Connect</Button>,
    },
    {
      group: "Send and track",
      id: "hubspot",
      name: "HubSpot",
      description: "Interested leads become contacts and deals",
      icon: <HubSpotIcon />,
      className: "t4",
      action: <Button variant="solid" onClick={() => setAdvOpen(true)}>Connect</Button>,
    },
    {
      group: "Use Kestrel elsewhere",
      id: "mcp",
      name: "Kestrel MCP",
      description: "Use your Kestrel data in Claude or Codex",
      icon: <McpIcon />,
      className: "t5",
      action: <Button variant="solid" onClick={() => setAdvOpen(true)}>Set up</Button>,
    },
  ];

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q)
      )
    : items;

  const groups = Array.from(new Set(filtered.map((it) => it.group)));

  return (
    <>
      <PageHeader
        title="Connections"
        description="Tools that work with Kestrel. Kestrel AI is included, no setup needed."
      />

      <Search
        placeholder="Search connections"
        aria-label="Search connections"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: 480, marginBottom: 32 }}
      />

      {groups.map((group) => {
        const groupItems = filtered.filter((it) => it.group === group);
        return (
          <ListGroup key={group} title={group}>
            {groupItems.map((item) => (
              <ListRow
                key={item.id}
                className={item.className}
                icon={item.icon}
                name={item.name}
                description={item.description}
                action={item.action}
              />
            ))}
          </ListGroup>
        );
      })}

      <div style={{ marginTop: 28 }}>
        <Button
          variant="advanced"
          icon={<ChevronRightIcon />}
          aria-expanded={advOpen}
          onClick={() => setAdvOpen(!advOpen)}
        >
          Advanced: use your own AI key
        </Button>

        {advOpen && (
          <div style={{ marginTop: 16 }}>
            <ConnectionsKeys
              account={account ?? null}
              demo={Boolean(demo)}
              toast={toast ?? (() => {})}
            />
          </div>
        )}
      </div>
    </>
  );
}
