import Link from "next/link";
import { Brand } from "@/components/ui";
import { FOOTER, SITE } from "@/lib/site";
import CookieSettingsLink from "@/components/cookie-link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
      <div className="footer-panel">
      <div className="footer-grid">
        <div className="footer-brand">
          <Brand />
          <p>Lead research for agencies and B2B teams. Find the right businesses, judge them with AI, and reach out with care.</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3>{col.title}</h3>
            {col.links.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            {col.title === "Legal" ? <CookieSettingsLink /> : null}
          </nav>
        ))}
      </div>
      <div className="footer-base">
        <span>© 2026 {SITE.name}. All rights reserved.</span>
        <span>{SITE.domain}</span>
      </div>
      <svg className="wordmark" viewBox="0 0 1000 232" aria-hidden="true"><text x="0" y="226" textLength="1000" lengthAdjust="spacing">Kestrel</text></svg>
      </div>
      </div>
    </footer>
  );
}
