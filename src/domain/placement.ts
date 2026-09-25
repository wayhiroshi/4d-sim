import type { Member } from "../shared/types";

type PlacementMember = Pick<Member, "id" | "parentMemberId" | "endedPeriod">;

export function effectiveFirstLineMemberIds(members: PlacementMember[], parentMemberId: string): Set<string> {
  const firstLine = new Set<string>();
  const pending = members.filter((member) => member.parentMemberId === parentMemberId);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const member = pending.shift();
    if (!member || visited.has(member.id)) continue;
    visited.add(member.id);
    if (member.endedPeriod !== null) {
      pending.push(...members.filter((item) => item.parentMemberId === member.id));
    } else {
      firstLine.add(member.id);
    }
  }
  return firstLine;
}

export function descendantMemberIds(members: PlacementMember[], memberId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [memberId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const member of members) {
      if (member.parentMemberId !== parentId || descendants.has(member.id)) continue;
      descendants.add(member.id);
      pending.push(member.id);
    }
  }
  return descendants;
}

export function placementValidationError(
  members: PlacementMember[],
  memberId: string,
  parentMemberId: string,
  firstLineLimit: number
): string | null {
  const member = members.find((item) => item.id === memberId);
  const parent = members.find((item) => item.id === parentMemberId && item.endedPeriod === null);
  if (!member) return "メンバーが見つかりません";
  if (!parent) return "変更先のアップが存在しません";
  if (memberId === parentMemberId || descendantMemberIds(members, memberId).has(parentMemberId)) {
    return "自分または自分の配下はアップに指定できません";
  }
  const effectiveChildren = effectiveFirstLineMemberIds(members, parentMemberId);
  effectiveChildren.delete(memberId);
  const currentChildren = effectiveChildren.size;
  if (currentChildren >= firstLineLimit) return `変更先の1次ラインが上限${firstLineLimit}名です`;
  return null;
}
