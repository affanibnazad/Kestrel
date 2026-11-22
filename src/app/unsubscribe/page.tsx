import type { Metadata } from "next";
import UnsubscribeForm from "./form";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// The page behind the unsubscribe link in a Kestrel campaign email (/unsubscribe?t=…). One button; nothing changes
// until it is clicked, so link scanners in mail systems cannot unsubscribe people by accident.
export default function UnsubscribePage() {
  return <div className="redeem-page"><UnsubscribeForm /></div>;
}
