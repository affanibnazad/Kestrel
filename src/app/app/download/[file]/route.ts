import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Downloads for signed-in team members only: the Kestrel extension, Claude Code kit, and MCP connector.
// Served strictly from the private Supabase Storage bucket "downloads" using the authenticated user's session.
// No fallback to local disk. Demo mode is never allowed.

const FILENAMES: Record<string, string> = {
  extension: "Kestrel-extension-2.9.4.zip",
  kit: "Kestrel-AI-Kit.zip",
  mcp: "kestrel-mcp.mjs",
};

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  // Security rule: strictly require an authenticated Supabase user session.
  // Demo mode (?demo / ?preview) never allows downloading paid files.
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", _req.url));
  }

  const { file } = await params;
  const name = FILENAMES[file];
  if (!name) return new NextResponse("Not found", { status: 404 });

  // Read ONLY from the private Supabase Storage bucket "downloads"
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.storage.from("downloads").download(name);
    if (error || !data) {
      return new NextResponse("Not available yet", { status: 404 });
    }

    const buffer = await data.arrayBuffer();
    return new NextResponse(new Uint8Array(buffer) as unknown as BodyInit, {
      headers: {
        "content-type": name.endsWith(".mjs")
          ? "text/javascript; charset=utf-8"
          : "application/zip",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Not available yet", { status: 404 });
  }
}
