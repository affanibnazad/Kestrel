import { NextResponse } from "next/server";
import { CONNECT_UPDATE } from "@/lib/downloads";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config";

// Kestrel Connect auto-update. GET /connect/update → the newest connector's signed note { version, sha256, sig };
// GET /connect/update?file=1 → the program itself. Public on purpose: the program holds no secrets (it signs in as the
// person and the database decides what they may do). Connect's launcher checks the signature and the SHA-256 before it
// runs a download, so this address alone cannot push code to anyone (mcp/build.mjs signs; connect/src/kestrel-launch.mjs checks).

export async function GET(req: Request) {
  const wantFile = new URL(req.url).searchParams.get("file") === "1";
  if (!wantFile) {
    return NextResponse.json(CONNECT_UPDATE, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.storage.from("downloads").download("kestrel-mcp.mjs");
    if (error || !data) {
      return NextResponse.json({ error: "No update published." }, { status: 404 });
    }
    const buffer = await data.arrayBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "No update published." }, { status: 404 });
  }
}
