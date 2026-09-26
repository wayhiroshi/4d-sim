import { evaluateTitle, evaluateTitleChecklists, indexMonth } from "./engine";
import type { Member, OrganizationSnapshot, TitleEvaluation, TitleChecklistItem } from "../shared/types";

/** Display-only evaluation. Never writes a simulated award to the registered member. */
export function organizationTitles(source: OrganizationSnapshot) {
  const snapshot = indexMonth({ ...source, members: source.members.map(m => ({ ...m })) });
  const children = new Map<string, Member[]>();
  for (const m of snapshot.members) if (m.parentMemberId) children.set(m.parentMemberId, [...(children.get(m.parentMemberId) ?? []), m]);
  const result = new Map<string, { evaluation: TitleEvaluation; checklist: TitleChecklistItem[] }>();
  const seen = new Set<string>();
  const visit = (m: Member) => {
    if (seen.has(m.id)) return; seen.add(m.id);
    for (const child of children.get(m.id) ?? []) visit(child);
    if (m.joinedPeriod > snapshot.period || (m.endedPeriod && m.endedPeriod <= snapshot.period)) { m.title = "NONE"; return; }
    // Keep the saved acquisition history while checking this ID; only its
    // descendants have their current-month titles substituted at this point.
    const evaluation = evaluateTitle(snapshot, m.id);
    const checklist = evaluateTitleChecklists(snapshot, m.id);
    result.set(m.id, { evaluation, checklist }); m.title = evaluation.achievedTitle;
  };
  snapshot.members.filter(m => !m.parentMemberId).forEach(visit);
  return result;
}
