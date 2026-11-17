// Le stringhe dei comandi dei fogli nella tavolozza dei comandi.
//
// Ogni comando del catalogo (`catalogo.generated.json`) ha qui il suo titolo,
// con la chiave che il catalogo gli dà (`fogli.cmd.<comando>`), e ogni campo
// dei suoi parametri il suo nome (`fogli.campo.<campo>`), per la finestra che
// la tavolozza costruisce quando il comando non ne ha una scritta a mano.
//
// Arrivano con i comandi, che la superficie della griglia carica con un
// `import()` quando apre una cartella: chi non apre una cartella di Excel non
// le scarica. I titoli seguono quelli della barra, che seguono Excel in
// italiano; dove la barra non ne ha uno, il titolo dice da solo che cosa fa il
// comando, perché nella tavolozza non c'è il gruppo della barra a spiegarlo.
//
// Il file è scritto a partire dal catalogo: un comando nuovo nel catalogo fa
// fallire `strings.test.ts` finché non ha il suo titolo in `strings/`. Le voci
// stanno lì per area, ciascuna con il suo inglese accanto; qui si ricompongono
// nello stesso ordine.
import { catalog } from "../../../i18n/strings";
import { PALETTE_EN, PALETTE_IT } from "./strings/palette";
import { COMMANDS_EN, COMMANDS_IT } from "./strings/commands";
import { FIELDS_EN, FIELDS_IT } from "./strings/fields";
import { RESULT_EN, RESULT_IT } from "./strings/result";

/// Il catalogo italiano, che è anche la forma degli altri.
const IT = {
  ...PALETTE_IT,
  ...COMMANDS_IT,
  ...FIELDS_IT,
  ...RESULT_IT,
};

export type FogliKey = keyof typeof IT;

const EN: Record<FogliKey, string> = {
  ...PALETTE_EN,
  ...COMMANDS_EN,
  ...FIELDS_EN,
  ...RESULT_EN,
};

export const fogliStrings = catalog(IT, { en: EN });
export const { t } = fogliStrings;

/// Se `key` è una chiave di questo catalogo.
export function hasFogliKey(key: string): key is FogliKey {
  return Object.prototype.hasOwnProperty.call(IT, key);
}
