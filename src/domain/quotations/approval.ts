import type { Role } from "@/domain/access/roles";
import type { ApprovalStepConfig, ApproverConfig, StepCondition } from "./config";

/**
 * The approval of one quotation, from the configured steps (D-088). When it is submitted, each step is planned from the figures: a step
 * whose condition is met must approve, in order; one whose condition is not met is either still told (it may note "Diketahui") or left
 * out. The quotation is approved when every step that must approve has approved. The database checks the same before it accepts an
 * approved quotation.
 */
export type Figures = { revenue: bigint; grossMargin: bigint };

export function isConditionMet(condition: StepCondition, figures: Figures): boolean {
  if (condition.kind === "ALWAYS") return true;
  if (condition.kind === "GM_BELOW") {
    // Without division: GM × 10000 < threshold × revenue. No revenue means no margin to judge, so the step is needed.
    return figures.revenue <= 0n || figures.grossMargin * 10_000n < BigInt(condition.thresholdBp) * figures.revenue;
  }
  return figures.revenue >= BigInt(condition.amountCents);
}

export type PlannedStep = {
  position: number;
  key: string;
  label: string;
  acknowledgeLabel: string;
  approver: ApproverConfig;
  required: boolean;
  mayEditCosts: boolean;
};

/** The steps of this quotation, in order, with whether each must approve. Steps that need not approve and are skipped are left out. */
export function planApprovals(steps: readonly ApprovalStepConfig[], figures: Figures): PlannedStep[] {
  const planned: PlannedStep[] = [];
  for (const step of steps) {
    const required = isConditionMet(step.condition, figures);
    if (!required && step.whenNotRequired === "SKIP") continue;
    planned.push({ position: planned.length + 1, key: step.key, label: step.label, acknowledgeLabel: step.acknowledgeLabel, approver: step.approver, required, mayEditCosts: step.mayEditCosts });
  }
  return planned;
}

export const APPROVAL_STATES = ["PENDING", "APPROVED", "ACKNOWLEDGED"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type ApprovalRow = { position: number; key: string; required: boolean; status: ApprovalState; approver: ApproverConfig; mayEditCosts: boolean };

/** The step whose turn it is: the first one that must approve and has not. Null when all have. */
export function currentStep<T extends ApprovalRow>(rows: readonly T[]): T | null {
  return [...rows].sort((a, b) => a.position - b.position).find((row) => row.required && row.status === "PENDING") ?? null;
}

export function allRequiredApproved(rows: readonly ApprovalRow[]): boolean {
  return rows.every((row) => !row.required || row.status === "APPROVED");
}

/** Whether this person is the approver of a step: they hold its role, or they are one of the people it names. */
export function isApproverOf(approver: ApproverConfig, viewer: { id: string; role: Role }): boolean {
  return approver.kind === "ROLE" ? viewer.role === approver.role : approver.userIds.includes(viewer.id);
}

/** "Purchasing → Direktur": the steps that must approve, for the line under the margin. */
export function routeSummary(planned: readonly PlannedStep[]): string {
  const required = planned.filter((step) => step.required).map((step) => step.label);
  const told = planned.filter((step) => !step.required).map((step) => step.acknowledgeLabel);
  return [required.length ? `Persetujuan: ${required.join(" → ")}` : "Tidak ada persetujuan yang diperlukan", told.length ? `diberi tahu: ${told.join(", ")}` : ""].filter(Boolean).join("; ") + ".";
}
