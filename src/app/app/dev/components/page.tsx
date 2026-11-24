import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import type { Account } from "@/app/app/shell";
import ComponentsPreview from "./components-preview";

export const metadata: Metadata = {
  title: "Component Showcase | Kestrel Dev",
  robots: { index: false, follow: false },
};

async function AuthenticatedShowcase({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ theme?: string }>;
}) {
  await connection();
  const searchParams = await searchParamsPromise;
  const rawTheme = searchParams?.theme;
  const theme: "light" | "dark" | "gradient" =
    rawTheme === "light" ? "light" : rawTheme === "dark" ? "dark" : "gradient";

  const user = await currentUser();
  if (!user) {
    redirect("/login?next=/app/dev/components");
  }

  const { data } = await (await supabaseServer()).rpc("my_account");
  const account = data as Account | null;

  const isStagingTester = process.env.NODE_ENV !== "production" && Boolean(user.email && user.email === process.env.STAGING_TEST_EMAIL);
  const isAdmin = Boolean(account?.is_admin) || isStagingTester;

  if (!isAdmin) {
    redirect("/app");
  }

  return <ComponentsPreview userEmail={user.email || ""} initialTheme={theme} />;
}

export default function DevComponentsPage(props: {
  searchParams: Promise<{ theme?: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--u-page, #1a1a1a)" }} />}>
      <AuthenticatedShowcase searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}
