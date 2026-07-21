import { COURSES, type CourseCode } from "../shared/types";

export type CsvKind = "members" | "purchases";

export interface CsvPreview {
  headers: string[];
  rows: Array<Record<string, string>>;
  errors: Array<{ row: number; field: string; message: string }>;
}

export interface ExistingMemberLink {
  id: string;
  parentMemberId: string | null;
}

export function validateMemberRelationships(
  rows: Array<Record<string, string>>,
  existing: ExistingMemberLink[],
  firstLineLimit = 7
): CsvPreview["errors"] {
  const errors: CsvPreview["errors"] = [];
  const existingIds = new Set(existing.map((member) => member.id));
  const importedIds = new Set(rows.map((row) => row.id ?? ""));
  const allIds = new Set([...existingIds, ...importedIds]);
  const parentById = new Map(existing.map((member) => [member.id, member.parentMemberId]));
  const childrenByParent = new Map<string, number>();
  for (const member of existing) {
    if (member.parentMemberId) childrenByParent.set(member.parentMemberId, (childrenByParent.get(member.parentMemberId) ?? 0) + 1);
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const id = row.id ?? "";
    const parentId = row.parent_id || null;
    if (existingIds.has(id)) errors.push({ row: rowNumber, field: "id", message: "既存IDと重複しています" });
    if (parentId && !allIds.has(parentId)) errors.push({ row: rowNumber, field: "parent_id", message: "配置親が存在しません" });
    if (parentId === id) errors.push({ row: rowNumber, field: "parent_id", message: "自分自身は配置親にできません" });
    if (parentId) {
      const childCount = (childrenByParent.get(parentId) ?? 0) + 1;
      childrenByParent.set(parentId, childCount);
      if (childCount > firstLineLimit) errors.push({ row: rowNumber, field: "parent_id", message: `1次ラインは${firstLineLimit}名までです` });
    }
    parentById.set(id, parentId);
  });

  rows.forEach((row, index) => {
    const startId = row.id ?? "";
    const visited = new Set<string>();
    let cursor: string | null | undefined = startId;
    while (cursor) {
      if (visited.has(cursor)) {
        errors.push({ row: index + 2, field: "parent_id", message: "配置関係が循環しています" });
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor);
    }
  });
  return errors;
}

const required: Record<CsvKind, string[]> = {
  members: ["id", "display_name", "parent_id", "introducer_id", "id_kind", "course", "joined_period"],
  purchases: ["id", "member_id", "period", "kind", "status", "quantity", "price", "pv"]
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value); value = ""; }
    else value += char;
  }
  cells.push(value);
  return cells.map((cell) => cell.trim());
}

export function previewCsv(kind: CsvKind, csv: string): CsvPreview {
  if (new TextEncoder().encode(csv).byteLength > 1_000_000) throw new Error("CSVは1MB以下にしてください");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [], errors: [{ row: 1, field: "file", message: "CSVが空です" }] };
  const headers = splitCsvLine(lines[0] ?? "");
  const errors: CsvPreview["errors"] = [];
  for (const field of required[kind]) if (!headers.includes(field)) errors.push({ row: 1, field, message: "必須列がありません" });
  const rows = lines.slice(1).map((line, lineIndex) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    if (cells.length !== headers.length) errors.push({ row: lineIndex + 2, field: "row", message: "列数が一致しません" });
    return row;
  });
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const id = row.id ?? "";
    if (!id) errors.push({ row: rowNumber, field: "id", message: "IDは必須です" });
    else if (ids.has(id)) errors.push({ row: rowNumber, field: "id", message: "CSV内でIDが重複しています" });
    ids.add(id);
    if (kind === "members" && !COURSES.includes((row.course ?? "") as CourseCode)) {
      errors.push({ row: rowNumber, field: "course", message: "コースはA/B/F/G/Iのいずれかです" });
    }
    if (kind === "members") {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.joined_period ?? "")) errors.push({ row: rowNumber, field: "joined_period", message: "開始営業月はYYYY-MM形式です" });
      if (!(["master", "sub"] as string[]).includes(row.id_kind ?? "")) errors.push({ row: rowNumber, field: "id_kind", message: "ID種別はmaster/subです" });
    }
    if (kind === "purchases") {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period ?? "")) errors.push({ row: rowNumber, field: "period", message: "営業月はYYYY-MM形式です" });
      if (!(["initial", "repeat", "additional"] as string[]).includes(row.kind ?? "")) errors.push({ row: rowNumber, field: "kind", message: "購入種別が不正です" });
      if (!(["planned", "confirmed"] as string[]).includes(row.status ?? "")) errors.push({ row: rowNumber, field: "status", message: "確定状態が不正です" });
      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) errors.push({ row: rowNumber, field: "quantity", message: "数量は1以上の整数です" });
      for (const field of ["price", "pv"] as const) {
        const value = Number(row[field]);
        if (!Number.isInteger(value) || value < 0) errors.push({ row: rowNumber, field, message: "0以上の整数です" });
      }
    }
  });
  return { headers, rows, errors };
}

export const CSV_TEMPLATES: Record<CsvKind, string> = {
  members: "id,display_name,parent_id,introducer_id,id_kind,course,joined_period,director_promoted_period\nmember-1,メンバー1,root,root,master,A,2026-07,\n",
  purchases: "id,member_id,period,kind,status,quantity,price,pv\npurchase-1,member-1,2026-07,repeat,confirmed,1,9950,5330\n"
};
