"use client";

import { Tip } from "@/components/ui";
import type { MonitorResult } from "@/lib/blacklist";

// Spam Guard B on screen (Email accounts → an account → Domain health): is this sending domain, or its own sending
// server, on a public blacklist? Kestrel checks every sending domain once a day by itself; "Check now" runs it at once.
export type Monitor = MonitorResult & { cached?: boolean };
export const BLACKLIST_HELP = "Blacklists are public lists that mail providers use to block spam. Kestrel checks your domain on Spamhaus, SURBL and URIBL once a day, and your own sending server's address on four more (Gmail, Outlook and Zoho servers are their job). If a domain gets listed, Kestrel pauses its email accounts so it does not get worse. “Could not check” means the list did not answer this time; it is not a problem with your domain.";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? "just now" : m < 60 ? `${m} minutes ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

export default function BlacklistCard({ domain, monitor, busy, manage, onCheck }: {
  domain: string; monitor?: Monitor; busy: boolean; manage: boolean; onCheck: (domain: string) => void;
}) {
  const unknown = monitor?.lists.filter((l) => l.status === "unknown").length ?? 0;
  const young = monitor?.age_days != null && monitor.age_days < 30;
  return (
    <>
      <div className="dr-row"><h3 className="acct-h3">Blacklists <Tip text={BLACKLIST_HELP} /></h3>
        {manage ? <button type="button" className="btn small glass" disabled={busy} onClick={() => onCheck(domain)}>{busy ? "Checking…" : "Check now"}</button> : null}</div>
      {!monitor ? <p className="dr-muted">Not checked yet. Kestrel checks every sending domain once a day by itself.</p> : (
        <>
          <p className={`bl-sum ${monitor.listed ? "bad" : "ok"}`} role="status">
            {monitor.listed ? `✗ ${domain} is on a blacklist. Its email accounts are paused.` : unknown ? `✓ Not listed on the lists that answered (${unknown} could not be checked).` : `✓ Not on any blacklist.`}
            <small>Checked {ago(monitor.checked_at)}</small>
          </p>
          <ul className="trk-result">{monitor.lists.map((l) => (
            <li key={`${l.kind}:${l.name}`} className={l.status === "clean" ? "ok" : l.status === "listed" ? "bad" : ""}>
              {l.status === "clean" ? "✓" : l.status === "listed" ? "✗" : "•"} <b>{l.name}</b>: {l.status === "clean" ? "not listed" : l.status === "listed" ? "listed" : "could not check"}
              <small className="muted-line">{l.kind === "ip" ? `Sending server ${l.target}` : "Domain"}</small>
            </li>
          ))}</ul>
          {monitor.listed ? <p className="dr-muted">Stop sending from this domain, find the cause (a bad lead list, spam complaints, a hacked website), then ask the list to remove it (each list has a removal page). Resume the accounts in Settings when it is clean.</p> : null}
          <h3 className="acct-h3">Domain age <Tip text="New domains have no reputation yet. Wait about 2 weeks after buying a domain before you send from it, and do not send campaigns from a domain younger than about a month." /></h3>
          <p className={young ? "bl-sum bad" : "dr-muted"}>{monitor.age_days == null ? "Unknown (the registry did not say)." : `${monitor.age_days} days old${monitor.registered ? ` (registered ${monitor.registered.slice(0, 10)})` : ""}.${young ? " Too new for campaigns: keep warming it." : ""}`}</p>
          {monitor.server ? (
            <>
              <h3 className="acct-h3">Sending server <Tip text="Reverse DNS (PTR) is the name your server's address points back to. Providers trust servers whose reverse DNS is set to a real name. Big providers manage this for you." /></h3>
              <p className="dr-muted">{monitor.server.shared ? `${monitor.server.host}: a big provider's server, they manage its reputation.` : `${monitor.server.host}${monitor.server.ip ? ` · ${monitor.server.ip}` : ""} · reverse DNS: ${monitor.server.ptr ?? "not set (ask your host to set it)"}`}</p>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
