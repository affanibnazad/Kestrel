// One place for the site's facts. Values marked "to be added" are shown on the legal pages
// until Affan fills them in, so nothing invented is ever published.
export const SITE = {
  name: "Kestrel",
  domain: "kestrelleads.com",
  url: "https://kestrelleads.com",
  tagline: "Find the right clients, faster",
  description:
    "Kestrel is a lead research workspace for agencies and B2B teams. Collect business leads from public sources, score them against your offer with AI, and prepare personal first emails.",
  legalName: "[Company legal name, to be added]",
  address: "[Registered postal address, to be added]",
  country: "[Country of registration, to be added]",
  contactEmail: "[Contact email, to be added]",
  privacyEmail: "[Privacy email, to be added]",
  legalUpdated: "11 November 2026",
};

export const NAV = [
  { href: "/features", label: "Features" },
  { href: "/use-cases", label: "Use cases" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export const FOOTER = [
  { title: "Product", links: [["/features", "Features"], ["/how-it-works", "How it works"], ["/use-cases", "Use cases"], ["/security", "Security"], ["/pricing", "Pricing"], ["/pricing#plans", "Start free trial"]] },
  { title: "Resources", links: [["/help", "Help centre"], ["/help#install", "Get the extension"], ["/help#ai", "AI guides"], ["/help#safety", "Safe collecting"]] },
  { title: "Company", links: [["/about", "About"], ["/creators", "Creator program"], ["/contact", "Contact"]] },
  { title: "Legal", links: [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/cookies", "Cookie Policy"], ["/acceptable-use", "Acceptable Use"], ["/dpa", "Data Processing"], ["/subprocessors", "Sub-processors"]] },
];

// The nine sources, described the way they really work.
export const SOURCES = [
  { logo: "maps", name: "Google Maps", text: "Local businesses by keyword and place, from map results you open." },
  { logo: "google", name: "Google Search", text: "Business pages from the websites you choose to search." },
  { logo: "youtube", name: "YouTube", text: "Channels by niche and country, with public contact details." },
  { logo: "osm", name: "OpenStreetMap", text: "The open world map, through its official data service." },
  { logo: "jobs", name: "Hiring on job boards", text: "Companies hiring for the skills you sell, from public job boards." },
  { logo: "companies", name: "Companies House", text: "UK companies from the official Companies House register." },
  { logo: "listennotes", name: "Podcasts via Listen Notes", text: "Shows and the companies behind them, from Listen Notes." },
  { logo: "page", name: "Any web page", text: "A list on any web page you open, turned into rows." },
  { logo: "sites", name: "Your website lists", text: "Your own list of websites, checked for public contact details." },
];

export const FAQ = [
  ["What is Kestrel?", "Kestrel is a lead research workspace. A browser extension collects public business details from sources you choose, and the Kestrel app helps you score, organise and contact the best fits."],
  ["Who is Kestrel for?", "Agencies, freelancers and small B2B teams who sell a service to other businesses and want a steady list of well-matched prospects."],
  ["Does Kestrel send emails for me?", "No. Kestrel drafts personal first emails for you to check. You send them from your own email account, so you stay in control of every message."],
  ["How does AI scoring work?", "You describe your offer and your ideal customer once. Kestrel's AI reads each lead and marks it Good, Maybe or No, with a short reason. You can use your own AI key or a coding agent like Claude Code or Codex."],
  ["Is my data safe?", "Leads collected with the extension stay in your browser until you choose to sync them with your team. Keys for connected services are never included in exports or backups. See the Security page for details."],
  ["How does Kestrel avoid problems with websites?", "Kestrel collects slowly, with daily limits, follows each website's robots.txt, stops when a site shows a check, and never gets around logins or blocks."],
  ["Can my team work together?", "Yes. Team workspaces share one lead list and one progress view, so nobody searches the same place twice and duplicates are merged."],
];

// Kestrel extension in the Chrome Web Store (Brave uses the same store). When the listing is approved, put its ID here:
// the App then finds the store copy too, and Get Kestrel shows a one-click "Add to Brave / Chrome" button.
export const EXTENSION = {
  devId: "miifajapklleeecglnooafedaafodafi", // the copy loaded with Developer mode (fixed by the manifest key)
  storeId: "",                              // e.g. "abcdefghijklmnopabcdefghijklmnop" after the store listing is created
};
export const storeUrl = () => (EXTENSION.storeId ? `https://chromewebstore.google.com/detail/${EXTENSION.storeId}` : "");

// Kestrel Connect installers (quarry-cloud/connect), hosted on GitHub Releases (Affan, 17 Nov 2026). Empty until the public
// releases repository exists: then "https://github.com/<owner>/kestrel-connect-releases/releases/latest/download".
export const CONNECT_RELEASES = "https://github.com/affanibnazad/kestrel-connect-releases/releases/latest/download";
export const CONNECT_FILES = { macArm: "Kestrel-Connect-mac-arm64.dmg", macIntel: "Kestrel-Connect-mac-x64.dmg", windows: "Kestrel-Connect-windows-setup.exe" };
