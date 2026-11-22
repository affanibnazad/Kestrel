"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Brand } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Kestrel Root Error]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "var(--bg, #f8fafc)",
        color: "var(--text, #0f172a)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif",
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <Brand />
      </div>

      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--card, #ffffff)",
          border: "1px solid var(--line, #e2e8f0)",
          borderRadius: 16,
          padding: "36px 28px",
          textAlign: "center",
          boxShadow: "none",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "9999px",
            background: "rgba(220, 38, 38, 0.1)",
            color: "#DC2626",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          !
        </div>

        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            margin: "0 0 10px",
            color: "var(--text, #0f172a)",
            letterSpacing: "-0.2px",
          }}
        >
          Something went wrong
        </h1>

        <p
          style={{
            fontSize: 14,
            color: "var(--label2, #64748b)",
            margin: "0 0 24px",
            lineHeight: 1.5,
          }}
        >
          Kestrel encountered an unexpected error. Please try again or return to the home page.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: "9999px",
              minHeight: 40,
              padding: "8px 24px",
              background: "#1677f9",
              color: "#ffffff",
              border: 0,
              fontWeight: 600,
              fontSize: "13.5px",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>

          <Link
            href="/"
            style={{
              borderRadius: "9999px",
              minHeight: 40,
              padding: "8px 20px",
              background: "transparent",
              color: "var(--text, #0f172a)",
              border: "1px solid var(--line, #e2e8f0)",
              fontWeight: 500,
              fontSize: "13.5px",
              display: "inline-flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Back to Home
          </Link>
        </div>

        {error?.message ? (
          <details
            style={{
              marginTop: 24,
              textAlign: "left",
              fontSize: 12,
              color: "var(--label3, #94a3b8)",
            }}
          >
            <summary style={{ cursor: "pointer", userSelect: "none" }}>Diagnostic information</summary>
            <pre
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "var(--bg, #f8fafc)",
                border: "1px solid var(--line, #e2e8f0)",
                borderRadius: 8,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "11px",
              }}
            >
              {error.message}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
