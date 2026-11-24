// src/lib/angles.ts
// Stage D2: Deterministic Angle Picker (CODE, not AI)
// Per lead, picks 1–2 principles from a small library:
// - timing (only if a verified buying_trigger exists)
// - social proof (only if real linked proof)
// - reciprocity (only if first_step offer is set)
// - evidence (default: open with a verified observation)

import type { About } from "./about";
import type { LeadData, Offer } from "./ai";

export type AnglePrinciple = "timing" | "social_proof" | "reciprocity" | "evidence";

export type ChosenAngle = {
  angle: string;
  principles: AnglePrinciple[];
  reasons: string[];
  why: string;
};

export function pickAngle(
  leadData: LeadData | null,
  offer: Offer | null,
  about: About | null,
  buyingTrigger?: string | null
): ChosenAngle {
  const data = leadData ?? {};
  const principles: AnglePrinciple[] = [];
  const reasons: string[] = [];

  // 1. Timing: only if a verified buying_trigger exists
  const trigger = String(
    buyingTrigger ||
    data.ai?.buying_trigger ||
    (data as Record<string, unknown>).buying_trigger ||
    ""
  ).trim();

  if (trigger) {
    principles.push("timing");
    reasons.push(`Timing: verified buying trigger ("${trigger.slice(0, 80)}")`);
  }

  // 2. Social proof: only if real linked proof exists for this offer
  const proofIds = Array.isArray(offer?.proof_ids) ? offer.proof_ids : [];
  const linkedProof = (about?.proof || []).filter(
    (p) => proofIds.includes(p.id) && (p.title || p.result)
  );
  if (linkedProof.length > 0) {
    const p = linkedProof[0];
    principles.push("social_proof");
    reasons.push(`Social proof: verified case study ("${(p.title || p.result).slice(0, 80)}")`);
  }

  // 3. Reciprocity: only if first_step offer is set
  const firstStep = (offer?.first_step || "").trim();
  if (firstStep) {
    principles.push("reciprocity");
    reasons.push(`Reciprocity: low-risk first step offer ("${firstStep.slice(0, 80)}")`);
  }

  // 4. Evidence (default): opens with verified observation from website research
  const obs = data.research?.observations || [];
  if (obs.length > 0) {
    const q = obs[0].quote || obs[0].fact || "";
    principles.push("evidence");
    reasons.push(`Evidence: verified observation ("${q.slice(0, 80)}")`);
  }

  // Selection rule: pick 1-2 principles
  // If timing is present, combine timing + evidence/social_proof/reciprocity
  // If no timing, pair social_proof or reciprocity with evidence
  // Fallback to evidence
  const selected: AnglePrinciple[] = [];
  const selectedReasons: string[] = [];

  if (principles.includes("timing")) {
    selected.push("timing");
    selectedReasons.push(reasons[principles.indexOf("timing")]);

    const second = principles.find(
      (p) => p !== "timing" && (p === "evidence" || p === "social_proof" || p === "reciprocity")
    );
    if (second) {
      selected.push(second);
      selectedReasons.push(reasons[principles.indexOf(second)]);
    }
  } else if (principles.includes("social_proof")) {
    selected.push("social_proof");
    selectedReasons.push(reasons[principles.indexOf("social_proof")]);

    if (principles.includes("evidence")) {
      selected.push("evidence");
      selectedReasons.push(reasons[principles.indexOf("evidence")]);
    }
  } else if (principles.includes("reciprocity")) {
    selected.push("reciprocity");
    selectedReasons.push(reasons[principles.indexOf("reciprocity")]);

    if (principles.includes("evidence")) {
      selected.push("evidence");
      selectedReasons.push(reasons[principles.indexOf("evidence")]);
    }
  } else if (principles.includes("evidence")) {
    selected.push("evidence");
    selectedReasons.push(reasons[principles.indexOf("evidence")]);
  } else {
    selected.push("evidence");
    selectedReasons.push("Evidence: opening with direct verified observation");
  }

  return {
    angle: selected.join(" + "),
    principles: selected,
    reasons: selectedReasons,
    why: selectedReasons.join("; "),
  };
}
