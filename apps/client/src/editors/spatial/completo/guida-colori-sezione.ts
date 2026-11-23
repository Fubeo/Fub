// La guida dei colori (K6 T14, giro 3): la sezione «Guida colori» del Design, con id `color_guide`.
// Le armonie del colore del lato attivo, lette dal motore (`color.harmony`): una riga per colore
// della guida, con i suoi passi, e il colore di partenza al centro. Un clic dà il colore al lato
// attivo (`paint.setFill` o `paint.setStroke`). Opzioni e Limita sono le finestre di
// `guida-colori-finestre.ts`; le scelte non vanno sul disco.
import { textButton } from "../../../kit/button";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import type { EseguiColore, LatoAttivo } from "./colore-sezione";
import { chiama, type DipendenzeComando } from "./esegui";
import {
  apriLimiteGuida,
  apriOpzioniGuida,
  GUIDA_DI_SERIE,
  nomeRegola,
  type StatoGuida,
} from "./guida-colori-finestre";
import { normalizzaHex } from "./ricolora-modello";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// La guida letta: i colori (il base per primo) e, per ciascuno, i suoi passi in esadecimale.
export interface GuidaLetta {
  readonly colori: readonly string[];
  readonly griglia: readonly (readonly string[])[];
}

/// La guida da una lettura `color.harmony` (`{colors, grid}`); `null` se non ha quella forma.
export function guidaDaLettura(lettura: unknown): GuidaLetta | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const { colors, grid } = lettura as { colors?: unknown; grid?: unknown };
  if (!Array.isArray(colors) || !Array.isArray(grid) || colors.length !== grid.length) return null;
  const colori: string[] = [];
  const griglia: string[][] = [];
  for (const [indice, colore] of colors.entries()) {
    const hex = typeof colore === "string" ? normalizzaHex(colore) : null;
    const riga: unknown = grid[indice];
    if (hex === null || !Array.isArray(riga)) return null;
    const celle = riga.map((cella: unknown) => (typeof cella === "string" ? normalizzaHex(cella) : null));
    if (celle.some((cella) => cella === null)) return null;
    colori.push(hex);
    griglia.push(celle as string[]);
  }
  return { colori, griglia };
}

/// I parametri di `color.harmony`: il colore base e le scelte della guida.
function parametri(base: string, guida: StatoGuida): Record<string, unknown> {
  return {
    color: base,
    rule: guida.regola,
    steps: guida.passi,
    variation: guida.variazione,
    amount: guida.ampiezza,
    ...(guida.documento ? { limitTo: "document" } : {}),
  };
}

/// La sezione «Guida colori». `dipendenze` è una funzione: la sezione si registra prima del
/// percorso dei comandi, e lo legge quando serve.
export function sezioneGuidaColori(
  esegui: EseguiColore,
  dipendenze: () => DipendenzeComando,
  vita: Lifetime,
  lato: LatoAttivo,
): Sezione {
  let guida: StatoGuida = GUIDA_DI_SERIE;
  let chiaveLetta = "";
  let attesa = false;
  let letta: GuidaLetta | null = null;
  // Un esito di una chiave vecchia non sovrascrive quella nuova: conta solo l'ultima lettura.
  let versione = 0;
  let ultimo: ContestoSezione | null = null;

  const nota = (testo: string): HTMLElement => {
    const paragrafo = document.createElement("p");
    paragrafo.className = "draw-guide-note";
    paragrafo.textContent = testo;
    return paragrafo;
  };

  const griglia = (guidaLetta: GuidaLetta): HTMLElement => {
    const contenitore = document.createElement("div");
    contenitore.className = "draw-guide-grid";
    guidaLetta.colori.forEach((_colore, indice) => {
      const riga = document.createElement("div");
      riga.className = "draw-guide-row";
      const passi = guidaLetta.griglia[indice] ?? [];
      passi.forEach((hex, passo) => {
        const campione = document.createElement("button");
        campione.type = "button";
        campione.className = "draw-guide-swatch";
        // Il colore di partenza sta al centro della riga: ha il suo bordo.
        if (passo === Math.floor(passi.length / 2)) campione.dataset.base = "";
        campione.style.backgroundColor = hex;
        campione.title = hex;
        campione.setAttribute("aria-label", hex);
        campione.addEventListener("click", () => {
          esegui(lato.lato === "fill" ? "paint.setFill" : "paint.setStroke", { color: hex });
        });
        riga.append(campione);
      });
      contenitore.append(riga);
    });
    return contenitore;
  };

  const intestazione = (): HTMLElement => {
    const riga = document.createElement("div");
    riga.className = "draw-guide-head";
    const nome = document.createElement("span");
    nome.className = "draw-guide-rule-name";
    nome.textContent = nomeRegola(guida.regola);
    const opzioni = textButton({
      label: t("draw.guida.opzioni"),
      lifetime: vita,
      onPress: () => cambiaStato(apriOpzioniGuida(guida, vita)),
    });
    const limite = textButton({
      label: `${t("draw.guida.limite.titolo")}…`,
      lifetime: vita,
      onPress: () => cambiaStato(apriLimiteGuida(guida, vita)),
    });
    riga.append(nome, opzioni, limite);
    return riga;
  };

  const cambiaStato = (promessa: Promise<StatoGuida | null>): void => {
    void promessa.then((nuova) => {
      if (nuova === null) return;
      guida = nuova;
      if (ultimo !== null) disegna(ultimo);
    });
  };

  /// Legge la guida se la chiave (colore, scelte) è cambiata; altrimenti la lascia com'è.
  const leggi = (base: string, deps: DipendenzeComando): void => {
    const chiave = `${base}|${guida.regola}|${guida.passi}|${guida.variazione}|${guida.ampiezza}|${guida.documento}`;
    if (chiave === chiaveLetta) return;
    chiaveLetta = chiave;
    letta = null;
    attesa = true;
    const questa = ++versione;
    void chiama(deps, "disegno.color.harmony", parametri(base, guida), false)
      .catch(() => null)
      .then((esito) => {
        if (questa !== versione) return;
        attesa = false;
        letta = esito === null || esito.refused !== null ? null : guidaDaLettura(esito.reading);
        if (ultimo !== null) disegna(ultimo);
      });
  };

  const disegna = (ctx: ContestoSezione): void => {
    ultimo = ctx;
    const corpo = ctx.corpo;
    corpo.replaceChildren(intestazione());
    const deps = dipendenze();
    if (deps.motore === null) {
      corpo.append(nota(t("draw.guida.nessun.disegno")));
      return;
    }
    const colore = ctx.colori[lato.lato === "fill" ? "riempimento" : "contorno"]?.valore ?? null;
    const base = colore === null ? null : normalizzaHex(colore);
    if (base === null) {
      corpo.append(nota(t("draw.guida.senza.colore")));
      return;
    }
    leggi(base, deps);
    if (attesa) {
      corpo.append(nota(t("draw.guida.caricamento")));
    } else if (letta === null) {
      corpo.append(nota(t("draw.guida.errore")));
    } else {
      corpo.append(griglia(letta));
    }
  };

  return {
    id: "color_guide",
    scheda: "design",
    titolo: t("draw.guida.titolo"),
    disegna,
  };
}

/// Registra la sezione «Guida colori» nel Completo aperto. `false` se c'è già.
export function registraGuidaColori(
  sezioni: Sezioni,
  esegui: EseguiColore,
  dipendenze: () => DipendenzeComando,
  vita: Lifetime,
  lato: LatoAttivo,
): boolean {
  return registraSezione({ sezioni }, sezioneGuidaColori(esegui, dipendenze, vita, lato));
}
