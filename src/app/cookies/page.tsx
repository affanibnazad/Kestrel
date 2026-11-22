import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";
import CookieSettingsLink from "@/components/cookie-link";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "Which cookies and similar storage the Kestrel website and app use, and how to change your choices.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      intro="We keep cookies to a minimum. Optional cookies are only used if you agree."
      sections={[
        { id: "what", title: "What cookies are", body: <p>Cookies and similar storage (such as local storage) are small pieces of data a website keeps in your browser. Some are needed for the site to work; others are optional.</p> },
        { id: "use", title: "What we use", body: (
          <table><thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>Kept for</th></tr></thead><tbody>
            <tr><td>kestrel-consent</td><td>Essential (local storage)</td><td>Remembers your cookie choice</td><td>Until you change it</td></tr>
            <tr><td>Sign-in session</td><td>Essential</td><td>Keeps you signed in to the Kestrel app (when sign-in is available)</td><td>Session, or until you sign out</td></tr>
            <tr><td>Analytics</td><td>Optional</td><td>Anonymous visit counts to improve the site. Not used today; only ever with your consent</td><td>Up to 13 months</td></tr>
            <tr><td>kestrel_ref</td><td>Marketing (optional)</td><td>Remembers which Kestrel creator&rsquo;s link brought you, so they are credited if you sign up. Only with your consent</td><td>30 days</td></tr>
          </tbody></table>
        ) },
        { id: "choice", title: "Your choices", body: <><p>When you first visit, you can accept all, reject all, or choose. You can change your mind at any time: <CookieSettingsLink />.</p><p>You can also clear cookies and site data in your browser settings.</p></> },
        { id: "extension", title: "The browser extension", body: <p>The Kestrel extension does not use advertising or tracking cookies. It stores your leads and settings in your browser so the extension can work.</p> },
        { id: "changes", title: "Changes", body: <p>If we add any optional cookie or tool, we will update this page and ask for your consent before using it.</p> },
      ]}
    />
  );
}
