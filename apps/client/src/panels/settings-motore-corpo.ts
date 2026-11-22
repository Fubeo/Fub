// Il corpo della sezione «Motore del disegno» (piano K6, T11): arriva con un
// `import()` da `settings-motore.ts` quando il riquadro si apre.
//
// - **L'elenco** è `prefs.list` del motore, su un disegno vuoto aperto qui: una
//   categoria per riquadro, i titoletti dentro, un campo di `kit/form.ts` per
//   preferenza (casella, numero, scelta, testo). Le cartelle il motore non le
//   dice nemmeno (l'host le toglie).
// - **Le parole** sono quelle generate
//   (`settings-motore.generated.json`, dal catalogo italiano del motore
//   passato per il glossario del disegno); una parola che manca resta com'è.
// - **Scrivere.** Un campo preso è un `prefs.set`; l'host salva `draw.motore`.
//   Un testo si prende quando il campo lo lascia, non a ogni tasto. Un
//   rifiuto lo dice (notifica e riga d'errore) e la sezione si rilegge, così
//   mostra il valore che vale. «Ripristina» è `prefs.reset` della categoria.
// - **Sola lettura.** Un `draw.motore` di una versione più nuova o rotto non
//   si riscrive: i campi si spengono, una riga dice perché, e resta «Azzera».

import type { SettingEntry } from "../host/contract";
import { api } from "../host/ipc";
import { errorText, isErrorKind } from "../host/errors";
import { resolvedLanguage, t } from "../i18n/strings";
import { formBody, formCheck, formChoice, formNumber, formRow, formText, sixDigits } from "../kit/form";
import type { QuantityProblem } from "../kit/quantity";
import { confirm } from "../platform/confirm";
import { identifier } from "../ui/a11y";
import { notify } from "../ui/notify";
import parole from "./settings-motore.generated.json";
import { DRAW_ENGINE_SETTING, categorieAperte, mostraErrore, type DipendenzeMotore } from "./settings-motore";

/// Il disegno vuoto su cui la sezione chiede e scrive le preferenze: il nome
/// lo vedono solo i log dell'host.
const DOC = "impostazioni-motore.svg";
const VUOTO =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100" width="100" height="100"/>\n';

/// Una riga di `prefs.list`.
export interface RigaPreferenza {
  readonly key: string;
  readonly category: string;
  readonly section: string;
  readonly label: string;
  readonly value: unknown;
  readonly kind: "bool" | "number" | "integer" | "choice" | "color" | "text";
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  readonly options?: readonly string[];
}

/// Come si legge `draw.motore`, con la regola dell'host
/// (`EnginePrefs::parse` in `crates/fub-host/src/drawing.rs`).
export type LetturaMotore =
  | { readonly stato: "ok" }
  | { readonly stato: "nuovo"; readonly versione: number }
  | { readonly stato: "rotto" };

export function leggiValore(valore: unknown): LetturaMotore {
  if (typeof valore !== "string" || valore.trim() === "") return { stato: "ok" };
  let letto: unknown;
  try {
    letto = JSON.parse(valore);
  } catch {
    return { stato: "rotto" };
  }
  const v = (letto as { v?: unknown } | null)?.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return { stato: "rotto" };
  if (v > parole.versione) return { stato: "nuovo", versione: v };
  const prefs = (letto as { prefs?: unknown }).prefs;
  const oggetto = typeof prefs === "object" && prefs !== null && !Array.isArray(prefs);
  return v === parole.versione && oggetto ? { stato: "ok" } : { stato: "rotto" };
}

const testi: Readonly<Record<string, { readonly it: string; readonly en: string }>> = parole.testi;
const scelte: Readonly<Record<string, readonly (readonly string[])[]>> = parole.scelte;

/// La parola del motore nella lingua di adesso.
export function parola(inglese: string): string {
  const voce = testi[inglese];
  if (!voce) return inglese;
  return resolvedLanguage() === "en" ? voce.en : voce.it;
}

/// L'etichetta di un valore di una scelta.
function etichettaScelta(chiave: string, valore: string): string {
  const coppia = scelte[chiave]?.find(([v]) => v === valore);
  return coppia ? parola(coppia[1]!) : valore;
}

/// Il disegno vuoto aperto adesso, e la generazione che l'ha aperto.
let istanza: { readonly id: string; readonly vault: string } | null = null;
let generazione = 0;

async function chiudiIstanza(): Promise<void> {
  const aperta = istanza;
  istanza = null;
  if (aperta === null) return;
  await api.closeDrawing(aperta.id, aperta.vault).catch(() => undefined);
}

/// Chiude il disegno vuoto (le Impostazioni che si chiudono, i test).
export function chiudiMotore(): Promise<void> {
  generazione++;
  return chiudiIstanza();
}

async function comando(id: string, value: unknown): Promise<unknown> {
  const aperta = istanza;
  if (aperta === null) throw new Error(t("settings.drawing_engine.closed"));
  const esito = await api.drawingCommand(aperta.id, { revision: "0", id, selection: [], value }, aperta.vault);
  if (esito.refused) throw new Error(t("settings.drawing_engine.refused"));
  return esito.reading ?? null;
}

/// Le frasi del campo numerico: le stesse delle finestre del disegno, nel
/// catalogo della shell (quello del disegno arriva solo con un disegno aperto).
const PROBLEMI: Readonly<Record<QuantityProblem, Parameters<typeof t>[0]>> = {
  empty: "settings.drawing_engine.problem.empty",
  syntax: "settings.drawing_engine.problem.syntax",
  unit: "settings.drawing_engine.problem.unit",
  relative: "settings.drawing_engine.problem.syntax",
  finite: "settings.drawing_engine.problem.finite",
};

function fuoriLimiti(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return t("settings.drawing_engine.range", { min, max });
  if (min !== undefined) return t("settings.drawing_engine.range_min", { min });
  return t("settings.drawing_engine.range_max", { max: max ?? 0 });
}

/// Riempie `dentro` con le preferenze del motore. Un motore che non c'è in
/// questa build (`unserved`) toglie il riquadro.
export async function disegnaMotore(dentro: HTMLElement, entry: SettingEntry, dip: DipendenzeMotore): Promise<void> {
  const mia = ++generazione;
  await chiudiIstanza();
  let righe: RigaPreferenza[];
  try {
    const aperto = await api.openDrawing(DOC, VUOTO, dip.vault);
    if (mia !== generazione || dip.vita.closed) {
      await api.closeDrawing(aperto.instance, dip.vault).catch(() => undefined);
      return;
    }
    istanza = { id: aperto.instance, vault: dip.vault };
    const questa = istanza;
    dip.vita.add(() => {
      if (istanza === questa) void chiudiMotore();
    });
    const lette = await comando("disegno.prefs.list", {});
    righe = Array.isArray(lette) ? (lette as RigaPreferenza[]) : [];
  } catch (error) {
    if (mia !== generazione) return;
    if (isErrorKind(error, "unserved")) {
      dentro.closest("details")?.remove();
      return;
    }
    mostraErrore(dentro, errorText(error), dip);
    return;
  }
  if (mia !== generazione || dip.vita.closed) return;
  dentro.replaceChildren(...corpo(righe, leggiValore(entry.value), dip));
}

const riga = (className: string, contenuto: string, role?: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = contenuto;
  if (role) el.setAttribute("role", role);
  return el;
};

const pulsante = (etichetta: string, azione: () => void, aria?: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.textContent = etichetta;
  if (aria) button.setAttribute("aria-label", aria);
  button.addEventListener("click", azione);
  return button;
};

function corpo(righe: readonly RigaPreferenza[], lettura: LetturaMotore, dip: DipendenzeMotore): HTMLElement[] {
  const scrivibile = lettura.stato === "ok";
  const nodi: HTMLElement[] = [riga("muted settings-note", t("settings.drawing_engine.hint"))];
  if (!scrivibile) {
    nodi.push(
      riga(
        "setting-source setting-diagnostic",
        lettura.stato === "nuovo"
          ? t("settings.drawing_engine.newer", { version: lettura.versione })
          : t("settings.drawing_engine.broken"),
        "status",
      ),
    );
    const azioni = document.createElement("div");
    azioni.className = "settings-actions";
    azioni.append(pulsante(t("settings.drawing_engine.reset_all"), () => void azzera(lettura, dip)));
    nodi.push(azioni);
  }
  const errore = riga("setting-source setting-error", "", "alert");
  errore.hidden = true;
  nodi.push(errore);

  /// Scrive e, se il motore o l'host rifiutano, lo dice e rilegge.
  const scrivi = async (id: string, value: unknown): Promise<void> => {
    try {
      await comando(id, value);
      errore.hidden = true;
    } catch (error) {
      const testo = t("settings.drawing_engine.write_failed", { reason: errorText(error) });
      notify(testo, "guasto");
      errore.textContent = testo;
      errore.hidden = false;
      dip.ridisegna();
    }
  };

  const categorie = new Map<string, RigaPreferenza[]>();
  for (const r of righe) {
    const elenco = categorie.get(r.category);
    if (elenco) elenco.push(r);
    else categorie.set(r.category, [r]);
  }
  for (const [categoria, elenco] of categorie) {
    const details = document.createElement("details");
    details.className = "settings-details";
    details.dataset.detailsKey = `drawing-engine:${categoria}`;
    details.open = categorieAperte.has(categoria);
    details.addEventListener("toggle", () => {
      if (details.open) categorieAperte.add(categoria);
      else categorieAperte.delete(categoria);
    });
    const summary = document.createElement("summary");
    summary.textContent = parola(categoria);
    const dentro = document.createElement("div");
    dentro.className = "settings-details-body";
    const campi: HTMLElement[] = [];
    let sezione = "";
    for (const r of elenco) {
      if (r.section !== sezione) {
        sezione = r.section;
        if (sezione !== "") {
          const titolo = document.createElement("h4");
          titolo.className = "kit-form-label";
          titolo.textContent = parola(sezione);
          campi.push(titolo);
        }
      }
      campi.push(campo(r, scrivibile, dip, (value) => void scrivi("disegno.prefs.set", { key: r.key, value })));
    }
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = !scrivibile;
    fieldset.append(formBody(campi));
    fieldset.style.border = "0";
    fieldset.style.margin = "0";
    fieldset.style.padding = "0";
    fieldset.style.minWidth = "0";
    dentro.append(fieldset);
    if (scrivibile) {
      const azioni = document.createElement("div");
      azioni.className = "settings-actions";
      azioni.append(
        pulsante(
          t("settings.drawing_engine.reset"),
          () => void scrivi("disegno.prefs.reset", { category: categoria }).then(() => dip.ridisegna()),
          t("settings.drawing_engine.reset_aria", { category: parola(categoria) }),
        ),
      );
      dentro.append(azioni);
    }
    details.append(summary, dentro);
    nodi.push(details);
  }
  return nodi;
}

/// Il campo di una preferenza; `prendi` riceve il valore preso.
function campo(r: RigaPreferenza, scrivibile: boolean, dip: DipendenzeMotore, prendi: (value: unknown) => void): HTMLElement {
  const nome = parola(r.label);
  const vita = dip.vita;
  switch (r.kind) {
    case "bool":
      return formCheck({ label: nome, checked: r.value === true, onChange: prendi, lifetime: vita }).element;
    case "number":
    case "integer": {
      const numero = formNumber({
        label: nome,
        value: typeof r.value === "number" ? r.value : 0,
        unit: r.unit || undefined,
        min: r.min,
        max: r.max,
        places: r.kind === "integer" ? 0 : undefined,
        outOfRange: fuoriLimiti,
        problem: (problema) =>
          t(problema === "mixed" ? PROBLEMI.syntax : PROBLEMI[problema], { units: r.unit ?? "" }),
        onChange: (valore) => prendi(r.kind === "integer" ? Math.round(valore) : valore),
        lifetime: vita,
      });
      return formRow(numero.element);
    }
    case "choice": {
      const opzioni = (r.options ?? []).map((valore) => ({ value: valore, label: etichettaScelta(r.key, valore) }));
      const valore = typeof r.value === "string" ? r.value : "";
      const corte = opzioni.length <= 3 && opzioni.every((o) => o.label.length <= 14);
      if (corte && scrivibile) {
        return formChoice({ label: nome, choices: opzioni, value: valore, onChange: prendi, lifetime: vita }).element;
      }
      return sceltaLunga(nome, opzioni, valore, prendi, dip);
    }
    case "color":
    case "text": {
      const iniziale = typeof r.value === "string" ? r.value : "";
      const testo = formText({ label: nome, value: iniziale, blank: "", onChange: () => undefined, lifetime: vita });
      let preso = iniziale;
      const lascia = (): void => {
        const scritto = testo.value();
        if (scritto === preso) return;
        if (r.kind === "color") {
          const codice = sixDigits(scritto);
          if (codice === null) {
            testo.setError(t("settings.drawing_engine.color"));
            return;
          }
          testo.setError(null);
          preso = codice;
          prendi(codice);
          return;
        }
        preso = scritto;
        prendi(scritto);
      };
      testo.input.addEventListener("change", lascia);
      vita.add(() => testo.input.removeEventListener("change", lascia));
      return testo.element;
    }
  }
}

/// Una scelta con molte voci o voci lunghe: un menu a tendina, nella riga del
/// modulo.
function sceltaLunga(
  nome: string,
  opzioni: readonly { readonly value: string; readonly label: string }[],
  valore: string,
  prendi: (value: unknown) => void,
  dip: DipendenzeMotore,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "kit-form-label";
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = identifier("drawing-engine-choice");
  label.htmlFor = select.id;
  label.textContent = nome;
  for (const o of opzioni) {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    select.append(option);
  }
  if (!opzioni.some((o) => o.value === valore)) {
    const option = document.createElement("option");
    option.value = valore;
    option.textContent = valore;
    select.append(option);
  }
  select.value = valore;
  const cambia = (): void => prendi(select.value);
  select.addEventListener("change", cambia);
  dip.vita.add(() => select.removeEventListener("change", cambia));
  return formRow(label, select);
}

/// «Azzera»: toglie `draw.motore`. Un valore più nuovo chiede prima.
async function azzera(lettura: LetturaMotore, dip: DipendenzeMotore): Promise<void> {
  if (lettura.stato === "nuovo") {
    const ok = await confirm(t("settings.drawing_engine.reset_confirm"), {
      title: t("settings.drawing_engine.reset_confirm_title"),
      okLabel: t("settings.drawing_engine.reset_confirm_ok"),
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await api.resetSetting(DRAW_ENGINE_SETTING);
  } catch (error) {
    notify(t("settings.drawing_engine.write_failed", { reason: errorText(error) }), "guasto");
  }
  dip.ridisegna();
}
