// «Trova carattere…» del menu Testo (VectorCraft `type.findFont`, Find Font…): la finestra dei
// caratteri del disegno. Elenca i caratteri che i testi usano (`text.fonts`, con quelli che mancano),
// e per quello scelto:
//
// - **Trova** sceglie i testi che lo usano (`select.font`), visibili e sbloccati;
// - **Cambia** lo sostituisce nei soli testi scelti (`text.replaceFont` con `selectionOnly`);
// - **Cambia tutto** lo sostituisce in tutto il disegno (`text.replaceFont`).
//
// Il carattere nuovo è una famiglia che Fub conosce (`text.fontList`) e uno dei suoi stili, o «lo
// stile più vicino» (nessuno stile: il motore tiene quello più simile). La finestra resta aperta dopo
// ogni azione, come in VectorCraft, e rilegge l'elenco dopo un cambio. I comandi sono della famiglia
// `testo` (e `select.font` di `livelli`): la finestra le prepara prima di leggere. Un cambio passa da
// `applicaRisposta` (un passo di Annulla, la frase del motore se rifiuta); l'avviso del motore (testi
// bloccati lasciati com'erano, stile che non c'è) si legge nella finestra. Ogni lettura ha il suo
// numero, e una risposta vecchia non vince su una nuova.

import { openDialog } from "../../../kit/dialog";
import { formBody, formError, formNote } from "../../../kit/form";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import {
  applicaRisposta,
  chiamaConArgomenti,
  type DipendenzeComando,
} from "./esegui";

/// Un carattere usato dal disegno (`text.fonts`).
export interface CarattereDelDisegno {
  readonly family: string;
  readonly style: string;
  readonly objects: number;
  readonly missing: boolean;
}

/// Il carattere che prende il posto: lo stile `null` è «lo stile più vicino».
export interface CarattereNuovo {
  readonly family: string;
  readonly style: string | null;
}

/// L'esito di un'azione: `fatto` se è andata (il perché di un rifiuto l'ha già detto
/// `applicaRisposta`), `avviso` del motore, o `null` se il motore non risponde.
export type EsitoAzione = {
  readonly fatto: boolean;
  readonly avviso: string | null;
} | null;

/// Il motore visto dalla finestra.
export interface PortaTrovaCarattere {
  /// Prepara le famiglie dei comandi: `false` se non sono pronte.
  pronta(): Promise<boolean>;
  caratteri(): Promise<readonly CarattereDelDisegno[] | null>;
  famiglie(): Promise<readonly string[] | null>;
  stili(famiglia: string): Promise<readonly string[] | null>;
  /// Vero se ci sono oggetti scelti (Cambia vale solo su di loro).
  ciSonoScelti(): boolean;
  trova(da: CarattereDelDisegno): Promise<EsitoAzione>;
  sostituisci(
    da: CarattereDelDisegno,
    a: CarattereNuovo,
    soloScelti: boolean,
  ): Promise<EsitoAzione>;
}

/// I caratteri dalla lettura di `text.fonts`; `null` se non si legge.
export function caratteriDi(
  lettura: unknown,
): readonly CarattereDelDisegno[] | null {
  if (!Array.isArray(lettura)) return null;
  return lettura.flatMap((voce: Record<string, unknown>) =>
    typeof voce.family === "string" && typeof voce.style === "string"
      ? [
          {
            family: voce.family,
            style: voce.style,
            objects: typeof voce.objects === "number" ? voce.objects : 0,
            missing: voce.missing === true,
          },
        ]
      : [],
  );
}

/// Le parole di `text.fontList` sotto la chiave `chiave` (`families` o `styles`); `null` se non si leggono.
function paroleDi(
  lettura: unknown,
  chiave: "families" | "styles",
): readonly string[] | null {
  const elenco = (lettura as Record<string, unknown> | null | undefined)?.[
    chiave
  ];
  return Array.isArray(elenco)
    ? elenco.filter((v): v is string => typeof v === "string")
    : null;
}

/// L'avviso di `text.replaceFont` (`warning`), se c'è.
function avvisoDi(lettura: unknown): string | null {
  const avviso = (lettura as { warning?: unknown } | null | undefined)?.warning;
  return typeof avviso === "string" && avviso !== "" ? avviso : null;
}

/// La porta della finestra sul motore del Completo aperto.
export function creaPortaTrovaCarattere(
  dipendenze: DipendenzeComando,
): PortaTrovaCarattere {
  const leggi = async (id: string, valore: unknown): Promise<unknown> => {
    const esito = await chiamaConArgomenti(
      dipendenze,
      `disegno.${id}`,
      valore,
      false,
    );
    if (esito === null || "kind" in esito || esito.refused !== null)
      return null;
    return esito.reading ?? null;
  };
  const agisci = async (
    id: string,
    valore: unknown,
    etichetta: string,
  ): Promise<EsitoAzione> => {
    const esito = await chiamaConArgomenti(
      dipendenze,
      `disegno.${id}`,
      valore,
      false,
    );
    if (esito === null || dipendenze.vita.closed) return null;
    const fatto = applicaRisposta(esito, etichetta, dipendenze);
    return { fatto, avviso: "kind" in esito ? null : avvisoDi(esito.reading) };
  };
  return {
    async pronta() {
      const [testo, livelli] = await Promise.all([
        dipendenze.carica.famiglia("testo"),
        dipendenze.carica.famiglia("livelli"),
      ]);
      return testo.kind === "pronta" && livelli.kind === "pronta";
    },
    async caratteri() {
      return caratteriDi(await leggi("text.fonts", {}));
    },
    async famiglie() {
      return paroleDi(await leggi("text.fontList", {}), "families");
    },
    async stili(famiglia) {
      return paroleDi(
        await leggi("text.fontList", { family: famiglia }),
        "styles",
      );
    },
    ciSonoScelti: () => dipendenze.selezione().length > 0,
    trova: (da) =>
      agisci(
        "select.font",
        { family: da.family, style: da.style },
        t("draw.trovaCarattere.undoTrova"),
      ),
    sostituisci: (da, a, soloScelti) =>
      agisci(
        "text.replaceFont",
        {
          from: { family: da.family, style: da.style },
          to:
            a.style === null
              ? { family: a.family }
              : { family: a.family, style: a.style },
          ...(soloScelti ? { selectionOnly: true } : {}),
        },
        t("draw.trovaCarattere.undo"),
      ),
  };
}

/// Il nome di un carattere nell'elenco: famiglia e stile, e se manca.
export function nomeDelCarattere(c: CarattereDelDisegno): string {
  const nome = `${c.family} ${c.style}`.trim();
  return c.missing ? t("draw.trovaCarattere.manca", { nome }) : nome;
}

/// Apre la finestra. `vita` è quella del Completo: chiuso il disegno, la finestra si chiude da sola.
export function apriTrovaCarattere(
  porta: PortaTrovaCarattere,
  vita: Lifetime,
): void {
  const own = openLifetime();
  vita.add(() => own.close());

  let caratteri: readonly CarattereDelDisegno[] = [];
  let pronta = false;
  let occupato = false;
  let giroElenco = 0;
  let giroStili = 0;

  const titoloElenco = formNote("", true);
  const elenco = document.createElement("select");
  elenco.size = 8;
  elenco.className = "kit-form-select draw-findfont-list";
  elenco.setAttribute("aria-label", t("draw.trovaCarattere.titolo"));
  const titoloNuovo = formNote(t("draw.trovaCarattere.sostituisciCon"), true);
  const famiglia = document.createElement("select");
  famiglia.className = "kit-form-select draw-findfont-family";
  famiglia.setAttribute("aria-label", t("draw.trovaCarattere.famiglia"));
  const stile = document.createElement("select");
  stile.className = "kit-form-select draw-findfont-style";
  stile.setAttribute("aria-label", t("draw.trovaCarattere.stile"));
  const avviso = formNote("", true);
  avviso.hidden = true;
  const errore = formError("");
  errore.hidden = true;
  const corpo = document.createElement("div");
  corpo.className = "draw-findfont-body";
  corpo.append(
    titoloElenco,
    elenco,
    titoloNuovo,
    famiglia,
    stile,
    avviso,
    errore,
  );

  const dire = (nota: HTMLElement, testo: string | null): void => {
    nota.textContent = testo ?? "";
    nota.hidden = testo === null;
  };
  const scelto = (): CarattereDelDisegno | null =>
    caratteri[elenco.selectedIndex] ?? null;
  const nuovo = (): CarattereNuovo | null =>
    famiglia.value === ""
      ? null
      : {
          family: famiglia.value,
          style: stile.value === "" ? null : stile.value,
        };

  const aggiornaAzioni = (): void => {
    const niente = !pronta || occupato || scelto() === null;
    const tasto = (azione: string): HTMLButtonElement | null =>
      finestra.element.querySelector<HTMLButtonElement>(
        `[data-action="${azione}"]`,
      );
    const trova = tasto("find");
    const cambia = tasto("change");
    const tutto = tasto("changeAll");
    if (trova !== null) trova.disabled = niente;
    if (cambia !== null) cambia.disabled = niente || nuovo() === null;
    if (tutto !== null) tutto.disabled = niente || nuovo() === null;
  };

  const caricaStili = async (): Promise<void> => {
    const mio = ++giroStili;
    stile.replaceChildren(opzione("", t("draw.trovaCarattere.stileVicino")));
    aggiornaAzioni();
    if (famiglia.value === "") return;
    const stili = await porta.stili(famiglia.value);
    if (own.closed || mio !== giroStili || stili === null) return;
    for (const s of stili) stile.append(opzione(s, s));
  };

  /// L'elenco dei caratteri del disegno, riletto; il carattere scelto resta scelto se c'è ancora.
  const caricaElenco = async (): Promise<void> => {
    const mio = ++giroElenco;
    const prima = scelto();
    const letti = await porta.caratteri();
    if (own.closed || mio !== giroElenco) return;
    if (letti === null) {
      dire(errore, t("draw.trovaCarattere.elencoFallito"));
      aggiornaAzioni();
      return;
    }
    caratteri = letti;
    elenco.replaceChildren(
      ...letti.map((c, i) => opzione(String(i), nomeDelCarattere(c))),
    );
    dire(
      titoloElenco,
      letti.length === 0
        ? t("draw.trovaCarattere.nessuno")
        : t("draw.trovaCarattere.nelDisegno", { count: letti.length }),
    );
    const ancora =
      prima === null
        ? -1
        : letti.findIndex(
            (c) => c.family === prima.family && c.style === prima.style,
          );
    elenco.selectedIndex = ancora >= 0 ? ancora : letti.length > 0 ? 0 : -1;
    aggiornaAzioni();
  };

  const onElenco = (): void => aggiornaAzioni();
  const onFamiglia = (): void => void caricaStili();
  const onStile = (): void => aggiornaAzioni();
  elenco.addEventListener("change", onElenco);
  famiglia.addEventListener("change", onFamiglia);
  stile.addEventListener("change", onStile);
  own.add(() => {
    elenco.removeEventListener("change", onElenco);
    famiglia.removeEventListener("change", onFamiglia);
    stile.removeEventListener("change", onStile);
  });

  /// Un'azione: la finestra resta aperta (`false`), col perché o l'avviso del motore.
  const agisci = async (
    azione: "trova" | "cambia" | "tutto",
  ): Promise<boolean> => {
    const da = scelto();
    const a = nuovo();
    dire(errore, null);
    dire(avviso, null);
    if (da === null) {
      dire(errore, t("draw.trovaCarattere.scegli"));
      return false;
    }
    if (azione === "cambia" && !porta.ciSonoScelti()) {
      dire(errore, t("draw.trovaCarattere.cambiaSenzaScelti"));
      return false;
    }
    if (azione !== "trova" && a === null) return false;
    occupato = true;
    aggiornaAzioni();
    const esito =
      azione === "trova"
        ? await porta.trova(da)
        : await porta.sostituisci(da, a!, azione === "cambia");
    occupato = false;
    if (own.closed) return false;
    if (esito === null) dire(errore, t("draw.trovaCarattere.fallito"));
    else dire(avviso, esito.avviso);
    if (azione !== "trova" && esito?.fatto === true) await caricaElenco();
    aggiornaAzioni();
    return false;
  };

  const finestra = openDialog<string>({
    title: t("draw.trovaCarattere.titolo"),
    body: formBody([corpo]),
    actions: [
      { id: "close", label: t("draw.trovaCarattere.chiudi"), value: "chiudi" },
      { id: "find", label: t("draw.trovaCarattere.trova"), value: "trova" },
      { id: "change", label: t("draw.trovaCarattere.cambia"), value: "cambia" },
      {
        id: "changeAll",
        label: t("draw.trovaCarattere.cambiaTutto"),
        kind: "primary",
        value: "tutto",
      },
    ],
    dismissValue: "chiudi",
    lifetime: own,
    preview: true,
    className: "draw-findfont-dialog",
    confirm: (valore) =>
      valore === "chiudi"
        ? true
        : agisci(valore as "trova" | "cambia" | "tutto"),
  });
  void finestra.result.then(() => own.close());

  dire(titoloElenco, t("draw.trovaCarattere.caricamento"));
  stile.append(opzione("", t("draw.trovaCarattere.stileVicino")));
  aggiornaAzioni();
  void porta.pronta().then(async (si) => {
    if (own.closed) return;
    if (!si) {
      dire(titoloElenco, null);
      dire(errore, t("draw.trovaCarattere.nonPronta"));
      return;
    }
    pronta = true;
    const [, famiglie] = await Promise.all([caricaElenco(), porta.famiglie()]);
    if (own.closed) return;
    if (famiglie === null) {
      dire(errore, t("draw.trovaCarattere.famiglieFallite"));
    } else {
      famiglia.replaceChildren(...famiglie.map((f) => opzione(f, f)));
      // Di serie la famiglia del carattere scelto, se Fub la conosce: Cambia prende allora lo stile.
      const primo = scelto();
      if (primo !== null && famiglie.includes(primo.family))
        famiglia.value = primo.family;
      await caricaStili();
    }
    aggiornaAzioni();
  });
}

function opzione(valore: string, testo: string): HTMLOptionElement {
  const voce = document.createElement("option");
  voce.value = valore;
  voce.textContent = testo;
  return voce;
}
