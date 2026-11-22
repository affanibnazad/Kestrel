import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

// Choose a plan → Lemon Squeezy checkout. The link carries the team id, so the payment unlocks the right team,
// and the discount code chosen by checkout_discount (creator code, the team's offer code, or the offer for everyone). Only the team owner pays. Card details are typed on Lemon Squeezy's page, never here.
export async function GET(request: Request) {
  const url = new URL(request.url), back = (m: string) => NextResponse.redirect(new URL(`/app?view=plan&billing=${m}`, url.origin), 303);
  const plan = url.searchParams.get("plan");
  if (!plan || !["starter", "pro", "agency"].includes(plan)) return back("unknown-plan");
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin), 303);
  const sb = await supabaseServer();
  const { data: account } = await sb.rpc("my_account");
  const a = account as { team_id?: string; role?: string } | null;
  if (!a?.team_id || a.role !== "owner") return back("owner-only");
  const { data: row } = await sb.from("billing_plans").select("checkout_url").eq("plan", plan).maybeSingle();
  if (!row?.checkout_url) return back("not-ready");
  await sb.rpc("choose_plan", { p: plan });
  const go = new URL(row.checkout_url);
  go.searchParams.set("checkout[custom][team_id]", a.team_id);
  if (user.email) go.searchParams.set("checkout[email]", user.email);
  // The discount code (Owner → Offers, database 046): the team's creator code, else its offer code, else the offer for
  // everyone; none means the normal price. Before 046: only the creator code (database 040).
  const offer = await sb.rpc("checkout_discount", { plan });
  const code = offer.error ? (await sb.rpc("my_referral_code")).data : offer.data;
  const discount = typeof code === "string" && /^[A-Z0-9]{3,20}$/.test(code) ? code : "";
  if (discount) go.searchParams.set("checkout[discount_code]", discount);
  return NextResponse.redirect(go, 303);
}
