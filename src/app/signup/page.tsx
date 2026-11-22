import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import AuthLayout from "@/components/auth-layout";
import { Tip } from "@/components/ui";
import { SUPABASE_KEY, SUPABASE_URL, supabaseReady } from "@/lib/supabase/config";
import { TRIAL_DAYS, type PlanId } from "@/lib/plans";
import SignupForm from "./form";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: `Create your Kestrel account and try every feature free for ${TRIAL_DAYS} days. No card needed.`,
  alternates: { canonical: "/signup" },
};

// Sign up: a new account starts a free trial (with the plan picked on Pricing); with ?team=CODE it joins that team.
export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthLayout
      title={<>Create your account <Tip text="We email you a one-time link instead of a password. Your trial starts when you open it." /></>}
      sub={`${TRIAL_DAYS}-day free trial with every feature. No card needed.`}
    >
      <Suspense fallback={<SignupForm ready={supabaseReady} joinCode="" teamName={null} plan="pro" />}>
        <WithTeam searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

async function WithTeam({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const sp = await searchParams;
  const code = typeof sp.team === "string" ? sp.team.replace(/[^a-f0-9]/gi, "").slice(0, 64) : "";
  const plan: PlanId = sp.plan === "starter" || sp.plan === "agency" ? sp.plan : "pro";
  let teamName: string | null = null, full = false;
  if (code && supabaseReady) {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    // Name and free seat (database 036); before 036, the name only.
    const info = await sb.rpc("team_join_info", { code });
    if (!info.error) { const v = info.data as { name?: string; full?: boolean } | null; teamName = v?.name ?? null; full = Boolean(v?.full); }
    else { const { data } = await sb.rpc("team_for_code", { code }); teamName = typeof data === "string" ? data : null; }
  }
  return <SignupForm ready={supabaseReady} joinCode={code} teamName={teamName} plan={plan} full={full} />;
}
