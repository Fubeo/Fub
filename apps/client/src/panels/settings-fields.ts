// Il modulo «Impostazioni»: una riga e i suoi campi (interruttore, numero, testo, scelta, lingua, elenco).
import { api } from "../host/ipc";
import type {
  SettingEntry,
  SettingKind,
  SettingValue,
  SettingScope,
  UiOption,
} from "../host/contract";
import {
  allCommands,
  commandOfKeybindingKey,
  keybindingKey,
  validateKeybinding,
} from "../ui/commands";
import { LANGUAGE_KEY, catalogLanguages, resolvedLanguage, t, type Key } from "../i18n/strings";
import { SERIES_THEME_ID, THEME_KEY, currentThemeId, selectTheme } from "../theme/theme";
import { setTooltip } from "../ui/tooltip";
import { icon } from "../ui/icons";
import {
  controlFor,
  defaultText,
  isModified,
  optionLabel,
  parseSettingNumber,
  searchText,
  show,
  shownChoice,
  type Control,
  type NumberProblem,
} from "./settings-model";
import { row } from "./settings-vault";
import {
  blockedRows,
  installRadioGroup,
  pendingRows,
  refuseRow,
  rowErrorNode,
  rowErrors,
  rowPending,
  sourceLabel,
  tab,
  viewParts,
  writeRow,
} from "./settings";
import { KEYBINDING_REASONS } from "./settings-shortcuts";

/// Una riga di impostazione.
///
/// `nome` sostituisce l'etichetta dichiarata, e c'è per una sola famiglia: le
/// scorciatoie dei comandi **della shell** (§16.3). La loro chiave la dichiara
/// il bundle di core, che il titolo del comando non ce l'ha — la frase la
/// localizza chi l'ha scritto ([0040]), e chi ha scritto «Apri il pannello dei
/// file» è questa shell. Passarlo di qua costa un parametro; portarne una copia
/// di là costerebbe trentaquattro stringhe tradotte due volte.
///
/// A sinistra l'etichetta, la prosa e una riga di metadati: dove vale il
/// valore e, se qualcuno l'ha scelto, qual è il predefinito e come tornarci. A
/// destra il controllo. Una riga modificata porta un segno sul bordo
/// (`data-modified`), che è anche ciò che il filtro «Solo modificate» legge.
///
/// [0040]: ../../../docs/decisions/0192-impostazioni-locale-e-temi.md
export function renderRow(entry: SettingEntry, name?: string, description?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  // Identità stabile della riga: dopo un re-render il focus torna sullo
  // stesso controllo (A03) invece di cadere su BODY.
  el.dataset.settingKey = entry.spec.key;
  const modified = isModified(entry);
  if (modified) el.dataset.modified = "true";
  const label = name ?? entry.spec.label;
  const below = description ?? entry.spec.description;
  el.dataset.search = searchText(entry, label, below);

  const controlId = `setting-${entry.spec.key}`;
  const text = document.createElement("div");
  text.className = "setting-text";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  labelEl.htmlFor = controlId;
  labelEl.id = `${controlId}-label`;
  text.append(labelEl);
  const described: string[] = [];
  if (below) {
    const desc = row("muted setting-description", below);
    desc.id = `${controlId}-desc`;
    described.push(desc.id);
    text.append(desc);
  }
  if (modified) text.append(rowMeta(entry));
  // La frase intera sulla provenienza: la pastiglia la dice in breve a chi
  // guarda, questa la dice per intero a chi ascolta, arrivando sul campo.
  const source = document.createElement("span");
  source.className = "sr-only";
  source.id = `${controlId}-source`;
  source.textContent = sourceLabel(entry);
  described.push(source.id);
  text.append(source);
  const pending = pendingRows.has(entry.spec.key);
  const failure = rowErrors.get(entry.spec.key);
  if (pending) el.setAttribute("aria-busy", "true");

  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(field(entry));
  for (const part of control.children) viewParts.add(part);
  // Chi arriva al campo col lettore di schermo sente anche cosa fa e dove
  // vale, non solo l'etichetta: la prosa sotto la riga era solo per gli occhi.
  for (const focusable of control.querySelectorAll<HTMLElement>("input, select, textarea, [role=radiogroup], [role=group]")) {
    // Un gruppo di caselle si descrive una volta, sul gruppo, e non a ogni
    // casella.
    const group = focusable.parentElement?.closest("[role=group]");
    if (group && control.contains(group)) continue;
    const existing = focusable.getAttribute("aria-describedby");
    focusable.setAttribute("aria-describedby", [...described, ...(existing ? [existing] : [])].join(" "));
  }
  el.append(text, control);
  if (pending) text.append(rowPending());
  else if (failure) text.append(rowErrorNode(failure));

  // Spegnere solo la riga in volo che scrive un cambio (`block`), «azzera»
  // compreso; le altre righe in volo restano usabili (A03).
  if (blockedRows.has(entry.spec.key)) {
    for (const node of el.querySelectorAll("input, select, button")) {
      (node as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
    }
  }
  return el;
}

/// La riga dei metadati, solo per una riga modificata: la pastiglia
/// dell'ambito, il predefinito e «Azzera».
///
/// Su una riga al valore di serie non c'è niente da dire che serva a chi
/// guarda: dove varrà il valore lo dice la pastiglia quando un valore c'è, e a
/// chi ascolta lo dice comunque la frase della provenienza. Tre parole grigie
/// sotto ogni riga erano rumore uguale dappertutto.
///
/// «Azzera» compare **solo dove c'è qualcosa da azzerare**: su una riga al
/// valore predefinito sarebbe un pulsante che non fa niente, cioè un pulsante
/// che insegna a non fidarsi dei pulsanti. E accanto dice a cosa riporta:
/// senza, «azzera» era un salto nel buio.
function rowMeta(entry: SettingEntry): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "setting-meta";
  meta.append(scopeChip(entry.spec.scope));
  // Lingua e fuso vuoti vogliono dire «come il sistema», ed è così che li
  // chiama il loro controllo: il predefinito deve dirlo con la stessa parola.
  const empty = SYSTEM_WHEN_EMPTY.has(entry.spec.key) ? t("settings.as_system") : undefined;
  meta.append(row("setting-default", t("settings.default", { value: ownDefaultText(entry) ?? defaultText(entry, empty) })));
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "link-button setting-reset";
  resetButton.textContent = t("settings.reset");
  setTooltip(resetButton, t("settings.reset.hint"));
  resetButton.addEventListener("click", () => {
    void writeRow(entry.spec.key, null, () => api.resetSetting(entry.spec.key));
  });
  meta.append(resetButton);
  return meta;
}

/// Il predefinito di una lista col campo di chi la possiede, detto da lui:
/// i nomi delle parti e non i loro identificativi. `null` per le altre righe.
function ownDefaultText(entry: SettingEntry): string | null {
  const own = ownListFields.get(entry.spec.key);
  const kind = entry.spec.kind;
  if (own === undefined || kind.kind !== "list") return null;
  return own.describe(kind.default) || t("settings.nothing");
}

/// Dove vale un valore, in una pastiglia: la macchina o il vault. È nascosta a
/// chi ascolta, che la sente per intero dalla frase della provenienza.
function scopeChip(scope: SettingScope): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "setting-scope";
  chip.dataset.scope = scope;
  chip.setAttribute("aria-hidden", "true");
  const figure = document.createElement("span");
  figure.className = "setting-scope-icon";
  figure.innerHTML = icon(scope === "machine" ? "monitor" : "vault");
  const words = document.createElement("span");
  words.textContent = t(scope === "machine" ? "settings.scope.chip.machine" : "settings.scope.chip.vault");
  chip.append(figure, words);
  setTooltip(chip, t(scope === "machine" ? "settings.scope.chip.machine.hint" : "settings.scope.chip.vault.hint"));
  return chip;
}

// Una lista resta una dichiarazione generica del contratto. L'editor compare
// solo per le chiavi per cui la shell possiede un gesto utente esplicito:
// `program_writable` è deliberatamente un'altra capacità.
const editableListKeys = new Set(["files.excluded-folders"]);

/// Il campo di una lista che sceglie fra nomi che conosce chi la possiede, e
/// come quel campo dice un valore: nomi e stringhe sono suoi (0192).
interface OwnListField {
  field(entry: SettingEntry, id: string, write: (value: string[], part: string, checked: boolean) => void): HTMLElement;
  describe(value: readonly string[]): string;
}

/// Le liste che hanno un campo di chi le possiede. Arriva con un `import()`,
/// con le sue stringhe, quando il form ha la riga: chi non la vede non lo
/// scarica.
const OWN_LIST_FIELDS = new Map<string, () => Promise<OwnListField>>([
  [
    "draw.toolbar",
    () => import("../editors/spatial/toolbar-field").then(({ toolbarField, describeToolbar }) => ({ field: toolbarField, describe: describeToolbar })),
  ],
  [
    "canvas.toolbar",
    () => import("../editors/canvas/toolbar-field").then(({ canvasToolbarField, describeCanvasToolbar }) => ({ field: canvasToolbarField, describe: describeCanvasToolbar })),
  ],
  [
    "uri.allowed",
    () => import("../ui/uri-allowed-field").then(({ uriAllowedField, describeUriAllowed }) => ({ field: uriAllowedField, describe: describeUriAllowed })),
  ],
  [
    "map.tile-hosts",
    () => import("../ui/map-tile-hosts-field").then(({ mapTileHostsField, describeMapTileHosts }) => ({ field: mapTileHostsField, describe: describeMapTileHosts })),
  ],
  [
    "sync.exclude",
    () => import("../ui/sync-exclude-field").then(({ syncExcludeField, describeSyncExclude }) => ({ field: syncExcludeField, describe: describeSyncExclude })),
  ],
]);

const ownListFields = new Map<string, OwnListField>();

/// Carica i campi delle liste di `entries` che ne hanno uno e non l'hanno
/// ancora. Uno che non arriva lascia la lista in sola lettura, e si riprova
/// al prossimo ridisegno.
export async function loadOwnListFields(entries: readonly SettingEntry[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const load = OWN_LIST_FIELDS.get(entry.spec.key);
      if (load === undefined || ownListFields.has(entry.spec.key)) return;
      try {
        ownListFields.set(entry.spec.key, await load());
      } catch {
        // Il modulo non è arrivato: la lista resta leggibile.
      }
    }),
  );
}

const structuralFolderKeys = new Set([".fub", ".trash", ".", ".."]);

function normalizedFolder(raw: string): string {
  let folder = raw.trim().replaceAll("\\", "/");
  while (folder.startsWith("/")) folder = folder.slice(1);
  while (folder.endsWith("/")) folder = folder.slice(0, -1);
  return folder.trim().normalize("NFC");
}

function folderKey(folder: string): string {
  return folder.normalize("NFC").toLowerCase();
}

function normalizedList(value: SettingValue): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const folder = normalizedFolder(raw);
    const key = folderKey(folder);
    if (!folder || seen.has(key)) continue;
    seen.add(key);
    result.push(folder);
  }
  return result;
}

function checkedFolder(
  raw: string,
  existing: string[],
): { value: string } | { message: string } {
  const value = normalizedFolder(raw);
  if (!value) return { message: t("settings.list.empty") };
  if (value.includes("/")) return { message: t("settings.list.path") };
  const key = folderKey(value);
  if (structuralFolderKeys.has(key)) {
    return { message: t("settings.list.structural", { folder: value }) };
  }
  if (existing.some((folder) => folderKey(folder) === key)) {
    return { message: t("settings.list.duplicate", { folder: value }) };
  }
  return { value };
}

/// Una lista in sola lettura: le voci come pastiglie, «niente» se è vuota.
function readonlyListField(entry: SettingEntry, id: string): HTMLElement {
  const values = Array.isArray(entry.value) ? entry.value : [];
  if (values.length === 0) {
    const el = row("muted", show(entry.value));
    el.id = id;
    return el;
  }
  const list = document.createElement("ul");
  list.className = "setting-chips";
  list.id = id;
  for (const value of values) {
    const item = document.createElement("li");
    item.className = "setting-chip";
    item.textContent = value;
    list.append(item);
  }
  return list;
}

function listField(entry: SettingEntry, id: string): HTMLElement {
  const values = normalizedList(entry.value);
  const editor = document.createElement("div");
  editor.className = "setting-list";

  if (values.length === 0) editor.append(row("muted", t("settings.list.none")));
  else {
    const list = document.createElement("ul");
    list.className = "setting-chips";
    for (const [index, folder] of values.entries()) {
      const item = document.createElement("li");
      item.className = "setting-chip";
      item.append(document.createTextNode(folder));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "setting-chip-remove";
      remove.innerHTML = icon("close");
      remove.setAttribute("aria-label", t("settings.list.remove.hint", { folder }));
      setTooltip(remove, t("settings.list.remove"));
      remove.addEventListener("click", () => {
        void writeRow(entry.spec.key, folder, () =>
          api.setSetting(
            entry.spec.key,
            values.filter((_, candidate) => candidate !== index),
          ),
        { block: true });
      });
      item.append(remove);
      list.append(item);
    }
    editor.append(list);
  }

  const form = document.createElement("form");
  form.className = "setting-list-add";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.autocomplete = "off";
  input.placeholder = t("settings.list.placeholder");
  const error = row("setting-field-error", "");
  error.id = `${id}-error`;
  error.setAttribute("role", "alert");
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);

  const add = document.createElement("button");
  add.type = "submit";
  add.className = "settings-btn";
  add.textContent = t("settings.list.add");
  form.append(input, add, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const checked = checkedFolder(input.value, values);
    if ("message" in checked) {
      error.textContent = checked.message;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    void writeRow(entry.spec.key, checked.value, async () => {
      await api.setSetting(entry.spec.key, [...values, checked.value]);
    }, { block: true });
  });
  editor.append(form);
  return editor;
}

/// Il campo di una riga, dal **controllo che il modello sceglie** per la sua
/// specie (`controlFor`).
///
/// Un caso per controllo e nessun default: una specie nuova nel contratto
/// arriva come errore di compilazione in `controlFor`, e un controllo nuovo lì
/// arriva come errore qui (`mirror.test.ts` ferma la prima prima ancora), non
/// come una riga che il pannello salta in silenzio.
function field(entry: SettingEntry): HTMLElement {
  const id = `setting-${entry.spec.key}`;
  if (entry.spec.kind.kind === "text" && entry.spec.key === LANGUAGE_KEY) return languageField(entry, id);
  const control: Control = controlFor(entry);
  switch (control.kind) {
    case "switch":
      return switchField(entry, id);
    case "segmented":
      return segmentedField(entry, id, control.options);
    case "select":
      return selectField(entry, id, control.options);
    case "range":
      return rangeField(entry, id, control);
    case "number":
      return numberInput(entry, id, control.min, control.max);
    case "text":
      return textField(entry, id);
    case "list": {
      const own = ownListFields.get(entry.spec.key);
      if (own !== undefined) {
        return own.field(entry, id, (value, part, checked) => {
          void writeRow(entry.spec.key, `${part}: ${show(checked)}`, () => api.setSetting(entry.spec.key, value), { block: true });
        });
      }
      return editableListKeys.has(entry.spec.key)
        ? listField(entry, id)
        : readonlyListField(entry, id);
    }
  }
}

/// Un interruttore: una casella con `role="switch"`, che dice «acceso/spento»
/// invece di «selezionata», e che la pelle disegna come tale. Come ogni
/// interruttore si commuta anche con Invio, non solo con lo Spazio della
/// casella nativa.
export function switchInput(id: string, checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "setting-switch";
  input.setAttribute("role", "switch");
  input.id = id;
  input.checked = checked;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || input.disabled) return;
    event.preventDefault();
    input.click();
  });
  return input;
}

function switchField(entry: SettingEntry, id: string): HTMLElement {
  const input = switchInput(id, entry.value === true);
  input.addEventListener("change", () => {
    void writeRow(entry.spec.key, show(input.checked), () =>
      api.setSetting(entry.spec.key, input.checked),
    );
  });
  return input;
}

/// Il campo numerico. `step="any"` perché lo schema non dichiara un passo, e un
/// `2.5` non deve diventare un campo che il browser segna come invalido: lo
/// scoperto lo ha portato il primo numero vero dello schema — i pesi dei campi
/// della ricerca (§21.6), che sono frazionari per natura. Il valore lo
/// controllano i due estremi, che è ciò che il kernel verifica davvero.
function numberInput(entry: SettingEntry, id: string, min: number | null, max: number | null): HTMLInputElement {
  const input = document.createElement("input");
  // Un testo e non un `input[type=number]`: quello legge a modo suo ciò che si
  // scrive («1,5» diventava 15 in WebKit) e al codice dà un valore vuoto per
  // tutto ciò che non capisce. Il numero lo legge `parseSettingNumber`, e ciò
  // che non è il numero scritto si rifiuta col suo motivo, sotto la riga.
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className = "setting-number";
  input.id = id;
  input.value = String(entry.value);
  const kind = numberKind(entry, min, max);
  input.addEventListener("change", () => {
    const read = parseSettingNumber(input.value, kind, resolvedLanguage());
    if (!("value" in read)) {
      refuseRow(entry.spec.key, numberProblemText(read), input.value);
      return;
    }
    const n = read.value;
    void writeRow(entry.spec.key, input.value, () => api.setSetting(entry.spec.key, n));
  });
  return input;
}

/// La specie numerica di una riga, con gli estremi del suo controllo.
function numberKind(entry: SettingEntry, min: number | null, max: number | null): Extract<SettingKind, { kind: "number" }> {
  const kind = entry.spec.kind;
  return { kind: "number", default: kind.kind === "number" ? kind.default : 0, min, max };
}

/// Perché un numero non si scrive, nelle parole dell'interfaccia.
function numberProblemText(read: NumberProblem): string {
  const bound = (n: number) =>
    new Intl.NumberFormat(resolvedLanguage(), { useGrouping: false, maximumFractionDigits: 20 }).format(n);
  switch (read.problem) {
    case "min":
      return t("settings.not_changed", { reason: t("settings.number.min", { min: bound(read.min) }) });
    case "max":
      return t("settings.not_changed", { reason: t("settings.number.max", { max: bound(read.max) }) });
    default: {
      const reasons: Record<typeof read.problem, Key> = {
        empty: "settings.number.empty",
        syntax: "settings.number.syntax",
        finite: "settings.number.finite",
        precision: "settings.number.precision",
        ambiguous: "settings.number.ambiguous",
      };
      return t("settings.not_changed", { reason: t(reasons[read.problem]) });
    }
  }
}

/// Un numero con un intervallo: il cursore per il gesto, il campo per il
/// valore preciso. Il cursore scrive **al rilascio** (`change`) e non a ogni
/// passo: trascinarlo da 12 a 28 sarebbero sedici scritture e sedici ridisegni.
/// Mentre si trascina, il campo accanto mostra dove si è.
function rangeField(entry: SettingEntry, id: string, control: Extract<Control, { kind: "range" }>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "setting-range";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "setting-slider";
  slider.id = `${id}-range`;
  slider.min = String(control.min);
  slider.max = String(control.max);
  slider.step = String(control.step);
  slider.value = String(entry.value);
  // Un nome suo, da un'etichetta esplicita: quella visibile della riga è del
  // campo numerico, e un `aria-labelledby` verso di lei non regge quando la
  // riga è fuori dalla vista del corpo che scorre.
  const name = document.createElement("label");
  name.className = "sr-only";
  name.htmlFor = slider.id;
  name.textContent = entry.spec.label;
  const number = numberInput(entry, id, control.min, control.max);
  slider.addEventListener("input", () => {
    number.value = slider.value;
  });
  slider.addEventListener("change", () => {
    const n = Number(slider.value);
    if (!Number.isFinite(n)) return;
    void writeRow(entry.spec.key, slider.value, () => api.setSetting(entry.spec.key, n));
  });
  const kind = numberKind(entry, control.min, control.max);
  number.addEventListener("input", () => {
    const read = parseSettingNumber(number.value, kind, resolvedLanguage());
    if ("value" in read) slider.value = String(read.value);
  });
  wrap.append(name, slider, number);
  return wrap;
}

function textField(entry: SettingEntry, id: string): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.value = String(entry.value);
  const zones = entry.spec.key === TIMEZONE_KEY ? timezoneSuggestions(input) : null;
  input.addEventListener("change", () => {
    // Una scorciatoia si riconosce dalla forma della chiave (`keys.…`), come
    // fa il kernel, e non soltanto dall'elenco dei comandi di adesso: quelle
    // che l'elenco non porta finivano fra le righe sciolte, e lì «xx» si
    // salvava (IMP-026).
    const shortcut = commandOfKeybindingKey(entry.spec.key) !== null ||
      allCommands().some((command) => keybindingKey(command.id) === entry.spec.key);
    const validation = shortcut ? validateKeybinding(input.value) : null;
    if (validation && !validation.valid) {
      input.setAttribute("aria-invalid", "true");
      // Nella scheda delle scorciatoie lo dice già la diagnosi sotto il campo,
      // mentre si scrive; altrove lo dice la riga, come ogni rifiuto.
      if (tab !== "shortcuts") {
        refuseRow(
          entry.spec.key,
          t("settings.not_changed", { reason: t(KEYBINDING_REASONS[validation.reason]) }),
          input.value,
        );
      }
      return;
    }
    input.removeAttribute("aria-invalid");
    void writeRow(entry.spec.key, input.value, () => api.setSetting(entry.spec.key, input.value));
  });
  if (!zones) return input;
  const wrap = document.createElement("span");
  wrap.append(input, zones);
  return wrap;
}

function selectField(entry: SettingEntry, id: string, options: UiOption[]): HTMLElement {
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = id;
  // Il valore corrente potrebbe **non essere fra le opzioni**: un
  // `settings.json` scritto a mano, o uno schema che ha cambiato le proprie
  // scelte fra due versioni del plugin. Senza questa riga nessuna `option`
  // risulterebbe scelta e il browser mostrerebbe la prima — cioè un valore
  // falso, che è peggio di un valore strano. Una scelta nascosta (un valore di
  // prima con l'etichetta di un'altra, `visibleChoices`) mostra quella.
  const current = shownChoice(entry);
  if (!options.some((o) => o.value === current)) {
    const outside = document.createElement("option");
    outside.value = current;
    outside.textContent = t("settings.off_choices", { value: current });
    outside.selected = true;
    select.append(outside);
  }
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = optionLabel(option);
    el.selected = option.value === current;
    select.append(el);
  }
  // Di nuovo a tendina piena: `selected` messo su un'opzione non ancora
  // inserita non tutti i DOM lo tengono (happy-dom ne sceglie un'altra), e chi
  // legge `value` — una veste della shell — leggerebbe una scelta falsa.
  select.value = current;
  select.addEventListener("change", () => {
    void writeRow(entry.spec.key, select.value, () => writeChoice(entry.spec.key, select.value));
  });
  return select;
}

/// Scrive una scelta. Il tema ha un gesto suo — sceglie una luce **della
/// serie**, e con essa il tema di serie — qualunque controllo lo mostri: un
/// valore fuori dalle scelte lo fa cadere in una tendina, e la tendina non deve
/// diventare una strada che salta `selectTheme`.
function writeChoice(key: string, value: string): Promise<void> {
  return key === THEME_KEY
    ? selectTheme(SERIES_THEME_ID, value as "" | "light" | "dark")
    : api.setSetting(key, value);
}

/// La lingua come scelta fra quelle in cui la shell sa parlare, invece di un
/// campo in cui indovinare un tag BCP 47. La chiave resta testo (il kernel
/// accetta `it-CH`): un valore scritto altrove resta visibile come scelta a sé.
function languageField(entry: SettingEntry, id: string): HTMLElement {
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = id;
  const current = typeof entry.value === "string" ? entry.value : "";
  const options: [string, string][] = [["", t("settings.as_system")]];
  for (const code of catalogLanguages()) options.push([code, endonym(code)]);
  if (!options.some(([value]) => value === current)) {
    options.push([current, t("settings.off_choices", { value: current })]);
  }
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = current;
  select.addEventListener("change", () => {
    void writeRow(entry.spec.key, select.selectedOptions[0]?.textContent ?? select.value, () =>
      api.setSetting(entry.spec.key, select.value),
    );
  });
  return select;
}

/// Il nome di una lingua nella lingua stessa («italiano», «English»): chi ha
/// sbagliato lingua deve riconoscere la propria senza leggere quella sbagliata.
function endonym(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

const TIMEZONE_KEY = "locale.timezone";

/// Le chiavi di testo il cui valore vuoto vuol dire «come il sistema».
const SYSTEM_WHEN_EMPTY = new Set([LANGUAGE_KEY, TIMEZONE_KEY]);

/// I fusi IANA che il motore conosce, come suggerimenti del campo: resta un
/// campo di testo (vuoto è «come il sistema»), ma non va più scritto a memoria.
function timezoneSuggestions(input: HTMLInputElement): HTMLDataListElement | null {
  const zones = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  input.placeholder = t("settings.as_system");
  if (zones.length === 0) return null;
  const list = document.createElement("datalist");
  list.id = `${input.id}-zones`;
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone;
    list.append(option);
  }
  input.setAttribute("list", list.id);
  return list;
}

/// Una scelta breve come segmentato: le opzioni affiancate, la corrente
/// riconoscibile senza aprire niente. Lo decide la forma della scelta
/// (`controlFor`), non la chiave: densità, modalità dell'editor e rientro sono
/// lo stesso dato del tema e si vedono allo stesso modo.
///
/// Le etichette sono quelle che lo schema della Choice porta già dal kernel:
/// l'`option.label` è localizzata là (0040), e ricopiarla qui vorrebbe dire
/// mantenere due traduzioni della stessa frase. Il tema resta l'unico caso con
/// un gesto suo: sceglie la luce della serie, e con un tema installato attivo
/// nessuna delle tre luci è quella corrente.
function segmentedField(entry: SettingEntry, id: string, options: UiOption[]): HTMLElement {
  const current = shownChoice(entry);
  const customThemeActive = entry.spec.key === THEME_KEY && currentThemeId() !== SERIES_THEME_ID;
  const group = document.createElement("div");
  group.className = "segmented segmented--wide setting-segmented";
  group.id = id;
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", `${id}-label`);
  for (const op of options) {
    const value = op.value;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "segmented-option";
    btn.setAttribute("role", "radio");
    btn.textContent = optionLabel(op);
    const selected = !customThemeActive && value === current;
    // `aria-checked` e basta: era accompagnato da una classe modificatrice, e
    // la pelle finiva per elencare quattro selettori diversi per lo stesso
    // acceso, perché nessuno sapeva quale dei quattro il markup usasse.
    btn.setAttribute("aria-checked", String(selected));
    // La scrittura è la stessa della `<select>`: `api.setSetting` con il
    // valore dell'opzione, e `writeRow` che ridisegna con l'esito vicino alla
    // riga. Il reset «azzera» continua a funzionare perché è fuori dal campo.
    btn.dataset.choice = value;
    group.append(btn);
  }
  installRadioGroup(group, (button) => {
    const selectedValue = button.dataset.choice ?? "";
    void writeRow(entry.spec.key, button.textContent || selectedValue, () => writeChoice(entry.spec.key, selectedValue));
  });
  return group;
}
