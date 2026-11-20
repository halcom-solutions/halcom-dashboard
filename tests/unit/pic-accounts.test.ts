import { describe, expect, it } from "vitest";
import { ROLES } from "@/domain/access/roles";
import { canLinkPicAccount, PIC_ACCOUNT_TEAMS } from "@/domain/pics/accounts";

describe("which PIC may have its own account (D-097, D-100)", () => {
  it("SOA and Purchasing PICs can both have accounts", () => {
    expect(PIC_ACCOUNT_TEAMS).toEqual(["SOA", "PURCHASING"]);
  });

  it("links a PIC only to an account of its own team's role", () => {
    for (const role of ROLES) {
      expect(canLinkPicAccount("SOA", role), role).toBe(role === "SOA");
      expect(canLinkPicAccount("PURCHASING", role), role).toBe(role === "PURCHASING");
    }
  });
});
