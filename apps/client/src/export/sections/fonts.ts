// La sezione «Caratteri» dello spazio «Esporta in PDF» (E28, T72; il
// prototipo `.px-fonts`, `.px-rng`, `.px-row`, `.px-seg`, `.px-tog`, passo
// 28), e i caratteri del vault che la stampa usa.
//
// In cima il carattere del testo e quello dei titoli, ognuno un pulsante
// scritto nel suo carattere: prima quelli di Fub (IBM Plex Mono solo per i
// titoli), poi quelli del vault. Sotto il corpo, l'interlinea e la scala dei
// titoli, che si trascinano «dal vivo»; i paragrafi staccati o col rientro,
// i titoli a sinistra o al centro; il testo giustificato, la sillabazione, i
// titoli numerati. Ogni scelta tranne la sillabazione sta sopra il tema, come
// i colori: «Togli le regolazioni tue» nella sezione Tema la riporta lì.
//
// **I caratteri del vault.** Il core li elenca (`pdf.vault_fonts`,
// `crates/fub-features/src/pdf_export/fonts.rs`) per famiglia, con le facce,
// se hanno un corsivo e se la licenza lascia incorporarli. Uno che la lascia
// si carica nel documento con `FontFace` (`PrintFonts`), sotto un nome suo, e
// le pagine lo usano col carattere del tema dietro; il profilo nomina il suo
// file (`carattere_testo: "Caratteri/Mia.ttf"`). Uno che non la lascia si
// vede, e sceglierlo dice perché non si può: il testo resta nel carattere di
// Fub, lo stesso che lo scrittore metterebbe nel PDF. Le facce si registrano
// in modo che il browser non inventi niente: senza corsivo, il tondo fa anche
// da corsivo; un peso che manca lo dà la faccia più vicina. Così le pagine e
// il PDF, che incorpora quei file e basta, restano uguali.

import { errorText } from "../../host/errors";
import { plural, resolvedLanguage, t, type Key } from "../../i18n/strings";
import type { ExportProfile, ProfileText } from "../profile";
import { fontName, FUB_HEADING_FONTS, FUB_TEXT_FONTS, isVaultFont, PRINT_FONTS, printTheme, setVaultFontFamily, textOf, vaultFontFamily } from "../themes";
import type { SectionContext } from "./index";

// ── I caratteri del vault ───────────────────────────────────────────────────

/// Una faccia di un carattere del vault (`FacciaDelVault`).
export interface VaultFontFace {
  readonly file: string;
  readonly corsivo: boolean;
  readonly pesi: readonly [number, number];
  readonly incorporabile: boolean;
}

/// Una famiglia del vault (`CarattereDelVault`).
export interface VaultFont {
  readonly famiglia: string;
  /// Il file che il profilo nomina.
  readonly file: string;
  readonly facce: readonly VaultFontFace[];
  readonly corsivo: boolean;
  readonly incorporabile: boolean;
}

/// L'elenco del core (`CaratteriDelVault`).
export interface VaultFontList {
  readonly caratteri: readonly VaultFont[];
  readonly illeggibili: readonly string[];
  readonly tralasciati: number;
}

/// Dove lo spazio prende i caratteri del vault: l'elenco dal core, i byte
/// dalla porta delle risorse (`state/document-controller.ts`).
export interface VaultFontSource {
  list(): Promise<VaultFontList>;
  /// I byte del file; `null` se non c'è più o se pesa più di `limit`.
  read(file: string, limit: number): Promise<Uint8Array | null>;
}

/// Il file più grande che si carica, come il core (`MAX_FONT_BYTES`).
const MAX_FONT_BYTES = 64 * 1024 * 1024;

/// Quante famiglie del vault si caricano da sole per mostrarle nel loro
/// carattere; le altre si caricano alla scelta.
const PREVIEW_FAMILIES = 24;

/// Il nome CSS di un carattere del vault: suo, stabile, e che nessun foglio
/// dell'app usa.
export function vaultFamilyName(file: string): string {
  let hash = 0x811c9dc5;
  for (const char of file) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fubprint-${hash.toString(36)}`;
}

interface FaceRule {
  readonly file: string;
  readonly style: "normal" | "italic";
  readonly weight: readonly [number, number];
}

/// Come si registrano le facce di una famiglia: per ogni stile i pesi da 1 a
/// 1000 divisi fra le facce, ognuna attorno ai suoi; uno stile che manca lo
/// fanno le facce dell'altro. Il browser non deve mai fingere un corsivo o
/// un nero che il PDF non avrebbe.
export function faceRules(font: VaultFont): FaceRule[] {
  const rules: FaceRule[] = [];
  for (const style of ["normal", "italic"] as const) {
    let faces = font.facce.filter((face) => face.corsivo === (style === "italic"));
    if (faces.length === 0) faces = [...font.facce];
    faces = [...faces].sort((a, b) => a.pesi[0] + a.pesi[1] - (b.pesi[0] + b.pesi[1]));
    faces.forEach((face, index) => {
      const before = faces[index - 1];
      const after = faces[index + 1];
      const lo = before ? Math.floor((before.pesi[1] + face.pesi[0]) / 2) + 1 : 1;
      const hi = after ? Math.floor((face.pesi[1] + after.pesi[0]) / 2) : 1000;
      rules.push({ file: face.file, style, weight: [Math.max(1, Math.min(lo, hi)), Math.max(lo, hi)] });
    });
  }
  return rules;
}

/// La regola `@font-face` di una faccia, come la legge la sonda dell'export
/// (`probe.ts`, `FaceTable`): il file è il percorso nel vault.
function faceCss(family: string, rule: FaceRule): string {
  const url = `/${rule.file.split("/").map(encodeURIComponent).join("/")}`;
  return `@font-face { font-family: "${family}"; src: url("${url}"); font-style: ${rule.style}; font-weight: ${rule.weight[0]} ${rule.weight[1]}; }`;
}

/// I caratteri del vault di uno spazio aperto: l'elenco, chiesto una volta,
/// e le famiglie caricate nel documento, che se ne vanno con lo spazio.
export class PrintFonts {
  private listing: Promise<VaultFontList> | null = null;
  private listed: VaultFontList | null = null;
  private listError: string | null = null;
  private readonly families = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();
  private readonly css = new Map<string, string[]>();
  private readonly added: FontFace[] = [];
  private disposed = false;

  constructor(private readonly source: VaultFontSource | null) {}

  /// L'elenco, se è arrivato.
  get list(): VaultFontList | null {
    return this.listed;
  }

  /// Perché l'elenco non è arrivato, se non è arrivato.
  get error(): string | null {
    return this.listError;
  }

  /// Se l'elenco si sta ancora chiedendo.
  get loading(): boolean {
    return this.listing !== null && this.listed === null && this.listError === null;
  }

  /// Chiede l'elenco (una volta per spazio). Senza una fonte, è vuoto.
  load(): Promise<VaultFontList> {
    if (this.listing) return this.listing;
    const source = this.source;
    this.listing = (source ? source.list() : Promise.resolve<VaultFontList>({ caratteri: [], illeggibili: [], tralasciati: 0 })).then(
      (list) => {
        this.listed = { caratteri: list.caratteri ?? [], illeggibili: list.illeggibili ?? [], tralasciati: list.tralasciati ?? 0 };
        return this.listed;
      },
      (error: unknown) => {
        this.listError = errorText(error);
        throw error;
      },
    );
    return this.listing;
  }

  /// La famiglia che un id del profilo nomina: il suo file, o una delle sue
  /// facce.
  find(id: string): VaultFont | null {
    return this.listed?.caratteri.find((font) => font.file === id || font.facce.some((face) => face.file === id)) ?? null;
  }

  /// Se la famiglia è già caricata nel documento.
  ready(font: VaultFont): boolean {
    return vaultFontFamily(font.file) !== null && this.css.has(font.file);
  }

  /// Perché una famiglia non si è caricata, se è così.
  failure(font: VaultFont): string | null {
    return this.failures.get(font.file) ?? null;
  }

  /// Carica le facce di una famiglia nel documento (una volta). Una che la
  /// licenza non lascia incorporare non si carica mai.
  use(font: VaultFont): Promise<void> {
    if (!font.incorporabile) return Promise.reject(new Error(t("pdf_export.fonts.closed_mark")));
    const known = this.families.get(font.file);
    if (known) return known;
    const loading = this.register(font).catch((error: unknown) => {
      this.failures.set(font.file, errorText(error));
      this.families.delete(font.file);
      throw error;
    });
    this.families.set(font.file, loading);
    return loading;
  }

  private async register(font: VaultFont): Promise<void> {
    const source = this.source;
    if (!source) throw new Error(t("pdf_export.fonts.vault_empty"));
    if (typeof FontFace !== "function" || !document.fonts) throw new Error("FontFace");
    const family = vaultFamilyName(font.file);
    const rules = faceRules(font);
    const bytes = new Map<string, Uint8Array>();
    for (const rule of rules) {
      if (bytes.has(rule.file)) continue;
      const read = await source.read(rule.file, MAX_FONT_BYTES);
      if (!read) throw new Error(t("pdf_export.fonts.missing", { name: font.famiglia, fallback: "" }));
      bytes.set(rule.file, read);
    }
    const faces = rules.map((rule) => {
      const data = bytes.get(rule.file) as Uint8Array;
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      return new FontFace(family, buffer, { style: rule.style, weight: `${rule.weight[0]} ${rule.weight[1]}` });
    });
    await Promise.all(faces.map((face) => face.load()));
    if (this.disposed) return;
    for (const face of faces) {
      document.fonts.add(face);
      this.added.push(face);
    }
    this.failures.delete(font.file);
    this.css.set(font.file, rules.map((rule) => faceCss(family, rule)));
    setVaultFontFamily(font.file, family);
  }

  /// Carica i caratteri del vault che il profilo nomina, se la licenza lo
  /// lascia. Torna vero se ne è arrivato uno nuovo (le pagine vanno rifatte).
  async ensure(profile: ExportProfile): Promise<boolean> {
    const text = textOf(profile);
    const ids = [text.carattere_testo, text.carattere_titoli].filter(isVaultFont);
    if (ids.length === 0) return false;
    try {
      await this.load();
    } catch {
      return false;
    }
    let fresh = false;
    for (const id of ids) {
      const font = this.find(id);
      if (!font || !font.incorporabile || this.ready(font)) continue;
      try {
        await this.use(font);
        fresh = !this.disposed;
      } catch {
        // Il motivo resta in `failure`: la sezione lo dice.
      }
    }
    return fresh;
  }

  /// Le regole `@font-face` dei caratteri del vault caricati, per la sonda
  /// che scrive l'elenco delle pagine del PDF.
  fontFaces(): string[] {
    return [...this.css.values()].flat();
  }

  dispose(): void {
    this.disposed = true;
    for (const face of this.added) document.fonts?.delete(face);
    this.added.length = 0;
    for (const file of this.css.keys()) setVaultFontFamily(file, null);
    this.css.clear();
  }
}

// ── I controlli della sezione (anche di `page.ts`) ──────────────────────────

/// Una riga col nome a sinistra e il controllo a destra (`.px-row`).
export function row(label: string, control: HTMLElement, stacked = false): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = stacked ? "export-row export-row-stacked" : "export-row";
  const name = document.createElement("span");
  name.className = "export-row-label";
  name.textContent = label;
  wrap.append(name, control);
  return wrap;
}

/// Le frecce spostano la scelta in un gruppo di pulsanti `radio`.
function arrows(group: HTMLElement): void {
  group.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const buttons = [...group.querySelectorAll<HTMLButtonElement>("[role=radio]")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next = buttons[(at + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  });
}

/// Una scelta fra pochi valori (`.px-seg`).
export function segments<V extends string | number | boolean>(id: string, label: string, options: readonly (readonly [V, Key])[], current: V | null, pick: (value: V) => void): HTMLElement {
  const group = document.createElement("div");
  group.className = "export-segments";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", label);
  for (const [value, name] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "export-segment";
    button.id = `${id}-${String(value)}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(value === current));
    button.tabIndex = value === current || (current === null && value === options[0][0]) ? 0 : -1;
    button.textContent = t(name);
    button.addEventListener("click", () => {
      if (value !== current) pick(value);
    });
    group.append(button);
  }
  arrows(group);
  return group;
}

/// Un interruttore (`.px-tog`), come quelli dei Colori.
export function toggle(id: string, label: Key, hint: Key | null, on: boolean, flip: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "export-toggle";
  button.id = id;
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", String(on));
  const text = document.createElement("span");
  text.className = "export-toggle-text";
  text.textContent = t(label);
  if (hint) {
    const small = document.createElement("small");
    small.className = "export-toggle-hint";
    small.textContent = t(hint);
    text.append(small);
  }
  const knob = document.createElement("i");
  knob.className = "export-toggle-knob";
  knob.setAttribute("aria-hidden", "true");
  button.append(text, knob);
  button.addEventListener("click", flip);
  return button;
}

/// Un numero nella lingua dell'app: «1,5» in italiano, come nel prototipo.
export function decimal(value: number, digits: number): string {
  return new Intl.NumberFormat(resolvedLanguage(), { maximumFractionDigits: digits }).format(value);
}

/// Un cursore col suo valore (`.px-rng`): mentre si trascina le pagine
/// seguono (`live`), al rilascio il pannello si ridisegna.
function range(id: string, label: Key, min: number, max: number, step: number, value: number, unit: string, set: (value: number, live: boolean) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "export-range";
  wrap.htmlFor = id;
  const name = document.createElement("span");
  name.textContent = t(label);
  const input = document.createElement("input");
  input.type = "range";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(Math.min(max, Math.max(min, value)));
  const digits = String(step).split(".")[1]?.length ?? 0;
  const output = document.createElement("output");
  output.setAttribute("for", id);
  output.textContent = `${decimal(value, digits)}${unit}`;
  input.addEventListener("input", () => {
    output.textContent = `${decimal(Number(input.value), digits)}${unit}`;
    set(Number(input.value), true);
  });
  input.addEventListener("change", () => set(Number(input.value), false));
  wrap.append(name, input, output);
  return wrap;
}

// ── La sezione ──────────────────────────────────────────────────────────────

/// L'avviso di una scelta che non si è potuta fare, fra un disegno e l'altro.
const WARNING_KEY = "caratteri.avviso";

/// Il profilo con una scelta del testo cambiata (sopra il tema).
export function withText(profile: ExportProfile, change: Partial<ProfileText>): ExportProfile {
  return { ...profile, testo: { ...profile.testo, ...change } };
}

type FontRole = "testo" | "titoli";

export function fontsBody(context: SectionContext): HTMLElement {
  const body = document.createElement("div");
  body.className = "export-fonts-section";
  const profile = context.profile;
  const text = textOf(profile);
  const theme = printTheme(profile.tema).text;
  const fonts = context.fonts ?? null;
  const set = (change: Partial<ProfileText>, live = false) => context.change(withText(context.profile, change), { live });

  const status = document.createElement("div");
  status.className = "export-fonts-status";
  status.id = "export-fonts-status";
  status.setAttribute("role", "status");

  const fontButtons = (role: FontRole): HTMLElement => {
    const key = role === "testo" ? "carattere_testo" : "carattere_titoli";
    const current = text[key];
    const fallback = role === "testo" ? theme.carattere_testo : theme.carattere_titoli;
    const group = document.createElement("div");
    group.className = "export-fonts";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", t(role === "testo" ? "pdf_export.fonts.text_group" : "pdf_export.fonts.headings_group"));
    const add = (id: string, label: string, title: string, stack: string | null, checked: boolean, pick: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "export-font";
      button.id = `export-font-${role}-${id}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = checked ? 0 : -1;
      button.title = title;
      button.textContent = label;
      if (stack) button.style.fontFamily = stack;
      button.addEventListener("click", pick);
      group.append(button);
      return button;
    };
    for (const id of role === "testo" ? FUB_TEXT_FONTS : FUB_HEADING_FONTS) {
      const font = PRINT_FONTS[id];
      add(id, font.name.split(" ")[0], font.name, font.stack, current === id, () => {
        context.memory.delete(WARNING_KEY);
        if (current !== id) set({ [key]: id });
      });
    }
    for (const font of fonts?.list?.caratteri ?? []) {
      const checked = current === font.file || font.facce.some((face) => face.file === current);
      const family = vaultFontFamily(font.file);
      const button = add(
        vaultFamilyName(font.file).slice("fubprint-".length),
        font.famiglia,
        t("pdf_export.fonts.vault_title", { name: font.famiglia, path: font.file }),
        family ? `"${family}", ${PRINT_FONTS[fallback]?.stack ?? "serif"}` : null,
        checked,
        () => void chooseVault(role, font),
      );
      button.dataset["vault"] = font.file;
      if (!font.incorporabile) {
        button.classList.add("is-closed");
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-describedby", "export-fonts-status");
      }
    }
    // Nessun pulsante scelto (un carattere che non c'è più): il primo prende
    // il tasto Tab.
    if (!group.querySelector("[tabindex='0']")) group.querySelector<HTMLButtonElement>("button")?.setAttribute("tabindex", "0");
    arrows(group);
    return group;
  };

  /// Sceglie un carattere del vault: lo carica, poi lo mette nel profilo.
  async function chooseVault(role: FontRole, font: VaultFont): Promise<void> {
    const key = role === "testo" ? "carattere_testo" : "carattere_titoli";
    const fallback = fontName(role === "testo" ? theme.carattere_testo : theme.carattere_titoli);
    if (!fonts) return;
    if (!font.incorporabile) {
      context.memory.set(WARNING_KEY, t("pdf_export.fonts.closed", { name: font.famiglia, fallback }));
      context.redraw();
      return;
    }
    context.memory.delete(WARNING_KEY);
    try {
      await fonts.use(font);
    } catch (error) {
      context.memory.set(WARNING_KEY, t("pdf_export.fonts.load_failed", { name: font.famiglia, reason: errorText(error), fallback }));
      context.redraw();
      return;
    }
    set({ [key]: font.file });
  }

  /// Le frasi sotto i caratteri: l'elenco del vault, poi ciò che vale per
  /// le scelte di adesso.
  const fillStatus = () => {
    const lines: { text: string; warn: boolean }[] = [];
    if (fonts?.loading) lines.push({ text: t("pdf_export.fonts.vault_loading"), warn: false });
    else if (fonts?.error) lines.push({ text: t("pdf_export.fonts.vault_failed", { reason: fonts.error }), warn: true });
    else if (fonts?.list) {
      const list = fonts.list;
      if (list.caratteri.length === 0) lines.push({ text: t("pdf_export.fonts.vault_empty"), warn: false });
      if (list.illeggibili.length > 0) {
        const files = list.illeggibili.slice(0, 3).join(", ") + (list.illeggibili.length > 3 ? ", …" : "");
        lines.push({ text: plural(list.illeggibili.length, "pdf_export.fonts.vault_unreadable.one", "pdf_export.fonts.vault_unreadable.other", { files }), warn: true });
      }
      if (list.tralasciati > 0) lines.push({ text: t("pdf_export.fonts.vault_skipped", { n: list.tralasciati }), warn: true });
    }
    const said = new Set<string>();
    for (const role of ["testo", "titoli"] as const) {
      const id = role === "testo" ? text.carattere_testo : text.carattere_titoli;
      if (!isVaultFont(id) || !fonts?.list || said.has(id)) continue;
      said.add(id);
      const fallback = fontName(role === "testo" ? theme.carattere_testo : theme.carattere_titoli);
      const font = fonts.find(id);
      if (!font) lines.push({ text: t("pdf_export.fonts.missing", { name: fontName(id), fallback }), warn: true });
      else if (!font.incorporabile) lines.push({ text: t("pdf_export.fonts.closed", { name: font.famiglia, fallback }), warn: true });
      else if (fonts.failure(font)) lines.push({ text: t("pdf_export.fonts.load_failed", { name: font.famiglia, reason: fonts.failure(font) ?? "", fallback }), warn: true });
      else if (!font.corsivo) lines.push({ text: t("pdf_export.fonts.no_italic", { name: font.famiglia }), warn: false });
    }
    const warning = context.memory.get(WARNING_KEY);
    if (typeof warning === "string") lines.push({ text: warning, warn: true });
    status.replaceChildren(
      ...lines.map((line) => {
        const p = document.createElement("p");
        p.className = line.warn ? "export-note export-fonts-warning" : "export-note";
        p.textContent = line.text;
        return p;
      }),
    );
    status.hidden = lines.length === 0;
  };

  const textRow = row(t("pdf_export.fonts.text"), fontButtons("testo"), true);
  const headingRow = row(t("pdf_export.fonts.headings"), fontButtons("titoli"), true);
  fillStatus();

  // L'elenco del vault arriva dopo: il pannello si ridisegna una volta, col
  // fuoco dov'era. Le famiglie che si lasciano incorporare si caricano per
  // mostrarsi nel loro carattere; ognuna cambia solo il suo pulsante.
  if (fonts && !fonts.list && !fonts.error) {
    const pending = !fonts.loading;
    void fonts.load().then(
      () => {
        if (pending && body.isConnected) context.redraw();
      },
      () => {
        if (pending && body.isConnected) context.redraw();
      },
    );
  }
  if (fonts?.list) {
    for (const font of fonts.list.caratteri.filter((entry) => entry.incorporabile && !fonts.ready(entry)).slice(0, PREVIEW_FAMILIES)) {
      void fonts.use(font).then(
        () => {
          for (const button of body.querySelectorAll<HTMLButtonElement>(".export-font[data-vault]")) {
            if (button.dataset["vault"] !== font.file) continue;
            const role = button.id.startsWith("export-font-testo") ? theme.carattere_testo : theme.carattere_titoli;
            button.style.fontFamily = `"${vaultFamilyName(font.file)}", ${PRINT_FONTS[role]?.stack ?? "serif"}`;
          }
        },
        () => undefined,
      );
    }
  }

  body.append(
    textRow,
    headingRow,
    status,
    range("export-fonts-size", "pdf_export.fonts.body_size", 8, 14, 0.5, text.corpo, " pt", (value, live) => set({ corpo: value }, live)),
    range("export-fonts-leading", "pdf_export.fonts.leading", 1.2, 1.9, 0.05, text.interlinea, "", (value, live) => set({ interlinea: value }, live)),
    range("export-fonts-scale", "pdf_export.fonts.scale", 1.05, 1.5, 0.01, text.scala_titoli, "", (value, live) => set({ scala_titoli: value }, live)),
    row(
      t("pdf_export.fonts.paragraphs"),
      segments("export-fonts-paragraphs", t("pdf_export.fonts.paragraphs"), [["spazio", "pdf_export.fonts.spaced"], ["rientro", "pdf_export.fonts.indented"]], text.paragrafi, (value) => set({ paragrafi: value })),
    ),
    row(
      t("pdf_export.fonts.headings"),
      segments("export-fonts-heading-align", t("pdf_export.fonts.headings"), [["sinistra", "pdf_export.fonts.left"], ["centro", "pdf_export.fonts.center"]], text.allineamento_titoli, (value) => set({ allineamento_titoli: value })),
    ),
    toggle("export-fonts-justify", "pdf_export.fonts.justify", null, text.giustificato, () => set({ giustificato: !text.giustificato })),
    toggle("export-fonts-hyphens", "pdf_export.fonts.hyphens", "pdf_export.fonts.hyphens_hint", profile.testo.sillabazione, () => set({ sillabazione: !profile.testo.sillabazione })),
    toggle("export-fonts-numbered", "pdf_export.fonts.numbered", "pdf_export.fonts.numbered_hint", text.titoli_numerati, () => set({ titoli_numerati: !text.titoli_numerati })),
  );
  return body;
}

/// Il riassunto della sezione chiusa: «Newsreader · 11 pt».
export function fontsSummary(profile: ExportProfile): string {
  const text = textOf(profile);
  return `${fontName(text.carattere_testo)} · ${t("pdf_export.fonts.size", { size: decimal(text.corpo, 1) })}`;
}
