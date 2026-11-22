import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Data Processing Terms",
  description: "How Kestrel processes personal data on behalf of customers, in line with UK and EU GDPR Article 28.",
  alternates: { canonical: "/dpa" },
};

export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Terms"
      intro="When you store leads in the Kestrel app, we process personal data on your behalf. These terms set out our commitments."
      sections={[
        { id: "roles", title: "Roles", body: <p>You are the controller of personal data in your leads. {SITE.legalName} is your processor and processes it only to provide Kestrel and on your documented instructions.</p> },
        { id: "scope", title: "What we process", body: <p>Business contact details and, sometimes, names and job titles of people at those businesses, plus notes and drafts you add. We do not intend to process sensitive personal data; please do not add it.</p> },
        { id: "commit", title: "Our commitments", body: (
          <ul>
            <li>Process data only on your instructions and keep it confidential.</li>
            <li>Make sure our people who access it are bound by confidentiality.</li>
            <li>Use appropriate technical and organisational security measures.</li>
            <li>Use sub-processors only under written terms with equal protection, and tell you before adding new ones.</li>
            <li>Help you answer requests from individuals exercising their rights.</li>
            <li>Tell you without undue delay after becoming aware of a personal data breach.</li>
            <li>Delete or return data when your account ends, unless the law requires us to keep it.</li>
            <li>Make available the information needed to show we meet these terms.</li>
          </ul>
        ) },
        { id: "subs", title: "Sub-processors", body: <p>The current list is on our <Link href="/subprocessors">Sub-processors</Link> page.</p> },
        { id: "transfers", title: "International transfers", body: <p>Transfers outside the UK or European Economic Area use recognised safeguards, such as the UK International Data Transfer Agreement or the EU Standard Contractual Clauses.</p> },
        { id: "contact", title: "Contact", body: <p>For a signed copy of these terms or privacy questions, contact {SITE.privacyEmail}.</p> },
      ]}
    />
  );
}
