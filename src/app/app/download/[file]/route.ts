import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";

// Downloads for signed-in team members only: the Kestrel extension and the Claude Code kit
// (built by tools/build_downloads.py into downloads-private/, which is not public).
const DIR = path.join(process.cwd(), "downloads-private");

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", _req.url));
  const { file } = await params;
  const info = JSON.parse(await readFile(path.join(DIR, "downloads.json"), "utf8")) as { extension: string; kit: string };
  // Kestrel MCP (mcp/build.mjs): one JavaScript file, always this name.
  const name = file === "extension" ? info.extension : file === "kit" ? info.kit : file === "mcp" ? "kestrel-mcp.mjs" : "";
  if (!name) return new NextResponse("Not found", { status: 404 });
  const body = await readFile(path.join(DIR, name)).catch(() => null);
  if (!body) return new NextResponse("Not built yet", { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": name.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
}
