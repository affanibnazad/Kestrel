"use client";

import { useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { INTRO } from "@/lib/plans";

// A creator's own page (database 040): their link and code, how many teams they brought, and what they earned.
// It never shows who signed up: only the date, how they came (link or code) and whether they pay.
type Mine = {
  name: string; code: string; rate: number; months: number; founding: boolean; status: string;
  signups: number; paying: number; money: { earned: number; held: number; owed: number; paid: number; back: number };
  recent: { joined: string; source: "link" | "code"; state: "paying" | "trial" | "not paying"; earned: number }[];
};
const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE = { paying: "Paying", trial: "On free trial", "not paying": "Not paying" } as const;

export default function CreatorPage({ toast }: { toast: (t: string) => void }) {
  const [me, setMe] = useState<Mine | null>(null);
  const [msg, setMsg] = useState("Loading…");
  useEffect(() => {
    supabaseBrowser().rpc("my_creator").then(({ data, error }) => {
      if (error) setMsg(error.message);
      else if (!data) setMsg("This page is for Kestrel creators.");
      else { setMe(data as Mine); setMsg(""); }
    });
  }, []);
  const link = me ? `https://kestrelleads.com/?ref=${me.code}` : "";
  async function copy(text: string, what: string) { await navigator.clipboard.writeText(text); toast(`Copied ${what}.`); }

  return (
    <div className="app-page">
      <header className="head"><div>
        <h1>Creator <Tip text={`You earn ${me?.rate ?? 30}% of every payment from teams you bring, for ${me?.months ?? 12} months from their first payment. Each payment is held 30 days (refunds take it back), then paid to you. Your audience gets ${INTRO.percent}% off their first ${INTRO.months} months.`} /></h1>
        <span className="sub">{me ? `${me.name}${me.founding ? " · Founding creator" : ""} · ${me.rate}% for ${me.months} months` : msg}</span>
      </div></header>
      {me ? (
        <>
          <div className="join-card creator-share">
            <div><small>Your link</small><b>{link}</b></div>
            <div className="join-row"><button type="button" className="btn small go" onClick={() => copy(link, "your link")}>Copy link</button></div>
            <div><small>Your code <Tip text="For people who sign up without your link: they type it in the sign-up form. It also gives the discount at checkout." /></small><b>{me.code}</b></div>
            <div className="join-row"><button type="button" className="btn small glass" onClick={() => copy(me.code, "your code")}>Copy code</button></div>
          </div>
          {me.status !== "active" ? <p className="plan-msg">Your creator account is {me.status}. {me.status === "paused" ? "New sign-ups are not credited right now; teams you already brought still earn." : ""} Questions? Reply to your last email from Kestrel.</p> : null}
          <div className="owner-tiles">
            <div className="owner-tile"><small>Sign-ups</small><b>{me.signups}</b><span>Teams that came from you.</span></div>
            <div className="owner-tile"><small>Paying now</small><b>{me.paying}</b><span>Teams paying for a plan today.</span></div>
            <div className="owner-tile"><small>Earned</small><b>{usd(me.money.earned)}</b><span>{usd(me.money.paid)} paid to you so far.</span></div>
            <div className="owner-tile"><small>Ready to pay</small><b>{usd(me.money.owed)}</b><span>{usd(me.money.held)} still in the 30-day hold.{me.money.back ? ` ${usd(me.money.back)} of refunds comes off your next payment.` : ""}</span></div>
          </div>
          <div className="table-card members">
            <table className="leads">
              <thead><tr><th>Signed up</th><th>Came from</th><th>Now</th><th>You earned</th></tr></thead>
              <tbody>{me.recent.map((r, i) => (
                <tr key={i}><td>{new Date(r.joined).toLocaleDateString()}</td><td>{r.source === "link" ? "Your link" : "Your code"}</td><td>{STATE[r.state]}</td><td>{usd(r.earned)}</td></tr>
              ))}</tbody>
            </table>
            {!me.recent.length ? <div className="empty"><div><b>No sign-ups yet</b><Tip text="Share your link or code. Sign-ups show here as soon as they create their account; you earn when they pay." /></div></div> : null}
          </div>
          <p className="plan-msg owner-note">Please say it is an affiliate link when you share it, and show legal use only (real business emails, a postal address, an easy way to say no). <a href="/creators/terms" target="_blank">Creator terms</a></p>
        </>
      ) : null}
    </div>
  );
}
