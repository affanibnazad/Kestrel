import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import AdminShell from "./admin-shell";

export const metadata = {
  title: "Admin Portal — Kestrel",
};

async function AdminGate() {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");

  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/app");

  return <AdminShell email={user.email ?? ""} />;
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="app-shell" />}>
      <AdminGate />
    </Suspense>
  );
}
