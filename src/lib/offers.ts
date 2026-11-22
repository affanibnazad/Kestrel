// Offers (database 046): how an offer reads, shared by Owner → Offers, the pricing page, sign-up and the Plan page.
export type PublicOffer = { name: string; amount_type: "percent" | "fixed"; amount: number; duration: "once" | "repeating" | "forever"; months: number | null; plans: string[]; ends_at: string | null };

// "30% off for 3 months", "$10 off the first payment", "20% off every payment"
export function offerText(o: Pick<PublicOffer, "amount_type" | "amount" | "duration" | "months">) {
  const off = o.amount_type === "percent" ? `${o.amount}% off` : `$${(o.amount / 100).toFixed(o.amount % 100 ? 2 : 0)} off`;
  if (o.duration === "once") return `${off} the first payment`;
  if (o.duration === "forever") return `${off} every payment`;
  return `${off} for ${o.months ?? 1} ${o.months === 1 ? "month" : "months"}`;
}
// The monthly price while the offer runs.
export const offerPrice = (price: number, o: Pick<PublicOffer, "amount_type" | "amount">) =>
  Math.max(0, Math.round((o.amount_type === "percent" ? price * (100 - o.amount) / 100 : price - o.amount / 100) * 100) / 100);
export const offerFor = (o: Pick<PublicOffer, "plans"> | null | undefined, plan: string) => Boolean(o && (!o.plans.length || o.plans.includes(plan)));
