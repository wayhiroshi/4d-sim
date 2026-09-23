import { describe, expect, it } from "vitest";
import { descendantMemberIds, placementValidationError } from "./placement";

const members = [
  { id: "root", parentMemberId: null, endedPeriod: null },
  { id: "a", parentMemberId: "root", endedPeriod: null },
  { id: "b", parentMemberId: "a", endedPeriod: null },
  { id: "c", parentMemberId: "root", endedPeriod: null }
];

describe("placement helpers", () => {
  it("配下を深さに関係なく取得する", () => {
    expect([...descendantMemberIds(members, "a")]).toEqual(["b"]);
    expect([...descendantMemberIds(members, "root")]).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("配下への循環配置を拒否する", () => {
    expect(placementValidationError(members, "a", "b", 7)).toBe("自分または自分の配下はアップに指定できません");
  });

  it("同じアップへの保存では自分を1次ライン人数から除外する", () => {
    expect(placementValidationError(members, "a", "root", 2)).toBeNull();
  });
});
