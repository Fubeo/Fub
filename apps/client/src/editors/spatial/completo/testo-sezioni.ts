// Le sezioni «Carattere» e «Paragrafo» dell'ispettore Design del Completo (K6 T16, giro 1): il testo
// di punto scelto, con la famiglia e lo stile, il corpo e la spaziatura; e l'allineamento.
//
// - **I valori dalla vista del pannello.** Le sezioni mostrano il testo scelto come il pannello lo ha
//   già (`Selezione.testo`): nessuna richiesta al motore per mostrarlo. Senza un testo scelto le
//   sezioni non ci sono.
// - **Un cambio, un comando.** Una famiglia, uno stile, un corpo o una spaziatura confermati mandano
//   `text.setRangeStyle` con quel valore solo; un allineamento `text.setStyle {justify}`. Il motore li
//   fa su ogni testo scelto, in un passo (`famiglie/testo.rs`). I comandi passano dal percorso unico
//   (`eseguiPerId`).
// - **La famiglia col kit.** La scelta del carattere è `kit/font-picker.ts` com'è: le famiglie di Fub
//   e quelle che il disegno usa, dalla vista. Il motore riceve il nome della famiglia.
// - **Ciò che il formato non tiene ancora** (l'interlinea per pezzo, la crenatura, i rientri, la
//   giustificazione) non si offre: il motore lo rifiuterebbe (`unsupported`). L'interlinea di Fub
//   resta nella sezione Testo del pannello.

import { fontButton, type FontButton, type FontChoice, type FontSource } from "../../../kit/font-picker";
import { numberField, type NumberField } from "../../../kit/number-field";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import { TEXT_FAMILIES } from "../tools/text";
import { registraSezione, type ContestoSezione, type FamigliaSelezione, type Sezione, type Sezioni, type TestoSelezione } from "./sezioni";

/// Il comando del motore: l'id della voce e i suoi valori.
export type EseguiTesto = (id: string, valori: Readonly<Record<string, unknown>>) => void;

/// I pesi dello stile, con il nome della faccia che il motore legge (`peso_e_corsivo`).
const PESI: ReadonlyArray<{ readonly peso: number; readonly faccia: string; readonly chiave: DrawKey }> = [
  { peso: 300, faccia: "Light", chiave: "draw.properties.weight.light" },
  { peso: 400, faccia: "Regular", chiave: "draw.properties.weight.normal" },
  { peso: 500, faccia: "Medium", chiave: "draw.properties.weight.medium" },
  { peso: 600, faccia: "SemiBold", chiave: "draw.properties.weight.semibold" },
  { peso: 700, faccia: "Bold", chiave: "draw.properties.weight.bold" },
  { peso: 800, faccia: "ExtraBold", chiave: "draw.properties.weight.extrabold" },
  { peso: 900, faccia: "Black", chiave: "draw.properties.weight.black" },
];

/// I nomi delle facce per i pesi che il menu non ha.
const ALTRE_FACCE: Readonly<Record<number, string>> = { 100: "Thin", 200: "ExtraLight" };

/// Gli allineamenti del Paragrafo: l'àncora del testo, il valore del motore, il nome e l'icona.
const ALLINEAMENTI: ReadonlyArray<{ readonly ancora: string; readonly justify: string; readonly chiave: DrawKey }> = [
  { ancora: "start", justify: "left", chiave: "draw.paragrafo.sinistra" },
  { ancora: "middle", justify: "center", chiave: "draw.paragrafo.centro" },
  { ancora: "end", justify: "right", chiave: "draw.paragrafo.destra" },
];

/// Le frasi dei problemi di lettura di un campo numerico (le stesse di Trasforma).
const PROBLEMI: Readonly<Record<string, DrawKey>> = {
  empty: "draw.properties.problem.empty",
  syntax: "draw.properties.problem.syntax",
  unit: "draw.properties.problem.unit",
  relative: "draw.properties.problem.relative",
  finite: "draw.properties.problem.finite",
};

/// Le famiglie generiche del CSS, che non sono il nome di un carattere.
const GENERICHE: ReadonlySet<string> = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/// La prima famiglia di un elenco CSS (`"Noto Serif", serif` → `Noto Serif`), senza virgolette.
export function primaFamiglia(elenco: string): string {
  const prima = elenco.split(",")[0]?.trim() ?? "";
  return prima.replace(/^(['"])(.*)\1$/u, "$2");
}

/// Il generico di ripiego di un elenco CSS, se ne ha uno.
function genericoDi(elenco: string): string | undefined {
  const parti = elenco.split(",").map((parte) => parte.trim().toLowerCase());
  return parti.find((parte) => GENERICHE.has(parte));
}

/// Le famiglie della scelta del kit: quelle di Fub, poi quelle del disegno; quella di serie no (non ha
/// un nome da mandare al motore).
export function sceltaDelleFamiglie(famiglie: readonly FamigliaSelezione[]): FontChoice[] {
  const viste = new Set<string>();
  const scelta: FontChoice[] = [];
  for (const famiglia of famiglie) {
    if (famiglia.valore === "") continue;
    const nome = primaFamiglia(famiglia.valore);
    if (nome === "" || viste.has(nome.toLowerCase())) continue;
    viste.add(nome.toLowerCase());
    const source: FontSource = TEXT_FAMILIES.includes(famiglia.valore) ? "system" : "document";
    const generico = genericoDi(famiglia.valore);
    scelta.push({ family: nome, source, ...(generico === undefined ? {} : { generic: generico }) });
  }
  return scelta;
}

/// Il nome della faccia che il motore legge per `peso` e `corsivo`: `Bold Italic`, `Italic`, `Light`.
export function facciaDi(peso: number, corsivo: boolean): string {
  const nome = PESI.find((each) => each.peso === peso)?.faccia ?? ALTRE_FACCE[peso] ?? String(peso);
  if (!corsivo) return nome;
  return peso === 400 ? "Italic" : `${nome} Italic`;
}

/// La parola che il pulsante del carattere mostra per la famiglia del testo.
function nomeDellaFamiglia(testo: TestoSelezione): string | null {
  if (testo.famiglia === null) return null;
  if (testo.famiglia === "") return testo.famiglie.find((each) => each.valore === "")?.nome ?? t("draw.properties.family.default");
  return primaFamiglia(testo.famiglia);
}

/// Il problema di un campo numerico, nella lingua di adesso.
const problemaDi = (unita: string) => (problema: string): string =>
  problema === "mixed" ? t("draw.properties.problem.mixed") : t(PROBLEMI[problema] ?? "draw.properties.problem.syntax", { units: unita });

/// Una voce del menu.
function voce(testo: string, valore: string): HTMLOptionElement {
  const una = document.createElement("option");
  una.textContent = testo;
  una.value = valore;
  return una;
}

/// Il campo dello stile: un menu del peso, con e senza corsivo.
function campoStile(testo: TestoSelezione, esegui: EseguiTesto, vita: Lifetime): HTMLElement {
  const campo = document.createElement("div");
  campo.className = "draw-properties-field draw-type-style";
  const menu = document.createElement("select");
  menu.className = "draw-properties-input";
  menu.id = identifier("draw-type-style");
  const nome = document.createElement("label");
  nome.className = "draw-properties-label";
  nome.htmlFor = menu.id;
  nome.textContent = t("draw.carattere.stile");
  const pesi = PESI.map((each) => each.peso);
  if (testo.peso !== null && !pesi.includes(testo.peso)) {
    pesi.push(testo.peso);
    pesi.sort((a, b) => a - b);
  }
  const misto = testo.peso === null || testo.corsivo === null;
  if (misto) {
    const mista = voce(t("draw.properties.mixed"), "");
    mista.disabled = true;
    menu.append(mista);
  }
  for (const corsivo of [false, true]) {
    for (const peso of pesi) {
      const chiave = PESI.find((each) => each.peso === peso)?.chiave;
      const parola = chiave === undefined ? String(peso) : t(chiave);
      menu.append(voce(corsivo ? t("draw.carattere.corsivo", { peso: parola }) : parola, `${peso}${corsivo ? "i" : ""}`));
    }
  }
  menu.value = misto ? "" : `${testo.peso}${testo.corsivo === true ? "i" : ""}`;
  vita.listen(menu, "change", () => {
    const scelta = /^(\d+)(i?)$/u.exec(menu.value);
    if (scelta === null) return;
    esegui("text.setRangeStyle", { style: facciaDi(Number(scelta[1]), scelta[2] === "i") });
  });
  campo.append(nome, menu);
  return campo;
}

/// La sezione «Carattere» per la scheda Design, da registrare nel Completo aperto: `vita` è quella del
/// Completo, con cui vive il pulsante del carattere (la scelta aperta resta aperta da un giro all'altro).
export function sezioneCarattere(esegui: EseguiTesto, vita: Lifetime): Sezione {
  let pulsante: FontButton | null = null;

  const disegna = (contesto: ContestoSezione): (() => void) => {
    const testo = contesto.sel.testo!;
    const radice = document.createElement("div");
    radice.className = "draw-type";
    const famiglie = sceltaDelleFamiglie(testo.famiglie);
    pulsante ??= fontButton({
      label: t("draw.carattere.famiglia"),
      mixedText: t("draw.carattere.misto"),
      value: null,
      fonts: famiglie,
      text: {
        search: t("draw.carattere.cerca"),
        empty: t("draw.carattere.nessuno"),
        groups: { recent: t("draw.carattere.recenti"), document: t("draw.carattere.documento"), vault: t("draw.carattere.vault"), system: t("draw.carattere.fub") },
      },
      onChange: (famiglia) => esegui("text.setRangeStyle", { font: famiglia }),
      lifetime: vita,
    });
    pulsante.setFonts(famiglie);
    pulsante.setValue(nomeDellaFamiglia(testo));
    const misure = document.createElement("div");
    misure.className = "draw-type-sizes";
    const campi: NumberField[] = [];
    const corpo = testo.corpo;
    if (corpo !== undefined) {
      campi.push(
        numberField({
          label: t("draw.carattere.corpo"),
          value: corpo.valore,
          unit: corpo.unita,
          places: corpo.decimali,
          min: 0.1,
          mixedText: "",
          problem: problemaDi(corpo.unita),
          onCommit: (valore) => {
            if (!(valore > 0)) return t("draw.properties.problem.finite");
            // Il corpo scritto è nell'unità del pannello: il motore lavora nelle unità della scena.
            esegui("text.setRangeStyle", { size: corpo.allaScena(valore) });
            return undefined;
          },
          lifetime: contesto.vita,
        }),
      );
    }
    if (testo.spaziatura !== undefined) {
      campi.push(
        numberField({
          label: t("draw.carattere.spaziatura"),
          value: testo.spaziatura,
          unit: "%",
          relative: true,
          places: 1,
          mixedText: "",
          problem: problemaDi("%"),
          // Il pannello la mostra in percento del corpo; il motore la vuole in millesimi.
          onCommit: (valore) => {
            esegui("text.setRangeStyle", { tracking: valore * 10 });
            return undefined;
          },
          lifetime: contesto.vita,
        }),
      );
    }
    for (const campo of campi) misure.append(campo.element);
    // Il nome sopra il pulsante, come gli altri campi; chi legge lo schermo lo sente dal pulsante
    // stesso («Famiglia: Inter»), una volta sola.
    const famiglia = document.createElement("div");
    famiglia.className = "draw-properties-field draw-type-family";
    const nome = document.createElement("span");
    nome.className = "draw-properties-label";
    nome.setAttribute("aria-hidden", "true");
    nome.textContent = t("draw.carattere.famiglia");
    famiglia.append(nome, pulsante.element);
    radice.append(famiglia, campoStile(testo, esegui, contesto.vita), misure);
    contesto.corpo.append(radice);
    return () => contesto.corpo.replaceChildren();
  };

  return {
    id: "character",
    scheda: "design",
    titolo: t("draw.carattere.titolo"),
    quando: (sel) => sel.testo !== undefined,
    disegna,
  };
}

/// La sezione «Paragrafo» per la scheda Design: l'allineamento del testo scelto.
export function sezioneParagrafo(esegui: EseguiTesto): Sezione {
  const disegna = (contesto: ContestoSezione): (() => void) => {
    const testo = contesto.sel.testo!;
    const campo = document.createElement("div");
    campo.className = "draw-properties-field draw-type-align";
    const nome = document.createElement("span");
    nome.className = "draw-properties-label";
    nome.id = identifier("draw-type-align");
    nome.textContent = t("draw.paragrafo.allinea");
    const fila = document.createElement("div");
    fila.className = "draw-properties-bar";
    fila.setAttribute("role", "toolbar");
    fila.setAttribute("aria-labelledby", nome.id);
    for (const allineamento of ALLINEAMENTI) {
      const pulsante = document.createElement("button");
      pulsante.type = "button";
      pulsante.className = "draw-button draw-properties-segment";
      const parola = t(allineamento.chiave);
      pulsante.setAttribute("aria-label", parola);
      pulsante.title = parola;
      pulsante.setAttribute("aria-pressed", String(testo.allineamento === allineamento.ancora));
      const icona = iconEl(`draw-anchor-${allineamento.ancora}`);
      if (icona !== null) pulsante.append(icona);
      contesto.vita.listen(pulsante, "click", () => {
        if (testo.allineamento !== allineamento.ancora) esegui("text.setStyle", { justify: allineamento.justify });
      });
      fila.append(pulsante);
    }
    campo.append(nome, fila);
    contesto.corpo.append(campo);
    return () => contesto.corpo.replaceChildren();
  };

  return {
    id: "paragraph",
    scheda: "design",
    titolo: t("draw.paragrafo.titolo"),
    quando: (sel) => sel.testo !== undefined,
    disegna,
  };
}

/// Registra Carattere e Paragrafo nel registro del Completo aperto. `false` se c'erano già.
export function registraTesto(sezioni: Sezioni, esegui: EseguiTesto, vita: Lifetime): boolean {
  const carattere = registraSezione({ sezioni }, sezioneCarattere(esegui, vita));
  const paragrafo = registraSezione({ sezioni }, sezioneParagrafo(esegui));
  return carattere && paragrafo;
}
