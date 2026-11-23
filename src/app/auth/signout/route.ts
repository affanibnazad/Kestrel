import { NextResponse, type NextRequest } from "next/server";
import { supabaseReady } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

// Log out, then back to the Log in page.
export async function POST(request: NextRequest) {
  if (!supabaseReady) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
  }
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
