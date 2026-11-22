import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "The rules for using Kestrel responsibly: lawful outreach, opt-outs, respect for websites and no spam.",
  alternates: { canonical: "/acceptable-use" },
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      intro="Kestrel is for careful, lawful, business-to-business research and outreach. These rules keep it that way."
      sections={[
        { id: "do", title: "You must", body: (
          <ul>
            <li>Collect only public business information, for lawful business purposes.</li>
            <li>Follow the email, marketing and privacy laws where you and your contacts are, such as UK PECR, UK and EU GDPR, and CAN-SPAM.</li>
            <li>Include your real sender details, a postal address and an easy way to opt out in every email.</li>
            <li>Honour opt-outs quickly and keep those people on your do-not-contact list.</li>
            <li>Respect each website&rsquo;s terms and robots.txt.</li>
          </ul>
        ) },
        { id: "dont", title: "You must not", body: (
          <ul>
            <li>Send spam, bulk unsolicited messages to consumers, or misleading emails.</li>
            <li>Harass, scam or phish anyone.</li>
            <li>Collect sensitive personal data, or data about children.</li>
            <li>Get around logins, paywalls, CAPTCHAs, rate limits or blocks, or hide your identity from websites.</li>
            <li>Change Kestrel to remove its safety limits or licence check.</li>
            <li>Resell data collected with Kestrel as a list or database.</li>
          </ul>
        ) },
        { id: "enforce", title: "What happens if rules are broken", body: <p>To enforce these rules, we monitor how each account uses Kestrel: searches made, leads added, emails sent, bounce, unsubscribe and spam-complaint rates, emails to Do-not-contact addresses, and AI use. We do not read the text of your emails for this. If rules are broken we may warn you, limit features, or lock your team (read-only: no sending, no AI, no new leads) and show you the reason, or end access. We may also co-operate with lawful requests from authorities.</p> },
        { id: "report", title: "Reporting misuse", body: <p>If you received an unwanted message that may have been prepared with Kestrel, tell us through the Contact page and we will look into it.</p> },
      ]}
    />
  );
}
