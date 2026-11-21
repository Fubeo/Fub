// I tasti del Disegno completo (piano K6, T9b; `docs/product/drawing.md`, «I tasti
// del Completo»). Regole come funzioni pure: quale tasto vale per ogni comando
// del motore, chi vince su chi, e se un tasto parte adesso. Il montaggio
// (`montaggio-tasti.ts`) le legge e fa partire il comando; qui non c'è DOM.
//
// - D1 (a): nel Completo valgono i tasti del motore, presi dall'indice. I tasti
//   di Fub (quelli della shell e quelli dell'editor del disegno) vincono: il
//   comando del motore che ne ha uno resta senza tasto.
// - Due comandi del motore con lo stesso tasto: vince l'ultimo assegnato, e il
//   conflitto si restituisce, perché si veda.
// - Le modifiche dell'utente (`draw.keys`, T9c) arrivano come una mappa
//   `comando → tasto` e si applicano sopra quelle del motore. Un tasto di Fub
//   resta di Fub anche se l'utente lo sceglie per un comando del motore.
// - Su macOS `Mod` è Cmd, e il motore scrive `Cmd+` per lo stesso tasto; `Ctrl+`
//   è Control su ogni sistema. La sintassi e il confronto sono quelli della
//   shell (`ui/commands.ts`): qui non si inventa un secondo parser.

import { matchesBinding, parseChords, splitAlternatives, type KeyChord } from "../../../ui/commands";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import { COPY_STYLE_BINDING, IMAGE_BINDING, PASTE_STYLE_BINDING } from "../tools/editor/constants";

/// Il sistema per cui si confrontano i tasti: su `mac` Cmd e Control sono due
/// tasti, altrove `Ctrl` e `Mod` sono lo stesso (come `onPlatform` della shell).
export type Piattaforma = "mac" | "other";

/// Un comando del motore come lo dà l'indice: il suo tasto come lo scrive il
/// motore (`Cmd+K`, `Cmd+Shift+]`), o `null` se non ne ha uno.
export interface VoceTasto {
  readonly id: string;
  readonly tasto: string | null;
}

/// Le modifiche dell'utente: comando → tasto nella forma di Fub (`Mod-k`).
/// `null` toglie il tasto. Un tasto che la shell non sa premere si tratta come
/// `null`: chi lo scrive lo deve sapere prima (T9c).
export type ModificheTasti = Readonly<Record<string, string | null>>;

/// Due o più comandi del motore sullo stesso tasto: `vince` è l'ultimo
/// assegnato, `perde` gli altri, che restano senza tasto.
export interface ConflittoTasto {
  readonly tasto: string;
  readonly vince: string;
  readonly perde: readonly string[];
}

/// Un comando del motore che perde il suo tasto perché il tasto è di Fub.
export interface TastoCoperto {
  readonly comando: string;
  readonly tasto: string;
}

/// La regola applicata: il tasto che vale per ogni comando, i conflitti fra i
/// comandi del motore, e i comandi coperti da un tasto di Fub.
export interface RegolaTasti {
  /// Comando → tasto nella forma di Fub, solo per i comandi che lo tengono.
  readonly tasti: ReadonlyMap<string, string>;
  readonly conflitti: readonly ConflittoTasto[];
  readonly coperti: readonly TastoCoperto[];
}

/// Che cosa sa il montaggio di un tasto premuto: se è in un campo dove si
/// scrive, se lo strumento vuole il testo, se un IME compone.
export interface StatoTastiera {
  readonly inCampo: boolean;
  readonly vuoleTesto: boolean;
  readonly componendo: boolean;
}

export type DecisioneTasto = { readonly tipo: "passa" } | { readonly tipo: "esegue"; readonly comando: string };

/// I modificatori del motore, nel modo in cui li scrive la shell.
const MODIFICATORI_DEL_MOTORE: Readonly<Record<string, string>> = {
  Cmd: "Mod",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

/// Un tasto del motore (`Cmd+Shift+]`) nella forma di Fub (`Mod-Shift-]`), o
/// `null` se la shell non lo sa premere. Con Maiusc su un simbolo o una cifra
/// il motore scrive il carattere che la sua tastiera dà: su un'altra tastiera
/// è un altro tasto, e non lo si mostra né lo si ascolta.
export function tastoFub(tastoMotore: string | null | undefined): string | null {
  const testo = (tastoMotore ?? "").trim();
  if (testo === "" || /\s/.test(testo)) return null;
  const mods: string[] = [];
  let resto = testo;
  // Un modificatore è `Nome+` seguito da qualcosa: `Cmd++` è Cmd e il tasto +.
  for (;;) {
    const m = /^(Cmd|Ctrl|Alt|Shift)\+(?=.)/.exec(resto);
    if (m === null) break;
    mods.push(MODIFICATORI_DEL_MOTORE[m[1]!]!);
    resto = resto.slice(m[0].length);
  }
  if (resto === "") return null;
  if (mods.includes("Shift") && resto.length === 1 && !/[A-Za-z]/.test(resto)) return null;
  const fub = [...mods, resto].join("-");
  return normaTasto(fub);
}

/// Un tasto di Fub come la shell lo legge: un accordo solo, valido. `null` se
/// non lo è (una sequenza, un nome sbagliato, un tasto senza modificatore).
export function normaTasto(tasto: string | null | undefined): string | null {
  const testo = (tasto ?? "").trim();
  if (testo === "") return null;
  const accordi = parseChords(testo);
  return accordi !== null && accordi.length === 1 ? testo : null;
}

/// Il tasto come si confronta su `piattaforma`: stessa stringa, stesso tasto.
/// `null` se non è un accordo solo.
export function chiaveTasto(tasto: string, piattaforma: Piattaforma): string | null {
  const accordi = parseChords(tasto);
  if (accordi === null || accordi.length !== 1) return null;
  const a = accordi[0]!;
  const mod = piattaforma === "mac" ? a.mod : a.mod || a.ctrl;
  const ctrl = piattaforma === "mac" ? a.ctrl : false;
  return [a.alt ? "alt" : "", ctrl ? "ctrl" : "", mod ? "mod" : "", a.shift ? "shift" : "", a.key]
    .filter((parte) => parte !== "")
    .join("-");
}

/// I tasti dell'editor del disegno che restano di Fub: quelli che `keys.ts`
/// scrive nelle sue righe e quelli che `vault-images.ts` legge. Si contano
/// solo gli accordi con un modificatore o un tasto di funzione: un tasto nudo
/// il motore non ce l'ha, e la shell non lo accetta come scorciatoia.
const TASTI_DELL_EDITOR: readonly string[] = [
  // Annulla, taglia, copia, incolla, seleziona tutto, duplica, raggruppa.
  "Mod-z", "Mod-Shift-z", "Mod-y", "Mod-x", "Mod-c", "Mod-v", "Mod-Shift-v", "Mod-a",
  "Mod-d", "Mod-g", "Mod-Shift-g", "Mod-i", "Mod-f", "Mod-/", "Mod-.", "Mod-0", "Mod-'",
  "Mod-k", "Mod-Shift-k", "Mod-Enter", "Mod-Shift-l", "Mod-Shift-h",
  // L'ordine, con parentesi quadre e Pag Su/Giù.
  "Mod-]", "Mod-[", "Mod-Shift-]", "Mod-Shift-[", "Shift-PageUp", "Shift-PageDown",
  // Lo spostamento e il ridimensionamento della selezione, con le frecce.
  "Mod-ArrowLeft", "Mod-ArrowUp", "Mod-ArrowRight", "Mod-ArrowDown",
  "Alt-ArrowUp", "Alt-ArrowDown", "Alt-Enter", "Shift-Tab",
  // Allineamento, centro e distribuzione.
  "Alt-a", "Alt-d", "Alt-w", "Alt-s", "Alt-h", "Alt-v", "Alt-Shift-h", "Alt-Shift-v",
  // Il menu, la barra della selezione, gli strumenti con Maiusc.
  "Alt-F10", "Shift-F10", "Shift-h", "Shift-v", "Shift-1", "Shift-2",
  // I tasti di funzione dell'editor, e lo stile.
  "F2", COPY_STYLE_BINDING, PASTE_STYLE_BINDING, IMAGE_BINDING,
];

/// I tasti di Fub che vincono su quelli del motore (D1 (a)): quelli della shell
/// (`shell-keys.generated.ts`), quelli dell'editor del disegno, e i quattro che
/// si nominano sempre (Ctrl+P, Ctrl+K, Ctrl+W, Ctrl+Tab).
export const TASTI_DI_FUB: readonly string[] = [
  ...Object.values(SHELL_KEYS).flatMap((accordo) => splitAlternatives(accordo)),
  ...TASTI_DELL_EDITOR,
  "Mod-p", "Mod-k", "Mod-w", "Ctrl-Tab",
];

/// Applica la regola a un elenco di comandi del motore e alle modifiche
/// dell'utente, su `piattaforma`. Pura: stessi argomenti, stesso risultato.
///
/// Ordine: prima i tasti del motore (nell'ordine dell'indice), poi le modifiche
/// dell'utente, che valgono sopra. Per ogni comando vale l'ultimo tasto che gli
/// è stato assegnato. Poi: un tasto di Fub copre i comandi del motore che lo
/// vogliono; fra i rimasti, due sullo stesso tasto danno un conflitto e vince
/// il più recente.
export function risolviTasti(
  voci: readonly VoceTasto[],
  modifiche: ModificheTasti,
  piattaforma: Piattaforma,
  globali: readonly string[] = TASTI_DI_FUB,
): RegolaTasti {
  const noti = new Set<string>();
  const eventi: { readonly id: string; readonly tasto: string | null }[] = [];
  for (const voce of voci) {
    noti.add(voce.id);
    eventi.push({ id: voce.id, tasto: tastoFub(voce.tasto) });
  }
  for (const [id, tasto] of Object.entries(modifiche)) {
    if (!noti.has(id)) continue;
    eventi.push({ id, tasto: tasto === null ? null : normaTasto(tasto) });
  }
  // Il tasto che vale per ogni comando: l'ultimo evento che lo riguarda.
  const finale = new Map<string, { readonly tasto: string; readonly ordine: number } | null>();
  eventi.forEach((evento, ordine) => {
    finale.set(evento.id, evento.tasto === null ? null : { tasto: evento.tasto, ordine });
  });

  const difesi = new Set<string>();
  for (const g of globali) {
    const chiave = chiaveTasto(g, piattaforma);
    if (chiave !== null) difesi.add(chiave);
  }

  const coperti: TastoCoperto[] = [];
  const vivi = new Map<string, { readonly tasto: string; readonly ordine: number }>();
  for (const [id, assegnato] of finale) {
    if (assegnato === null) continue;
    const chiave = chiaveTasto(assegnato.tasto, piattaforma);
    if (chiave === null) continue;
    if (difesi.has(chiave)) {
      coperti.push({ comando: id, tasto: assegnato.tasto });
      continue;
    }
    vivi.set(id, assegnato);
  }

  const perChiave = new Map<string, string[]>();
  for (const [id, assegnato] of vivi) {
    const chiave = chiaveTasto(assegnato.tasto, piattaforma)!;
    const gruppo = perChiave.get(chiave);
    if (gruppo) gruppo.push(id);
    else perChiave.set(chiave, [id]);
  }

  const tasti = new Map<string, string>();
  const conflitti: ConflittoTasto[] = [];
  for (const ids of perChiave.values()) {
    const ordinati = [...ids].sort((a, b) => vivi.get(a)!.ordine - vivi.get(b)!.ordine);
    const vince = ordinati[ordinati.length - 1]!;
    const tasto = vivi.get(vince)!.tasto;
    tasti.set(vince, tasto);
    if (ordinati.length > 1) conflitti.push({ tasto, vince, perde: ordinati.slice(0, -1) });
  }
  return { tasti, conflitti, coperti };
}

/// Il tasto che vale davvero per il comando `id`, nella forma di Fub, o `null`
/// se non ne ha uno (nessun tasto dell'indice, un tasto di Fub, un conflitto
/// perso). Ciò che i menu (≡ e Ctrl+/) mostrano: lo si scrive con
/// `displayBinding` della shell.
export function tastoDelComando(regola: RegolaTasti, id: string): string | null {
  return regola.tasti.get(id) ?? null;
}

/// Un tasto che scrive un carattere: una lettera, una cifra, un segno, lo
/// spazio. Senza Ctrl, Cmd o Alt, non è un comando mentre si scrive.
function scrive(evento: KeyChord): boolean {
  return evento.key.length === 1 && !evento.ctrlKey && !evento.metaKey && !evento.altKey;
}

/// Se il tasto `evento` fa partire un comando del motore adesso, e quale.
///
/// Non parte: in un campo dove si scrive, mentre un IME compone, e un tasto che
/// scrive quando lo strumento vuole il testo. Negli altri casi vale il tasto
/// del motore che corrisponde, come la shell lo confronta (`matchesBinding`).
export function decidiTasto(
  evento: KeyChord,
  regola: RegolaTasti,
  stato: StatoTastiera,
  piattaforma: Piattaforma,
): DecisioneTasto {
  if (stato.inCampo || stato.componendo) return { tipo: "passa" };
  if (stato.vuoleTesto && scrive(evento)) return { tipo: "passa" };
  for (const [comando, tasto] of regola.tasti) {
    if (matchesBinding(evento, tasto, piattaforma)) return { tipo: "esegue", comando };
  }
  return { tipo: "passa" };
}
