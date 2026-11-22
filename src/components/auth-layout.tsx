import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "@/components/ui";

// Sign up and Log in: a premium split screen. Left, the colour panel with what Kestrel does (no made-up
// quotes or numbers). Right, a clean form. On phones the panel shrinks to a short header.
export default function AuthLayout({ title, sub, aside, children }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-panel">
        <Link href="/" className="auth-brand" aria-label="Kestrel home"><Mark size={34} /> Kestrel</Link>
        <div className="auth-pitch">
          <h2>Find clients who are ready to talk.</h2>
          <ul className="auth-points">
            <li><b>Collect</b><span>Businesses from Google Maps, Search, YouTube and six more sources, in every country.</span></li>
            <li><b>Score</b><span>AI checks each lead against your offer, so the best ones rise to the top.</span></li>
            <li><b>Reach out</b><span>A personal first email for each lead, ready to check and send.</span></li>
          </ul>
          {aside}
        </div>
        <p className="auth-foot">© Kestrel · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></p>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <h1>{title}</h1>
          {sub ? <p className="auth-sub">{sub}</p> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
