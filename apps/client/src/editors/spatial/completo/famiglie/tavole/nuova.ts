// «Opzioni nuova tavola…» (`ui.newArtboard`, VectorCraft: New Artboard Options…, Alt+clic su Nuova
// tavola nel pannello Tavole): le Opzioni tavola per una tavola che ancora non c'è, compilate come
// `artboard.new {}` la farebbe (il nome che le darebbe, le misure dell'ultima tavola, 20 a destra
// di lei; senza tavole 612 × 792 nell'origine). OK manda `artboard.new` coi campi e la tavola nuova
// diventa quella attuale; Annulla non aggiunge niente. Il colore e i segni della tavola non ci sono:
// il file non li tiene ancora.

import { openDialog } from "../../../../../kit/dialog";
import { numberField } from "../../../../../kit/number-field";
import { openLifetime } from "../../../../../ui/lifetime";
import { problemaDelNumero } from "../../opzioni";
import type { TavoleDocumento } from "../../sezioni";

/// I campi della tavola nuova, come `artboard.new` li prende.
export interface NuovaTavola {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/// La distanza dall'ultima tavola, e le misure senza tavole: quelle di `artboard.new`.
const DISTANZA = 20;
const SENZA_TAVOLE = [0, 0, 612, 792] as const;

/// Il nome di serie di una tavola nuova nel file (`Artboard N` del motore, `tavole.rs`).
const nome = (numero: number): string => `Tavola ${numero}`;

/// I campi come `artboard.new {}` farebbe la tavola: «Tavola N» col primo N dal numero delle
/// tavole più uno che nessuna ha già, le misure dell'ultima, a 20 alla sua destra.
export function nuovaTavolaDiSerie(tavole: TavoleDocumento | undefined): NuovaTavola {
  const elenco = tavole?.elenco ?? [];
  const ultima = elenco[elenco.length - 1];
  const [x, y, w, h] = ultima === undefined ? SENZA_TAVOLE : ultima.rect;
  const usati = new Set(elenco.map((t) => t.nome));
  let numero = elenco.length + 1;
  while (usati.has(nome(numero))) numero += 1;
  return ultima === undefined
    ? { name: nome(numero), x, y, width: w, height: h }
    : { name: nome(numero), x: x + w + DISTANZA, y, width: w, height: h };
}

/// I valori di `artboard.new` dai campi: il nome solo se non è quello di serie, così il motore dà
/// alla tavola il suo nome come col clic semplice.
export function valoriNuovaTavola(campi: NuovaTavola, diSerie: NuovaTavola): Readonly<Record<string, unknown>> {
  const { name, ...resto } = campi;
  return name === diSerie.name ? { ...resto } : { ...campi };
}

/// Il dialogo: i campi della tavola, o `null` se si annulla.
export function chiediNuovaTavola(parti: NuovaTavola, parola: (chiave: string) => string): Promise<NuovaTavola | null> {
  const vita = openLifetime();
  const corpo = document.createElement("div");
  corpo.className = "draw-artboards-new";
  const etichetta = document.createElement("label");
  etichetta.className = "kit-number-label";
  etichetta.textContent = parola("tavole.nome");
  const nome = document.createElement("input");
  nome.type = "text";
  nome.className = "draw-properties-input draw-artboards-name-input";
  nome.id = "draw-artboards-new-name";
  nome.value = parti.name;
  etichetta.htmlFor = nome.id;
  const rigaNome = document.createElement("div");
  rigaNome.className = "draw-artboards-name-field";
  rigaNome.append(etichetta, nome);
  corpo.append(rigaNome);
  const campo = (chiave: string, valore: number, min?: number) => {
    const f = numberField({
      label: parola(chiave),
      value: valore,
      unit: "px",
      places: 2,
      ...(min === undefined ? {} : { min }),
      mixedText: "",
      problem: problemaDelNumero,
      onCommit: (v) => (min !== undefined && !(v > 0) ? parola("tavole.misura") : undefined),
      lifetime: vita,
    });
    f.element.dataset.field = chiave;
    corpo.append(f.element);
    return f;
  };
  const x = campo("tavole.x", parti.x);
  const y = campo("tavole.y", parti.y);
  const w = campo("tavole.larghezza", parti.width, 0.001);
  const h = campo("tavole.altezza", parti.height, 0.001);
  const dialogo = openDialog<"ok" | "annulla">({
    title: parola("tavole.nuova.titolo"),
    description: parola("tavole.nuova.descrizione"),
    body: corpo,
    actions: [
      { id: "cancel", label: parola("tavole.nuova.annulla"), value: "annulla" },
      { id: "apply", label: parola("tavole.nuova.ok"), kind: "primary", value: "ok" },
    ],
    dismissValue: "annulla",
    lifetime: vita,
    submit: "apply",
    className: "draw-artboards-new-dialog",
  });
  return dialogo.result.then((scelta) => {
    const testo = nome.value.trim();
    const valori = {
      name: testo === "" ? parti.name : testo,
      x: x.value() ?? parti.x,
      y: y.value() ?? parti.y,
      width: w.value() ?? parti.width,
      height: h.value() ?? parti.height,
    };
    vita.close();
    return scelta === "ok" && valori.width > 0 && valori.height > 0 ? valori : null;
  });
}
