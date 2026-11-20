import type { Role } from "@/domain/access/roles";
import type { PicTeam } from "./teams";

/**
 * The teams whose PICs may have their own account (D-097). SOA was tried first (Adityo and Ibnu); Purchasing followed (D-100: Gita and
 * Soraya, with "Soraya & Gita" as a shared PIC). Removing a team here sends it back to its shared login without touching any row.
 */
export const PIC_ACCOUNT_TEAMS: readonly PicTeam[] = ["SOA", "PURCHASING"];

/** Whether a PIC of this team can be given an account of this role: the team must be in the trial, and the account must work for it. */
export function canLinkPicAccount(team: PicTeam, role: Role): boolean {
  return PIC_ACCOUNT_TEAMS.includes(team) && role === team;
}

/** The most accounts one shared PIC can have (D-100); a pair is the case today. */
export const MAX_PIC_MEMBERS = 10;
