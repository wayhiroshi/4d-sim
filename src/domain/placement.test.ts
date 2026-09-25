import { describe, expect, it } from "vitest";
import { descendantMemberIds, effectiveFirstLineMemberIds, placementValidationError } from "./placement";

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

  it("削除済みサブIDの配下を1段上げて有効な1次ラインとして数える", () => {
    const compressed = [
      { id: "root", parentMemberId: null, endedPeriod: null },
      { id: "sub", parentMemberId: "root", endedPeriod: "2026-07" },
      { id: "promoted-a", parentMemberId: "sub", endedPeriod: null },
      { id: "promoted-b", parentMemberId: "sub", endedPeriod: null },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `direct-${index}`, parentMemberId: "root", endedPeriod: null }))
    ];

    expect([...effectiveFirstLineMemberIds(compressed, "root")]).toHaveLength(8);
    expect(placementValidationError(compressed, "promoted-a", "root", 7)).toBe("変更先の1次ラインが上限7名です");
  });
});
