import { describe, expect, it } from "vitest";
import { ROLES } from "@/domain/access/roles";
import { canLinkPicAccount, PIC_ACCOUNT_TEAMS } from "@/domain/pics/accounts";

describe("which PIC may have its own account (D-097)", () => {
  it("tries SOA first; Purchasing keeps its shared login for now", () => {
    expect(PIC_ACCOUNT_TEAMS).toEqual(["SOA"]);
    expect(canLinkPicAccount("PURCHASING", "PURCHASING")).toBe(false);
  });

  it("links an SOA PIC only to an SOA account", () => {
    for (const role of ROLES) expect(canLinkPicAccount("SOA", role), role).toBe(role === "SOA");
  });
});
