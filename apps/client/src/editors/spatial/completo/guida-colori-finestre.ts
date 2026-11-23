// Le finestre della guida dei colori (K6 T14, guida): Opzioni guida colori (armonia, passi,
// variazione, ampiezza) e Limita guida colori (nessun limite, una libreria di base del motore, o i
// campioni del documento). Le scelte stanno nella sezione, per la pagina aperta: non vanno sul disco
// e non cambiano il disegno.
import { openDialog } from "../../../kit/dialog";
import { formBody, formChoice, formNote, formNumber, formRow, type FormChoiceHandle, type FormNumber } from "../../../kit/form";
import { adopt } from "../../../kit/owned";
import type { QuantityProblem } from "../../../kit/quantity";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import { chiama, type DipendenzeComando } from "./esegui";

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

/// Il limite della guida che vuole i campioni del documento (`limitTo: "document"`).
export const LIMITE_DOCUMENTO = "document";

/// Le scelte della guida, per la pagina aperta. `limite` è `null` (nessun limite), `LIMITE_DOCUMENTO`,
/// o l'id di una libreria di base del motore.
export interface StatoGuida {
  readonly regola: Regola;
  readonly passi: number;
  readonly variazione: Variazione;
  readonly ampiezza: number;
  readonly limite: string | null;
}

/// I valori di serie del motore: quattro passi, ampiezza 50, tinte e ombre, nessun limite.
export const GUIDA_DI_SERIE: StatoGuida = {
  regola: "complementary",
  passi: 4,
  variazione: "tintsShades",
  ampiezza: 50,
  limite: null,
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

/// Le librerie di colori di base del motore (categoria «builtIn» di `swatch.library.list`) che Fub
/// sa nominare: un id che non è qui non si offre. Il nome in italiano è la chiave.
const NOME_LIBRERIA: Readonly<Record<string, DrawKey>> = {
  "web-safe-216": "draw.guida.libreria.web-safe-216",
  "grays-neutrals": "draw.guida.libreria.grays-neutrals",
  "earth-tones": "draw.guida.libreria.earth-tones",
  "skin-tone-ramps": "draw.guida.libreria.skin-tone-ramps",
  pastels: "draw.guida.libreria.pastels",
  brights: "draw.guida.libreria.brights",
  "metallic-gradients": "draw.guida.libreria.metallic-gradients",
  "perceptual-scales": "draw.guida.libreria.perceptual-scales",
  "harmony-sets": "draw.guida.libreria.harmony-sets",
};

/// I campioni che sono del sistema, non del documento: non contano per il limite ai campioni.
const CAMPIONI_DI_SISTEMA = new Set(["[None]", "[Registration]"]);

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

/// Il nome italiano di una libreria di base, o `null` se Fub non la sa nominare.
export function nomeLibreria(id: string): string | null {
  const chiave = NOME_LIBRERIA[id];
  return chiave === undefined ? null : t(chiave);
}

function isRecord(valore: unknown): valore is Readonly<Record<string, unknown>> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

/// Le librerie di colori di base che la finestra offre, nell'ordine del motore: id e nome in
/// italiano. `null` se il motore non ha risposto.
export async function libreriePiuBase(deps: DipendenzeComando): Promise<readonly { readonly id: string; readonly nome: string }[] | null> {
  const esito = await chiama(deps, "disegno.swatch.library.list", {}, false).catch(() => null);
  if (esito === null || esito.refused !== null || !isRecord(esito.reading) || !Array.isArray(esito.reading.libraries)) return null;
  const librerie: { id: string; nome: string }[] = [];
  for (const libreria of esito.reading.libraries) {
    if (!isRecord(libreria) || libreria.category !== "builtIn" || typeof libreria.id !== "string") continue;
    const nome = nomeLibreria(libreria.id);
    if (nome !== null) librerie.push({ id: libreria.id, nome });
  }
  return librerie;
}

/// Vero se il documento ha campioni di colore pieno suoi (non quelli di sistema); `null` se il motore
/// non ha risposto. È il controllo che la famiglia fa anche prima del motore.
export async function campioniDelDocumento(deps: DipendenzeComando): Promise<boolean | null> {
  const esito = await chiama(deps, "disegno.swatch.list", {}, false).catch(() => null);
  if (esito === null || esito.refused !== null || !isRecord(esito.reading) || !Array.isArray(esito.reading.swatches)) return null;
  return esito.reading.swatches.some(
    (campione) => isRecord(campione) && campione.kind === "color" && typeof campione.name === "string" && !CAMPIONI_DI_SISTEMA.has(campione.name),
  );
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
function campoNumero(
  etichetta: string,
  valore: number,
  min: number,
  max: number,
  unita: string | undefined,
  vita: Lifetime,
): FormNumber {
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
    lifetime: vita,
  });
}

/// Apre una finestra della guida con il suo corpo e Annulla/Applica. Risolve lo stato nuovo con
/// Applica, `null` altrimenti. Applica si accende solo se i numeri sono validi.
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
    // Un numero si conferma con Invio o alla perdita del fuoco: ricontrolla dopo ogni passo di scrittura.
    corpo.addEventListener("input", aggiorna);
    corpo.addEventListener("keydown", aggiorna);
    corpo.addEventListener("focusout", aggiorna);
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
  const campoPassi = campoNumero(t("draw.guida.passi"), stato.passi, 1, 20, undefined, vita);
  const campoAmpiezza = campoNumero(t("draw.guida.ampiezza"), stato.ampiezza, 0, 100, "%", vita);
  const etichettaRegola = document.createElement("label");
  etichettaRegola.className = "draw-guide-field";
  const nomeCampo = document.createElement("span");
  nomeCampo.textContent = t("draw.guida.regola");
  etichettaRegola.append(nomeCampo, voci);
  const corpo = formBody([etichettaRegola, variazioni.element, formRow(campoPassi.element), formRow(campoAmpiezza.element)]);
  // I numeri si leggono a Applica, quando sono validi.
  return finestraGuida(
    t("draw.guida.opzioni.titolo"),
    t("draw.guida.opzioni.descrizione"),
    corpo,
    vita,
    () => campoPassi.valid() && campoAmpiezza.valid(),
    () => ({
      regola,
      passi: campoPassi.value(),
      variazione,
      ampiezza: campoAmpiezza.value(),
      limite: stato.limite,
    }),
  );
}

/// La finestra «Limita guida colori»: nessun limite, una libreria di base, o i campioni del documento.
/// I campioni del documento si offrono solo se il documento ne ha; altrimenti la frase lo dice.
export function apriLimiteGuida(stato: StatoGuida, vita: Lifetime, deps: DipendenzeComando): Promise<StatoGuida | null> {
  let limite: string | null = stato.limite;
  const scelta = document.createElement("select");
  scelta.className = "draw-guide-rule";
  scelta.setAttribute("aria-label", t("draw.guida.limite.titolo"));
  const nota = formNote(t("draw.guida.caricamento"));
  const aggiungi = (valore: string, nome: string, disabilitata = false): void => {
    const voce = document.createElement("option");
    voce.value = valore;
    voce.textContent = nome;
    voce.selected = valore === (limite ?? "");
    voce.disabled = disabilitata;
    scelta.append(voce);
  };
  aggiungi("", t("draw.guida.limite.nessuno"));
  scelta.addEventListener("change", () => {
    limite = scelta.value === "" ? null : scelta.value;
  });
  const corpo = formBody([scelta, nota]);
  const pronta = async (): Promise<void> => {
    const [librerie, campioni] = await Promise.all([libreriePiuBase(deps), campioniDelDocumento(deps)]);
    if (librerie === null || campioni === null) {
      nota.textContent = t("draw.guida.limite.libreria.errore");
      return;
    }
    for (const libreria of librerie) aggiungi(libreria.id, libreria.nome);
    aggiungi(LIMITE_DOCUMENTO, t("draw.guida.limite.documento"), !campioni);
    nota.textContent = campioni ? "" : t("draw.guida.limite.senza.campioni");
    nota.hidden = campioni;
    scelta.value = limite ?? "";
  };
  void pronta();
  return finestraGuida(
    t("draw.guida.limite.titolo"),
    t("draw.guida.limite.descrizione"),
    corpo,
    vita,
    () => true,
    () => ({ ...stato, limite }),
  );
}
