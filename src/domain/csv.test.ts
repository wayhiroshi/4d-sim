import { describe, expect, it } from "vitest";
import { previewCsv, validateMemberRelationships } from "./csv";

describe("CSV preview", () => {
  it("reports duplicate IDs, invalid courses and dates by row", () => {
    const members = previewCsv("members", "id,display_name,parent_id,introducer_id,id_kind,course,joined_period\na,A,root,root,master,X,2026-07\na,B,root,root,master,A,2026-07\n");
    expect(members.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: "course" }),
      expect.objectContaining({ row: 3, field: "id" })
    ]));
    const purchases = previewCsv("purchases", "id,member_id,period,kind,status,quantity,price,pv\np,m,2026-13,repeat,confirmed,1,0,5330\n");
    expect(purchases.errors).toContainEqual(expect.objectContaining({ field: "period" }));
  });

  it("detects missing parents, existing IDs and circular organizations before commit", () => {
    const rows = [
      { id: "a", parent_id: "b" },
      { id: "b", parent_id: "a" },
      { id: "existing", parent_id: "missing" }
    ];
    const errors = validateMemberRelationships(rows, [{ id: "existing", parentMemberId: null }]);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "id", message: "既存IDと重複しています" }),
      expect.objectContaining({ field: "parent_id", message: "配置親が存在しません" }),
      expect.objectContaining({ field: "parent_id", message: "配置関係が循環しています" })
    ]));
  });

  it("rejects the eighth first-line member", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, parent_id: "root" }));
    const errors = validateMemberRelationships(rows, [{ id: "root", parentMemberId: null }]);
    expect(errors).toContainEqual(expect.objectContaining({ row: 9, message: "1次ラインは7名までです" }));
  });
});
