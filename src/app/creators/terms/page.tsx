import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/legal-page";
import { INTRO } from "@/lib/plans";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Creator terms",
  description: "The rules of the Kestrel creator program: commission, payouts, honest promotion and what ends a creator account.",
  alternates: { canonical: "/creators/terms" },
};

const who = SITE.legalName.startsWith("[") ? "Kestrel" : SITE.legalName;

export default function CreatorTermsPage() {
  return (
    <LegalPage title="Creator terms" updated="14 November 2026"
      intro={`These terms apply to everyone in the Kestrel creator program. By sharing your Kestrel link or code you agree to them. ${who} may change them with 30 days' notice by email.`}
      sections={[
        { id: "join", title: "Joining", body: <p>We approve creators by hand. Approval gives you a personal link, a code and a Creator page in the Kestrel App, where you see your sign-ups and earnings. We may decline an application without giving a reason.</p> },
        { id: "credit", title: "Who is credited", body: <><p>A new Kestrel team is credited to you when its owner signs up within 30 days of opening your link (if they allowed marketing cookies), or types your code in the sign-up form. One creator per team: the first one wins. People who join an existing team are not new teams.</p><p>You are never credited for your own account, your own company, or teams you control.</p></> },
        { id: "money", title: "Commission", body: <><p>You earn your rate (30% unless your page says otherwise; founding creators 40%) of each payment a credited team makes, before tax, for 12 months from its first payment. Trials earn nothing; only real payments count.</p><p>Each commission is held for 30 days. A refund or chargeback in that time, or later, takes the commission back. After the hold we pay what you are owed twice a month, by bank transfer or PayPal. Amounts are in US dollars.</p></> },
        { id: "audience", title: "What your audience gets", body: <p>Your link and code give a new team {INTRO.percent}% off its first {INTRO.months} months on any plan, plus the normal free trial. Do not promise anything else.</p> },
        { id: "honest", title: "Honest promotion", body: <><p>Say clearly that your link is an affiliate link (for example &ldquo;I earn a commission if you sign up&rdquo;), as the law requires (FTC in the US, ASA/CAP in the UK).</p><p>Show legal use only: real business contacts, a sender name and postal address in every email, an easy way to say no, and respect for Do-not-contact. Never present Kestrel as a tool for spam, buying lists, hiding who you are or getting around anyone&rsquo;s rules.</p><p>Do not bid on &ldquo;Kestrel&rdquo; in paid search ads, do not send unsolicited messages to promote your link, and do not make fake reviews or accounts.</p></> },
        { id: "end", title: "Ending", body: <p>You can leave any time. We may pause or end a creator account that breaks these terms; commission from broken rules is not paid. When an account ends, payments already past the hold are still paid; nothing more is earned. See also our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p> },
      ]} />
  );
}
