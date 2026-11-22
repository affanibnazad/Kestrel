import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

// Kestrel Connect auto-update. GET /connect/update → the newest connector's signed note { version, sha256, sig };
// GET /connect/update?file=1 → the program itself. Public on purpose: the program holds no secrets (it signs in as the
// person and the database decides what they may do). Connect's launcher checks the signature and the SHA-256 before it
// runs a download, so this address alone cannot push code to anyone (mcp/build.mjs signs; connect/src/kestrel-launch.mjs checks).
const DIR = path.join(process.cwd(), "downloads-private");

export async function GET(req: Request) {
  const wantFile = new URL(req.url).searchParams.get("file") === "1";
  const body = await readFile(path.join(DIR, wantFile ? "kestrel-mcp.mjs" : "kestrel-mcp.json")).catch(() => null);
  if (!body) return NextResponse.json({ error: "No update published." }, { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": wantFile ? "text/javascript; charset=utf-8" : "application/json", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}
