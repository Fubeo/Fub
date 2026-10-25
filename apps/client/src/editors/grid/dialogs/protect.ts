// Le finestre della protezione: Proteggi foglio, Proteggi cartella e le loro
// rimozioni.
//
// Excel chiede la password due volte, la seconda in una finestra sua; qui le
// due righe stanno insieme, e l'OK rifiuta se non coincidono. Togliere una
// protezione senza password non chiede niente: la finestra prova senza, e si
// apre soltanto se il provider ne vuole una.
import type { DialogBuilder, DialogContext } from "./host";
import { formDialog } from "./form";
import type { FieldSpec, Values } from "./fields";
import { t, type DialogKey } from "./strings";

const ALLOW: readonly (readonly [string, DialogKey, boolean])[] = [
  ["selectLockedCells", "grid.dialog.protect_sheet.select_locked", true],
  ["selectUnlockedCells", "grid.dialog.protect_sheet.select_unlocked", true],
  ["formatCells", "grid.dialog.protect_sheet.format_cells", false],
  ["formatColumns", "grid.dialog.protect_sheet.format_columns", false],
  ["formatRows", "grid.dialog.protect_sheet.format_rows", false],
  ["insertColumns", "grid.dialog.protect_sheet.insert_columns", false],
  ["insertRows", "grid.dialog.protect_sheet.insert_rows", false],
  ["deleteColumns", "grid.dialog.protect_sheet.delete_columns", false],
  ["deleteRows", "grid.dialog.protect_sheet.delete_rows", false],
  ["sort", "grid.dialog.protect_sheet.sort", false],
  ["autofilter", "grid.dialog.protect_sheet.autofilter", false],
];

/// La password e la sua conferma: la ragione se non coincidono.
function password(values: Values): string | null {
  const first = String(values.password ?? "");
  return first === String(values.again ?? "") ? null : t("grid.dialog.error.password");
}

function passwordFields(label: string): readonly FieldSpec[] {
  return [
    { kind: "password", key: "password", label },
    { kind: "password", key: "again", label: t("grid.dialog.protect.confirm") },
  ];
}

const protectSheet: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.protect_sheet.title"),
    values: Object.fromEntries(ALLOW.map(([key, , on]) => [key, on])),
    command: "review.protectSheet",
    fields: () => [
      ...passwordFields(t("grid.dialog.protect_sheet.password")),
      {
        kind: "section",
        label: t("grid.dialog.protect_sheet.allow"),
        fields: ALLOW.map(([key, label]) => ({ kind: "check", key, label: t(label) })),
      },
    ],
    params: (values) => {
      const wrong = password(values);
      if (wrong) return wrong;
      const params: Record<string, unknown> = Object.fromEntries(ALLOW.map(([key]) => [key, values[key] === true]));
      if (values.password) params.password = values.password;
      return params;
    },
  });

const protectWorkbook: DialogBuilder = (context) =>
  formDialog(context, {
    title: t("grid.dialog.protect_workbook.title"),
    values: {},
    command: "review.protectWorkbook",
    fields: () => [
      { kind: "note", text: t("grid.dialog.protect_workbook.note") },
      ...passwordFields(t("grid.dialog.protect_workbook.password")),
    ],
    params: (values) => password(values) ?? (values.password ? { on: true, password: values.password } : { on: true }),
  });

/// Prova a togliere la protezione senza password; se il provider ne vuole
/// una, la chiede.
async function unprotect(
  context: DialogContext,
  command: string,
  title: string,
  base: Readonly<Record<string, unknown>>,
): Promise<ReturnType<typeof formDialog> | null> {
  const first = await context.engine.run(command, JSON.stringify(base));
  if (first.ok) {
    context.engine.focus();
    return null;
  }
  return formDialog(context, {
    title,
    values: { password: "" },
    command,
    fields: () => [{ kind: "password", key: "password", label: t("grid.dialog.protect.password") }],
    params: (values) => ({ ...base, password: values.password }),
  });
}

const unprotectSheet: DialogBuilder = (context) =>
  unprotect(context, "review.unprotectSheet", t("grid.dialog.unprotect_sheet.title"), {});

const unprotectWorkbook: DialogBuilder = (context) =>
  unprotect(context, "review.protectWorkbook", t("grid.dialog.unprotect_workbook.title"), { on: false });

export const PROTECT_DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  protectSheet,
  unprotectSheet,
  protectWorkbook,
  unprotectWorkbook,
};
