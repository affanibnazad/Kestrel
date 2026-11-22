import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/ui";
import Redeem from "./redeem";

export const metadata: Metadata = { title: "Claim free access", robots: { index: false, follow: false } };

// An invitation link: kestrelleads.com/redeem?code=KST-XXXX-XXXX. Claims free access for the visitor's team.
export default function RedeemPage() {
  return (
    <div className="auth-page redeem-page">
      <div className="redeem-card">
        <Link href="/" aria-label="Kestrel home"><Brand /></Link>
        <Redeem />
      </div>
    </div>
  );
}
