"use client";

import { useEffect, useState } from "react";
import { supabaseReady } from "@/lib/supabase/config";
import { offerText, type PublicOffer } from "@/lib/offers";
import { PLANS } from "@/lib/plans";

// The offer for everyone made in Owner → Offers (database 046), on the pricing page and the App's Plan page.
// Nothing shows when there is no live offer (or before 046). It is applied by itself at checkout.
export default function OfferBanner() {
  const [o, setO] = useState<PublicOffer | null>(null);
  useEffect(() => {
    if (!supabaseReady) return;
    import("@/lib/supabase/client").then(({ supabaseBrowser }) => supabaseBrowser().rpc("public_offers"))
      .then(({ data, error }) => { if (!error) setO((data as { everyone?: PublicOffer | null } | null)?.everyone ?? null); })
      .catch(() => {});
  }, []);
  if (!o) return null;
  const plans = o.plans.length ? o.plans.map((p) => PLANS.find((x) => x.id === p)?.name ?? p).join(", ") : "every plan";
  const until = o.ends_at ? ` Ends ${new Date(o.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.` : "";
  return <p className="offer-banner" role="status"><b>{o.name}:</b> {offerText(o)} on {plans}.{until} Applied at checkout.</p>;
}
