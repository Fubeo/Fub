// La sezione «Disegno completo» di Impostazioni › Scorciatoie (piano K6, T9c;
// D1 (a), D7 (a)): i comandi del Disegno completo coi loro tasti, l'insieme di
// tasti del motore, e il suo file da importare e da esportare.
//
// - **Pigra.** Il modulo del Completo (`editors/spatial/completo/index.ts`, nel
//   suo chunk) arriva con un `import()` solo quando si apre il riquadro: chi
//   non lo apre non lo carica. Da lì vengono l'indice, la regola dei tasti e la
//   lettura di `draw.keys`, gli stessi dell'editor.
// - **Il tasto che vale.** Ogni riga mostra il tasto del comando come lo
//   scrive la shell (`Mod-k`), quello dell'utente sopra quello del motore; sotto
//   dice se un tasto di Fub lo copre (vince Fub) o se un altro comando lo ha
//   preso dopo (vince l'ultimo assegnato).
// - **Il disco.** Si scrive `draw.keys` intero con `setSetting`; un valore di
//   serie si azzera. Un valore rotto o di una versione più nuova non si
//   riscrive: i controlli si spengono e resta solo «Azzera». Una scrittura che
//   non riesce lo dice (`scrivi`, con la notifica delle Impostazioni) e il
//   ridisegno mostra il valore di prima, che il kernel ha tenuto.
// - **Gli insiemi.** Il file si sceglie con la finestra dei file del sistema
//   (un `<input type=file>` della webview, come «Importa disegno») e si salva
//   con `saveArtifact`, che apre la finestra di salvataggio dell'host: nessuna
//   porta nuova. Un file rotto dice perché e non cambia niente.

import type { SettingEntry } from "../host/contract";
import { api } from "../host/ipc";
import { errorText } from "../host/errors";
import { resolvedLanguage, t, type Key } from "../i18n/strings";
import { confirm } from "../platform/confirm";
import { displayBinding, keyboardPlatform } from "../ui/commands";
import { notify } from "../ui/notify";

type ModuloCompleto = typeof import("../editors/spatial/completo");
type TastiUtente = import("../editors/spatial/completo/tasti-utente").TastiUtente;
type LetturaTasti = import("../editors/spatial/completo/tasti-utente").LetturaTasti;
type ErroreInsieme = import("../editors/spatial/completo/tasti-utente").ErroreInsieme;
type VoceIndice = import("../editors/spatial/completo/indice").VoceIndice;
type RegolaTasti = import("../editors/spatial/completo/tasti").RegolaTasti;

/// La chiave dell'impostazione (`DRAW_KEYS_KEY` di `tasti-utente.ts`): qui per
/// trovarla fra le impostazioni senza caricare il modulo del Completo.
export const DRAW_KEYS_SETTING = "draw.keys";

/// Ciò che la sezione chiede alle Impostazioni.
export interface DipendenzeTastiDisegno {
  /// Scrive e poi ridisegna; una scrittura che non riesce lo dice (`write`
  /// delle Impostazioni).
  readonly scrivi: (azione: () => Promise<void>) => Promise<void>;
  /// Ridisegna la scheda (dopo che il riquadro si apre).
  readonly ridisegna: () => void;
}

/// Il modulo del Completo, una `import()` sola finché riesce.
let modulo: Promise<ModuloCompleto> | null = null;
/// Il riquadro aperto: il corpo si ridisegna intero a ogni scrittura, e un
/// riquadro che si richiude da solo porterebbe via il campo appena usato.
let aperta = false;
/// L'esito dell'ultimo import o export, finché non si fa altro.
let esito: { readonly testo: string; readonly errore: boolean } | null = null;

function caricaModulo(): Promise<ModuloCompleto> {
  if (modulo !== null) return modulo;
  const questo = import("../editors/spatial/completo");
  modulo = questo;
  questo.catch(() => {
    if (modulo === questo) modulo = null;
  });
  return questo;
}

/// Il riquadro chiuso e dimenticato, per un pannello che si chiude e per i test.
export function dimenticaTastiDisegno(): void {
  aperta = false;
  esito = null;
}

const testo = (className: string, contenuto: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = contenuto;
  return el;
};

const pulsante = (className: string, etichetta: string, azione: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = etichetta;
  button.addEventListener("click", azione);
  return button;
};

/// Riempie `corpo` con la sezione; torna quanti comandi hanno un tasto cambiato
/// (0 a riquadro chiuso: non si sa senza il modulo).
export async function riempiTastiDisegno(corpo: HTMLElement, entry: SettingEntry, dip: DipendenzeTastiDisegno): Promise<number> {
  const details = document.createElement("details");
  details.className = "settings-details drawing-keys";
  details.dataset.detailsKey = "drawing-keys";
  details.open = aperta;
  const summary = document.createElement("summary");
  summary.textContent = t("settings.drawing_keys.open");
  const dentro = document.createElement("div");
  dentro.className = "settings-details-body";
  details.append(summary, dentro);
  corpo.append(details);
  details.addEventListener("toggle", () => {
    if (details.open === aperta) return;
    aperta = details.open;
    if (!aperta) return;
    dentro.replaceChildren(testo("muted settings-note", t("settings.drawing_keys.loading")));
    dip.ridisegna();
  });
  if (!aperta) return 0;

  let completo: ModuloCompleto;
  let voci: readonly VoceIndice[];
  try {
    completo = await caricaModulo();
    voci = (await completo.indiceDeiComandi()).voci.filter((voce) => "comando" in voce.chiamata);
  } catch (error) {
    const riga = testo("setting-source setting-error", t("settings.drawing_keys.load_failed", { reason: errorText(error) }));
    riga.setAttribute("role", "alert");
    dentro.append(riga, pulsante("settings-btn", t("settings.drawing_keys.retry"), () => dip.ridisegna()));
    return 0;
  }
  return disegna(dentro, entry, completo, voci, dip);
}

/// La sezione col modulo arrivato.
function disegna(
  dentro: HTMLElement,
  entry: SettingEntry,
  completo: ModuloCompleto,
  voci: readonly VoceIndice[],
  dip: DipendenzeTastiDisegno,
): number {
  const tu = completo.tastiUtente;
  const lettura: LetturaTasti = tu.leggiTasti(entry.value);
  const valore = lettura.valore;
  const scrivibile = lettura.stato === "vuoto" || lettura.stato === "ok";
  const chiamate = voci.map((voce) => ({ id: voce.id, tasto: voce.tasto }));
  const regola = completo.risolviTasti(chiamate, valore.tasti, piattaformaTasti());
  const lingua = resolvedLanguage() === "en" ? "en" : "it";
  const nomeDi = new Map(voci.map((voce) => [voce.id, voce.etichetta[lingua]]));
  const noti = new Set(voci.map((voce) => voce.id));

  /// Scrive il valore nuovo: azzera quando torna quello di serie.
  const salva = (nuovo: TastiUtente): Promise<void> =>
    dip.scrivi(() => (tu.tastiVuoti(nuovo) ? api.resetSetting(DRAW_KEYS_SETTING) : api.setSetting(DRAW_KEYS_SETTING, tu.scriviTasti(nuovo))));

  // Un valore che non si riscrive: lo si dice, e resta solo «Azzera».
  if (!scrivibile) {
    const avviso = testo(
      "setting-source setting-diagnostic",
      lettura.stato === "nuovo" ? t("settings.drawing_keys.newer", { version: lettura.versione }) : t("settings.drawing_keys.broken"),
    );
    avviso.setAttribute("role", "status");
    const azioni = document.createElement("div");
    azioni.className = "settings-actions";
    azioni.append(
      pulsante("settings-btn", t("settings.drawing_keys.reset_all"), () => {
        esito = null;
        void dip.scrivi(() => api.resetSetting(DRAW_KEYS_SETTING));
      }),
    );
    dentro.append(avviso, azioni);
  }

  dentro.append(rigaInsieme(valore, scrivibile, lettura.stato !== "rotto", salva, noti));
  if (esito !== null) {
    const riga = testo(esito.errore ? "setting-source setting-error" : "setting-source", esito.testo);
    riga.setAttribute("role", esito.errore ? "alert" : "status");
    dentro.append(riga);
  }

  if (voci.length === 0) {
    dentro.append(testo("muted settings-note", t("settings.drawing_keys.empty")));
    return 0;
  }
  let cambiati = 0;
  for (const voce of voci) {
    const cambiato = Object.prototype.hasOwnProperty.call(valore.tasti, voce.id);
    if (cambiato) cambiati++;
    dentro.append(rigaComando(voce, cambiato, valore, regola, scrivibile, completo, nomeDi, chiamate, salva));
  }
  return cambiati;
}

/// La riga dell'insieme: la scelta, «Importa un insieme…» ed «Esporta
/// l'insieme…».
function rigaInsieme(
  valore: TastiUtente,
  scrivibile: boolean,
  esportabile: boolean,
  salva: (nuovo: TastiUtente) => Promise<void>,
  noti: ReadonlySet<string>,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row drawing-keys-set";
  el.dataset.settingKey = `${DRAW_KEYS_SETTING}:insieme`;
  const id = "setting-draw-keys-set";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = t("settings.drawing_keys.set");
  const desc = testo("muted setting-description", t("settings.drawing_keys.set_desc"));
  desc.id = `${id}-desc`;
  text.append(label, desc);

  const control = document.createElement("div");
  control.className = "setting-control";
  const select = document.createElement("select");
  select.className = "setting-select";
  select.id = id;
  select.setAttribute("aria-describedby", desc.id);
  const personalizzato = Object.keys(valore.tasti).length > 0;
  const insiemi: ReadonlyArray<{ readonly id: string }> = [{ id: "serie" }, { id: "classico" }];
  for (const insieme of insiemi) {
    const option = document.createElement("option");
    option.value = insieme.id;
    option.textContent = t(`settings.drawing_keys.set.${insieme.id}` as Key);
    select.append(option);
  }
  if (personalizzato) {
    const option = document.createElement("option");
    option.value = "custom";
    option.disabled = true;
    option.textContent = t("settings.drawing_keys.set.custom");
    select.append(option);
  }
  select.value = personalizzato ? "custom" : (valore.insieme ?? "serie");
  select.disabled = !scrivibile;
  select.addEventListener("change", () => {
    const scelto = select.value as "serie" | "classico";
    void (async () => {
      if (personalizzato) {
        const ok = await confirm(t("settings.drawing_keys.set_confirm", { set: t(`settings.drawing_keys.set.${scelto}` as Key) }), {
          title: t("settings.drawing_keys.set_confirm_title"),
          okLabel: t("settings.drawing_keys.set_confirm_ok"),
          danger: true,
        });
        if (!ok) {
          select.value = "custom";
          return;
        }
      }
      esito = null;
      await salva({ insieme: scelto === "serie" ? null : scelto, tasti: {} });
    })();
  });

  const azioni = document.createElement("div");
  azioni.className = "settings-actions";
  const importa = pulsante("settings-btn", t("settings.drawing_keys.import"), () => scegliFile(valore, salva, noti));
  importa.disabled = !scrivibile;
  const esporta = pulsante("settings-btn", t("settings.drawing_keys.export"), () => void esportaFile(valore));
  esporta.disabled = !esportabile;
  azioni.append(importa, esporta);
  control.append(select, azioni);
  el.append(text, control);
  return el;
}

/// Le parole del perché un file d'insieme non si legge.
function perche(errore: ErroreInsieme, nomeDi: (id: string) => string): string {
  switch (errore.tipo) {
    case "json":
      return t("settings.drawing_keys.error.json");
    case "formato":
      return t("settings.drawing_keys.error.formato");
    case "grande":
      return t("settings.drawing_keys.error.grande");
    case "versione":
      return t("settings.drawing_keys.error.versione", { version: errore.versione });
    case "tasto":
      return t("settings.drawing_keys.error.tasto", { key: errore.tasto, command: nomeDi(errore.comando) });
  }
}

/// «Importa un insieme…»: la finestra dei file, poi il file letto. Un file
/// rotto lo dice, e non cambia niente.
function scegliFile(valore: TastiUtente, salva: (nuovo: TastiUtente) => Promise<void>, noti: ReadonlySet<string>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      if (file !== undefined) void importaFile(file, valore, salva, noti);
    },
    { once: true },
  );
  input.click();
}

/// Legge e applica il file `file` (esportata per i test).
export async function importaFile(
  file: Blob,
  valore: TastiUtente,
  salva: (nuovo: TastiUtente) => Promise<void>,
  noti: ReadonlySet<string>,
): Promise<void> {
  const completo = await caricaModulo();
  const tu = completo.tastiUtente;
  const nomi = new Map<string, string>();
  try {
    const lingua = resolvedLanguage() === "en" ? "en" : "it";
    for (const voce of (await completo.indiceDeiComandi()).voci) nomi.set(voce.id, voce.etichetta[lingua]);
  } catch {
    // Senza i nomi, l'errore dice l'id del comando.
  }
  const fallito = (reason: string) => {
    esito = { testo: t("settings.drawing_keys.import_failed", { reason }), errore: true };
    notify(esito.testo, "guasto");
  };
  let contenuto: string;
  try {
    if (file.size > tu.MISURA_MASSIMA_INSIEME) {
      fallito(t("settings.drawing_keys.error.grande"));
      return;
    }
    contenuto = await file.text();
  } catch (error) {
    fallito(t("settings.drawing_keys.error.read", { reason: errorText(error) }));
    return;
  }
  const letto = tu.importaInsieme(contenuto, noti);
  if ("errore" in letto) {
    fallito(perche(letto.errore, (id) => nomi.get(id) ?? id));
    return;
  }
  if (Object.keys(valore.tasti).length > 0) {
    const ok = await confirm(t("settings.drawing_keys.import_confirm"), {
      title: t("settings.drawing_keys.import_confirm_title"),
      okLabel: t("settings.drawing_keys.import_confirm_ok"),
      danger: true,
    });
    if (!ok) return;
  }
  const count = Object.keys(letto.ok.valore.tasti).length;
  esito = {
    testo:
      letto.ok.ignorati > 0
        ? t("settings.drawing_keys.imported_skipped", { count, skipped: letto.ok.ignorati })
        : t("settings.drawing_keys.imported", { count }),
    errore: false,
  };
  await salva(letto.ok.valore);
}

/// «Esporta l'insieme…»: la finestra di salvataggio dell'host.
async function esportaFile(valore: TastiUtente): Promise<void> {
  try {
    const completo = await caricaModulo();
    const bytes = Array.from(new TextEncoder().encode(completo.tastiUtente.esportaInsieme(valore)));
    const fatto = await api.saveArtifact(t("settings.drawing_keys.file_name"), "application/json", bytes);
    if (fatto.status !== "saved") return;
    esito = { testo: t("settings.drawing_keys.exported", { path: fatto.path }), errore: false };
    notify(esito.testo);
  } catch (error) {
    esito = { testo: t("settings.drawing_keys.export_failed", { reason: errorText(error) }), errore: true };
    notify(esito.testo, "guasto");
  }
}

/// La riga di un comando: il nome, il percorso, il tasto, cosa lo copre.
function rigaComando(
  voce: VoceIndice,
  cambiato: boolean,
  valore: TastiUtente,
  regola: RegolaTasti,
  scrivibile: boolean,
  completo: ModuloCompleto,
  nomeDi: ReadonlyMap<string, string>,
  chiamate: ReadonlyArray<{ readonly id: string; readonly tasto: string | null }>,
  salva: (nuovo: TastiUtente) => Promise<void>,
): HTMLElement {
  const tu = completo.tastiUtente;
  const lingua = resolvedLanguage() === "en" ? "en" : "it";
  const nome = voce.etichetta[lingua];
  const diSerie = completo.tastoFub(voce.tasto);
  const scritto = cambiato ? (valore.tasti[voce.id] ?? null) : diSerie;
  const el = document.createElement("div");
  el.className = "setting-row";
  el.dataset.settingKey = `${DRAW_KEYS_SETTING}:${voce.id}`;
  if (cambiato) el.dataset.modified = "true";
  const percorso = completo.percorsoPosto(voce.posto);
  el.dataset.search = [voce.id, voce.etichetta.it, voce.etichetta.en, percorso, scritto ?? ""].join(" ").toLowerCase();
  const id = `setting-draw-keys-${voce.id.replace(/[^a-z0-9_-]/gi, "-")}`;

  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.id = `${id}-label`;
  label.textContent = nome;
  text.append(label);
  const described: string[] = [];
  if (percorso !== "") {
    const desc = testo("muted setting-description", percorso);
    desc.id = `${id}-desc`;
    described.push(desc.id);
    text.append(desc);
  }
  if (cambiato) {
    const meta = document.createElement("div");
    meta.className = "setting-meta";
    const piattaforma = keyboardPlatform(navigator.platform);
    meta.append(
      testo("setting-default", t("settings.default", { value: diSerie === null ? t("settings.drawing_keys.none") : displayBinding(diSerie, piattaforma) })),
    );
    const azzera = pulsante("link-button setting-reset", t("settings.reset"), () => {
      esito = null;
      void salva(tu.ripristinaTasto(valore, voce.id));
    });
    azzera.disabled = !scrivibile;
    meta.append(azzera);
    text.append(meta);
  }
  const diagnosi = testo("setting-source setting-diagnostic", "");
  diagnosi.setAttribute("role", "status");
  diagnosi.id = `${id}-issue`;
  described.push(diagnosi.id);
  text.append(diagnosi);

  const control = document.createElement("div");
  control.className = "setting-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.value = scritto ?? "";
  input.placeholder = t("settings.drawing_keys.none");
  input.disabled = !scrivibile;
  input.setAttribute("aria-describedby", described.join(" "));
  control.append(input);
  el.append(text, control);

  /// Cosa dice la riga col tasto scritto nel campo (forma della shell, vuoto:
  /// nessun tasto), mentre lo si scrive e prima di salvarlo.
  const aggiorna = (): void => {
    const proposto = input.value.trim();
    const valido = proposto === "" || tu.tastoMotore(proposto) !== null;
    let problema: string;
    if (!valido) {
      problema = t("settings.shortcut.invalid_unsaved", { reason: t("settings.shortcut.invalid_chord") });
    } else if (proposto === (scritto ?? "")) {
      problema = diagnosiDi(voce.id, regola, nomeDi);
    } else {
      const nuovo = tu.assegnaTasto(valore, voce.id, proposto === "" ? null : proposto);
      problema = diagnosiDi(voce.id, completo.risolviTasti(chiamate, nuovo.tasti, piattaformaTasti()), nomeDi);
    }
    diagnosi.textContent = problema;
    el.toggleAttribute("data-issue", problema !== "");
    if (valido) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  };
  input.addEventListener("input", aggiorna);
  input.addEventListener("change", () => {
    const proposto = input.value.trim();
    if (proposto === (scritto ?? "")) return;
    if (proposto !== "" && tu.tastoMotore(proposto) === null) {
      aggiorna();
      return;
    }
    esito = null;
    void salva(tu.assegnaTasto(valore, voce.id, proposto === "" ? null : proposto));
  });
  aggiorna();
  return el;
}

/// La piattaforma dei tasti, come la chiede la regola del Completo.
const piattaformaTasti = (): "mac" | "other" => (keyboardPlatform(navigator.platform) === "mac" ? "mac" : "other");

/// Cosa dice la riga del comando `id` sotto la regola `regola`.
function diagnosiDi(id: string, regola: RegolaTasti, nomeDi: ReadonlyMap<string, string>): string {
  const piattaforma = keyboardPlatform(navigator.platform);
  const nome = (altro: string) => nomeDi.get(altro) ?? altro;
  const coperto = regola.coperti.find((uno) => uno.comando === id);
  if (coperto) return t("settings.drawing_keys.covered", { chord: displayBinding(coperto.tasto, piattaforma) });
  for (const conflitto of regola.conflitti) {
    const chord = displayBinding(conflitto.tasto, piattaforma);
    if (conflitto.perde.includes(id)) return t("settings.drawing_keys.lost", { chord, command: nome(conflitto.vince) });
    if (conflitto.vince === id) return t("settings.drawing_keys.wins", { chord, commands: conflitto.perde.map(nome).join(", ") });
  }
  return "";
}
