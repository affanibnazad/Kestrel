import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply when you use the Kestrel website, browser extension and app.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms apply when you use the Kestrel website, browser extension and app. Please read them carefully."
      sections={[
        { id: "agreement", title: "Agreement", body: <p>These terms are an agreement between you (or the business you represent) and {SITE.legalName}. By using Kestrel you accept them. If you use Kestrel for a business, you confirm you can accept them on its behalf.</p> },
        { id: "service", title: "The service", body: <p>Kestrel helps you research businesses from public sources, organise and score them, and prepare emails. Kestrel never sends emails for you. Features may change as we improve the service.</p> },
        { id: "accounts", title: "Accounts and licences", body: <p>Keep your sign-in details and licence key private. A licence covers the number of computers your plan allows and is personal to your business. Do not share, resell or remove the licence check.</p> },
        { id: "plans", title: "Plans, payment and cancelling", body: <p>When paid plans are offered, prices, billing periods and the refund rule will be shown before you buy. You can cancel at any time; access continues until the end of the paid period. If payment fails, access may pause after a short grace period. Your local data stays on your computer.</p> },
        { id: "use", title: "Acceptable use", body: <p>You must follow our <Link href="/acceptable-use">Acceptable Use Policy</Link>, including all email, marketing and privacy laws that apply to you and the people you contact, and the terms of the websites and services you use with Kestrel.</p> },
        { id: "third", title: "Third-party websites and services", body: <p>Kestrel works with websites and services owned by others. Their terms apply to your use of them. Kestrel keeps careful limits, but any website may still limit or block access. We are not responsible for actions third parties take.</p> },
        { id: "data", title: "Your data", body: <p>You own the data you collect and add. You are responsible for having a lawful basis to use it. When we store it for you, our <Link href="/dpa">Data Processing terms</Link> apply. Keep your own backups.</p> },
        { id: "ip", title: "Our software", body: <p>Kestrel is licensed, not sold. You may not copy, modify, decompile, resell or rebuild it, remove its licence check or safety limits, or use it to train AI models or to create a competing product.</p> },
        { id: "warranty", title: "No guarantees", body: <p>Kestrel is provided &ldquo;as is&rdquo;. Websites change, so some features may stop working until we update them. We do not promise any number of leads, replies or sales.</p> },
        { id: "liability", title: "Limit of liability", body: <p>To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the three months before the claim. Nothing in these terms limits liability that cannot be limited by law.</p> },
        { id: "ending", title: "Suspending or ending access", body: <p>We monitor usage to enforce these terms (see the <Link href="/acceptable-use">Acceptable Use Policy</Link>). We may suspend or end access, or lock your team so it is read-only, if you break these terms, for example by sending spam, emailing people who opted out or sharing licence keys. We tell you the reason. You may stop using Kestrel at any time.</p> },
        { id: "changes", title: "Changes to these terms", body: <p>We may update these terms. We will show the date at the top and tell you in the app about important changes.</p> },
        { id: "law", title: "Governing law", body: <p>These terms are governed by the laws of {SITE.country}. Questions: {SITE.contactEmail}.</p> },
      ]}
    />
  );
}
