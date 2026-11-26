// La sezione «Motore del disegno» di Impostazioni › Disegni (piano K6, T11): le
// preferenze del motore del Disegno completo, che l'host tiene in
// `draw.motore` (`crates/fub-host/src/drawing.rs`).
//
// - **Pigra.** Qui c'è solo il riquadro chiuso. Il corpo
//   (`settings-motore-corpo.ts`, con le parole generate e i campi di
//   `kit/form.ts`) arriva con un `import()` solo quando lo si apre.
// - **Solo con il Completo acceso.** Le preferenze sono sue: con il Disegno
//   completo spento nel vault (la mappa dei componenti dell'host,
//   `state/components.ts`) il riquadro non c'è.
// - **Il motore dice l'elenco.** Il corpo apre nel motore un disegno vuoto
//   suo, chiede `prefs.list`, e ogni campo cambiato è un `prefs.set` su quel
//   disegno: l'host salva `draw.motore` dopo il comando, come per un disegno
//   aperto. «Ripristina» è `prefs.reset` della categoria. Il disegno vuoto si
//   chiude quando il riquadro si ridisegna o le Impostazioni si chiudono.

import type { SettingEntry } from "../host/contract";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { components } from "../state/components";
import { openLifetime, type Lifetime } from "../ui/lifetime";

type Corpo = typeof import("./settings-motore-corpo");

/// La chiave dell'impostazione (`fub_features::DRAW_ENGINE_PREFS_KEY`).
export const DRAW_ENGINE_SETTING = "draw.motore";

/// Il componente a cui le preferenze appartengono
/// (`fub_host::componenti::DISEGNO_COMPLETO`).
export const DRAWING_COMPLETE_COMPONENT = "fub.disegno-completo";

/// Ciò che la sezione chiede alle Impostazioni.
export interface DipendenzeMotore {
  /// Il vault aperto: il disegno vuoto vive lì.
  readonly vault: string;
  /// La vita del riquadro disegnato: chiude il disegno vuoto e i campi. Le
  /// Impostazioni danno la loro; ogni disegno del riquadro ne apre una figlia.
  readonly vita: Lifetime;
  /// Ridisegna la scheda (dopo che il riquadro si apre, o per riprovare).
  readonly ridisegna: () => void;
}

/// Il corpo, una `import()` sola finché riesce.
let corpo: Promise<Corpo> | null = null;
/// Il corpo arrivato, per chiuderne il disegno vuoto senza caricarlo.
let caricato: Corpo | null = null;
/// Il riquadro aperto, attraverso i ridisegni della scheda.
let aperta = false;
/// La vita dell'ultimo disegno del riquadro: il prossimo la chiude.
let vitaRiquadro: Lifetime | null = null;

/// Le categorie aperte, attraverso i ridisegni della scheda.
export const categorieAperte = new Set<string>();

function caricaCorpo(): Promise<Corpo> {
  if (corpo !== null) return corpo;
  const questo = import("./settings-motore-corpo");
  corpo = questo;
  questo.then(
    (modulo) => {
      caricato = modulo;
    },
    () => {
      if (corpo === questo) corpo = null;
    },
  );
  return questo;
}

/// Il riquadro chiuso e dimenticato, con il suo disegno vuoto: le Impostazioni
/// che si chiudono, i test.
export function dimenticaMotore(): void {
  aperta = false;
  categorieAperte.clear();
  vitaRiquadro?.close();
  vitaRiquadro = null;
  void caricato?.chiudiMotore();
}

/// Se la sezione c'è: il vault aperto e il Disegno completo acceso.
export function motoreVisibile(vault: string | null | undefined): vault is string {
  if (!vault) return false;
  const stato = components();
  return stato !== null && stato.on(DRAWING_COMPLETE_COMPONENT);
}

const nota = (className: string, contenuto: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = contenuto;
  return el;
};

/// Mette in `dove` il riquadro «Motore del disegno»; aperto, ne carica il corpo.
export async function riempiMotore(dove: HTMLElement, entry: SettingEntry, fuori: DipendenzeMotore): Promise<void> {
  vitaRiquadro?.close();
  const vita = openLifetime();
  vitaRiquadro = vita;
  fuori.vita.add(() => vita.close());
  const dip: DipendenzeMotore = { ...fuori, vita };
  const details = document.createElement("details");
  details.className = "settings-details";
  details.dataset.detailsKey = "drawing-engine";
  details.open = aperta;
  const summary = document.createElement("summary");
  summary.textContent = t("settings.drawing_engine.open");
  const dentro = document.createElement("div");
  dentro.className = "settings-details-body";
  details.append(summary, dentro);
  dove.append(details);
  details.addEventListener("toggle", () => {
    if (details.open === aperta) return;
    aperta = details.open;
    if (!aperta) return;
    dentro.replaceChildren(nota("muted settings-note", t("settings.drawing_engine.loading")));
    dip.ridisegna();
  });
  if (!aperta) return;
  dentro.append(nota("muted settings-note", t("settings.drawing_engine.loading")));
  let modulo: Corpo;
  try {
    modulo = await caricaCorpo();
  } catch (error) {
    if (!vita.closed) mostraErrore(dentro, errorText(error), dip);
    return;
  }
  if (vita.closed) return;
  await modulo.disegnaMotore(dentro, entry, dip);
}

/// Il corpo che non arriva: il perché e «Riprova».
export function mostraErrore(dentro: HTMLElement, reason: string, dip: DipendenzeMotore): void {
  const riga = nota("setting-source setting-error", t("settings.drawing_engine.load_failed", { reason }));
  riga.setAttribute("role", "alert");
  const riprova = document.createElement("button");
  riprova.type = "button";
  riprova.className = "settings-btn";
  riprova.textContent = t("settings.drawing_engine.retry");
  riprova.addEventListener("click", () => dip.ridisegna());
  dentro.replaceChildren(riga, riprova);
}
