"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import AppShell from "./shell";

const emptySubscribe = () => () => {};

export default function ClientAppShell(props: ComponentProps<typeof AppShell>) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <div className="app-shell-skeleton" suppressHydrationWarning style={{ minHeight: "100vh", background: "var(--bg, #f8fafc)" }}>
        <div suppressHydrationWarning style={{ display: "flex", height: "100vh" }}>
          <div suppressHydrationWarning style={{ width: 260, borderRight: "1px solid var(--line, #e2e8f0)", background: "var(--card, #ffffff)" }} />
          <div suppressHydrationWarning style={{ flex: 1, padding: 32 }} />
        </div>
      </div>
    );
  }

  return <AppShell {...props} />;
}
