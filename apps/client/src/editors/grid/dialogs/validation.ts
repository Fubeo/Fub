// Convalida dati: Impostazioni, Messaggio di input e Messaggio di errore.
//
// Parte dalla regola della cella attiva, che il provider mette in `rule`
// quando chiede la finestra: OK senza cambiare niente la riscrive com'era.
// I campi del criterio dipendono da «Consenti» e da «Dati», come in Excel.
import type { DialogBuilder } from "./host";
import { formDialog } from "./form";
import type { FieldSpec, Values } from "./fields";
import { t, type DialogKey } from "./strings";

const ALLOW: readonly (readonly [string, DialogKey])[] = [
  ["any", "grid.dialog.validation.any"],
  ["whole", "grid.dialog.validation.whole"],
  ["decimal", "grid.dialog.validation.decimal"],
  ["list", "grid.dialog.validation.list"],
  ["date", "grid.dialog.validation.date"],
  ["time", "grid.dialog.validation.time"],
  ["textLength", "grid.dialog.validation.text_length"],
  ["custom", "grid.dialog.validation.custom"],
];

const OPERATORS: readonly (readonly [string, DialogKey])[] = [
  ["between", "grid.dialog.op.between"],
  ["notBetween", "grid.dialog.op.not_between"],
  ["equal", "grid.dialog.op.equal"],
  ["notEqual", "grid.dialog.op.not_equal"],
  ["greater", "grid.dialog.op.greater"],
  ["less", "grid.dialog.op.less"],
  ["greaterOrEqual", "grid.dialog.op.greater_equal"],
  ["lessOrEqual", "grid.dialog.op.less_equal"],
];

const STYLES: readonly (readonly [string, DialogKey])[] = [
  ["stop", "grid.dialog.validation.stop"],
  ["warning", "grid.dialog.validation.warning"],
  ["information", "grid.dialog.validation.information"],
];

const twoBounds = (operator: unknown): boolean => operator === "between" || operator === "notBetween";

/// Le etichette dei due limiti: Minimo e Massimo, Data inizio e Data fine…
/// Con un solo limite, quello che l'operatore dice.
export function boundLabels(kind: string, operator: string): readonly [string, string] {
  const [low, high, one]: readonly [DialogKey, DialogKey, string] =
    kind === "date"
      ? ["grid.dialog.validation.start_date", "grid.dialog.validation.end_date", `${t("grid.dialog.validation.date")}:`]
      : kind === "time"
        ? ["grid.dialog.validation.start_time", "grid.dialog.validation.end_time", `${t("grid.dialog.validation.time")}:`]
        : kind === "textLength"
          ? ["grid.dialog.validation.minimum", "grid.dialog.validation.maximum", t("grid.dialog.validation.length")]
          : ["grid.dialog.validation.minimum", "grid.dialog.validation.maximum", t("grid.dialog.validation.value")];
  if (twoBounds(operator) || operator === "greater" || operator === "greaterOrEqual") return [t(low), t(high)];
  if (operator === "less" || operator === "lessOrEqual") return [t(high), t(high)];
  return [one, one];
}

function settings(values: Values): readonly FieldSpec[] {
  const kind = String(values.type);
  const fields: FieldSpec[] = [
    {
      kind: "select",
      key: "type",
      label: t("grid.dialog.validation.allow"),
      options: ALLOW.map(([value, label]) => ({ value, label: t(label) })),
    },
  ];
  if (kind === "list") {
    fields.push(
      { kind: "text", key: "formula1", label: t("grid.dialog.validation.source") },
      { kind: "check", key: "ignoreBlank", label: t("grid.dialog.validation.ignore_blank") },
      { kind: "check", key: "dropdown", label: t("grid.dialog.validation.dropdown") },
    );
  } else if (kind === "custom") {
    fields.push(
      { kind: "text", key: "formula1", label: t("grid.dialog.validation.formula") },
      { kind: "check", key: "ignoreBlank", label: t("grid.dialog.validation.ignore_blank") },
    );
  } else if (kind !== "any") {
    const operator = String(values.operator);
    const [first, second] = boundLabels(kind, operator);
    fields.push(
      { kind: "select", key: "operator", label: t("grid.dialog.validation.data"), options: OPERATORS.map(([value, label]) => ({ value, label: t(label) })) },
      { kind: "text", key: "formula1", label: first },
      ...(twoBounds(operator) ? [{ kind: "text" as const, key: "formula2", label: second }] : []),
      { kind: "check", key: "ignoreBlank", label: t("grid.dialog.validation.ignore_blank") },
    );
  }
  return fields;
}

const string = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const dataValidation: DialogBuilder = (context) => {
  const rule = context.params.rule && typeof context.params.rule === "object" ? (context.params.rule as Record<string, unknown>) : null;
  const values: Values = {
    type: string(rule?.type, rule ? "any" : "list"),
    operator: string(rule?.operator, "between"),
    formula1: string(rule?.formula1),
    formula2: string(rule?.formula2),
    ignoreBlank: rule ? rule.ignoreBlank !== false : true,
    dropdown: rule ? rule.dropdown !== false : true,
    inputTitle: string(rule?.inputTitle),
    inputMessage: string(rule?.inputMessage),
    errorStyle: string(rule?.errorStyle, "stop"),
    errorTitle: string(rule?.errorTitle),
    errorMessage: string(rule?.errorMessage),
  };
  return formDialog(context, {
    title: t("grid.dialog.validation.title"),
    values,
    command: "data.validation",
    className: "grid-dialog-wide",
    page: typeof context.params.tab === "string" ? context.params.tab : undefined,
    pages: [
      { id: "settings", label: t("grid.dialog.validation.tab.settings"), fields: settings },
      {
        id: "input",
        label: t("grid.dialog.validation.tab.input"),
        fields: () => [
          { kind: "text", key: "inputTitle", label: t("grid.dialog.validation.input_title") },
          { kind: "area", key: "inputMessage", label: t("grid.dialog.validation.input_message"), rows: 4 },
        ],
      },
      {
        id: "error",
        label: t("grid.dialog.validation.tab.error"),
        fields: () => [
          {
            kind: "select",
            key: "errorStyle",
            label: t("grid.dialog.validation.error_style"),
            options: STYLES.map(([value, label]) => ({ value, label: t(label) })),
          },
          { kind: "text", key: "errorTitle", label: t("grid.dialog.validation.error_title") },
          { kind: "area", key: "errorMessage", label: t("grid.dialog.validation.error_message"), rows: 4 },
        ],
      },
    ],
    change: (key) => key === "type" || key === "operator",
    params: (current) => {
      const kind = String(current.type);
      const params: Record<string, unknown> = {
        type: kind,
        ignoreBlank: current.ignoreBlank === true,
        inputTitle: current.inputTitle,
        inputMessage: current.inputMessage,
        errorStyle: current.errorStyle,
        errorTitle: current.errorTitle,
        errorMessage: current.errorMessage,
      };
      if (kind === "any") return params;
      const first = String(current.formula1 ?? "").trim();
      const [firstLabel, secondLabel] = boundLabels(kind, String(current.operator));
      const label = kind === "list" ? t("grid.dialog.validation.source") : kind === "custom" ? t("grid.dialog.validation.formula") : firstLabel;
      if (!first) return t("grid.dialog.error.required", { label: label.replace(/:$/, "") });
      params.formula1 = first;
      if (kind === "list") params.dropdown = current.dropdown === true;
      if (kind !== "list" && kind !== "custom") {
        params.operator = current.operator;
        if (twoBounds(current.operator)) {
          const second = String(current.formula2 ?? "").trim();
          if (!second) return t("grid.dialog.error.required", { label: secondLabel.replace(/:$/, "") });
          params.formula2 = second;
        }
      }
      return params;
    },
    extra: [
      {
        id: "clear",
        label: t("grid.dialog.validation.clear"),
        run: () => context.give("data.validation", { clear: true }),
      },
    ],
  });
};

export const VALIDATION_DIALOGS: Readonly<Record<string, DialogBuilder>> = { dataValidation };
