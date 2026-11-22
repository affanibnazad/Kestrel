"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Line } from "./ui";

interface Props {
  children: ReactNode;
  viewName: string;
  onReset?: () => void;
  onNavigateHome?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ViewErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[Kestrel Error Boundary] Error in view "${this.props.viewName}":`, error, errorInfo);
  }

  public componentDidUpdate(prevProps: Props) {
    // If the user navigates to another view in the sidebar, reset the error boundary automatically
    if (prevProps.viewName !== this.props.viewName && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      const displayName = this.props.viewName ? this.props.viewName.charAt(0).toUpperCase() + this.props.viewName.slice(1) : "Section";

      return (
        <div
          className="kpage kerror-boundary-wrap"
          role="alert"
          style={{
            padding: "40px 24px",
            maxWidth: 620,
            margin: "40px auto 0",
            textAlign: "center",
          }}
        >
          <div
            className="kcard"
            style={{
              background: "var(--card, #ffffff)",
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: "16px",
              padding: "36px 28px",
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
              }}
            >
              <Line name="alert" />
            </div>

            <h2
              style={{
                fontSize: "19px",
                fontWeight: 600,
                margin: "0 0 10px",
                color: "var(--text, #0f172a)",
                letterSpacing: "-0.2px",
              }}
            >
              Unable to load {displayName}
            </h2>

            <p
              style={{
                fontSize: "14px",
                color: "var(--label2, #64748b)",
                margin: "0 0 24px",
                lineHeight: 1.5,
              }}
            >
              Kestrel encountered an unexpected error while loading this view. Your saved workspace data is completely safe.
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
                className="btn go"
                onClick={this.handleReset}
                style={{
                  borderRadius: "9999px",
                  minHeight: 38,
                  padding: "8px 20px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>

              {this.props.onNavigateHome && (
                <button
                  type="button"
                  className="btn"
                  onClick={this.props.onNavigateHome}
                  style={{
                    borderRadius: "9999px",
                    minHeight: 38,
                    padding: "8px 20px",
                    fontSize: "13.5px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Return to Home
                </button>
              )}
            </div>

            {this.state.error?.message ? (
              <details
                style={{
                  marginTop: 28,
                  textAlign: "left",
                  fontSize: "12px",
                  color: "var(--label3, #94a3b8)",
                }}
              >
                <summary style={{ cursor: "pointer", userSelect: "none", outline: "none" }}>
                  Diagnostic information
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: "12px 14px",
                    background: "var(--bg, #f8fafc)",
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "8px",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "11.5px",
                    color: "var(--text, #1e293b)",
                  }}
                >
                  {this.state.error.message}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
