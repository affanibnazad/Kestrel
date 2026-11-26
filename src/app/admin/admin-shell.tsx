"use client";

import { useState } from "react";
import Link from "next/link";
import OwnerView from "@/app/app/owner-view";

export default function AdminShell({ email }: { email: string }) {
  const [toast, setToast] = useState("");

  return (
    <div className="app-shell">
      <main className="app-main" style={{ marginLeft: 0, width: "100%", maxWidth: "1280px", margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "16px 0 12px",
            borderBottom: "1px solid var(--line, var(--ds-border-subtle))",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontWeight: 600, fontSize: "15px" }}>Kestrel Admin</span>
            <span className="tag ok">Platform Admin</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {email ? <span className="muted" style={{ fontSize: "13px" }}>{email}</span> : null}
            <Link className="btn glass small" href="/app">
              Back to App
            </Link>
          </div>
        </div>

        {toast ? (
          <div className="toast" role="status" onClick={() => setToast("")}>
            {toast}
          </div>
        ) : null}

        <OwnerView toast={setToast} demo={false} />
      </main>
    </div>
  );
}
