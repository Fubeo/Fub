// La famiglia «trasforma» del Disegno completo (piano K6, T13, giro 2): la sezione
// «Allinea» dell'ispettore Design. Allinea e distribuisce la selezione con i comandi
// del motore (`object.align`, `object.distribute`, `object.distributeSpacing`): le
// voci `align.*` dell'indice portano il comando con il suo valore fisso, e la sezione
// aggiunge `to`. Con meno di due oggetti i pulsanti sono spenti e dicono perché
// (`needs_two`), salvo «allinea alla tavola», che va anche con uno. L'oggetto chiave
// aspetta T15 (`select.key`).

import type { ContestoCompleto, ModuloFamiglia } from "../../carica";
import { registraSezione, type ContestoSezione } from "../../sezioni";
import { languageCurrent } from "../../../../../i18n/strings";
import { t } from "../../../strings";
import { TESTI } from "./testi";

/// Il modo di «Allinea a»: alla selezione, o alla tavola.
type Modo = "selection" | "artboard";

/// I gruppi dei pulsanti, con le voci `align.*` che ci stanno.
const GRUPPI: readonly { readonly chiave: string; readonly ids: readonly string[] }[] = [
  { chiave: "gruppo:orizzontale", ids: ["align.horizontalLeft", "align.horizontalCenter", "align.horizontalRight"] },
  { chiave: "gruppo:verticale", ids: ["align.verticalTop", "align.verticalCenter", "align.verticalBottom"] },
  { chiave: "gruppo:centri", ids: ["align.horizontalVerticalCenter"] },
  {
    chiave: "gruppo:distribuisci-orizzontale",
    ids: ["align.distributeHorizontalLeft", "align.distributeHorizontalCenter", "align.distributeHorizontalRight", "align.distributeHorizontalSpace"],
  },
  {
    chiave: "gruppo:distribuisci-verticale",
    ids: ["align.distributeVerticalTop", "align.distributeVerticalCenter", "align.distributeVerticalBottom", "align.distributeVerticalSpace"],
  },
];

/// Quanti oggetti servono: due, salvo «allinea alla tavola» (un oggetto basta).
export function oggettiMinimi(id: string, modo: Modo): number {
  return modo === "artboard" && id.startsWith("align.") && !id.startsWith("align.distribute") ? 1 : 2;
}

/// Un pulsante è spento se la selezione è troppo piccola per il suo modo.
export function spento(id: string, modo: Modo, oggetti: number): boolean {
  return oggetti < oggettiMinimi(id, modo);
}

/// La parola di una chiave dei testi, nella lingua che l'app usa adesso.
function parola(chiave: string): string {
  const voce = TESTI[chiave];
  if (voce === undefined) return chiave;
  return languageCurrent().startsWith("en") ? voce.en : voce.it;
}

/// La sezione «Allinea»: due modi, poi i gruppi dei pulsanti. Un pulsante manda il
/// comando con il suo valore e `to` del modo scelto; il disegno non cambia da sé.
function disegnaAllinea(contesto: ContestoSezione, esegui: ContestoCompleto["esegui"]): () => void {
  const corpo = contesto.corpo;
  let modo: Modo = "selection";
  const bottoni: { readonly id: string; readonly el: HTMLButtonElement }[] = [];
  const modi: { readonly modo: Modo; readonly el: HTMLButtonElement }[] = [];

  const aggiorna = (): void => {
    for (const { id, el } of bottoni) {
      const off = spento(id, modo, contesto.sel.numero);
      el.disabled = off;
      el.title = off ? t("draw.disabled.needs_two") : parola(id);
    }
    for (const { modo: m, el } of modi) el.setAttribute("aria-pressed", String(m === modo));
  };

  const riga = document.createElement("div");
  riga.className = "draw-align-to";
  for (const m of ["selection", "artboard"] as const) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = parola(m === "selection" ? "allinea:selezione" : "allinea:tavola");
    el.addEventListener("click", () => {
      modo = m;
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
    titolo.textContent = parola(gruppo.chiave);
    blocco.append(titolo);
    for (const id of gruppo.ids) {
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.id = id;
      el.textContent = parola(id);
      el.addEventListener("click", () => {
        if (!el.disabled) esegui(id, { to: modo });
      });
      bottoni.push({ id, el });
      blocco.append(el);
    }
    corpo.append(blocco);
  }
  aggiorna();
  return () => corpo.replaceChildren();
}

const famiglia: ModuloFamiglia & { readonly testi: typeof TESTI } = {
  testi: TESTI,
  registra(ctx) {
    registraSezione(ctx, {
      id: "allinea",
      scheda: "design",
      titolo: parola("sezione:allinea"),
      disegna: (contesto) => disegnaAllinea(contesto, ctx.esegui),
    });
  },
};

export default famiglia;
