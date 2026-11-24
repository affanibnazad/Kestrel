import type { Metadata } from "next";
import "./globals.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import CookieBanner from "@/components/cookie-banner";
import Reveal from "@/components/reveal";
import SmoothScroll from "@/components/smooth-scroll";
import AuthHash from "@/components/auth-hash";
import RefCapture from "@/components/ref-capture";
import { SITE } from "@/lib/site";

// Calm Mono (T0.9, 21 Nov 2026): SF Pro only — Apple's system font stack.
// SF Pro is not on Google Fonts, so we use the native system stack which
// resolves to SF Pro Text / SF Pro Display on Apple platforms and a sane
// fallback elsewhere. Applied as CSS variables in globals.css :root.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: lead research and AI lead scoring for B2B teams`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  // No fixed title or address here: each page's own title, description and address are used for sharing.
  openGraph: { type: "website", siteName: SITE.name, locale: "en_GB" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

const CLEAN_EXTENSION_ATTRS = `(function(){
  try {
    var clean = function(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        if (node.hasAttribute('bis_skin_checked')) node.removeAttribute('bis_skin_checked');
        var children = node.querySelectorAll ? node.querySelectorAll('[bis_skin_checked]') : [];
        for (var i = 0; i < children.length; i++) children[i].removeAttribute('bis_skin_checked');
      }
    };
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'attributes' && m.attributeName === 'bis_skin_checked' && m.target && m.target.removeAttribute) {
            m.target.removeAttribute('bis_skin_checked');
          } else if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) clean(m.addedNodes[j]);
          }
        }
      });
      obs.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['bis_skin_checked'], childList: true });
    }
    clean(document.documentElement);
  } catch(e) {}
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-look="v2" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CLEAN_EXTENSION_ATTRS }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <CookieBanner />
        <Reveal />
        <SmoothScroll />
        <AuthHash />
        <RefCapture />
      </body>
    </html>
  );
}
