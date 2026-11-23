// La finestra «Librerie di campioni» del Disegno completo (K6 T14, giro «finestra»; righe
// `window.swatchLibrary`, `swatch.library.list`, `get` e `add`). Elenca le librerie di base del motore,
// mostra i campioni di quella scelta, e Aggiungi copia nel disegno tutti i campioni o solo quelli
// spuntati (`disegno.swatch.library.add`, con la regola di Fub: campioni globali e senza gruppo).
//
// - **Porta.** `creaPortaLibrerie` manda i tre comandi al motore col prefisso `disegno.`, con
//   `chiama` del Completo (il motore pronto, la sessione aperta). Un esito di `add` che il motore
//   rifiuta dà il perché in italiano; uno riuscito passa da `applicaEsito`, il passo di Annulla.
// - **Finestra.** Il dialogo del kit: una scelta di libreria, i campioni con la casella, due azioni di
//   aggiunta e Annulla. Una libreria con sfumature non si aggiunge, e lo dice prima di mandare niente
//   (il formato ha solo colori pieni). Un elenco o una libreria che non arrivano lo dicono, e la finestra
//   resta usabile.
// - **Risposte vecchie.** Ogni scelta di libreria ha un numero: la risposta di una libreria scelta prima
//   non entra se ne è scelta un'altra (CLAUDE.md: un risultato vecchio non vince sullo stato nuovo).
// - **Chiusura.** Annulla, Esc e il fondo chiudono senza mandare niente; la finestra ha la sua vita, che
//   si chiude con lei e con il Completo (nessun ascoltatore resta).

import { openDialog } from "../../../kit/dialog";
import { formBody, formCheck, formError, formNote } from "../../../kit/form";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import { applicaEsito, chiama, chiamaConArgomenti, type DipendenzeComando } from "./esegui";
import { motivoDelRifiuto } from "../motore/rifiuto";

/// Una libreria dell'elenco (`swatch.library.list`).
export interface LibreriaVoce {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly count: number;
}

/// Un campione di una libreria (`swatch.library.get`): il colore pieno, o la sua specie se non lo è.
export interface CampioneVoce {
  readonly name: string;
  readonly kind: string;
  readonly hex: string | null;
}

/// Il motore visto dalla finestra. `null` se il motore non risponde o la risposta non si legge.
export interface PortaLibrerie {
  elenco(): Promise<readonly LibreriaVoce[] | null>;
  campioni(id: string): Promise<readonly CampioneVoce[] | null>;
  /// Aggiunge i campioni di `id` (tutti se `nomi` è `null`). `rifiuto` col perché già a parole (la frase
  /// del motore se non ne prende gli argomenti), o `null`.
  aggiungi(id: string, nomi: readonly string[] | null): Promise<{ readonly rifiuto: string | null } | null>;
}

/// Le librerie dalla lettura di `swatch.library.list`; `null` se non si legge.
function librerieDi(lettura: unknown): readonly LibreriaVoce[] | null {
  const libreria = (lettura as { libraries?: unknown } | null | undefined)?.libraries;
  if (!Array.isArray(libreria)) return null;
  return libreria.flatMap((voce: Record<string, unknown>) =>
    typeof voce.id === "string" && typeof voce.name === "string" && typeof voce.category === "string" && typeof voce.count === "number"
      ? [{ id: voce.id, name: voce.name, category: voce.category, count: voce.count }]
      : [],
  );
}

/// I campioni dalla lettura di `swatch.library.get`; `null` se non si legge.
function campioniDi(lettura: unknown): readonly CampioneVoce[] | null {
  const campioni = (lettura as { swatches?: unknown } | null | undefined)?.swatches;
  if (!Array.isArray(campioni)) return null;
  return campioni.flatMap((voce: Record<string, unknown>) =>
    typeof voce.name === "string" && typeof voce.kind === "string"
      ? [{ name: voce.name, kind: voce.kind, hex: typeof voce.hex === "string" ? voce.hex : null }]
      : [],
  );
}

/// La porta della finestra sul motore del Completo aperto. `etichetta` è il passo di Annulla di Aggiungi.
export function creaPortaLibrerie(dipendenze: DipendenzeComando, etichetta: string): PortaLibrerie {
  return {
    async elenco() {
      const esito = await chiama(dipendenze, "disegno.swatch.library.list", {}, false);
      if (esito === null || esito.refused !== null) return null;
      return librerieDi(esito.reading);
    },
    async campioni(id) {
      const esito = await chiama(dipendenze, "disegno.swatch.library.get", { library: id }, false);
      if (esito === null || esito.refused !== null) return null;
      return campioniDi(esito.reading);
    },
    async aggiungi(id, nomi) {
      const valore = nomi === null ? { library: id } : { library: id, names: [...nomi] };
      const esito = await chiamaConArgomenti(dipendenze, "disegno.swatch.library.add", valore, false);
      if (esito === null) return null;
      if ("kind" in esito) return { rifiuto: esito.message };
      if (esito.refused !== null) return { rifiuto: t(motivoDelRifiuto(esito.refused) ?? "draw.libraries.add_failed") };
      return applicaEsito(esito, etichetta, dipendenze) ? { rifiuto: null } : { rifiuto: t("draw.libraries.add_failed") };
    },
  };
}

/// Apre la finestra. `vita` è quella del Completo: chiuso il disegno, la finestra si chiude da sola.
export function apriFinestraLibrerie(porta: PortaLibrerie, vita: Lifetime): void {
  const own = openLifetime();
  vita.add(() => own.close());

  let libreria: string | null = null;
  let campioni: readonly CampioneVoce[] = [];
  let scelte = new Set<string>();
  let generazione = 0;
  let occupato = false;

  const scelta = document.createElement("select");
  scelta.className = "kit-form-select draw-libraries-choice";
  scelta.setAttribute("aria-label", t("draw.libraries.library"));
  const elenco = document.createElement("div");
  elenco.className = "draw-libraries-list";
  elenco.setAttribute("role", "group");
  elenco.setAttribute("aria-label", t("draw.libraries.swatches"));
  const segnaposto = document.createElement("option");
  segnaposto.value = "";
  segnaposto.textContent = t("draw.libraries.choose");
  scelta.append(segnaposto);
  const info = formNote("", true);
  const errore = formError("");
  errore.hidden = true;

  const dialogo = document.createElement("div");
  dialogo.className = "draw-libraries-body";
  dialogo.append(scelta, info, elenco, errore);

  const dire = (testo: string): void => {
    info.textContent = testo;
    info.hidden = testo === "";
  };
  const dimmi = (testo: string | null): void => {
    errore.textContent = testo ?? "";
    errore.hidden = testo === null;
  };

  /// I pulsanti di aggiunta dicono se valgono: una libreria con sfumature o senza campioni, o nessuna
  /// casella spuntata, sono spenti, e mentre un'aggiunta gira anche.
  const aggiornaAzioni = (): void => {
    const sfumature = campioni.some((c) => c.kind !== "color");
    const nulla = libreria === null || campioni.length === 0 || sfumature || occupato;
    const tasto = (azione: string): HTMLButtonElement | null => finestra.element.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`);
    const tutti = tasto("all");
    const scelti = tasto("selected");
    if (tutti !== null) tutti.disabled = nulla;
    if (scelti !== null) scelti.disabled = nulla || scelte.size === 0;
    if (sfumature && libreria !== null) dimmi(t("draw.libraries.gradients"));
  };

  const mostraCampioni = (): void => {
    elenco.replaceChildren();
    scelte = new Set();
    for (const campione of campioni) {
      const casella = formCheck({
        label: campione.hex === null ? campione.name : `${campione.name} ${campione.hex}`,
        checked: false,
        onChange: (on) => {
          if (on) scelte.add(campione.name);
          else scelte.delete(campione.name);
          aggiornaAzioni();
        },
        lifetime: own,
      });
      elenco.append(casella.element);
    }
  };

  /// Una libreria scelta: il suo numero di richiesta, e la risposta che non è più l'ultima si butta.
  const caricaLibreria = async (id: string): Promise<void> => {
    const mia = ++generazione;
    libreria = id;
    campioni = [];
    mostraCampioni();
    dimmi(null);
    dire(t("draw.libraries.loading"));
    aggiornaAzioni();
    const letti = await porta.campioni(id);
    if (own.closed || mia !== generazione) return;
    if (letti === null) {
      campioni = [];
      dire("");
      dimmi(t("draw.libraries.get_failed"));
    } else {
      campioni = letti;
      mostraCampioni();
      dire(letti.length === 0 ? t("draw.libraries.none") : "");
    }
    aggiornaAzioni();
  };

  const onScelta = (): void => {
    dimmi(null);
    if (scelta.value === "") {
      generazione++;
      libreria = null;
      campioni = [];
      mostraCampioni();
      dire("");
      aggiornaAzioni();
      return;
    }
    void caricaLibreria(scelta.value);
  };
  scelta.addEventListener("change", onScelta);
  own.add(() => scelta.removeEventListener("change", onScelta));

  /// Aggiungi: `true` chiude la finestra; `false` la lascia aperta col perché.
  const aggiungi = async (nomi: readonly string[] | null): Promise<boolean> => {
    if (libreria === null) return false;
    occupato = true;
    dimmi(null);
    aggiornaAzioni();
    const esito = await porta.aggiungi(libreria, nomi);
    occupato = false;
    if (own.closed) return false;
    if (esito === null) dimmi(t("draw.libraries.add_failed"));
    else if (esito.rifiuto !== null) dimmi(esito.rifiuto);
    aggiornaAzioni();
    return esito !== null && esito.rifiuto === null;
  };

  const finestra = openDialog<string>({
    title: t("draw.libraries.title"),
    body: formBody([dialogo, formNote(t("draw.libraries.copia"))]),
    actions: [
      { id: "cancel", label: t("draw.resources.swatches.annulla"), value: "annulla" },
      { id: "selected", label: t("draw.libraries.add_selected"), value: "scelti" },
      { id: "all", label: t("draw.libraries.add_all"), kind: "primary", value: "tutti" },
    ],
    dismissValue: "annulla",
    lifetime: own,
    className: "draw-libraries-dialog",
    confirm: (valore) => {
      if (valore === "annulla") return true;
      if (valore === "scelti" && scelte.size === 0) {
        dimmi(t("draw.libraries.add_nothing"));
        return false;
      }
      // Tutti i campioni: nessun elenco di nomi. Scelti: quelli spuntati, nell'ordine della libreria.
      const nomi = valore === "tutti" ? null : campioni.filter((c) => scelte.has(c.name)).map((c) => c.name);
      return aggiungi(nomi);
    },
  });
  void finestra.result.then(() => own.close());

  // Il primo passo: l'elenco. Non arriva: lo si dice, e la scelta resta vuota.
  // Subito: i pulsanti di aggiunta sono spenti finché una libreria non c'è, anche se l'elenco non arriva.
  aggiornaAzioni();
  void porta.elenco().then((librerie) => {
    if (own.closed) return;
    if (librerie === null) {
      dimmi(t("draw.libraries.list_failed"));
      aggiornaAzioni();
      return;
    }
    for (const lib of librerie) {
      const voce = document.createElement("option");
      voce.value = lib.id;
      voce.textContent = `${lib.name} (${lib.count})`;
      scelta.append(voce);
    }
    aggiornaAzioni();
  });
}
