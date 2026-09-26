import { describe, expect, it } from "vitest";
import { ldFixture } from "../test/ld-fixture";
import { organizationTitles } from "./organization-titles";
import { evaluateTitle } from "./engine";

describe("organization display titles", () => {
  it("displays LD from current purchases and placement without changing the saved NONE", () => {
    const snapshot = ldFixture(), original = JSON.stringify(snapshot);
    expect(evaluateTitle(snapshot, "root").achievedTitle).toBe("LD");
    expect(organizationTitles(snapshot).get("root")!.evaluation.achievedTitle).toBe("LD");
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it("reverts when a trial is removed, moved or is not active", () => {
    for (const kind of ["remove", "move", "inactive"] as const) {
      const snapshot = ldFixture();
      if (kind === "remove") snapshot.members = snapshot.members.filter(m => m.id !== "e");
      if (kind === "move") snapshot.members.find(m => m.id === "e")!.parentMemberId = "d";
      if (kind === "inactive") snapshot.purchases = snapshot.purchases.filter(p => p.memberId !== "e");
      expect(organizationTitles(snapshot).get("root")!.evaluation.achievedTitle).toBe("NONE");
    }
  });
});
