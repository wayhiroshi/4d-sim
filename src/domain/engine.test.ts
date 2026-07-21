import { describe, expect, it } from "vitest";
import {
  computeBonus,
  computeLineBonus,
  evaluateTitle,
  generateMissions,
  groupPv,
  periodForDate,
  simulatePlacements
} from "./engine";
import type { CourseCode, Member, OrganizationSnapshot, PurchaseEvent, TaxProfile } from "../shared/types";

const period = "2026-07";
const tax: TaxProfile = { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 };

function member(id: string, parentMemberId: string | null, course: CourseCode = "A", introducerMemberId = "root"): Member {
  return {
    id, workspaceId: "test", displayName: id, parentMemberId,
    introducerMemberId: id === "root" ? null : introducerMemberId,
    masterMemberId: null, trainerMemberId: null, idKind: "master", course,
    title: "NONE", trainerCredential: "NONE", sponsorLicense: false, directorPromotedPeriod: null,
    joinedPeriod: period, endedPeriod: null
  };
}

function purchase(id: string, memberId: string, pv: number, kind: PurchaseEvent["kind"] = "repeat", targetPeriod = period): PurchaseEvent {
  return {
    id, workspaceId: "test", memberId, period: targetPeriod, productCode: null,
    kind, status: "confirmed", quantity: 1, price: 0, pv
  };
}

function snapshot(members: Member[], purchases: PurchaseEvent[]): OrganizationSnapshot {
  return { workspaceId: "test", period, members, purchases };
}

describe("business month", () => {
  it("labels the 18th through next 17th as one business month", () => {
    expect(periodForDate(new Date("2026-06-18T00:00:00Z"))).toBe("2026-07");
    expect(periodForDate(new Date("2026-07-17T23:59:59Z"))).toBe("2026-07");
    expect(periodForDate(new Date("2026-07-18T00:00:00Z"))).toBe("2026-08");
  });
});

describe("official golden line bonus cases", () => {
  it("calculates 1st G 10,670 pv plus 2nd A 5,330 pv as 1,868 yen", () => {
    const data = snapshot(
      [member("root", null), member("g", "root", "G"), member("a", "g")],
      [purchase("r", "root", 5330), purchase("g", "g", 10670), purchase("a", "a", 5330)]
    );
    expect(computeLineBonus(data, "root")).toBe(1868);
  });

  it("calculates 1st A 5,330 pv as 800 yen", () => {
    const data = snapshot(
      [member("root", null, "G"), member("a", "root")],
      [purchase("r", "root", 10670), purchase("a", "a", 5330)]
    );
    expect(computeLineBonus(data, "root")).toBe(800);
  });
});

describe("pv and title rules", () => {
  it("excludes the member repeat and includes their additional purchase in group pv", () => {
    const data = snapshot(
      [member("root", null), member("child", "root")],
      [purchase("repeat", "root", 5330), purchase("add", "root", 2010, "additional"), purchase("child", "child", 5330)]
    );
    expect(groupPv(data, "root")).toBe(7340);
    expect(computeLineBonus(data, "root")).toBe(1102);
  });

  it("uses initial pv only for the start bonus, not line or group pv", () => {
    const data = snapshot(
      [member("root", null), member("new", "root")],
      [purchase("root", "root", 5330), purchase("initial", "new", 5330, "initial")]
    );
    expect(groupPv(data, "root")).toBe(0);
    expect(computeLineBonus(data, "root")).toBe(0);
    expect(computeBonus(data, "root", tax).start).toBe(3740);
  });

  it("awards LD at the 3 first-line, 2 second-line and one direct-active boundary", () => {
    const members = [
      member("root", null), member("one", "root"), member("two", "root", "A", "other"),
      member("three", "root", "A", "other"), member("four", "one", "A", "other"), member("five", "one", "A", "other")
    ];
    const purchases = members.map((item) => purchase(`p-${item.id}`, item.id, 5330));
    expect(evaluateTitle(snapshot(members, purchases), "root").achievedTitle).toBe("LD");
  });

  it("counts a sub ID as the active direct member for LD", () => {
    const sub = { ...member("sub", "root"), idKind: "sub" as const, masterMemberId: "root" };
    const members = [
      member("root", null), sub, member("two", "root", "A", "other"), member("three", "root", "A", "other"),
      member("four", "sub", "A", "other"), member("five", "sub", "A", "other")
    ];
    expect(evaluateTitle(snapshot(members, members.map((item) => purchase(`p-${item.id}`, item.id, 5330))), "root").achievedTitle).toBe("LD");
  });

  it("compresses an ended member so their child moves up one line", () => {
    const ended = { ...member("ended", "root"), endedPeriod: period };
    const data = snapshot(
      [member("root", null), ended, member("child", "ended")],
      [purchase("root", "root", 5330), purchase("child", "child", 5330)]
    );
    expect(computeLineBonus(data, "root")).toBe(800);
  });

  it("does not award a star title unless the member also meets director requirements", () => {
    const root = { ...member("root", null), sponsorLicense: false };
    const directDirector = { ...member("director", "root"), title: "DR" as const };
    const members = [root, directDirector];
    for (let index = 0; index < 149; index += 1) members.push(member(`m${index}`, "director", "A", "other"));
    const purchases = members.map((item) => purchase(`p-${item.id}`, item.id, 6000));
    expect(evaluateTitle(snapshot(members, purchases), "root").achievedTitle).not.toBe("SD");
  });

  it("supports both director acquisition patterns including seven first-line IDs", () => {
    const pattern1Members = [{ ...member("root", null, "G"), sponsorLicense: true }];
    for (let index = 0; index < 3; index += 1) pattern1Members.push(member(`f${index}`, "root"));
    for (let index = 0; index < 9; index += 1) pattern1Members.push(member(`s${index}`, `f${index % 3}`));
    for (let index = 0; index < 27; index += 1) pattern1Members.push(member(`t${index}`, `s${index % 9}`));
    expect(evaluateTitle(snapshot(pattern1Members, pattern1Members.map((item) => purchase(`p-${item.id}`, item.id, 7000))), "root").achievedTitle).toBe("DR");

    const pattern2Members = [{ ...member("root", null, "G"), sponsorLicense: true }];
    for (let index = 0; index < 7; index += 1) pattern2Members.push(member(`f${index}`, "root"));
    for (let index = 0; index < 5; index += 1) pattern2Members.push(member(`s${index}`, "f0"));
    expect(evaluateTitle(snapshot(pattern2Members, pattern2Members.map((item) => purchase(`p-${item.id}`, item.id, 25000))), "root").achievedTitle).toBe("DR");
  });

  it("applies the promotion-following-month exception only for that month", () => {
    const root = { ...member("root", null, "G"), title: "DR" as const, directorPromotedPeriod: "2026-06" };
    const members = [root, member("f1", "root"), member("f2", "root"), member("f3", "root"), member("s1", "f1"), member("s2", "f1")];
    const july = snapshot(members, members.map((item) => purchase(`jul-${item.id}`, item.id, 10000)));
    expect(evaluateTitle(july, "root").achievedTitle).toBe("DR");
    const august = { ...july, period: "2026-08", purchases: members.map((item) => purchase(`aug-${item.id}`, item.id, 10000, "repeat", "2026-08")) };
    expect(evaluateTitle(august, "root").achievedTitle).not.toBe("DR");
  });

  it.each([
    ["SD", 150, 10, 1],
    ["TD", 800, 15, 2],
    ["TRD", 2000, 20, 3]
  ] as const)("awards %s at its active member and pv boundary", (expected, total, direct, directors) => {
    const root = { ...member("root", null, "G"), title: "DR" as const, sponsorLicense: true, directorPromotedPeriod: "2026-06" };
    const members: Member[] = [root];
    for (let index = 0; index < total; index += 1) {
      const parent = index < 7 ? "root" : "m0";
      const introducedBy = index < direct ? "root" : "other";
      members.push({ ...member(`m${index}`, parent, "A", introducedBy), title: index < directors ? "DR" : "NONE" });
    }
    const data = snapshot(members, members.map((item) => purchase(`p-${item.id}`, item.id, item.id === "root" ? 10670 : 5330)));
    expect(evaluateTitle(data, "root").achievedTitle).toBe(expected);
  });
});

describe("estimated payment", () => {
  it("matches the 2026 transition deduction and carries payments under 3,000 yen", () => {
    const data = snapshot(
      [member("root", null, "G"), member("a", "root")],
      [purchase("r", "root", 10670), purchase("a", "a", 5330)]
    );
    const result = computeBonus(data, "root", { ...tax, invoiceRegistered: false });
    expect(result.gross).toBe(800);
    expect(result.deductions.invoiceTransition).toBe(15);
    expect(result.estimatedNet).toBe(0);
    expect(result.carryover).toBe(785);
  });

  it("separates director line increases, direct fifth-line 4%, and group 7% from title bonus", () => {
    const root = { ...member("root", null, "G"), title: "DR" as const, directorPromotedPeriod: "2026-06" };
    const members = [root, member("direct", "root")];
    for (let depth = 1; depth <= 5; depth += 1) members.push(member(`x${depth}`, depth === 1 ? "direct" : `x${depth - 1}`));
    const result = computeBonus(snapshot(members, members.map((item) => purchase(`p-${item.id}`, item.id, 5330))), "root", tax);
    expect(result.line).toBe(2933);
    expect(result.director).toBe(2718);
    expect(result.title).toBe(0);
  });

  it("applies first same-rank compensation from the configured rate", () => {
    const root = { ...member("root", null, "G"), title: "DR" as const, directorPromotedPeriod: "2026-06" };
    const sameRank = { ...member("same", "root"), title: "DR" as const };
    const result = computeBonus(
      snapshot([root, sameRank], [purchase("root", "root", 10670), purchase("same", "same", 5330)]),
      "root",
      tax
    );
    expect(result.director).toBe(160);
    expect(result.title).toBe(0);
  });
});

describe("placement simulation", () => {
  it("is deterministic, rejects a full line and never mutates the source", () => {
    const members = [member("root", null, "G")];
    for (let index = 0; index < 7; index += 1) members.push(member(`m${index}`, "root"));
    const data = snapshot(members, members.map((item) => purchase(`p-${item.id}`, item.id, item.course === "G" ? 10670 : 5330)));
    const original = structuredClone(data);
    const request = { candidateName: "候補", course: "A" as const, period, targetTitle: "LD" as const, placementCandidateIds: ["root"], taxProfile: tax };
    const first = simulatePlacements(data, request);
    expect(first).toEqual(simulatePlacements(data, request));
    expect(first[0]).toMatchObject({ eligible: false, rank: null });
    expect(data).toEqual(original);
  });
});

describe("simulation checks", () => {
  it("builds checks only from unmet title conditions", () => {
    const title = evaluateTitle(
      snapshot([member("root", null)], [purchase("root", "root", 5330)]),
      "root"
    );
    const missions = generateMissions(title);
    expect(missions.length).toBeGreaterThan(0);
    expect(missions.every((mission) => mission.category === "title")).toBe(true);
    expect(missions[0]?.title).toContain("不足条件を試算");
  });
});
