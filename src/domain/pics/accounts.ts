import type { Role } from "@/domain/access/roles";
import type { PicTeam } from "./teams";

/**
 * The teams whose PICs may have their own account (D-097). SOA is tried first (Adityo and Ibnu); Purchasing keeps its shared login
 * until the trial is judged. Adding "PURCHASING" here is all it takes to open it to that team too.
 */
export const PIC_ACCOUNT_TEAMS: readonly PicTeam[] = ["SOA"];

/** Whether a PIC of this team can be given an account of this role: the team must be in the trial, and the account must work for it. */
export function canLinkPicAccount(team: PicTeam, role: Role): boolean {
  return PIC_ACCOUNT_TEAMS.includes(team) && role === team;
}
