// I nomi delle sfumature preimpostate del motore nella lingua dell'interfaccia (K6 T15, giro 6).
//
// Il motore dà le sue preimpostate col nome inglese e il tema (la libreria) da cui vengono
// (`gradient.presets.list`). Il nome resta la chiave con cui il motore le applica; qui si mostra la
// traduzione: i nomi fissi uno a uno, quelli composti («Red to Amber», «Coral and Navy», «Red Glow»)
// con lo schema e i colori della lingua. Un nome che la tavola non conosce (una preimpostata nuova del
// motore, o una salvata, che ha il nome scritto da chi la salva) si mostra com'è.

import { t, type DrawKey } from "../strings";

/// I temi del motore, col loro nome.
const TEMI: Readonly<Record<string, DrawKey>> = {
  "Spectrum Gradients": "draw.sfumatura.tema.spettro",
  "Sky Gradients": "draw.sfumatura.tema.cielo",
  "Neutral Gradients": "draw.sfumatura.tema.neutri",
  "Duotone Gradients": "draw.sfumatura.tema.duetoni",
  "Radial Glows": "draw.sfumatura.tema.bagliori",
  "Metallic Gradients": "draw.sfumatura.tema.metalli",
};

/// I nomi fissi.
const FISSI: Readonly<Record<string, DrawKey>> = {
  Spectrum: "draw.sfumatura.nome.spettro",
  "Soft Spectrum": "draw.sfumatura.nome.spettroTenue",
  Dawn: "draw.sfumatura.nome.alba",
  Noon: "draw.sfumatura.nome.mezzogiorno",
  Sunset: "draw.sfumatura.nome.tramonto",
  Dusk: "draw.sfumatura.nome.crepuscolo",
  Night: "draw.sfumatura.nome.notte",
  Overcast: "draw.sfumatura.nome.nuvoloso",
  "White to Black": "draw.sfumatura.nome.biancoNero",
  "Light Grays": "draw.sfumatura.nome.grigiChiari",
  "Dark Grays": "draw.sfumatura.nome.grigiScuri",
  "Warm Grays": "draw.sfumatura.nome.grigiCaldi",
  "Cool Grays": "draw.sfumatura.nome.grigiFreddi",
  "Fade to Transparent": "draw.sfumatura.nome.trasparente",
  "White Fade": "draw.sfumatura.nome.dissolvenzaBianca",
  Vignette: "draw.sfumatura.nome.vignettatura",
  Gold: "draw.sfumatura.nome.oro",
  Silver: "draw.sfumatura.nome.argento",
  Bronze: "draw.sfumatura.nome.bronzo",
  Copper: "draw.sfumatura.nome.rame",
  Brass: "draw.sfumatura.nome.ottone",
  Chrome: "draw.sfumatura.nome.cromo",
  "Rose Gold": "draw.sfumatura.nome.oroRosa",
  Gunmetal: "draw.sfumatura.nome.cannaDiFucile",
  Platinum: "draw.sfumatura.nome.platino",
  Pewter: "draw.sfumatura.nome.peltro",
};

/// Le tinte di «A to B» e di «A Glow».
const TINTE: Readonly<Record<string, DrawKey>> = {
  Red: "draw.sfumatura.tinta.rosso",
  Orange: "draw.sfumatura.tinta.arancione",
  Amber: "draw.sfumatura.tinta.ambra",
  Yellow: "draw.sfumatura.tinta.giallo",
  Lime: "draw.sfumatura.tinta.lime",
  Green: "draw.sfumatura.tinta.verde",
  Teal: "draw.sfumatura.tinta.verdeAcqua",
  Cyan: "draw.sfumatura.tinta.ciano",
  Azure: "draw.sfumatura.tinta.azzurro",
  Blue: "draw.sfumatura.tinta.blu",
  Violet: "draw.sfumatura.tinta.viola",
  Magenta: "draw.sfumatura.tinta.magenta",
};

/// I colori di «A and B».
const DUE_TONI: Readonly<Record<string, DrawKey>> = {
  Coral: "draw.sfumatura.duo.corallo",
  Navy: "draw.sfumatura.duo.bluNotte",
  Plum: "draw.sfumatura.duo.prugna",
  Lime: "draw.sfumatura.duo.lime",
  Teal: "draw.sfumatura.duo.verdeAcqua",
  Gold: "draw.sfumatura.duo.oro",
  Indigo: "draw.sfumatura.duo.indaco",
  Peach: "draw.sfumatura.duo.pesca",
  Forest: "draw.sfumatura.duo.verdeBosco",
  Rose: "draw.sfumatura.duo.rosa",
};

/// La prima lettera maiuscola: i colori della lingua stanno minuscoli dentro una frase.
function maiuscola(testo: string): string {
  return testo.length === 0 ? testo : testo[0]!.toLocaleUpperCase() + testo.slice(1);
}

/// Il nome di un tema del motore nella lingua di adesso; `null` per le salvate.
export function nomeDelTema(tema: string | null): string {
  if (tema === null) return t("draw.sfumatura.tema.salvate");
  const chiave = TEMI[tema];
  return chiave === undefined ? tema : t(chiave);
}

/// Il nome di una preimpostata del motore nella lingua di adesso. Una salvata (`delMotore` falso) si
/// mostra col nome che le ha dato chi l'ha salvata.
export function nomeDellaPreimpostata(nome: string, delMotore: boolean): string {
  if (!delMotore) return nome;
  const fisso = FISSI[nome];
  if (fisso !== undefined) return t(fisso);
  const da = /^(\w+) to (\w+)$/.exec(nome);
  if (da !== null && TINTE[da[1]!] !== undefined && TINTE[da[2]!] !== undefined) {
    const a = t(TINTE[da[1]!]!);
    const b = t(TINTE[da[2]!]!);
    // «ad» davanti a una vocale «a», come si scrive in italiano; l'inglese ha lo stesso testo.
    const schema: DrawKey = /^a/i.test(b) ? "draw.sfumatura.schema.daVocale" : "draw.sfumatura.schema.da";
    return maiuscola(t(schema, { a, b }));
  }
  const coppia = /^(\w+) and (\w+)$/.exec(nome);
  if (coppia !== null && DUE_TONI[coppia[1]!] !== undefined && DUE_TONI[coppia[2]!] !== undefined) {
    return maiuscola(t("draw.sfumatura.schema.e", { a: t(DUE_TONI[coppia[1]!]!), b: t(DUE_TONI[coppia[2]!]!) }));
  }
  const bagliore = /^(\w+) Glow$/.exec(nome);
  if (bagliore !== null && TINTE[bagliore[1]!] !== undefined) {
    return maiuscola(t("draw.sfumatura.schema.bagliore", { tinta: t(TINTE[bagliore[1]!]!) }));
  }
  return nome;
}
