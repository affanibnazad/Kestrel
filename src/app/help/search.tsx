"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { ARTICLES, HELP_GROUPS } from "@/lib/help";

export default function HelpSearch() {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = (a: (typeof ARTICLES)[number]) => !query || [a.title, a.desc, ...(a.steps ?? []), ...(a.text ?? [])].join(" ").toLowerCase().includes(query);
  const groups = HELP_GROUPS.map(([id, name]) => [id, name, ARTICLES.filter((a) => a.group === id && match(a))] as const).filter(([, , items]) => items.length);

  return (
    <>
      <label className="help-search">
        <span style={{ width: 18, height: 18, display: "inline-flex", fill: "var(--label2)" }}><Icon name="search" /></span>
        <input type="search" placeholder="Search help" aria-label="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="help-body" style={{ position: "relative", zIndex: 1 }}>
        {groups.length ? groups.map(([id, name, items]) => (
          <section key={id} id={id} className="help-group">
            <h2>{name}</h2>
            <div className="help-list">
              {items.map((a) => (
                <Link key={a.slug} href={`/help/${a.slug}`} className="help-item">
                  <div className="t"><b>{a.title}</b><span>{a.desc}</span></div>
                  <span className="go" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>
        )) : <p style={{ textAlign: "center", color: "var(--label2)" }}>No articles match &ldquo;{q}&rdquo;.</p>}
      </div>
    </>
  );
}
