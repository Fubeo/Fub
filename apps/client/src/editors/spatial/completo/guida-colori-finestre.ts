// Le finestre della guida dei colori (K6 T14, giro 3): Opzioni guida colori (armonia, passi,
// variazione, ampiezza) e Limita guida colori. Le scelte vivono nella sezione, per la pagina aperta:
// non vanno sul disco e non cambiano il disegno.
import { openDialog } from "../../../kit/dialog";
import { formBody, formCheck, formChoice, formNote, formNumber, formRow, type FormChoiceHandle, type FormNumber } from "../../../kit/form";
import type { QuantityProblem } from "../../../kit/quantity";
import { adopt } from "../../../kit/owned";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";

/// Le armonie che il motore conosce (`color.harmony`), nell'ordine in cui la finestra le mostra.
export const REGOLE = [
  "complementary",
  "complementary2",
  "splitComplementary",
  "leftComplement",
  "rightComplement",
  "analogous",
  "analogous2",
  "monochromatic",
  "shades",
  "triad",
  "triad2",
  "triad3",
  "tetrad",
  "tetrad2",
  "tetrad3",
  "compound",
  "compound2",
  "highContrast",
  "highContrast2",
  "highContrast3",
  "pentagram",
] as const;
export type Regola = (typeof REGOLE)[number];

/// Le variazioni che il motore conosce: come si passa dal colore alle sue tinte e ombre.
export const VARIAZIONI = ["tintsShades", "warmCool", "vividMuted"] as const;
export type Variazione = (typeof VARIAZIONI)[number];

/// Le scelte della guida, per la pagina aperta. `documento` limita la guida ai colori del
/// documento (`limitTo: "document"`); le librerie di colori non ci sono ancora.
export interface StatoGuida {
  readonly regola: Regola;
  readonly passi: number;
  readonly variazione: Variazione;
  readonly ampiezza: number;
  readonly documento: boolean;
}

/// I valori di serie del motore: quattro passi, ampiezza 50, tinte e ombre.
export const GUIDA_DI_SERIE: StatoGuida = {
  regola: "complementary",
  passi: 4,
  variazione: "tintsShades",
  ampiezza: 50,
  documento: false,
};

const ETICHETTA_REGOLA: Readonly<Record<Regola, DrawKey>> = {
  complementary: "draw.guida.regola.complementary",
  complementary2: "draw.guida.regola.complementary2",
  splitComplementary: "draw.guida.regola.splitComplementary",
  leftComplement: "draw.guida.regola.leftComplement",
  rightComplement: "draw.guida.regola.rightComplement",
  analogous: "draw.guida.regola.analogous",
  analogous2: "draw.guida.regola.analogous2",
  monochromatic: "draw.guida.regola.monochromatic",
  shades: "draw.guida.regola.shades",
  triad: "draw.guida.regola.triad",
  triad2: "draw.guida.regola.triad2",
  triad3: "draw.guida.regola.triad3",
  tetrad: "draw.guida.regola.tetrad",
  tetrad2: "draw.guida.regola.tetrad2",
  tetrad3: "draw.guida.regola.tetrad3",
  compound: "draw.guida.regola.compound",
  compound2: "draw.guida.regola.compound2",
  highContrast: "draw.guida.regola.highContrast",
  highContrast2: "draw.guida.regola.highContrast2",
  highContrast3: "draw.guida.regola.highContrast3",
  pentagram: "draw.guida.regola.pentagram",
};

const ETICHETTA_VARIAZIONE: Readonly<Record<Variazione, DrawKey>> = {
  tintsShades: "draw.guida.variazione.tintsShades",
  warmCool: "draw.guida.variazione.warmCool",
  vividMuted: "draw.guida.variazione.vividMuted",
};

/// La regola che il motore conosce: la finestra dà solo quelle.
export function regolaValida(testo: string): Regola | null {
  return (REGOLE as readonly string[]).includes(testo) ? (testo as Regola) : null;
}

/// La variazione che il motore conosce, o `null`.
export function variazioneValida(testo: string): Variazione | null {
  return (VARIAZIONI as readonly string[]).includes(testo) ? (testo as Variazione) : null;
}

/// Il nome di un'armonia, come lo leggono la sezione e la sua finestra.
export function nomeRegola(regola: Regola): string {
  return t(ETICHETTA_REGOLA[regola]);
}

function problemaDelNumero(problema: QuantityProblem | "mixed"): string {
  const chiavi: Readonly<Record<QuantityProblem, DrawKey>> = {
    empty: "draw.properties.problem.empty",
    syntax: "draw.properties.problem.syntax",
    unit: "draw.properties.problem.unit",
    relative: "draw.properties.problem.relative",
    finite: "draw.properties.problem.finite",
  };
  return t(problema === "mixed" ? chiavi.syntax : chiavi[problema]);
}

/// Il campo di un numero della guida: fuori dai limiti non si prende e dice perché.
function campoNumero(etichetta: string, valore: number, min: number, max: number, unita: string | undefined, onValidity: (valido: boolean) => void, vita: Lifetime): FormNumber {
  return formNumber({
    label: etichetta,
    value: valore,
    min,
    max,
    places: 0,
    ...(unita === undefined ? {} : { unit: unita }),
    outOfRange: (minimo, massimo) => t("draw.recolor.fuori", { min: String(minimo ?? min), max: String(massimo ?? max) }),
    problem: problemaDelNumero,
    onChange: () => undefined,
    onValidity,
    lifetime: vita,
  });
}

/// Apre una finestra della guida con il suo corpo e Annulla/Applica. Risolve lo stato nuovo con
/// Applica, `null` altrimenti. `ok` dice se il pulsante di Applica è acceso.
function finestraGuida(
  titolo: string,
  descrizione: string,
  corpo: HTMLElement,
  vita: Lifetime,
  valido: () => boolean,
  nuovo: () => StatoGuida,
): Promise<StatoGuida | null> {
  return new Promise<StatoGuida | null>((fine) => {
    const own = openLifetime();
    const liberaDalDisegno = adopt(vita, () => own.close());
    const handle = openDialog<"ok" | "annulla">({
      title: titolo,
      description: descrizione,
      body: corpo,
      actions: [
        { id: "cancel", label: t("draw.window.cancel"), value: "annulla" },
        { id: "ok", label: t("draw.guida.opzioni.azione"), kind: "primary", value: "ok" },
      ],
      dismissValue: "annulla",
      lifetime: own,
      className: "draw-effect-dialog draw-guide-dialog",
    });
    const ok = handle.element.querySelector<HTMLButtonElement>('[data-action="ok"]');
    const aggiorna = (): void => {
      if (ok !== null) ok.disabled = !valido();
    };
    aggiorna();
    corpo.addEventListener("input", aggiorna);
    corpo.addEventListener("change", aggiorna);
    handle.result.then((scelta) => {
      liberaDalDisegno();
      own.close();
      fine(scelta === "ok" ? nuovo() : null);
    });
  });
}

/// La finestra «Opzioni guida colori»: armonia, passi, variazione e ampiezza.
export function apriOpzioniGuida(stato: StatoGuida, vita: Lifetime): Promise<StatoGuida | null> {
  let regola: Regola = stato.regola;
  let variazione: Variazione = stato.variazione;
  let passi = stato.passi;
  let ampiezza = stato.ampiezza;
  const validi = new Map<string, boolean>();
  const voci = document.createElement("select");
  voci.className = "draw-guide-rule";
  voci.setAttribute("aria-label", t("draw.guida.regola"));
  for (const id of REGOLE) {
    const voce = document.createElement("option");
    voce.value = id;
    voce.textContent = t(ETICHETTA_REGOLA[id]);
    voce.selected = id === regola;
    voci.append(voce);
  }
  voci.addEventListener("change", () => {
    regola = regolaValida(voci.value) ?? regola;
  });
  const variazioni: FormChoiceHandle = formChoice({
    label: t("draw.guida.variazione"),
    choices: VARIAZIONI.map((v) => ({ value: v, label: t(ETICHETTA_VARIAZIONE[v]) })),
    value: variazione,
    onChange: (valore) => {
      variazione = variazioneValida(valore) ?? variazione;
    },
    lifetime: vita,
  });
  const campoPassi = campoNumero(t("draw.guida.passi"), passi, 1, 20, undefined, (v) => validi.set("passi", v), vita);
  const campoAmpiezza = campoNumero(t("draw.guida.ampiezza"), ampiezza, 0, 100, "%", (v) => validi.set("ampiezza", v), vita);
  const etichettaRegola = document.createElement("label");
  etichettaRegola.className = "draw-guide-field";
  const nomeRegola = document.createElement("span");
  nomeRegola.textContent = t("draw.guida.regola");
  etichettaRegola.append(nomeRegola, voci);
  const corpo = formBody([etichettaRegola, variazioni.element, formRow(campoPassi.element), formRow(campoAmpiezza.element)]);
  // I numeri si leggono a Applica, quando sono validi.
  return finestraGuida(
    t("draw.guida.opzioni.titolo"),
    t("draw.guida.opzioni.descrizione"),
    corpo,
    vita,
    () => [...validi.values()].every((v) => v !== false),
    () => {
      passi = campoPassi.value();
      ampiezza = campoAmpiezza.value();
      return { regola, passi, variazione, ampiezza, documento: stato.documento };
    },
  );
}

/// La finestra «Limita guida colori»: solo i colori del documento. Le librerie non ci sono ancora.
export function apriLimiteGuida(stato: StatoGuida, vita: Lifetime): Promise<StatoGuida | null> {
  let documento = stato.documento;
  const casella = formCheck({
    label: t("draw.guida.limite.documento"),
    checked: documento,
    onChange: (valore) => {
      documento = valore;
    },
    lifetime: vita,
  });
  return finestraGuida(
    t("draw.guida.limite.titolo"),
    "",
    formBody([casella.element, formNote(t("draw.guida.limite.libreria"))]),
    vita,
    () => true,
    () => ({ ...stato, documento }),
  );
}
