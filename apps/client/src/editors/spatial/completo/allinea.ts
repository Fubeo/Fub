// La sezione «Allinea» dell'ispettore Design (K6 T13, giro 2). Il Completo la mette
// nella scheda Design da sé, senza la famiglia `trasforma`: le sue voci `align.*` sono
// nell'indice generato con il comando del motore e il suo valore, e la sezione aggiunge
// soltanto `to`. La famiglia si carica al primo clic di un suo comando, come gli altri
// comandi pigri (`eseguiVoce` in `esegui.ts`). Acceso o spento lo dice il client, dal
// numero di oggetti scelti: alla selezione servono due oggetti, alla tavola ne basta uno
// per allineare (`needs_two`). Le parole stanno nel catalogo del Completo, così ci sono
// prima che la famiglia arrivi.

import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// Il modo di «Allinea a»: alla selezione, o alla tavola.
export type ModoAllinea = "selection" | "artboard";

/// Quello che la sezione manda: l'id della voce `align.*`, e il `to` del modo scelto.
export type EseguiAllinea = (id: string, valori: Readonly<Record<string, string>>) => void;

/// I gruppi dei pulsanti, con le voci `align.*` che ci stanno.
const GRUPPI: readonly { readonly chiave: DrawKey; readonly ids: readonly string[] }[] = [
  { chiave: "draw.allinea.gruppo.orizzontale", ids: ["align.horizontalLeft", "align.horizontalCenter", "align.horizontalRight"] },
  { chiave: "draw.allinea.gruppo.verticale", ids: ["align.verticalTop", "align.verticalCenter", "align.verticalBottom"] },
  { chiave: "draw.allinea.gruppo.centri", ids: ["align.horizontalVerticalCenter"] },
  {
    chiave: "draw.allinea.gruppo.distribuisciOrizzontale",
    ids: ["align.distributeHorizontalLeft", "align.distributeHorizontalCenter", "align.distributeHorizontalRight", "align.distributeHorizontalSpace"],
  },
  {
    chiave: "draw.allinea.gruppo.distribuisciVerticale",
    ids: ["align.distributeVerticalTop", "align.distributeVerticalCenter", "align.distributeVerticalBottom", "align.distributeVerticalSpace"],
  },
];

/// Quanti oggetti servono: due, salvo «allinea alla tavola» (un oggetto basta per allineare).
export function oggettiMinimi(id: string, modo: ModoAllinea): number {
  return modo === "artboard" && id.startsWith("align.") && !id.startsWith("align.distribute") ? 1 : 2;
}

/// Un pulsante è spento se la selezione è troppo piccola per il suo modo.
export function spento(id: string, modo: ModoAllinea, oggetti: number): boolean {
  return oggetti < oggettiMinimi(id, modo);
}

/// La parola del pulsante di una voce `align.*`: `draw.allinea.<resto dell'id>`.
function parolaDelPulsante(id: string): string {
  return t(`draw.allinea.${id.slice("align.".length)}` as DrawKey);
}

/// La sezione: due modi, poi i gruppi dei pulsanti. Un pulsante acceso manda il comando
/// col `to` del modo scelto; il disegno non cambia da sé.
function disegnaAllinea(contesto: ContestoSezione, esegui: EseguiAllinea, stato: { modo: ModoAllinea }): () => void {
  const corpo = contesto.corpo;
  const bottoni: { readonly id: string; readonly el: HTMLButtonElement }[] = [];
  const modi: { readonly modo: ModoAllinea; readonly el: HTMLButtonElement }[] = [];

  const aggiorna = (): void => {
    for (const { id, el } of bottoni) {
      const off = spento(id, stato.modo, contesto.sel.numero);
      el.disabled = off;
      el.title = off ? t("draw.disabled.needs_two") : parolaDelPulsante(id);
    }
    for (const { modo: m, el } of modi) el.setAttribute("aria-pressed", String(m === stato.modo));
  };

  const riga = document.createElement("div");
  riga.className = "draw-align-to";
  for (const m of ["selection", "artboard"] as const) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "draw-button draw-properties-segment";
    el.textContent = t(m === "selection" ? "draw.allinea.selezione" : "draw.allinea.tavola");
    el.addEventListener("click", () => {
      stato.modo = m;
      aggiorna();
    });
    modi.push({ modo: m, el });
    riga.append(el);
  }
  corpo.append(riga);

  for (const gruppo of GRUPPI) {
    const blocco = document.createElement("div");
    blocco.className = "draw-align-group";
    const titolo = document.createElement("p");
    titolo.textContent = t(gruppo.chiave);
    blocco.append(titolo);
    for (const id of gruppo.ids) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "kit-button";
      el.dataset.id = id;
      el.textContent = parolaDelPulsante(id);
      el.addEventListener("click", () => {
        if (!el.disabled) esegui(id, { to: stato.modo });
      });
      bottoni.push({ id, el });
      blocco.append(el);
    }
    corpo.append(blocco);
  }
  aggiorna();
  return () => corpo.replaceChildren();
}

/// La sezione per la scheda Design, da registrare nel Completo aperto. Non tocca nessuna
/// famiglia: `esegui` è il percorso unico dei comandi, che carica la famiglia al clic.
export function sezioneAllinea(esegui: EseguiAllinea): Sezione {
  // Il modo sta qui e non nel disegno: il pannello rifà la sezione a ogni selezione, e la scelta resta.
  const stato: { modo: ModoAllinea } = { modo: "selection" };
  return {
    id: "allinea",
    scheda: "design",
    titolo: t("draw.allinea.titolo"),
    disegna: (contesto) => disegnaAllinea(contesto, esegui, stato),
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraAllinea(sezioni: Sezioni, esegui: EseguiAllinea): boolean {
  return registraSezione({ sezioni }, sezioneAllinea(esegui));
}
