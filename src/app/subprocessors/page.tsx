import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Sub-processors",
  description: "The service providers Kestrel uses to host and run the service, and the services you can connect yourself.",
  alternates: { canonical: "/subprocessors" },
};

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      intro="The service providers we rely on to run Kestrel."
      sections={[
        { id: "list", title: "Our sub-processors", body: (
          <table><thead><tr><th>Provider</th><th>Purpose</th><th>Location</th></tr></thead><tbody>
            <tr><td>Vercel Inc.</td><td>Website and app hosting</td><td>Global network; app region London (UK)</td></tr>
            <tr><td>Supabase Inc.</td><td>Database and sign-in for team workspaces (when available)</td><td>London (UK)</td></tr>
            <tr><td>Lemon Squeezy</td><td>Payments and licence keys (when paid plans launch)</td><td>United States</td></tr>
          </tbody></table>
        ) },
        { id: "yours", title: "Services you connect yourself", body: <p>Some features use services with your own account and key, for example AI providers (Anthropic, OpenAI, Google, OpenRouter), Hunter.io, Listen Notes and Companies House. Data goes to these services directly from you, under their terms, only when you use those features.</p> },
        { id: "changes", title: "Changes", body: <p>We will update this page and tell customers in advance before adding a new sub-processor that handles their data.</p> },
      ]}
    />
  );
}
