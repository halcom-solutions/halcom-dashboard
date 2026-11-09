import { can } from "@/domain/access/permissions";
import { isPrivilegedRole, type Role } from "@/domain/access/roles";
import { salesActsOn, type ProjectSourceType } from "@/domain/projects/source";
import { currentStep, isApproverOf, type ApprovalRow } from "./approval";
import { canBeChosen, isCalculationEditable, isHeaderEditable, type QuotationStatus } from "./workflow";

/**
 * Who may do what with a quotation. The server asks this inside its transaction (with the stored account and the locked row); the page
 * asks it to decide which buttons to show. Approvers come from the configured steps: a role (Purchasing), or named people (the
 * Director, who also works as a salesperson).
 */
export type QuotationViewer = { id: string; role: Role; /** Named as an approver in a step of the configuration. */ isNamedApprover: boolean };

export type QuotationState = {
  status: QuotationStatus;
  chosen: boolean;
  /** Sent to Jurnal as a Sales Quote: its figures are then changed in Jurnal's way, not by reopening it here. */
  inJurnal: boolean;
  convertedInJurnal: boolean;
  approvals: readonly ApprovalRow[];
  project: { sourceType: ProjectSourceType; salesOwnerId: string | null; deleted: boolean };
};

export type QuotationAction =
  | "editCalculation"
  | "editHeader"
  | "submit"
  | "recall"
  | "approve"
  | "returnToSales"
  | "editCosts"
  | "acknowledge"
  | "reopen"
  | "cancel"
  | "choose"
  | "unchoose"
  | "duplicate";

/** The project's salesperson (any salesperson on a project from another source), or an administrator. */
export function mayPrepareOn(viewer: { id: string; role: Role }, project: { sourceType: ProjectSourceType; salesOwnerId: string | null; deleted?: boolean }): boolean {
  if (project.deleted) return false;
  return can(viewer.role, "quotations.prepare") && (isPrivilegedRole(viewer.role) || salesActsOn(project, viewer.id));
}

/** Reading a calculation shows buy prices and margins: the permission, or being named as an approver. */
export function mayViewQuotations(viewer: QuotationViewer): boolean {
  return can(viewer.role, "quotations.view") || viewer.isNamedApprover;
}

export function quotationActions(state: QuotationState, viewer: QuotationViewer): ReadonlySet<QuotationAction> {
  const actions = new Set<QuotationAction>();
  if (state.project.deleted) return actions;
  const preparer = mayPrepareOn(viewer, state.project);
  const { status } = state;

  if (preparer) {
    if (isCalculationEditable(status)) actions.add("editCalculation").add("submit");
    if (isHeaderEditable(status, state.chosen)) actions.add("editHeader");
    if (status === "PENDING") actions.add("recall");
    if (status === "APPROVED" && !state.chosen && !state.inJurnal) actions.add("reopen");
    if (status !== "CANCELLED" && !state.chosen && !state.inJurnal) actions.add("cancel");
    if (canBeChosen(status) && !state.chosen) actions.add("choose");
    if (state.chosen && !state.convertedInJurnal) actions.add("unchoose");
    actions.add("duplicate");
  }
  if (status === "PENDING") {
    const turn = currentStep(state.approvals);
    if (turn && isApproverOf(turn.approver, viewer)) {
      actions.add("approve").add("returnToSales");
      if (turn.mayEditCosts) actions.add("editCosts");
    }
  }
  if (status === "PENDING" || status === "APPROVED") {
    if (state.approvals.some((row) => !row.required && row.status === "PENDING" && isApproverOf(row.approver, viewer))) actions.add("acknowledge");
  }
  return actions;
}
