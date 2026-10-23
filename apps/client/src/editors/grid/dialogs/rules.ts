// La formattazione condizionale: le regole rapide del menu (Maggiore di…,
// Testo che contiene…), Nuova regola di formattazione e Gestione regole.
//
// Il formato di una regola si sceglie fra quelli di Excel per le regole
// rapide («Riempimento rosso chiaro con testo rosso scuro»): il provider li
// conosce per nome (`preset`). La regola vale per la selezione.
import { createList, textButton } from "../../../kit";
import type { DialogBuilder } from "./host";
import { formDialog } from "./form";
import type { Choice, FieldSpec, Values } from "./fields";
import { t, type DialogKey } from "./strings";

const PRESETS: readonly (readonly [string, DialogKey])[] = [
  ["lightRedFillDarkRedText", "grid.dialog.cf.preset.light_red_dark_red"],
  ["yellowFillDarkYellowText", "grid.dialog.cf.preset.yellow_dark_yellow"],
  ["greenFillDarkGreenText", "grid.dialog.cf.preset.green_dark_green"],
  ["lightRedFill", "grid.dialog.cf.preset.light_red"],
  ["redText", "grid.dialog.cf.preset.red_text"],
  ["redBorder", "grid.dialog.cf.preset.red_border"],
];

const PERIODS: readonly (readonly [string, DialogKey])[] = [
  ["yesterday", "grid.dialog.cf.period.yesterday"],
  ["today", "grid.dialog.cf.period.today"],
  ["tomorrow", "grid.dialog.cf.period.tomorrow"],
  ["last7Days", "grid.dialog.cf.period.last7"],
  ["lastWeek", "grid.dialog.cf.period.last_week"],
  ["thisWeek", "grid.dialog.cf.period.this_week"],
  ["nextWeek", "grid.dialog.cf.period.next_week"],
  ["lastMonth", "grid.dialog.cf.period.last_month"],
  ["thisMonth", "grid.dialog.cf.period.this_month"],
  ["nextMonth", "grid.dialog.cf.period.next_month"],
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

const choices = (list: readonly (readonly [string, DialogKey])[]): Choice[] =>
  list.map(([value, label]) => ({ value, label: t(label) }));

const presetField = (): FieldSpec => ({ kind: "select", key: "preset", label: t("grid.dialog.cf.with"), options: choices(PRESETS) });

const twoValues = (operator: unknown): boolean => operator === "between" || operator === "notBetween";

/// Il testo di un campo, senza spazi ai lati.
const field = (values: Values, key: string): string => String(values[key] ?? "").trim();

/// La regola dei valori di una finestra, o la ragione per cui manca un valore.
function ruleOf(type: string, values: Values): Record<string, unknown> | string {
  const rule: Record<string, unknown> = { type, preset: values.preset };
  const need = (key: string, label: DialogKey): string | null => {
    const text = field(values, key);
    if (!text) return t("grid.dialog.error.required", { label: t(label).replace(/:$/, "") });
    rule[key] = text;
    return null;
  };
  switch (type) {
    case "cellIs": {
      rule.operator = values.operator;
      const wrong = need("value", "grid.dialog.rule.value") ?? (twoValues(values.operator) ? need("value2", "grid.dialog.rule.value2") : null);
      return wrong ?? rule;
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith":
      return need("text", "grid.dialog.rule.text_operator") ?? rule;
    case "expression":
      return need("formula", "grid.dialog.cf.prompt.formula") ?? rule;
    case "timePeriod":
      rule.period = values.period;
      return rule;
    case "top10": {
      const rank = values.rank;
      if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 1000) {
        return t("grid.dialog.error.between", { label: t("grid.dialog.cf.rank").replace(/:$/, ""), min: 1, max: 1000 });
      }
      return { ...rule, rank, bottom: values.bottom === true, percent: values.percent === true };
    }
    case "aboveAverage":
      return { ...rule, below: values.below === true };
    default:
      return rule;
  }
}

function ruleParams(type: string, values: Values): Record<string, unknown> | string {
  const rule = ruleOf(type, values);
  return typeof rule === "string" ? rule : { rule };
}

/// Le regole rapide del menu Regole evidenziazione celle e Regole
/// primi/ultimi.
const cfQuick: DialogBuilder = (context) => {
  const asked = typeof context.params.type === "string" ? context.params.type : "cellIs";
  // «Nuova regola…» di GridCraft chiede `cfQuick` di tipo formula.
  if (asked === "expression") {
    context.open("newFormattingRule", context.params);
    return null;
  }
  const operator = typeof context.params.operator === "string" ? context.params.operator : "greater";
  const bottom = context.params.bottom === true;
  const percent = context.params.percent === true;
  const below = context.params.below === true;
  const values: Values = {
    operator,
    value: "",
    value2: "",
    text: "",
    period: "today",
    rank: typeof context.params.rank === "number" ? context.params.rank : 10,
    bottom,
    percent,
    below,
    duplicates: "duplicate",
    preset: PRESETS[0]![0],
  };
  const n = String(values.rank);
  let title: string;
  let fields: () => readonly FieldSpec[];
  let type = asked;
  switch (asked) {
    case "containsText":
      title = t("grid.dialog.cf.text");
      fields = () => [{ kind: "text", key: "text", label: t("grid.dialog.cf.prompt.text") }];
      break;
    case "timePeriod":
      title = t("grid.dialog.cf.date");
      fields = () => [{ kind: "select", key: "period", label: t("grid.dialog.cf.prompt.date"), options: choices(PERIODS) }];
      break;
    case "duplicate":
    case "unique":
      values.duplicates = asked;
      title = t("grid.dialog.cf.duplicates");
      fields = () => [
        {
          kind: "select",
          key: "duplicates",
          label: t("grid.dialog.cf.prompt.duplicates"),
          options: [
            { value: "duplicate", label: t("grid.dialog.cf.duplicate") },
            { value: "unique", label: t("grid.dialog.cf.unique") },
          ],
        },
      ];
      break;
    case "top10":
      title = t(bottom ? (percent ? "grid.dialog.cf.bottom_percent" : "grid.dialog.cf.bottom") : percent ? "grid.dialog.cf.top_percent" : "grid.dialog.cf.top", { n });
      fields = () => [
        { kind: "number", key: "rank", label: t(bottom ? "grid.dialog.cf.prompt.rank_bottom" : "grid.dialog.cf.prompt.rank"), min: 1, max: 1000 },
        ...(percent ? [{ kind: "note" as const, text: t("grid.dialog.cf.percent") }] : []),
      ];
      break;
    case "aboveAverage":
      title = t(below ? "grid.dialog.cf.below" : "grid.dialog.cf.above");
      fields = () => [{ kind: "note", text: t(below ? "grid.dialog.cf.prompt.below" : "grid.dialog.cf.prompt.above") }];
      break;
    default: {
      type = "cellIs";
      const key = (["greater", "less", "between", "equal"] as const).find((each) => each === operator) ?? "greater";
      title = t(`grid.dialog.cf.${key}`);
      fields = () => [
        { kind: "text", key: "value", label: t(`grid.dialog.cf.prompt.${key}`) },
        ...(key === "between" ? [{ kind: "text" as const, key: "value2", label: t("grid.dialog.cf.prompt.and") }] : []),
      ];
    }
  }
  return formDialog(context, {
    title,
    values,
    command: "home.conditionalFormat",
    fields: () => [...fields(), presetField()],
    params: (current) => ruleParams(type === "duplicate" || type === "unique" ? String(current.duplicates) : type, current),
  });
};

/// I tipi di Nuova regola di formattazione, con la regola del provider.
const RULE_TYPES: readonly (readonly [string, DialogKey])[] = [
  ["cellIs", "grid.dialog.rule.cell_is"],
  ["text", "grid.dialog.rule.text"],
  ["timePeriod", "grid.dialog.rule.date"],
  ["blanks", "grid.dialog.rule.blanks"],
  ["noBlanks", "grid.dialog.rule.no_blanks"],
  ["errors", "grid.dialog.rule.errors"],
  ["noErrors", "grid.dialog.rule.no_errors"],
  ["top10", "grid.dialog.rule.top"],
  ["aboveAverage", "grid.dialog.rule.average"],
  ["duplicates", "grid.dialog.rule.duplicates"],
  ["expression", "grid.dialog.rule.expression"],
];

const TEXT_OPERATORS: readonly (readonly [string, DialogKey])[] = [
  ["containsText", "grid.dialog.rule.contains"],
  ["notContainsText", "grid.dialog.rule.not_contains"],
  ["beginsWith", "grid.dialog.rule.begins"],
  ["endsWith", "grid.dialog.rule.ends"],
];

function ruleFields(values: Values): readonly FieldSpec[] {
  switch (values.type) {
    case "cellIs":
      return [
        { kind: "select", key: "operator", label: t("grid.dialog.rule.operator"), options: choices(OPERATORS) },
        { kind: "text", key: "value", label: t("grid.dialog.rule.value") },
        ...(twoValues(values.operator) ? [{ kind: "text" as const, key: "value2", label: t("grid.dialog.rule.value2") }] : []),
      ];
    case "text":
      return [
        { kind: "select", key: "textOperator", label: t("grid.dialog.rule.text_operator"), options: choices(TEXT_OPERATORS) },
        { kind: "text", key: "text", label: t("grid.dialog.rule.value") },
      ];
    case "timePeriod":
      return [{ kind: "select", key: "period", label: t("grid.dialog.cf.prompt.date"), options: choices(PERIODS) }];
    case "top10":
      return [
        {
          kind: "select",
          key: "side",
          label: t("grid.dialog.rule.top_bottom"),
          options: [
            { value: "top", label: t("grid.dialog.rule.top_side") },
            { value: "bottom", label: t("grid.dialog.rule.bottom_side") },
          ],
        },
        { kind: "number", key: "rank", label: t("grid.dialog.cf.rank"), min: 1, max: 1000 },
        { kind: "check", key: "percent", label: t("grid.dialog.cf.percent") },
      ];
    case "aboveAverage":
      return [
        {
          kind: "select",
          key: "side",
          label: t("grid.dialog.rule.average_side"),
          options: [
            { value: "above", label: t("grid.dialog.rule.above") },
            { value: "below", label: t("grid.dialog.rule.below") },
          ],
        },
      ];
    case "duplicates":
      return [
        {
          kind: "select",
          key: "duplicates",
          label: t("grid.dialog.cf.prompt.duplicates"),
          options: [
            { value: "duplicate", label: t("grid.dialog.cf.duplicate") },
            { value: "unique", label: t("grid.dialog.cf.unique") },
          ],
        },
      ];
    case "expression":
      return [{ kind: "text", key: "formula", label: t("grid.dialog.cf.prompt.formula") }];
    default:
      return [];
  }
}

/// Il tipo del provider per i valori di Nuova regola.
function providerType(values: Values): string {
  switch (values.type) {
    case "text":
      return String(values.textOperator);
    case "duplicates":
      return String(values.duplicates);
    default:
      return String(values.type);
  }
}

const newFormattingRule: DialogBuilder = (context) => {
  const asked = typeof context.params.type === "string" ? context.params.type : "cellIs";
  const values: Values = {
    type: RULE_TYPES.some(([value]) => value === asked) ? asked : "cellIs",
    operator: "between",
    value: "",
    value2: "",
    textOperator: "containsText",
    text: "",
    period: "today",
    side: "top",
    rank: 10,
    percent: false,
    duplicates: "duplicate",
    formula: typeof context.params.formula === "string" ? context.params.formula : "",
    preset: PRESETS[0]![0],
  };
  return formDialog(context, {
    title: t("grid.dialog.rule.title"),
    values,
    command: "home.conditionalFormat",
    className: "grid-dialog-wide",
    fields: (current) => [
      { kind: "select", key: "type", label: t("grid.dialog.rule.type"), size: RULE_TYPES.length, options: choices(RULE_TYPES) },
      ...ruleFields(current),
      presetField(),
    ],
    change: (key) => key === "type" || key === "operator",
    params: (current) =>
      ruleParams(providerType(current), {
        ...current,
        bottom: current.side === "bottom",
        below: current.side === "below",
      }),
  });
};

interface ListedRule {
  readonly index: number;
  readonly label: string;
}

const KINDS: Readonly<Record<string, DialogKey>> = {
  CellIs: "grid.dialog.rules.kind.cell_is",
  Expression: "grid.dialog.rules.kind.expression",
  ContainsText: "grid.dialog.rules.kind.text",
  NotContainsText: "grid.dialog.rules.kind.text",
  BeginsWith: "grid.dialog.rules.kind.text",
  EndsWith: "grid.dialog.rules.kind.text",
  Blanks: "grid.dialog.rules.kind.blanks",
  NoBlanks: "grid.dialog.rules.kind.no_blanks",
  Errors: "grid.dialog.rules.kind.errors",
  NoErrors: "grid.dialog.rules.kind.no_errors",
  Duplicate: "grid.dialog.rules.kind.duplicate",
  Unique: "grid.dialog.rules.kind.unique",
  Top10: "grid.dialog.rules.kind.top",
  AboveAverage: "grid.dialog.rules.kind.average",
  TimePeriod: "grid.dialog.rules.kind.date",
  ColorScale: "grid.dialog.rules.kind.scale",
  DataBar: "grid.dialog.rules.kind.bar",
  IconSet: "grid.dialog.rules.kind.icons",
};

/// Che cosa dice una regola, oltre al suo tipo: la formula, il testo, i
/// valori.
function detail(variant: string, body: Record<string, unknown>): string {
  const string = (value: unknown): string => (typeof value === "string" ? value : "");
  switch (variant) {
    case "CellIs":
      return [string(body.a), string(body.b)].filter(Boolean).join(" … ");
    case "Expression":
      return `=${string(body.formula)}`;
    case "ContainsText":
    case "NotContainsText":
    case "BeginsWith":
    case "EndsWith":
      return string(body.text);
    case "Top10":
      return `${typeof body.rank === "number" ? body.rank : ""}${body.percent === true ? "%" : ""}`;
    default:
      return "";
  }
}

/// Le regole del risultato di `home.manageRules`, nell'ordine in cui valgono.
export function listedRules(result: unknown): readonly ListedRule[] {
  const rules = result && typeof result === "object" ? (result as { rules?: unknown }).rules : undefined;
  if (!Array.isArray(rules)) return [];
  return rules.map((entry, index) => {
    const { ranges, rule } = (entry ?? {}) as { ranges?: unknown; rule?: unknown };
    const [variant, body] =
      rule && typeof rule === "object" ? (Object.entries(rule as Record<string, unknown>)[0] ?? ["", {}]) : [typeof rule === "string" ? rule : "", {}];
    const kind = KINDS[variant] ? t(KINDS[variant]) : variant;
    const extra = body && typeof body === "object" ? detail(variant, body as Record<string, unknown>) : "";
    return {
      index,
      label: t("grid.dialog.rules.item", {
        n: index + 1,
        rule: extra ? `${kind}: ${extra}` : kind,
        ranges: Array.isArray(ranges) ? ranges.filter((each) => typeof each === "string").join(", ") : "",
      }),
    };
  });
}

const manageRules: DialogBuilder = async (context) => {
  const load = async (): Promise<readonly ListedRule[]> => listedRules(await context.read("home.manageRules"));
  let rules = await load();
  const body = document.createElement("div");
  body.className = "grid-dialog-form grid-dialog-rules";
  const toolbar = document.createElement("div");
  toolbar.className = "grid-dialog-toolbar";
  const rows = document.createElement("div");
  rows.className = "grid-dialog-results";
  rows.setAttribute("aria-label", t("grid.dialog.rules.list"));
  const empty = document.createElement("p");
  empty.className = "grid-dialog-note";
  empty.textContent = t("grid.dialog.rules.none");
  body.append(toolbar, rows, empty);

  const list = createList<ListedRule>({
    container: rows,
    role: "listbox",
    items: rules,
    key: (item) => String(item.index),
    render: (item, row) => {
      row.textContent = item.label;
    },
    onActivate: () => {},
    onHighlight: () => refresh(),
    lifetime: context.life,
  });

  /// Dà un comando sulla regola attiva e rilegge l'elenco, con il fuoco sulla
  /// regola che si è spostata.
  const act = async (param: "delete" | "moveUp" | "moveDown"): Promise<void> => {
    const item = list.active();
    if (!item || !(await context.give("home.manageRules", { [param]: item.index }))) return;
    rules = await load();
    list.setItems(rules);
    const next = param === "moveUp" ? item.index - 1 : param === "moveDown" ? item.index + 1 : Math.min(item.index, rules.length - 1);
    list.setActive(rules.length ? String(Math.max(0, next)) : null);
    refresh();
    rows.focus();
  };

  const create = textButton({
    label: t("grid.dialog.rules.new"),
    lifetime: context.life,
    onPress: () => context.open("newFormattingRule", {}, true),
  });
  const remove = textButton({ label: t("grid.dialog.rules.delete"), kind: "danger", lifetime: context.life, onPress: () => void act("delete") });
  const up = textButton({ label: t("grid.dialog.rules.up"), lifetime: context.life, onPress: () => void act("moveUp") });
  const down = textButton({ label: t("grid.dialog.rules.down"), lifetime: context.life, onPress: () => void act("moveDown") });
  toolbar.append(create, remove, up, down);

  const refresh = (): void => {
    const active = list.active();
    rows.hidden = rules.length === 0;
    empty.hidden = rules.length > 0;
    remove.disabled = !active;
    up.disabled = !active || active.index === 0;
    down.disabled = !active || active.index === rules.length - 1;
  };
  refresh();

  return {
    title: t("grid.dialog.rules.title"),
    body,
    className: "grid-dialog-wide",
    actions: [{ id: "close", label: t("grid.dialog.close"), kind: "primary" }],
    submit: "close",
  };
};

export const RULE_DIALOGS: Readonly<Record<string, DialogBuilder>> = { cfQuick, newFormattingRule, manageRules };
