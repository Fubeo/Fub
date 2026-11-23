// La guida dei colori (K6 T14, guida): la sezione «Guida colori» del Design, con id `color_guide`. Le
// armonie del colore del lato attivo, lette dal motore (`color.harmony`): una riga per colore della
// guida, con i suoi passi e il colore di partenza al centro. Un clic dà il colore al lato attivo sugli
// oggetti scelti (`paint.setFill` o `paint.setStroke`). Senza scelta la guida parte dal colore attivo
// del motore (`paint.proxies`) e i clic sono spenti. Opzioni e Limite sono le finestre di
// `guida-colori-finestre.ts`; le loro scelte stanno nella pagina, non nel file.
import { textButton } from "../../../kit/button";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import type { EseguiColore, LatoAttivo } from "./colore-sezione";
import { chiama, type DipendenzeComando } from "./esegui";
import {
  apriLimiteGuida,
  apriOpzioniGuida,
  campioniDelDocumento,
  GUIDA_DI_SERIE,
  LIMITE_DOCUMENTO,
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

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

/// La guida da una lettura `color.harmony` (`{colors, grid}`); `null` se non ha quella forma.
export function guidaDaLettura(lettura: unknown): GuidaLetta | null {
  if (!isRecord(lettura)) return null;
  const { colors, grid } = lettura;
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

/// Il colore esadecimale di una vernice piena di `paint.proxies` (`{type: "solid", color: {model:
/// "rgb", r, g, b}}`, con i canali da 0 a 1). `null` per una sfumatura, un motivo o niente: la guida
/// non ha un colore di partenza da dare.
export function hexDellaVernice(vernice: unknown): string | null {
  if (!isRecord(vernice) || vernice.type !== "solid" || !isRecord(vernice.color) || vernice.color.model !== "rgb") return null;
  const canali = [vernice.color.r, vernice.color.g, vernice.color.b];
  if (!canali.every((canale): canale is number => typeof canale === "number" && canale >= 0 && canale <= 1)) return null;
  return `#${canali.map((canale) => Math.round(canale * 255).toString(16).padStart(2, "0")).join("")}`;
}

/// I parametri di `color.harmony`: il colore di partenza e le scelte della guida (e il limite, se c'è).
function parametri(base: string, guida: StatoGuida): Record<string, unknown> {
  return {
    color: base,
    rule: guida.regola,
    steps: guida.passi,
    variation: guida.variazione,
    amount: guida.ampiezza,
    ...(guida.limite === null ? {} : { limitTo: guida.limite }),
  };
}

/// Ciò che la sezione mostra: una lettura in corso, la guida, o perché non c'è.
type Stato =
  | { readonly tipo: "caricamento" }
  | { readonly tipo: "senzaMotore" }
  | { readonly tipo: "senzaColore" }
  | { readonly tipo: "senzaCampioni" }
  | { readonly tipo: "errore" }
  | { readonly tipo: "pronta"; readonly letta: GuidaLetta };

/// La sezione «Guida colori». `dipendenze` è una funzione: la sezione si registra prima del percorso
/// dei comandi, e lo legge quando serve.
export function sezioneGuidaColori(
  esegui: EseguiColore,
  dipendenze: () => DipendenzeComando,
  vita: Lifetime,
  lato: LatoAttivo,
): Sezione {
  // Le scelte stanno qui: vivono per la pagina aperta, non vanno sul disco né nel file.
  let guida: StatoGuida = GUIDA_DI_SERIE;
  let stato: Stato = { tipo: "caricamento" };
  let chiave = "";
  // Ogni lettura ha il suo numero: un esito di una lettura superata non sovrascrive quella nuova.
  let versione = 0;
  let ultimo: ContestoSezione | null = null;
  let senzaScelta = false;

  const nota = (testo: string): HTMLElement => {
    const paragrafo = document.createElement("p");
    paragrafo.className = "draw-guide-note";
    paragrafo.textContent = testo;
    return paragrafo;
  };

  const griglia = (guidaLetta: GuidaLetta, abilitati: boolean): HTMLElement => {
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
        campione.disabled = !abilitati;
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
      onPress: () => cambiaStato(apriLimiteGuida(guida, vita, dipendenze())),
    });
    riga.append(nome, opzioni, limite);
    return riga;
  };

  /// Disegna il corpo dallo stato attuale: non legge niente, così non può rilanciare una lettura.
  const disegnaCorpo = (): void => {
    if (ultimo === null) return;
    const corpo = ultimo.corpo;
    corpo.replaceChildren(intestazione());
    if (stato.tipo === "senzaMotore") {
      corpo.append(nota(t("draw.guida.nessun.disegno")));
      return;
    }
    if (senzaScelta) corpo.append(nota(t("draw.guida.scegli.oggetto")));
    switch (stato.tipo) {
      case "caricamento":
        corpo.append(nota(t("draw.guida.caricamento")));
        break;
      case "senzaColore":
        corpo.append(nota(t("draw.guida.senza.colore")));
        break;
      case "senzaCampioni":
        corpo.append(nota(t("draw.guida.limite.senza.campioni")));
        break;
      case "errore":
        corpo.append(nota(t("draw.guida.errore")));
        break;
      case "pronta":
        corpo.append(griglia(stato.letta, !senzaScelta));
        break;
      default:
        break;
    }
  };

  /// Legge il colore di partenza (dalla scelta, o il colore attivo senza scelta), il limite e la guida.
  const leggi = async (deps: DipendenzeComando, base: string | null, questa: number): Promise<void> => {
    let colore = base;
    if (senzaScelta) {
      const esito = await chiama(deps, "disegno.paint.proxies", {}, false).catch(() => null);
      if (questa !== versione) return;
      const lettura = esito === null || esito.refused !== null ? null : esito.reading;
      colore = isRecord(lettura) ? hexDellaVernice(lettura[lato.lato]) : null;
    }
    if (colore === null) {
      stato = { tipo: "senzaColore" };
      disegnaCorpo();
      return;
    }
    if (guida.limite === LIMITE_DOCUMENTO) {
      const campioni = await campioniDelDocumento(deps);
      if (questa !== versione) return;
      if (campioni === false) {
        stato = { tipo: "senzaCampioni" };
        disegnaCorpo();
        return;
      }
      if (campioni === null) {
        stato = { tipo: "errore" };
        disegnaCorpo();
        return;
      }
    }
    const esito = await chiama(deps, "disegno.color.harmony", parametri(colore, guida), false).catch(() => null);
    if (questa !== versione) return;
    const letta = esito === null || esito.refused !== null ? null : guidaDaLettura(esito.reading);
    stato = letta === null ? { tipo: "errore" } : { tipo: "pronta", letta };
    disegnaCorpo();
  };

  const cambiaStato = (promessa: Promise<StatoGuida | null>): void => {
    void promessa.then((nuova) => {
      if (nuova === null) return;
      guida = nuova;
      if (ultimo !== null) disegna(ultimo);
    });
  };

  const disegna = (ctx: ContestoSezione): void => {
    ultimo = ctx;
    const deps = dipendenze();
    senzaScelta = deps.selezione().length === 0;
    if (deps.motore === null) {
      stato = { tipo: "senzaMotore" };
      chiave = "";
      disegnaCorpo();
      return;
    }
    const valore = ctx.colori[lato.lato === "fill" ? "riempimento" : "contorno"]?.valore;
    const base = senzaScelta || valore === null || valore === undefined ? null : normalizzaHex(valore);
    const chiaveNuova = [senzaScelta ? "attivo" : (base ?? "nessuno"), lato.lato, guida.regola, guida.passi, guida.variazione, guida.ampiezza, guida.limite ?? ""].join("|");
    // Con il limite ai campioni si ricontrolla a ogni giro: un campione aggiunto sblocca la guida.
    if (chiaveNuova !== chiave || stato.tipo === "senzaCampioni") {
      chiave = chiaveNuova;
      stato = { tipo: "caricamento" };
      void leggi(deps, base, ++versione);
    }
    disegnaCorpo();
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
