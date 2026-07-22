import type {
  DashboardData,
  ForecastResult,
  ForecastScenario,
  Goal,
  Member,
  OrganizationSnapshot,
  PlacementResult,
  ProductRule,
  PurchaseEvent,
  SavedForecast,
  SimulationMember,
  SimulationOrganization,
  SimulationRequest,
  TaxProfile,
  TitleChecklistData
} from "./shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data ? String(data.error) : "通信に失敗しました";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  dashboard: (period?: string) => request<DashboardData>(`/api/v1/dashboard${period ? `?period=${period}` : ""}`),
  titleChecklists: (period?: string) => request<TitleChecklistData>(`/api/v1/titles/checklist${period ? `?period=${period}` : ""}`),
  tree: (period?: string) => request<OrganizationSnapshot>(`/api/v1/members/tree${period ? `?period=${period}` : ""}`),
  simulationOrganization: (period?: string) => request<SimulationOrganization>(`/api/v1/simulation-organization${period ? `?period=${period}` : ""}`),
  createMember: (member: Omit<Member, "id" | "workspaceId" | "trainerBonusRole">) => request<Member>("/api/v1/members", { method: "POST", body: JSON.stringify(member) }),
  renameMember: (id: string, displayName: string) => request<{ id: string; displayName: string }>(`/api/v1/members/${encodeURIComponent(id)}/display-name`, { method: "PATCH", body: JSON.stringify({ displayName }) }),
  createSimulationMember: (member: Pick<SimulationMember, "displayName" | "parentMemberId" | "course" | "period" | "trainerBonusRole">) => request<SimulationMember>("/api/v1/simulation-members", { method: "POST", body: JSON.stringify(member) }),
  renameSimulationMember: (id: string, displayName: string) => request<{ id: string; displayName: string }>(`/api/v1/simulation-members/${encodeURIComponent(id)}/display-name`, { method: "PATCH", body: JSON.stringify({ displayName }) }),
  clearSimulationMembers: (period: string) => request<{ deleted: number }>(`/api/v1/simulation-members?period=${encodeURIComponent(period)}`, { method: "DELETE" }),
  products: () => request<{ planVersion: string; products: ProductRule[] }>("/api/v1/products"),
  purchases: (period?: string) => request<PurchaseEvent[]>(`/api/v1/purchases${period ? `?period=${period}` : ""}`),
  createPurchase: (purchase: Omit<PurchaseEvent, "id" | "workspaceId">) => request<PurchaseEvent>("/api/v1/purchases", { method: "POST", body: JSON.stringify(purchase) }),
  goal: () => request<Goal>("/api/v1/goals"),
  saveGoal: (goal: Pick<Goal, "targetTitle" | "targetPeriod">) => request<Goal>("/api/v1/goals", { method: "PUT", body: JSON.stringify(goal) }),
  tax: () => request<TaxProfile>("/api/v1/settings/tax"),
  saveTax: (profile: TaxProfile) => request<TaxProfile>("/api/v1/settings/tax", { method: "PUT", body: JSON.stringify(profile) }),
  simulate: (payload: SimulationRequest) => request<{ results: PlacementResult[] }>("/api/v1/simulations", { method: "POST", body: JSON.stringify(payload) }),
  forecast: (payload: { period: string; rootMemberId: string; scenarios: ForecastScenario[] }) => request<{ results: ForecastResult[] }>("/api/v1/forecasts", { method: "POST", body: JSON.stringify(payload) }),
  savedForecasts: () => request<SavedForecast[]>("/api/v1/forecasts/saved"),
  saveForecast: (payload: { name: string; period: string; rootMemberId: string; scenarios: ForecastScenario[] }) => request<SavedForecast>("/api/v1/forecasts/saved", { method: "POST", body: JSON.stringify(payload) }),
  deleteForecast: (id: string) => request<{ deleted: number }>(`/api/v1/forecasts/saved/${encodeURIComponent(id)}`, { method: "DELETE" }),
  previewImport: (kind: "members" | "purchases", csv: string) => request<{ headers: string[]; rows: Array<Record<string, string>>; errors: Array<{ row: number; field: string; message: string }> }>("/api/v1/imports/preview", { method: "POST", body: JSON.stringify({ kind, csv }) }),
  commitImport: (kind: "members" | "purchases", csv: string) => request<{ imported: number }>("/api/v1/imports/commit", { method: "POST", body: JSON.stringify({ kind, csv }) })
};
