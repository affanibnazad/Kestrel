"use client";

import React, { useState, useEffect } from "react";

export default function ComponentsPreview({
  userEmail,
  initialTheme = "gradient",
}: {
  userEmail: string;
  initialTheme?: "dark" | "light" | "gradient";
}) {
  const [theme, setTheme] = useState<"dark" | "light" | "gradient">(initialTheme);
  const [searchVal, setSearchVal] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const switchTheme = (newTheme: "dark" | "light" | "gradient") => {
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  return (
    <div
      style={{
        margin: 0,
        minHeight: "100vh",
        background: "var(--u-page-wash, none), var(--u-page)",
        color: "var(--u-text)",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "16px",
        lineHeight: 1.5,
        padding: "32px",
        boxSizing: "border-box",
      }}
    >
      <div className="u-topbar topbar" role="group" aria-label="Theme">
        <button
          className={`u-btn btn ${theme === "light" ? "solid primary" : ""}`}
          type="button"
          data-set="light"
          aria-pressed={theme === "light"}
          onClick={() => switchTheme("light")}
        >
          Light
        </button>
        <button
          className={`u-btn btn ${theme === "dark" ? "solid primary" : ""}`}
          type="button"
          data-set="dark"
          aria-pressed={theme === "dark"}
          onClick={() => switchTheme("dark")}
        >
          Dark
        </button>
        <button
          className={`u-btn btn ${theme === "gradient" ? "solid primary" : ""}`}
          type="button"
          data-set="gradient"
          aria-pressed={theme === "gradient"}
          onClick={() => switchTheme("gradient")}
        >
          Gradient
        </button>
      </div>

      <div className="u-shell shell">
        <nav className="u-menu menu" aria-label="Settings">
          <div className="u-menu-label menu-label">Settings</div>
          <a href="#" onClick={(e) => e.preventDefault()}>
            General
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Your business
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Team
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Plan and billing
          </a>
          <a href="#" onClick={(e) => e.preventDefault()} aria-current="page">
            Connections
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Email accounts
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Notifications
          </a>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Privacy and data
          </a>
        </nav>

        <main className="u-content content">
          <h1>Connections</h1>
          <p className="u-lead lead">Tools that work with Kestrel. Kestrel AI is included, no setup needed.</p>

          <div className="u-search">
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
            <input
              type="search"
              placeholder="Search connections"
              aria-label="Search connections"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
            />
          </div>

          <div className="u-group-label group-label">Find leads</div>
          <div className="u-group group">
            <div className="u-row row t1">
              <span className="u-ico ico">
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
              </span>
              <div className="u-txt txt">
                <div className="u-name name">Chrome extension</div>
                <div className="u-desc desc">Collect leads from LinkedIn and Google Maps</div>
              </div>
              <span className="u-badge badge">Connected</span>
            </div>
            <div className="u-row row t2">
              <span className="u-ico ico">
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
              </span>
              <div className="u-txt txt">
                <div className="u-name name">Hunter</div>
                <div className="u-desc desc">Find and verify email addresses</div>
              </div>
              <button className="u-btn btn solid" type="button">
                Connect
              </button>
            </div>
            <div className="u-row row t3">
              <span className="u-ico ico">
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
              </span>
              <div className="u-txt txt">
                <div className="u-name name">Apollo</div>
                <div className="u-desc desc">Work emails when Hunter finds none</div>
              </div>
              <button className="u-btn btn solid" type="button">
                Connect
              </button>
            </div>
          </div>

          <div className="u-group-label group-label">Send and track</div>
          <div className="u-group group">
            <div className="u-row row t4">
              <span className="u-ico ico">
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
              </span>
              <div className="u-txt txt">
                <div className="u-name name">HubSpot</div>
                <div className="u-desc desc">Interested leads become contacts and deals</div>
              </div>
              <button className="u-btn btn solid" type="button">
                Connect
              </button>
            </div>
          </div>

          <div className="u-group-label group-label">Use Kestrel elsewhere</div>
          <div className="u-group group">
            <div className="u-row row t5">
              <span className="u-ico ico">
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
              </span>
              <div className="u-txt txt">
                <div className="u-name name">Kestrel MCP</div>
                <div className="u-desc desc">Use your Kestrel data in Claude or Codex</div>
              </div>
              <button className="u-btn btn solid" type="button">
                Set up
              </button>
            </div>
          </div>

          <button className="u-adv adv" type="button" aria-expanded="false">
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
            Advanced: use your own AI key
          </button>
        </main>
      </div>
    </div>
  );
}
