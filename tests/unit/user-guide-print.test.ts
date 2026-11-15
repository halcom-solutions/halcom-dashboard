import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "@/domain/access/roles";
import { nodesOfRole } from "@/domain/guide/access";
import { RACI_ROWS } from "@/domain/guide/raci";
import { GUIDE_LANES } from "@/domain/guide/workflow";
import { renderUserGuideHtml, USER_GUIDE_EDITIONS, type UserGuideEdition } from "@/features/guide/print-html";

const edition = (key: string): UserGuideEdition => USER_GUIDE_EDITIONS.find((e) => e.key === key)!;
const render = (key: string, logo: string | null = null) => renderUserGuideHtml({ edition: edition(key), printedOn: "15 Nov 2026", logo });
const parts = (html: string) => [...html.matchAll(/<article class="role" id="([a-z-]+)">/g)].map((match) => match[1]);

describe("the printable User Guide", () => {
  it("comes in three editions that together cover every role once", () => {
    expect(USER_GUIDE_EDITIONS.map((e) => e.key)).toEqual(["general", "finance", "admin"]);
    expect(USER_GUIDE_EDITIONS.flatMap((e) => e.roles).sort()).toEqual([...GUIDE_LANES].sort());
    expect(new Set(USER_GUIDE_EDITIONS.map((e) => e.file)).size).toBe(3);
  });

  it("keeps Finance and administration out of the general edition", () => {
    expect(parts(render("general"))).toEqual(["raci", "role-sales", "role-soa", "role-purchasing", "role-management", "statuses"]);
    expect(parts(render("finance"))).toEqual(["raci", "role-finance", "statuses"]);
    expect(parts(render("admin"))).toEqual(["raci", "role-admin", "role-superadmin", "statuses"]);
    expect(render("general")).not.toContain(nodesOfRole("ADMIN")[0]!.guide.steps[0]!);
  });

  it("opens every edition with the RACI matrix, before the first role, each part on a new page", () => {
    for (const { key } of USER_GUIDE_EDITIONS) {
      const html = render(key);
      expect(parts(html)[0]).toBe("raci");
      for (const row of RACI_ROWS) expect(html).toContain(row.activity);
      expect(html).toContain(".role { break-before: page; }");
    }
  });

  it("writes every step of the edition's roles", () => {
    for (const e of USER_GUIDE_EDITIONS) {
      const html = render(e.key);
      for (const role of e.roles) {
        expect(html).toContain(`<h2>${ROLE_LABELS[role]}</h2>`);
        for (const node of nodesOfRole(role)) expect(html).toContain(node.title.replaceAll("&", "&amp;"));
      }
      expect(html.match(/<section class="step">/g)?.length).toBe(e.roles.reduce((sum, role) => sum + nodesOfRole(role).length, 0));
    }
  });

  it("prints the title, the date and the logo only when there is one", () => {
    const html = render("finance");
    expect(html).toContain("<h1>User Guide: Finance</h1>");
    expect(html).toContain("Dicetak 15 Nov 2026");
    expect(html).not.toContain("<img");
    expect(render("finance", "data:image/png;base64,AAAA")).toContain('<img src="data:image/png;base64,AAAA"');
  });
});

describe("the RACI matrix", () => {
  it("has exactly one accountable role per activity, and only roles of the guide", () => {
    for (const row of RACI_ROWS) {
      const accountable = Object.values(row.codes).filter((code) => code === "A" || code === "A/R");
      expect(accountable, row.activity).toHaveLength(1);
      for (const role of Object.keys(row.codes)) expect(GUIDE_LANES as readonly string[]).toContain(role);
    }
  });
});
