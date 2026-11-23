// La finestra «Nuovo gruppo colori…» del Disegno completo (K6 T14, gruppi; riga `ui.newColorGroup` della
// mappa): chiede il nome del gruppo e quali campioni di colore pieno ci entrano, con una casella per campione.
// Il motore dà la lista (`swatch.list`); OK manda `swatch.newGroup` una volta sola, in un passo di Annulla.
//
// - **Una finestra del kit, non T6.** Il comando ha due argomenti, il nome e l'elenco dei campioni. L'elenco
//   si sceglie con le caselle, come in «Librerie di campioni»: la finestra T6 manderebbe il comando alla
//   pressione, senza poter dire prima che un gruppo vuoto non va.
// - **Il gruppo vuoto non va al motore.** Il motore lo rifiuta con un errore, e un errore del motore nella
//   sessione del disegno la fa cadere (`motore/sessione.ts`). La finestra dice la frase del motore e resta
//   aperta, senza mandare niente.
// - **Il nome è del motore.** Vuoto diventa «Gruppo colori»; un nome con spazi intorno lo taglia il motore, e
//   un nome già usato diventa «Nome 2». La finestra manda il nome com'è.
// - **Solo i colori pieni.** Il motore mette nel gruppo i campioni di colore pieno: gradienti, motivi e
//   «Nessuno» non si mostrano.
// - **Motore assente.** La lista non arriva: la finestra lo dice, e OK non manda niente.
// - **Vita.** Una finestra per volta; chiusa col Completo o col disegno, con i suoi ascolti.

import { openDialog } from "../../../kit/dialog";
import { formBody, formCheck, formError, formNote, formText } from "../../../kit/form";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { motivoDelRifiuto } from "../motore/rifiuto";
import { t } from "../strings";
import { applicaEsito, chiama, chiamaConArgomenti, type DipendenzeComando } from "./esegui";
import { famigliaColorePronta } from "./selettore-colore";
import type { VoceDelCompleto } from "./sezioni";

/// L'id della voce del client (`chiamata.client` dell'indice) della finestra.
export const VOCE_NUOVO_GRUPPO = "ui.newColorGroup";

/// Un campione di colore pieno, come lo dà `swatch.list`.
export interface CampioneDelGruppo {
  readonly name: string;
  readonly hex: string | null;
  readonly group: string | null;
}

/// I campioni di colore pieno del disegno, dal motore; `null` se non risponde.
export async function campioniDiColore(dipendenze: DipendenzeComando): Promise<readonly CampioneDelGruppo[] | null> {
  const esito = await chiama(dipendenze, "disegno.swatch.list", {}, false).catch(() => null);
  if (esito === null || esito.refused !== null) return null;
  const campioni = (esito.reading as { swatches?: unknown } | null | undefined)?.swatches;
  if (!Array.isArray(campioni)) return null;
  return campioni.flatMap((voce: Record<string, unknown>) =>
    voce.kind === "color" && typeof voce.name === "string"
      ? [
          {
            name: voce.name,
            hex: typeof voce.hex === "string" ? voce.hex : null,
            group: typeof voce.group === "string" ? voce.group : null,
          },
        ]
      : [],
  );
}

/// La riga di un campione nella lista: il nome, il codice, e il gruppo che lascia, se ne ha uno.
function etichettaDelCampione(campione: CampioneDelGruppo): string {
  const colore = campione.hex === null ? campione.name : `${campione.name} ${campione.hex}`;
  return campione.group === null ? colore : `${colore} · ${t("draw.colorGroup.nelGruppo", { gruppo: campione.group })}`;
}

/// Manda il gruppo al motore dal percorso dei comandi del Completo: la famiglia `colore` è pronta prima. Dà
/// il perché, già a parole, se il motore lo rifiuta (o ne rifiuta gli argomenti, con la sua frase); `null` se
/// è andata, o se non c'è niente da dire.
async function inviaGruppo(
  dipendenze: DipendenzeComando,
  valore: { readonly name: string; readonly swatches: readonly string[] },
  finestra: Lifetime,
): Promise<string | null> {
  const pronta = await famigliaColorePronta(dipendenze.carica);
  if (finestra.closed) return null;
  if (!pronta) return t("draw.window.failed");
  const esito = await chiamaConArgomenti(dipendenze, "disegno.swatch.newGroup", { name: valore.name, swatches: [...valore.swatches] }, false);
  if (finestra.closed) return null;
  if (esito === null) return t("draw.window.unanswered");
  if ("kind" in esito) return esito.message;
  if (esito.refused !== null) {
    const motivo = motivoDelRifiuto(esito.refused);
    return motivo === null ? null : t(motivo);
  }
  return applicaEsito(esito, t("draw.colorGroup.undo"), dipendenze) ? null : t("draw.completo.key.failed");
}

/// La finestra: il nome, la lista dei campioni con le caselle, e Annulla e OK. Un gruppo senza campioni non
/// parte: la finestra dice la frase del motore, e resta aperta.
function apriFinestraNuovoGruppo(dipendenze: DipendenzeComando, finestra: Lifetime): void {
  /// I campioni spuntati, per nome.
  const scelti = new Set<string>();
  /// I campioni di colore pieno che il motore ha dato, nell'ordine del disegno.
  let campioni: readonly CampioneDelGruppo[] = [];
  const nome = formText({
    label: t("draw.colorGroup.nome"),
    value: "",
    placeholder: t("draw.colorGroup.nomeDiSerie"),
    blank: t("draw.colorGroup.nomeDiSerie"),
    onChange: () => undefined,
    lifetime: finestra,
  });
  const elenco = document.createElement("div");
  elenco.className = "draw-colorgroup-list";
  elenco.setAttribute("role", "group");
  elenco.setAttribute("aria-label", t("draw.colorGroup.campioni"));
  const nota = formNote("", true);
  nota.hidden = true;
  const errore = formError("");
  errore.classList.add("draw-colorgroup-error");
  errore.hidden = true;
  const dire = (testo: string): void => {
    nota.textContent = testo;
    nota.hidden = testo === "";
  };
  const dimmi = (testo: string | null): void => {
    errore.textContent = testo ?? "";
    errore.hidden = testo === null;
  };
  const dialogo = openDialog<string>({
    title: t("draw.colorGroup.title"),
    body: formBody([nome.element, elenco, nota, errore]),
    actions: [
      { id: "cancel", label: t("draw.resources.swatches.annulla"), value: "annulla" },
      { id: "ok", label: t("draw.resources.swatches.ok"), kind: "primary", value: "ok" },
    ],
    dismissValue: "annulla",
    lifetime: finestra,
    className: "draw-colorgroup-dialog",
    submit: "ok",
    confirm: (azione) => {
      if (azione === "annulla") return true;
      if (scelti.size === 0) {
        dimmi(t("draw.colorGroup.vuoto"));
        return false;
      }
      dimmi(null);
      const swatches = campioni.filter((campione) => scelti.has(campione.name)).map((campione) => campione.name);
      return inviaGruppo(dipendenze, { name: nome.value(), swatches }, finestra)
        .catch((): string => t("draw.window.unanswered"))
        .then((rifiuto) => {
          if (rifiuto === null) return true;
          dimmi(rifiuto);
          return false;
        });
    },
  });
  void dialogo.result.then(() => finestra.close());
  const spegniOk = (): void => {
    const ok = dialogo.element.querySelector<HTMLButtonElement>('[data-action="ok"]');
    if (ok !== null) ok.disabled = true;
  };
  // La lista arriva dopo: senza motore o senza campioni di colore pieno, lo dice e OK resta spento.
  void campioniDiColore(dipendenze).then((letti) => {
    if (finestra.closed) return;
    if (letti === null) {
      dimmi(t("draw.window.unanswered"));
      spegniOk();
      return;
    }
    campioni = letti;
    if (letti.length === 0) {
      dire(t("draw.colorGroup.nessuno"));
      spegniOk();
      return;
    }
    for (const campione of letti) {
      const casella = formCheck({
        label: etichettaDelCampione(campione),
        checked: false,
        onChange: (on) => {
          if (on) scelti.add(campione.name);
          else scelti.delete(campione.name);
        },
        lifetime: finestra,
      });
      elenco.append(casella.element);
    }
  });
}

/// La voce `ui.newColorGroup` del Completo: sempre accesa (il gruppo si fa con i campioni del disegno, e la
/// finestra dice quando non ce ne sono). `vita` è quella delle finestre dei colori del Completo.
export function voceNuovoGruppo(opzioni: { readonly dipendenze: DipendenzeComando; readonly vita: Lifetime }): VoceDelCompleto {
  const aperte = new Set<Lifetime>();
  opzioni.vita.add(() => {
    for (const finestra of [...aperte]) finestra.close();
    aperte.clear();
  });
  return {
    stato: () => null,
    esegui() {
      if (opzioni.vita.closed || aperte.size > 0) return;
      const finestra = openLifetime();
      aperte.add(finestra);
      finestra.add(() => aperte.delete(finestra));
      apriFinestraNuovoGruppo(opzioni.dipendenze, finestra);
    },
  };
}
