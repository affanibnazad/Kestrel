import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Kestrel collects, uses and protects personal data on the website, in the browser extension and in the Kestrel app.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what personal data Kestrel handles, why, and the choices you have."
      updated="17 November 2026"
      sections={[
        { id: "who", title: "Who we are", body: <p>{SITE.name} is provided by {SITE.legalName}, {SITE.address}, {SITE.country} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). For privacy questions or requests, contact {SITE.privacyEmail}.</p> },
        { id: "scope", title: "What this policy covers", body: <p>This policy covers the website at {SITE.domain}, the Kestrel browser extension and the Kestrel app. When you use Kestrel to collect information about businesses, you decide what to collect and how to use it; see &ldquo;Data you collect with Kestrel&rdquo; below.</p> },
        { id: "data", title: "Data we collect", body: (
          <table><thead><tr><th>Data</th><th>Why</th><th>Legal basis</th></tr></thead><tbody>
            <tr><td>Account details (name, email, team) when you sign in to the app</td><td>To give you access and run your team workspace</td><td>Contract</td></tr>
            <tr><td>Licence and billing records, when paid plans launch</td><td>To manage your subscription and meet tax rules</td><td>Contract, legal obligation</td></tr>
            <tr><td>Support messages you send us</td><td>To answer you</td><td>Legitimate interests</td></tr>
            <tr><td>Usage records: searches made (keywords and places), numbers of leads added, emails sent, bounces, unsubscribes, spam complaints and AI use per team. Never the text of your emails</td><td>To enforce our Terms and Acceptable Use Policy, stop spam and abuse, and protect our sending reputation and other customers</td><td>Legitimate interests, contract</td></tr>
            <tr><td>Essential technical data (security logs, your cookie choice)</td><td>To keep the service secure and remember your choice</td><td>Legitimate interests</td></tr>
            <tr><td>Optional analytics, only if you agree</td><td>To understand and improve the website</td><td>Consent</td></tr>
          </tbody></table>
        ) },
        { id: "extension", title: "The browser extension", body: (
          <>
            <p>The extension stores the leads you collect, your settings and your search progress in your own browser. We do not receive this data unless you choose to sync it with a Kestrel team workspace.</p>
            <p>The extension sends data to other services only when you use a feature that needs them: for example your AI provider when you score leads with your own key (business details only, never email addresses or phone numbers), or a data service such as Companies House, Listen Notes or Hunter.io when you search it with your own key.</p>
          </>
        ) },
        { id: "google", title: "Google user data", body: (
          <>
            <p><b>What Kestrel accesses.</b> When you connect a Gmail or Google Workspace account with &ldquo;Sign in with Google&rdquo;, Kestrel can send email from that account and read its inbox to find replies to your campaigns. Kestrel also reads the email address of the account so it can show which mailbox is connected.</p>
            <p><b>Why.</b> Only to send the campaign emails you set up and to find, show and sort the replies to them in your Kestrel inbox. Kestrel does not read, keep or use other messages in the account for any other purpose.</p>
            <p><b>What we never do.</b> We do not sell Google user data. We do not use it for advertising, and we do not use it to build, train or improve AI or machine-learning models. People at Kestrel do not read it, except with your permission, when needed for security or to follow the law.</p>
            <p><b>Who else sees it.</b> Only the service providers that host Kestrel, under contract, to run the service for you. When you use AI reply labels, the text of a reply is sent to our AI provider (Anthropic) only to sort it into a label shown to you; its terms do not allow it to train its models on that data.</p>
            <p><b>How it is protected.</b> Sign-in tokens are stored encrypted, and all data is encrypted in transit. You can disconnect the account at any time in Kestrel or in your Google account settings; removing the mailbox in Kestrel deletes its sign-in token. You can delete replies in Kestrel, or ask us to delete all of this data at {SITE.privacyEmail}.</p>
            <p>Kestrel&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
          </>
        ) },
        { id: "collected", title: "Data you collect with Kestrel", body: <p>Leads may include business contact details and, sometimes, names of people at those businesses. For that information, you are the controller and we act as your processor when it is stored in the Kestrel app. You must have a lawful basis to collect and use it, honour opt-outs and follow the email and privacy laws that apply. Our <Link href="/dpa">Data Processing terms</Link> and <Link href="/acceptable-use">Acceptable Use Policy</Link> explain this.</p> },
        { id: "sharing", title: "Who we share data with", body: <p>We use trusted service providers to host and run Kestrel, listed on our <Link href="/subprocessors">Sub-processors</Link> page. We do not sell personal data and we do not use it for advertising.</p> },
        { id: "transfers", title: "International transfers", body: <p>Where data is transferred outside the UK or European Economic Area, we use recognised safeguards such as the UK International Data Transfer Agreement or the EU Standard Contractual Clauses.</p> },
        { id: "retention", title: "How long we keep data", body: <p>We keep account data while your account is active and for a short period afterwards to meet legal duties. You can delete leads at any time. In team workspaces we recommend removing leads that were never contacted within 12 months.</p> },
        { id: "rights", title: "Your rights", body: <p>You can ask to access, correct, delete or export your personal data, object to or restrict our use of it, and withdraw consent at any time. Contact {SITE.privacyEmail}. You can also complain to your data protection authority, such as the UK Information Commissioner&rsquo;s Office.</p> },
        { id: "security", title: "Security", body: <p>We protect data with access controls, encryption in transit and careful handling of keys. Read more on our <Link href="/security">Security</Link> page.</p> },
        { id: "cookies", title: "Cookies", body: <p>See our <Link href="/cookies">Cookie Policy</Link>. You can change your choice at any time with &ldquo;Cookie settings&rdquo; at the bottom of every page.</p> },
        { id: "changes", title: "Changes to this policy", body: <p>We will update this page when our practices change and show the date at the top. Important changes will also be shown in the app.</p> },
      ]}
    />
  );
}
