"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error instanceof Error ? error : new Error("Unknown application error"));
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          boxSizing: "border-box",
          background: "#faf9f6",
          color: "#27272a",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <title>Kestrel could not load this page</title>
          <h1 style={{ fontSize: 24, lineHeight: 1.25 }}>Kestrel could not load this page</h1>
          <p style={{ fontSize: 16, lineHeight: 1.6 }}>Try again. Your saved work is still here.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "10px 20px",
              border: 0,
              borderRadius: 999,
              background: "#1677f9",
              color: "white",
              font: "inherit",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
