// Lettura della vertical slice: un payload chiuso nel canale dati esistente.
// Non interpreta formule e non espone il futuro protocollo a finestre.
import type { IndexQuery, IndexResult, PluginError, SheetCellValue, SheetEvaluation } from "./contract";

type QueryIndex = (query: IndexQuery) => Promise<IndexResult>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coordinate(value: unknown): boolean {
  return record(value) && typeof value.sheet === "string" && typeof value.row === "string"
    && typeof value.column === "string";
}

function cellValue(value: unknown): value is SheetCellValue {
  if (!record(value)) return false;
  switch (value.kind) {
    case "blank": return true;
    case "number": return typeof value.value === "number" && Number.isFinite(value.value);
    case "text": return typeof value.value === "string";
    case "boolean": return typeof value.value === "boolean";
    case "error": return typeof value.value === "string"
      && ["parse", "ref", "name", "value", "div_zero", "num", "cycle"].includes(value.value);
    default: return false;
  }
}

function evaluation(value: unknown): value is SheetEvaluation {
  return record(value) && Array.isArray(value.cells) && Array.isArray(value.dependencies)
    && value.cells.every((cell) => record(cell) && coordinate(cell) && cellValue(cell.value))
    && value.dependencies.every((entry) => record(entry) && coordinate(entry.cell)
      && Array.isArray(entry.depends_on) && entry.depends_on.every(coordinate));
}

export async function evaluateSheet(queryIndex: QueryIndex, source: string): Promise<SheetEvaluation> {
  const response = await queryIndex({
    kind: "custom", ns: "fub.sheet", query: { kind: "evaluate", version: 1, source },
  });
  if (response.kind !== "custom" || !evaluation(response.value)) {
    throw { kind: "internal", message: "Invalid sheet evaluation response" } satisfies PluginError;
  }
  return response.value;
}
