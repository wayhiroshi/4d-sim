import { actionSchema, strategyRequestSchema, type StrategySimulationRequest } from "../shared/strategy";
import { TITLE_ORDER, type OrganizationSnapshot } from "../shared/types";

export interface TitlePrerequisite {
  memberId: string; name: string; kind: "change-course" | "qualification";
  label: string; scheduledMonth: number | null; course?: string; canAdd: boolean;
}

/** Plan-only checks: never treat future qualifications as current facts. */
export function titlePrerequisites(base: OrganizationSnapshot, input: StrategySimulationRequest): TitlePrerequisite[] {
  const targets = new Set(input.growthPriority.filter(p => TITLE_ORDER.indexOf(p.title) >= TITLE_ORDER.indexOf("DR")).map(p => p.memberId));
  if (TITLE_ORDER.indexOf(input.targetTitle) >= TITLE_ORDER.indexOf("DR")) targets.add(input.targetId);
  const result: TitlePrerequisite[] = [];
  for (const memberId of targets) {
    const member = base.members.find(m => m.id === memberId);
    const creation = input.actions.find(a => a.kind === "create-sub" && a.memberId === memberId);
    if (!member && !creation) continue;
    const name = member?.displayName ?? "試算サブ";
    for (const kind of ["change-course", "qualification"] as const) {
      const course = member?.course ?? creation!.course;
      if (kind === "change-course" ? course === "B" || course === "G" : member?.sponsorLicense) continue;
      const actions = input.actions.filter(a => a.memberId === memberId && a.kind === kind && (kind === "change-course" || a.sponsorLicense));
      // Conditional, conflicting or out-of-horizon schedules require a review,
      // not an additional action that silently replaces an explicit plan.
      const courseActions = actions.filter(a => !a.requiredMemberId && Math.max(1, a.month) <= input.horizonMonths);
      const finalCourse = [...courseActions].sort((a,b) => a.month - b.month).at(-1);
      const scheduled = kind === "change-course"
        ? actions.every(a => !a.requiredMemberId) && finalCourse && ["B", "G"].includes(finalCourse.course) ? finalCourse : undefined
        : courseActions.sort((a,b) => a.month - b.month)[0];
      const profile = input.leaders.find(l => l.existingMemberId === memberId);
      const licenseMonth = kind === "qualification" && profile?.licenseAfterMonths != null
        ? Math.max(1, profile.startMonth, profile.licenseAfterMonths) : null;
      const scheduledMonth = scheduled ? Math.max(1, scheduled.month) : licenseMonth !== null && licenseMonth <= input.horizonMonths ? licenseMonth : null;
      result.push({ memberId, name, kind, label: kind === "change-course" ? "B・Gコースへの変更" : "スポンサーライセンス取得",
        scheduledMonth, ...(kind === "change-course" && scheduled ? { course: scheduled.course } : {}),
        canAdd: !actions.length && licenseMonth === null && (!creation || (!creation.requiredMemberId && input.allowSubCreation && creation.month <= input.horizonMonths)) });
    }
  }
  return result;
}

export function scheduleTitlePrerequisites(base: OrganizationSnapshot, input: StrategySimulationRequest, month: number, course: "B" | "G") {
  if (!Number.isInteger(month) || month < 1 || month > input.horizonMonths) throw new Error("変更時期は試算期間内の1か月後以降で指定してください");
  const actions = [...input.actions];
  for (const issue of titlePrerequisites(base, input).filter(i => i.scheduledMonth === null && i.canAdd)) {
    const creation = input.actions.find(a => a.kind === "create-sub" && a.memberId === issue.memberId);
    let serial = actions.length;
    while (actions.some(a => a.id === `title-preparation-${serial}`)) serial++;
    actions.push(actionSchema.parse({ id: `title-preparation-${serial}`, kind: issue.kind, month: Math.max(month, creation?.month ?? 1),
      memberId: issue.memberId, parentId: null, ownerId: null, requiredMemberId: null, course, sponsorLicense: true }));
  }
  return strategyRequestSchema.parse({ ...input, actions });
}
