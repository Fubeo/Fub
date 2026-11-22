// La sezione «Sfumatura» del Design del Completo (K6 T15, giro 5): il tipo, l'angolo e i punti della
// sfumatura lineare o radiale del riempimento o del contorno delle forme scelte.
//
// - **I valori dalla vista del pannello** (`misure.sfumature`): il pannello legge le sfumature dal
//   disegno, senza chiedere il motore.
// - **Un cambio, un comando, un passo di Annulla.** Il tipo, l'angolo, l'inversione e ogni punto
//   (aggiunto, tolto, spostato, ricolorato, più o meno opaco) mandano `paint.editGradient` dal percorso
//   unico, senza la finestra della voce: i punti vanno tutti insieme, in ordine. «Crea una sfumatura»
//   dà quella di serie del motore a un colore pieno. Scegliere un punto lo dice al motore con
//   `gradient.selectStop`, perché i suoi tasti agiscano sullo stesso punto.
// - **L'angolo è quello del motore**, come in Illustrator: in gradi, in senso antiorario, 0 da sinistra a
//   destra. La scena lo scrive in senso orario; la sezione lo gira.
// - **Spenta col perché**: senza una selezione, con un oggetto bloccato, con soli testi (la scena non
//   scrive la sfumatura dei caratteri), su un colore che la selezione non ha.
// - **Gli stessi pozzi da un giro all'altro**, come nella sezione Colore: il pozzo di un punto resta lo
//   stesso elemento, così il selettore aperto non si chiude a ogni colore scelto.
// - **Le preimpostate** (giro 6), in fondo, chiuse finché non si aprono: l'elenco si legge dal motore
//   la prima volta che si aprono (`sfumature-preimpostate.ts`). Applicarne una manda
//   `gradient.presets.apply` dal percorso unico, un passo di Annulla; salvare quella mostrata e togliere
//   una salvata cambiano le preferenze del motore, non il disegno. Il nome si controlla qui: il motore
//   non riceve mai un nome vuoto o già preso.

import { colorWell, type ColorWell } from "../../../kit/color/well";
import { textField } from "../../../kit/field";
import { numberField } from "../../../kit/number-field";
import type { Lifetime } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import { drawPickerText } from "../tools/color-text";
import type { Lato, LatoAttivo } from "./colore-sezione";
import { nomeDelTema, nomeDellaPreimpostata } from "./sfumature-nomi";
import { problemaDelNome, type EsitoElenco, type PortaPreimpostate, type Preimpostata } from "./sfumature-preimpostate";
import { registraSezione, type ContestoSezione, type PuntoSfumatura, type Sezione, type SfumaturaSelezione, type Sezioni } from "./sezioni";

/// Il comando del motore: l'id della voce e i suoi valori.
export type EseguiSfumatura = (id: string, valori: Readonly<Record<string, unknown>>) => void;

/// Il tipo di una sfumatura, col nome che mostra.
const TIPI: ReadonlyArray<readonly ["linear" | "radial", DrawKey]> = [
  ["linear", "draw.sfumatura.lineare"],
  ["radial", "draw.sfumatura.radiale"],
];

/// Il perché di un Salva o Elimina rifiutato dall'host: le preferenze del motore non si scrivono.
function testoDelBlocco(perche: "nuove" | "rotte"): string {
  return t(perche === "nuove" ? "draw.sfumatura.preimpostate.nuove" : "draw.sfumatura.preimpostate.rotte");
}

/// I punti di una sfumatura, al minimo.
const PUNTI_MINIMI = 2;

/// `gradi` fra -180 escluso e 180, al centesimo, senza `-0`.
function angoloNormale(gradi: number): number {
  const girato = gradi - 360 * Math.floor((gradi + 180) / 360);
  return Math.round((girato === -180 ? 180 : girato) * 100) / 100 || 0;
}

/// I punti in ordine, come li vuole il motore.
function inOrdine(punti: readonly PuntoSfumatura[]): PuntoSfumatura[] {
  return punti
    .map((punto, dove) => ({ punto, dove }))
    .sort((p, q) => p.punto.offset - q.punto.offset || p.dove - q.dove)
    .map(({ punto }) => punto);
}

/// Il colore a metà fra `p` e `q`, `#rrggbb`.
function aMeta(p: string, q: string): string {
  const canale = (colore: string, i: number): number => Number.parseInt(colore.slice(1 + 2 * i, 3 + 2 * i), 16) || 0;
  return `#${[0, 1, 2].map((i) => Math.round((canale(p, i) + canale(q, i)) / 2).toString(16).padStart(2, "0")).join("")}`;
}

/// Un punto nuovo nel tratto più lungo fra due punti, col colore e l'opacità a metà.
export function conUnPuntoInPiu(punti: readonly PuntoSfumatura[]): PuntoSfumatura[] {
  const ordinati = inOrdine(punti);
  let largo = -1;
  let dopo = 1;
  for (let i = 1; i < ordinati.length; i++) {
    const tratto = ordinati[i]!.offset - ordinati[i - 1]!.offset;
    if (tratto > largo) {
      largo = tratto;
      dopo = i;
    }
  }
  const p = ordinati[dopo - 1]!;
  const q = ordinati[dopo]!;
  const nuovo = { offset: Math.round(((p.offset + q.offset) / 2) * 10000) / 10000, color: aMeta(p.color, q.color), opacity: (p.opacity + q.opacity) / 2 };
  return [...ordinati.slice(0, dopo), nuovo, ...ordinati.slice(dopo)];
}

/// L'immagine CSS dei punti, da sinistra a destra.
function immagineDi(punti: readonly PuntoSfumatura[]): string {
  const rgba = (punto: PuntoSfumatura): string => {
    const c = (i: number): number => Number.parseInt(punto.color.slice(1 + 2 * i, 3 + 2 * i), 16) || 0;
    return `rgb(${c(0)} ${c(1)} ${c(2)} / ${punto.opacity})`;
  };
  return `linear-gradient(to right, ${punti.map((punto) => `${rgba(punto)} ${Math.round(punto.offset * 10000) / 100}%`).join(", ")})`;
}

/// Che cosa non va in un numero scritto.
function problemaDi(problema: string): string {
  if (problema === "mixed") return t("draw.properties.problem.mixed");
  return t(problema === "empty" ? "draw.properties.problem.empty" : "draw.properties.problem.syntax");
}

/// Una nota della sezione.
function nota(testo: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "draw-properties-note draw-gradient-note";
  p.textContent = testo;
  return p;
}

/// Un pulsante di testo della sezione.
function pulsante(testo: string, suggerimento?: string): HTMLButtonElement {
  const bottone = document.createElement("button");
  bottone.type = "button";
  bottone.className = "kit-button";
  bottone.textContent = testo;
  if (suggerimento !== undefined) bottone.title = suggerimento;
  return bottone;
}

/// Una scelta con la sua etichetta; con `valore` `null` la prima voce è «Misto», che non si sceglie.
function scelta<T extends string>(
  classe: string,
  etichetta: string,
  voci: ReadonlyArray<readonly [T, string]>,
  valore: T | null,
  cambia: (valore: T) => void,
): { readonly radice: HTMLLabelElement; readonly select: HTMLSelectElement } {
  const select = document.createElement("select");
  select.className = `draw-properties-input ${classe}`;
  if (valore === null) {
    const misto = document.createElement("option");
    misto.value = "";
    misto.textContent = t("draw.properties.mixed");
    select.append(misto);
  }
  for (const [chiave, nome] of voci) {
    const voce = document.createElement("option");
    voce.value = chiave;
    voce.textContent = nome;
    select.append(voce);
  }
  select.value = valore ?? "";
  select.addEventListener("change", () => {
    if (select.value !== "") cambia(select.value as T);
  });
  const radice = document.createElement("label");
  radice.className = "draw-properties-field draw-gradient-field";
  radice.append(etichetta, select);
  return { radice, select };
}

/// Il nome di un lato nella lingua di adesso.
const nomeDi = (lato: Lato): string => t(lato === "fill" ? "draw.properties.fill" : "draw.properties.stroke");

/// La sezione «Sfumatura» per la scheda Design: `vita` è quella del Completo, con cui vivono i pozzi
/// dei punti; `stato` il lato attivo della sezione Colore, che la sezione mostra finché non se ne
/// sceglie un altro qui; `preimpostate` la porta delle preimpostate del motore (senza, il blocco non c'è).
export function sezioneSfumatura(
  esegui: EseguiSfumatura,
  vita: Lifetime,
  stato: LatoAttivo = { lato: "fill" },
  preimpostate?: PortaPreimpostate,
): Sezione {
  /// Il lato scelto nella sezione; `null` finché segue quello della sezione Colore.
  let scelto: Lato | null = null;
  /// Il punto scelto, per segnarlo: il suo posto fra i punti in ordine.
  let puntoScelto: number | null = null;
  /// I punti mostrati adesso e il lato, che i pozzi leggono quando cambia un colore.
  let attuali: readonly PuntoSfumatura[] = [];
  let latoAdesso: Lato = "fill";
  let spentaAdesso = true;
  const pozzi: ColorWell[] = [];

  // Le preimpostate, che restano da un giro all'altro: aperte o no, l'elenco letto, quella scelta, il
  // nome scritto per salvare, l'ultimo avviso e se una richiesta è in volo.
  let aperte = false;
  let elencoPreimpostate: EsitoElenco | "carica" | null = null;
  let preimpostataScelta: string | null = null;
  let nomeScritto = "";
  let avviso: { readonly testo: string; readonly errore: boolean } | null = null;
  let inVolo = false;
  /// Chiede di rifare la sezione: lo cambia ogni `disegna`.
  let rifai: () => void = () => {};

  /// Legge l'elenco dal motore e rifà la sezione quando arriva.
  const leggiPreimpostate = (): void => {
    if (preimpostate === undefined || elencoPreimpostate === "carica") return;
    elencoPreimpostate = "carica";
    void preimpostate.elenco().then((esito) => {
      if (vita.closed) return;
      elencoPreimpostate = esito;
      rifai();
    });
  };

  /// Salva o toglie, poi rilegge l'elenco.
  const inMotore = (richiesta: () => Promise<void>): void => {
    if (inVolo) return;
    inVolo = true;
    rifai();
    void richiesta().then(() => {
      inVolo = false;
      if (vita.closed) return;
      elencoPreimpostate = null;
      leggiPreimpostate();
      rifai();
    });
  };

  /// Il blocco delle preimpostate: `salvabili` i punti della sfumatura mostrata, se se ne può salvare una.
  const bloccoPreimpostate = (lato: Lato, spenta: boolean, salvabili: readonly PuntoSfumatura[] | null): HTMLElement | null => {
    const porta = preimpostate;
    if (porta === undefined) return null;
    const blocco = document.createElement("details");
    blocco.className = "draw-gradient-presets";
    blocco.open = aperte;
    const titolo = document.createElement("summary");
    titolo.className = "draw-gradient-presets-title";
    titolo.textContent = t("draw.sfumatura.preimpostate");
    blocco.append(titolo);
    blocco.addEventListener("toggle", () => {
      if (blocco.open === aperte) return;
      aperte = blocco.open;
      if (aperte && elencoPreimpostate === null) leggiPreimpostate();
      rifai();
    });
    if (!aperte) return blocco;
    if (elencoPreimpostate === null) leggiPreimpostate();
    const lettura = elencoPreimpostate;
    if (lettura === null || lettura === "carica") {
      blocco.append(nota(t("draw.sfumatura.preimpostate.carica")));
      return blocco;
    }
    if (lettura.kind === "assente") {
      const errore = nota(t("draw.sfumatura.preimpostate.errore"));
      errore.classList.add("draw-gradient-presets-error");
      const riprova = pulsante(t("draw.sfumatura.preimpostate.riprova"));
      riprova.classList.add("draw-gradient-presets-retry");
      riprova.addEventListener("click", () => {
        elencoPreimpostate = null;
        leggiPreimpostate();
        rifai();
      });
      blocco.append(errore, riprova);
      return blocco;
    }
    const elenco = lettura.preimpostate;
    if (preimpostataScelta === null || !elenco.some((p) => p.nome === preimpostataScelta)) preimpostataScelta = elenco[0]?.nome ?? null;
    const scelta: Preimpostata | undefined = elenco.find((p) => p.nome === preimpostataScelta);

    // La scelta, coi temi del motore in gruppi e le salvate per ultime.
    const select = document.createElement("select");
    select.className = "draw-properties-input draw-gradient-preset";
    const gruppi = new Map<string | null, HTMLOptGroupElement>();
    for (const p of elenco) {
      let gruppo = gruppi.get(p.tema);
      if (gruppo === undefined) {
        gruppo = document.createElement("optgroup");
        gruppo.label = nomeDelTema(p.tema);
        gruppi.set(p.tema, gruppo);
      }
      const voce = document.createElement("option");
      voce.value = p.nome;
      voce.textContent = nomeDellaPreimpostata(p.nome, p.delMotore);
      gruppo.append(voce);
    }
    const salvate = gruppi.get(null);
    gruppi.delete(null);
    select.append(...gruppi.values(), ...(salvate === undefined ? [] : [salvate]));
    select.value = preimpostataScelta ?? "";
    select.addEventListener("change", () => {
      preimpostataScelta = select.value;
      avviso = null;
      rifai();
    });
    const campo = document.createElement("label");
    campo.className = "draw-properties-field draw-gradient-field";
    campo.append(t("draw.sfumatura.preimpostate.scelta"), select);
    blocco.append(campo);

    if (scelta !== undefined) {
      const nomeMostrato = nomeDellaPreimpostata(scelta.nome, scelta.delMotore);
      const anteprima = document.createElement("div");
      anteprima.className = "draw-gradient-bar draw-gradient-preset-bar";
      anteprima.setAttribute("role", "img");
      anteprima.setAttribute("aria-label", t("draw.sfumatura.preimpostate.anteprima", { nome: nomeMostrato }));
      anteprima.style.backgroundImage = immagineDi(scelta.punti);
      const azioni = document.createElement("div");
      azioni.className = "draw-gradient-actions";
      const applica = pulsante(t("draw.sfumatura.applica"), t("draw.sfumatura.applica.nota", { nome: nomeMostrato }));
      applica.classList.add("draw-gradient-apply");
      applica.disabled = spenta;
      applica.addEventListener("click", () => {
        if (applica.disabled) return;
        avviso = null;
        esegui("gradient.presets.apply", { name: scelta.nome, stroke: lato === "stroke" });
      });
      azioni.append(applica);
      if (!scelta.delMotore) {
        const elimina = pulsante(t("draw.sfumatura.elimina"), t("draw.sfumatura.elimina.nota", { nome: nomeMostrato }));
        elimina.classList.add("draw-gradient-delete");
        elimina.disabled = inVolo;
        elimina.addEventListener("click", () => {
          if (elimina.disabled) return;
          inMotore(async () => {
            const esito = await porta.togli(scelta.nome);
            avviso =
              esito.kind === "fatto"
                ? { testo: t("draw.sfumatura.elimina.fatto", { nome: scelta.nome }), errore: false }
                : esito.kind === "vuoto"
                  ? { testo: t("draw.sfumatura.elimina.vuota", { nome: scelta.nome }), errore: true }
                  : esito.kind === "bloccato"
                    ? { testo: testoDelBlocco(esito.perche), errore: true }
                    : { testo: t("draw.sfumatura.preimpostate.motore"), errore: true };
            if (esito.kind === "fatto" || esito.kind === "vuoto") preimpostataScelta = null;
          });
        });
        azioni.append(elimina);
      }
      blocco.append(anteprima, azioni);
    }

    // Salvare la sfumatura mostrata: solo quando ce n'è una, con gli stessi punti per tutti.
    if (!spenta && salvabili !== null) {
      const riga = document.createElement("div");
      riga.className = "draw-gradient-save";
      // Il campo di testo del kit, col nome per chi ascolta: è lo stesso degli altri campi di Fub.
      const campoNome = textField({
        label: t("draw.sfumatura.salva.nome"),
        labelHidden: true,
        placeholder: t("draw.sfumatura.salva.segnaposto"),
        value: nomeScritto,
        onInput: (valore) => {
          nomeScritto = valore;
        },
        // Invio salva, come il pulsante; il campo del kit non lo prende a metà di una composizione.
        onSubmit: () => fai(),
      });
      const nome = campoNome.input;
      nome.classList.add("draw-gradient-save-name");
      nome.maxLength = 80;
      const salva = pulsante(t("draw.sfumatura.salva"), t("draw.sfumatura.salva.nota"));
      salva.classList.add("draw-gradient-save-button");
      salva.disabled = inVolo;
      const fai = (): void => {
        if (salva.disabled) return;
        const problema = problemaDelNome(nome.value, elenco);
        if (problema !== null) {
          avviso = {
            testo: problema === "vuoto" ? t("draw.sfumatura.salva.vuoto") : t("draw.sfumatura.salva.preso", { nome: nome.value.trim() }),
            errore: true,
          };
          rifai();
          return;
        }
        const pulito = nome.value.trim();
        inMotore(async () => {
          const esito = await porta.salva(pulito, lato, stato.lato);
          if (esito.kind === "fatto") {
            avviso = { testo: t("draw.sfumatura.salva.fatto", { nome: esito.nome }), errore: false };
            nomeScritto = "";
            preimpostataScelta = esito.nome;
          } else {
            avviso = {
              testo:
                esito.kind === "bloccato"
                  ? testoDelBlocco(esito.perche)
                  : t(esito.kind === "vuoto" ? "draw.sfumatura.salva.niente" : "draw.sfumatura.preimpostate.motore"),
              errore: true,
            };
          }
        });
      };
      salva.addEventListener("click", fai);
      riga.append(campoNome.element, salva);
      blocco.append(riga);
    }
    if (avviso !== null) {
      const testo = nota(avviso.testo);
      testo.classList.add("draw-gradient-presets-notice");
      testo.classList.toggle("draw-gradient-presets-error", avviso.errore);
      testo.setAttribute("role", avviso.errore ? "alert" : "status");
      blocco.append(testo);
    }
    return blocco;
  };

  const mandaPunti = (punti: readonly PuntoSfumatura[]): void => {
    if (spentaAdesso) return;
    esegui("paint.editGradient", { stroke: latoAdesso === "stroke", stops: inOrdine(punti).map(({ offset, color, opacity }) => ({ offset, color, opacity })) });
  };

  /// Il pozzo del punto `i`, lo stesso da un giro all'altro.
  const pozzoDi = (i: number): ColorWell => {
    while (pozzi.length <= i) {
      const dove = pozzi.length;
      pozzi.push(
        colorWell({
          label: t("draw.sfumatura.colore", { n: String(dove + 1) }),
          mixedText: t("draw.properties.mixed"),
          text: drawPickerText(),
          value: null,
          allowNone: false,
          onChange: (colore) => {
            if (colore === "none" || attuali[dove] === undefined) return;
            mandaPunti(attuali.map((punto, j) => (j === dove ? { ...punto, color: colore.toLowerCase() } : punto)));
          },
          lifetime: vita,
        }),
      );
    }
    return pozzi[i]!;
  };

  const disegna = (contesto: ContestoSezione): (() => void) => {
    const corpo = contesto.corpo;
    rifai = contesto.aggiorna;
    const radice = document.createElement("div");
    radice.className = "draw-gradient";
    corpo.append(radice);
    /// Le preimpostate in fondo, poi il disposer.
    const fine = (salvabili: readonly PuntoSfumatura[] | null, smonta: () => void): (() => void) => {
      const blocco = bloccoPreimpostate(latoAdesso, spentaAdesso, salvabili);
      if (blocco !== null) radice.append(blocco);
      return smonta;
    };
    const tutte = contesto.misure?.sfumature;
    const vuota = contesto.sel.numero === 0;
    const lato: Lato = scelto ?? stato.lato;
    latoAdesso = lato;
    const sfumatura: SfumaturaSelezione | undefined = lato === "fill" ? tutte?.riempimento : tutte?.contorno;
    const perche = vuota
      ? t("draw.sfumatura.vuota")
      : tutte?.soloTesto === true
        ? t("draw.sfumatura.testo")
        : tutte?.bloccato === true
          ? t("draw.sfumatura.bloccato")
          : sfumatura === undefined
            ? t("draw.sfumatura.manca", { lato: nomeDi(lato) })
            : null;
    const spenta = perche !== null;
    spentaAdesso = spenta;

    // Il colore che la sezione cambia: il riempimento o il contorno.
    const latoScelta = scelta<Lato>(
      "draw-gradient-side",
      t("draw.sfumatura.lato"),
      [
        ["fill", nomeDi("fill")],
        ["stroke", nomeDi("stroke")],
      ],
      lato,
      (nuovo) => {
        scelto = nuovo;
        puntoScelto = null;
        contesto.aggiorna();
      },
    );
    latoScelta.select.disabled = vuota;
    radice.append(latoScelta.radice);
    if (perche !== null) radice.append(nota(perche));

    const stroke = lato === "stroke";
    const conSfumatura = sfumatura !== undefined && sfumatura.conSfumatura > 0;
    if (!conSfumatura) {
      // Un colore pieno: la sfumatura di serie del motore, poi si cambia.
      if (sfumatura !== undefined && !spenta) radice.append(nota(t("draw.sfumatura.piena", { lato: nomeDi(lato) })));
      const crea = pulsante(t("draw.sfumatura.crea"));
      crea.classList.add("draw-gradient-create");
      crea.disabled = spenta;
      crea.addEventListener("click", () => {
        if (!crea.disabled) esegui("paint.editGradient", { stroke, kind: "linear" });
      });
      radice.append(crea);
      attuali = [];
      return fine(null, () => corpo.replaceChildren());
    }
    if (sfumatura.conSfumatura < sfumatura.parti) radice.append(nota(t("draw.sfumatura.inParte")));

    const tipo = scelta(
      "draw-gradient-kind",
      t("draw.sfumatura.tipo"),
      TIPI.map(([chiave, nome]) => [chiave, t(nome)] as const),
      sfumatura.tipo,
      (kind) => {
        if (!spenta) esegui("paint.editGradient", { stroke, kind });
      },
    );
    tipo.select.disabled = spenta;
    const angolo = numberField({
      label: t("draw.sfumatura.angolo"),
      value: sfumatura.angolo === null ? null : angoloNormale(-sfumatura.angolo),
      unit: "°",
      places: 2,
      min: -360,
      max: 360,
      mixedText: t("draw.properties.mixed"),
      problem: problemaDi,
      onCommit: (gradi) => {
        if (!spenta) esegui("paint.editGradient", { stroke, angle: angoloNormale(gradi) });
        return undefined;
      },
      lifetime: contesto.vita,
    });
    angolo.setDisabled(spenta);
    const coppia = document.createElement("div");
    coppia.className = "draw-gradient-row";
    coppia.append(tipo.radice, angolo.element);
    radice.append(coppia);

    const punti = sfumatura.punti;
    attuali = punti ?? [];
    if (punti === null) {
      radice.append(nota(t("draw.sfumatura.diverse")));
      return fine(null, () => corpo.replaceChildren());
    }

    const barra = document.createElement("div");
    barra.className = "draw-gradient-bar";
    barra.setAttribute("aria-hidden", "true");
    barra.style.backgroundImage = immagineDi(punti);

    const elenco = document.createElement("ol");
    elenco.className = "draw-gradient-stops";
    elenco.setAttribute("aria-label", t("draw.sfumatura.punti"));
    if (puntoScelto !== null && puntoScelto >= punti.length) puntoScelto = null;
    punti.forEach((punto, i) => {
      const riga = document.createElement("li");
      riga.className = "draw-gradient-stop";
      riga.dataset.index = String(i);
      riga.setAttribute("aria-label", t("draw.sfumatura.punto", { n: String(i + 1) }));
      riga.classList.toggle("draw-gradient-stop-chosen", puntoScelto === i);
      const pozzo = pozzoDi(i);
      pozzo.setValue(punto.color);
      pozzo.button.disabled = spenta;
      if (spenta) pozzo.close();
      const posizione = numberField({
        label: t("draw.sfumatura.posizione"),
        value: Math.round(punto.offset * 10000) / 100,
        unit: "%",
        places: 2,
        min: 0,
        max: 100,
        mixedText: "",
        problem: problemaDi,
        onCommit: (valore) => {
          mandaPunti(punti.map((p, j) => (j === i ? { ...p, offset: valore / 100 } : p)));
          return undefined;
        },
        lifetime: contesto.vita,
      });
      const opacita = numberField({
        label: t("draw.sfumatura.opacita"),
        value: Math.round(punto.opacity * 1000) / 10,
        unit: "%",
        places: 1,
        min: 0,
        max: 100,
        mixedText: "",
        problem: problemaDi,
        onCommit: (valore) => {
          mandaPunti(punti.map((p, j) => (j === i ? { ...p, opacity: valore / 100 } : p)));
          return undefined;
        },
        lifetime: contesto.vita,
      });
      posizione.setDisabled(spenta);
      opacita.setDisabled(spenta);
      const togli = pulsante(t("draw.sfumatura.togli"));
      togli.classList.add("draw-gradient-remove");
      const ultimi = punti.length <= PUNTI_MINIMI;
      togli.disabled = spenta || ultimi;
      const nomeTogli = ultimi ? t("draw.sfumatura.minimo") : t("draw.sfumatura.togli.nota", { n: String(i + 1) });
      togli.title = nomeTogli;
      togli.setAttribute("aria-label", nomeTogli);
      togli.addEventListener("click", () => {
        if (togli.disabled) return;
        puntoScelto = null;
        mandaPunti(punti.filter((_, j) => j !== i));
      });
      riga.append(pozzo.element, posizione.element, opacita.element, togli);
      // Scegliere un punto lo dice al motore: i suoi tasti e il pannello agiscono su quello.
      riga.addEventListener("focusin", () => {
        if (spenta || puntoScelto === i) return;
        puntoScelto = i;
        for (const altra of elenco.children) altra.classList.toggle("draw-gradient-stop-chosen", altra === riga);
        esegui("gradient.selectStop", { index: i });
      });
      elenco.append(riga);
    });

    const azioni = document.createElement("div");
    azioni.className = "draw-gradient-actions";
    const aggiungi = pulsante(t("draw.sfumatura.aggiungi"));
    aggiungi.disabled = spenta;
    aggiungi.addEventListener("click", () => {
      if (!aggiungi.disabled) mandaPunti(conUnPuntoInPiu(punti));
    });
    const inverti = pulsante(t("draw.sfumatura.inverti"), t("draw.sfumatura.inverti.nota"));
    inverti.disabled = spenta;
    inverti.addEventListener("click", () => {
      if (!inverti.disabled) esegui("paint.editGradient", { stroke, reverse: true });
    });
    azioni.append(aggiungi, inverti);
    radice.append(barra, elenco, azioni);
    return fine(punti, () => {
      for (const pozzo of pozzi) pozzo.element.remove();
      corpo.replaceChildren();
    });
  };

  return {
    id: "sfumatura",
    scheda: "design",
    titolo: t("draw.sfumatura.titolo"),
    disegna,
  };
}

/// Registra la sezione nel registro del Completo aperto. `false` se c'è già.
export function registraSfumatura(
  sezioni: Sezioni,
  esegui: EseguiSfumatura,
  vita: Lifetime,
  stato?: LatoAttivo,
  preimpostate?: PortaPreimpostate,
): boolean {
  return registraSezione({ sezioni }, sezioneSfumatura(esegui, vita, stato, preimpostate));
}
