import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import ClientAppShell from "./client-app";
import type { Account } from "./shell";
import { EXAMPLE_LEADS, toRow, type LeadRow } from "@/lib/leads";

export const metadata: Metadata = { title: "App", robots: { index: false, follow: false } };

// The App needs a signed-in team member. The sign-in check streams in behind Suspense.
// The App's one design is styled under :root[data-look="v2"]: set it while the page is still loading, before anything
// paints, so the App never flashes unstyled. A fixed string, no user data.
const LOOK = 'document.documentElement.dataset.look="v2";try{var p=new URLSearchParams(window.location.search);var qt=p.get("theme");if(qt&&["light","dark","gradient"].indexOf(qt)!==-1){document.documentElement.dataset.theme=qt;}else{var l=JSON.parse(localStorage.getItem("kestrel-look")||"{}");if(l&&l.theme&&l.theme!=="auto"){document.documentElement.dataset.theme=l.theme;}}}catch(e){}';

export default function AppPage({ searchParams }: PageProps<"/app">) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: LOOK }} />
      <Suspense fallback={<ClientAppShell email="" loading />}>
        <SignedIn searchParams={searchParams} />
      </Suspense>
    </>
  );
}

// Demo account: Strictly isolated, synthetic, zero admin privileges.
const DEMO_ACCOUNT: Account = {
  team_id: "demo",
  team_name: "Example Studio (Demo)",
  role: "owner",
  full_name: "Alex Example (Demo)",
  plan: "trial",
  chosen_plan: null,
  trial_ends_at: "2026-11-19T09:00:00.000Z",
  join_code: null,
  is_admin: false,
  members: [{ name: "Alex Example", email: "alex@example.test", role: "owner", joined_at: "2026-11-12T00:00:00.000Z" }]
};

// Preview only: example social links so the lead rows show their icons.
const DEMO_SOCIALS: Record<string, string>[] = [
  { instagram: "https://instagram.com/northlight.example", linkedin: "https://linkedin.com/company/northlight-example", youtube: "https://youtube.com/@northlight-example" },
  { instagram: "https://instagram.com/harbour.example", tiktok: "https://tiktok.com/@harbour.example", facebook: "https://facebook.com/harbour.example" },
  { linkedin: "https://linkedin.com/company/copperleaf-example", instagram: "https://instagram.com/copperleaf.example" },
  { facebook: "https://facebook.com/masonvale.example" },
  { instagram: "https://instagram.com/fieldhouse.example", x: "https://x.com/fieldhouse_example", linkedin: "https://linkedin.com/company/fieldhouse-example" },
  {},
];

const demoLeads = (): LeadRow[] => EXAMPLE_LEADS.map((l, i) => ({
  ...toRow(l, "demo", true),
  keyword: (l.keyword as string) || null,
  id: `demo-${i}`,
  phone: (l.phone as string) || null,
  socials: (l.socials as Record<string, string>) || DEMO_SOCIALS[i % DEMO_SOCIALS.length],
  created_at: `2026-11-${String(12 - i).padStart(2, "0")}T09:00:00.000Z`,
}) as LeadRow);

async function SignedIn({ searchParams }: { searchParams: PageProps<"/app">["searchParams"] }) {
  const sp = await searchParams;
  const initialView = typeof sp.view === "string" ? sp.view : "home";
  const isDemoAllowed = process.env.KESTREL_ALLOW_DEMO === "true";
  const isExplicitDemo = isDemoAllowed && (sp.demo === "true" || sp.demo === "1" || sp.preview === "1");

  // Check Supabase authentication
  const user = await currentUser();

  // 1. Authenticated user: Load real workspace, pass demo=undefined so real leads load from database
  if (user) {
    const { data } = await (await supabaseServer()).rpc("my_account");
    const account = (data as Account | null) ?? {
      team_id: user.id,
      team_name: "My Workspace",
      role: "owner",
      full_name: user.email?.split("@")[0] ?? "User",
      plan: "trial",
      chosen_plan: null,
      trial_ends_at: "2026-12-06T09:00:00.000Z",
      join_code: null,
      is_admin: false,
      members: [{ name: user.email?.split("@")[0] ?? "User", email: user.email ?? "", role: "owner", joined_at: "2026-11-22T09:00:00.000Z" }],
    };
    return <ClientAppShell initialView={initialView} email={user.email ?? ""} account={account} demo={undefined} isDemoMode={false} />;
  }

  // 2. Unauthenticated with explicit demo mode requested:
  if (isExplicitDemo) {
    return <ClientAppShell initialView={initialView} email="alex@example.test" account={DEMO_ACCOUNT} demo={demoLeads()} isDemoMode={true} />;
  }

  // 3. Unauthenticated without demo mode: Redirect to login with return destination
  const query = typeof sp.view === "string" ? `?view=${encodeURIComponent(sp.view)}` : "";
  const next = encodeURIComponent(`/app${query}`);
  redirect(`/login?next=${next}`);
}
