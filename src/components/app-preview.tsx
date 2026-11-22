// A detailed still picture of the Kestrel app with example data (built in HTML, not a screenshot).
// It follows the real app: list sidebar, title bar with search and export, numbers row, and the lead table.
const LEADS: [string, string, string, string, "good" | "maybe" | "no", string][] = [
  ["Northlight Studio", "northlight.studio", "London", "Google Maps", "good", "Makes brand films for retail clients"],
  ["Harbour Social", "harboursocial.co", "Bristol", "YouTube", "good", "Weekly short-form video, hiring an editor"],
  ["Copperleaf Design", "copperleaf.design", "Leeds", "Google Search", "maybe", "Strong design work, no video yet"],
  ["Mason & Vale", "masonvale.agency", "Manchester", "Companies House", "maybe", "New agency, two directors"],
  ["Fieldhouse Media", "fieldhouse.media", "Glasgow", "Job boards", "good", "Hiring a motion designer this month"],
  ["Quickprint Ltd", "quickprint.co.uk", "Leeds", "OpenStreetMap", "no", "Print shop, does not buy this service"],
];
const LISTS: [string, string][] = [["All leads", "248"], ["Good fit", "55"], ["Hiring now", "12"], ["Named contacts", "31"], ["Unreviewed", "96"]];
const SOURCES = ["Google Maps", "YouTube", "Companies House", "Job boards"];
const LABEL = { good: "Good", maybe: "Maybe", no: "No" };

export default function AppPreview() {
  return (
    <div className="ap" aria-label="Example of the Kestrel app with sample leads" role="img">
      <aside className="ap-side">
        <div className="ap-brand"><span className="ap-logo">K</span>Kestrel</div>
        {LISTS.map(([l, n], i) => <div key={l} className={`ap-nav${i === 1 ? " on" : ""}`}><span>{l}</span><small>{n}</small></div>)}
        <div className="ap-h">Sources</div>
        {SOURCES.map((s) => <div key={s} className="ap-nav"><span>{s}</span></div>)}
      </aside>
      <div className="ap-main">
        <div className="ap-top">
          <div><b>Good fit</b><small>55 leads · sorted by score</small></div>
          <div className="ap-search">Search leads</div>
          <span className="ap-btn">Export</span>
        </div>
        <div className="ap-stats">
          <div><small>Leads</small><b>248</b></div>
          <div><small>Good fit</small><b>55</b></div>
          <div><small>Have email</small><b>61%</b></div>
          <div><small>Hiring now</small><b>12</b></div>
        </div>
        <div className="ap-table">
          <div className="ap-row head"><span>Business</span><span>Place</span><span>Source</span><span>Score</span><span>Reason</span></div>
          {LEADS.map(([n, d, place, src, tone, why]) => (
            <div key={n} className="ap-row">
              <span className="ap-biz"><i>{n[0]}</i><span><b>{n}</b><small>{d}</small></span></span>
              <span>{place}</span><span>{src}</span>
              <span><em className={`pill ${tone}`}>{LABEL[tone]}</em></span>
              <span>{why}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
