import { blankMember } from "../shared/strategy";
import type { OrganizationSnapshot } from "../shared/types";

export function ldFixture(): OrganizationSnapshot {
  const members = [blankMember("root", null, "demo", "2026-07"),
    ...["a", "b", "c"].map(id => blankMember(id, "root", "demo", "2026-07")),
    ...["d", "e"].map(id => blankMember(id, "a", "demo", "2026-07"))];
  return { workspaceId: "demo", period: "2026-07", members, purchases: members.map(m => ({ id: `p-${m.id}`, workspaceId: "demo", memberId: m.id, period: "2026-07", productCode: null, kind: "repeat", status: "confirmed", quantity: 1, price: 9950, pv: 5330 })) };
}
