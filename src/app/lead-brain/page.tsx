import { redirect } from "next/navigation";

export default function LeadBrainRedirectPage() {
  redirect("/app?view=lead-brain");
}
