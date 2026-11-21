// La fila delle opzioni dello strumento del motore nel Disegno completo (piano
// K6, T8; `docs/product/drawing.md`, «La colonna»). Le opzioni arrivano dal
// motore in `DrawingToolState.options` (`host/contract.ts`), come un valore
// JSON: questa regola dice che controllo fa ogni chiave, e quali non si
// disegnano.
//
// - un sì o no è una casella;
// - un numero è un campo;
// - un colore `#rrggbb` è un campione;
// - `{ scelta, scelte }` con una scelta fra le sue è una scelta;
// - ogni altra chiave NON si mostra, e la regola dice il perché
//   (`fuori`): una forma che il disegno generico non sa fare, o una chiave
//   senza etichetta (un id grezzo non si legge mai).
//
// Le etichette vengono dal `testi.ts` della famiglia dello strumento, già
// letto: la regola non le inventa. Un cambio passa da `disegno.strumento.opzione`
// (chi monta la fila lo manda). La regola è pura; la fila è DOM, e sta nel
// chunk del Completo.

/// Un controllo della fila: la chiave del motore e il suo valore.
export type Controllo =
  | { readonly tipo: "casella"; readonly chiave: string; readonly valore: boolean }
  | { readonly tipo: "numero"; readonly chiave: string; readonly valore: number }
  | { readonly tipo: "scelta"; readonly chiave: string; readonly valore: string; readonly scelte: readonly string[] }
  | { readonly tipo: "colore"; readonly chiave: string; readonly valore: string };

/// Una chiave che non si mostra, e perché.
export interface Fuori {
  readonly chiave: string;
  readonly perche: "forma" | "etichetta";
}

/// Un'etichetta nelle due lingue, come nei `testi.ts` delle famiglie.
export type Etichette = Readonly<Record<string, { readonly it: string; readonly en: string }>>;

export interface Descrizione {
  readonly controlli: readonly Controllo[];
  readonly fuori: readonly Fuori[];
}

const COLORE = /^#[0-9a-f]{6}$/i;

/// Le opzioni di uno strumento come controlli, e le chiavi che restano fuori.
/// `options` vuoto o non un oggetto non dà niente.
export function descrivi(options: unknown, etichette: Etichette): Descrizione {
  const controlli: Controllo[] = [];
  const fuori: Fuori[] = [];
  if (options === null || typeof options !== "object" || Array.isArray(options)) return { controlli, fuori };
  for (const [chiave, valore] of Object.entries(options as Record<string, unknown>)) {
    if (etichette[chiave] === undefined) {
      fuori.push({ chiave, perche: "etichetta" });
      continue;
    }
    if (typeof valore === "boolean") controlli.push({ tipo: "casella", chiave, valore });
    else if (typeof valore === "number" && Number.isFinite(valore)) controlli.push({ tipo: "numero", chiave, valore });
    else if (typeof valore === "string" && COLORE.test(valore)) controlli.push({ tipo: "colore", chiave, valore });
    else if (sceltaValida(valore)) controlli.push({ tipo: "scelta", chiave, valore: valore.scelta, scelte: valore.scelte });
    else fuori.push({ chiave, perche: "forma" });
  }
  return { controlli, fuori };
}

interface SceltaGrezza {
  readonly scelta: string;
  readonly scelte: readonly string[];
}

/// Una scelta è `{ scelta, scelte }` con `scelta` fra le `scelte` (testi).
function sceltaValida(valore: unknown): valore is SceltaGrezza {
  if (valore === null || typeof valore !== "object") return false;
  const { scelta, scelte } = valore as { scelta?: unknown; scelte?: unknown };
  return typeof scelta === "string" && Array.isArray(scelte) && scelte.every((s) => typeof s === "string") && scelte.includes(scelta);
}

/// La fila dei controlli: un'etichetta per ciascuno, e `cambia` quando chi usa
/// lo cambia (il valore è quello del controllo: booleano, numero o testo).
export function costruisciFila(
  descrizione: Descrizione,
  etichetta: (chiave: string) => string,
  cambia: (chiave: string, valore: boolean | number | string) => void,
): HTMLElement {
  const fila = document.createElement("div");
  fila.className = "draw-options-row";
  for (const controllo of descrizione.controlli) {
    const voce = document.createElement("label");
    voce.className = "draw-option";
    const nome = document.createElement("span");
    nome.className = "draw-option-label";
    nome.textContent = etichetta(controllo.chiave);
    const input = creaControllo(controllo, (valore) => cambia(controllo.chiave, valore));
    voce.append(nome, input);
    fila.append(voce);
  }
  return fila;
}

function creaControllo(controllo: Controllo, cambiato: (valore: boolean | number | string) => void): HTMLElement {
  if (controllo.tipo === "casella") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = controllo.valore;
    input.addEventListener("change", () => cambiato(input.checked));
    return input;
  }
  if (controllo.tipo === "numero") {
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(controllo.valore);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) cambiato(n);
    });
    return input;
  }
  if (controllo.tipo === "colore") {
    const input = document.createElement("input");
    input.type = "color";
    input.value = controllo.valore;
    input.addEventListener("change", () => cambiato(input.value));
    return input;
  }
  const select = document.createElement("select");
  for (const scelta of controllo.scelte) {
    const option = document.createElement("option");
    option.value = scelta;
    option.textContent = scelta;
    option.selected = scelta === controllo.valore;
    select.append(option);
  }
  select.addEventListener("change", () => cambiato(select.value));
  return select;
}
