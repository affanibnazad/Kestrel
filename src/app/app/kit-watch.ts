"use client";

import { useEffect, useState } from "react";

// AI kit results waiting (UX audit rows 14, 32): on any App page, look in the connected kit folder's results/ for
// result files that are not imported yet, so the App can say "N results are waiting · Import". The import itself runs
// on Kestrel AI → Score and write (ai-kit.tsx). Only works where the browser already allowed the folder (Chrome, Edge,
// Brave); it never asks for permission by itself.
type Dir = FileSystemDirectoryHandle & { queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>; values?: () => AsyncIterable<FileSystemHandle> };
const RESULT = /^(fit|email)_result_[\w.-]+\.json$/;

function loadHandle(team: string): Promise<Dir | undefined> {
  return new Promise((ok) => {
    try {
      const open = indexedDB.open("kestrel-ai-kit", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kit");
      open.onerror = () => ok(undefined);
      open.onsuccess = () => {
        try { const req = open.result.transaction("kit", "readonly").objectStore("kit").get(team); req.onsuccess = () => ok(req.result as Dir | undefined); req.onerror = () => ok(undefined); }
        catch { ok(undefined); }
      };
    } catch { ok(undefined); }
  });
}

export function useKitResults(team: string | null, active: boolean) {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!team || !active || typeof window === "undefined" || !("showDirectoryPicker" in window)) return;
    let live = true;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      const dir = await loadHandle(team);
      if (!dir || (await dir.queryPermission?.({ mode: "readwrite" })) !== "granted") return;
      let n = 0;
      try {
        const results = (await dir.getDirectoryHandle("results")) as Dir;
        for await (const h of results.values?.() ?? []) if (h.kind === "file" && RESULT.test(h.name)) n++;
      } catch { /* no results folder yet */ }
      if (live) setWaiting(n);
    };
    look();
    const t = setInterval(look, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [team, active]);
  return waiting;
}
