// La porta dei suggerimenti (E6): chi ha il fuoco (un editor, il suo «/») dice
// che cosa sta facendo, e la riga della banda (`shells/scrittoio/frame/
// hints-row.ts`) lo scrive coi tasti della persona.
//
// Sta fra gli editor perché sono loro a usarla: un editor non importa dalla
// shell. La porta non sa niente della riga: tiene le fonti aperte, dice quale
// vince, e avvisa chi ascolta che qualcosa è cambiato. Avvisare costa un
// contatore e basta: la riga rilegge il contesto solo dopo una pausa, e senza
// nessuno che ascolti (la finestra di un documento, i test degli editor) una
// fonte che avvisa non costa niente.

/// Una voce della riga.
///
/// - `command`: un comando, coi tasti che la persona gli ha dato. `chord` è
///   l'accordo con cui la superficie lo esegue da sé (il grassetto di
///   CodeMirror, `Mod-b`): vale finché il comando non ha un accordo suo, né
///   dichiarato né scelto. Senza nessuno dei due la voce non c'è.
/// - `keys`: tasti che non sono un comando (le frecce di un elenco, il «/» che
///   si scrive, `Mod-Enter` di CodeMirror): uno o più, nella sintassi delle
///   scorciatoie (`Shift-ArrowUp`) o come nome di un tasto (`/`, `Escape`,
///   `Mod` per il modificatore tenuto).
export type HintItem =
  | { readonly command: string; readonly chord?: string | null; readonly say: string }
  | { readonly keys: readonly string[]; readonly say: string };

/// Il contesto di chi ha il fuoco: un nome (per i test e per il tema, che lo
/// legge in `data-context`) e le voci, nell'ordine in cui si dicono.
export interface HintContext {
  readonly id: string;
  readonly items: readonly HintItem[];
}

/// La fonte che una superficie apre: `changed` dopo ogni cosa che può aver
/// cambiato il contesto (selezione, testo, fuoco), `close` quando la superficie
/// se ne va. `changed(true)` la porta in cima: è chi ha appena preso il fuoco.
export interface HintSource {
  changed(raise?: boolean): void;
  close(): void;
}

interface Source {
  readonly read: () => HintContext | null;
  closed: boolean;
}

/// Le fonti aperte, dalla più vecchia alla più recente in cima. Vince la più
/// recente che ha qualcosa da dire: un editor che perde il fuoco risponde
/// `null`, e la riga passa a chi l'ha preso.
const sources: Source[] = [];

/// Chi ascolta i cambiamenti (la riga montata, se c'è).
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/// Apre una fonte di suggerimenti. `read` si chiama soltanto dopo la pausa,
/// mai durante la battuta: può leggere lo stato dell'editor con calma.
export function openHintSource(read: () => HintContext | null): HintSource {
  const source: Source = { read, closed: false };
  sources.push(source);
  return {
    changed(raise = false) {
      if (source.closed) return;
      if (raise && sources[sources.length - 1] !== source) {
        sources.splice(sources.indexOf(source), 1);
        sources.push(source);
      }
      notify();
    },
    close() {
      if (source.closed) return;
      source.closed = true;
      sources.splice(sources.indexOf(source), 1);
      notify();
    },
  };
}

/// Il contesto che vince adesso, o `null`.
export function currentHints(): HintContext | null {
  for (let i = sources.length - 1; i >= 0; i--) {
    const context = sources[i]!.read();
    if (context) return context;
  }
  return null;
}

/// Ascolta i cambiamenti delle fonti (aperta, avvisata, chiusa). Restituisce
/// il disabbonamento.
export function onHintsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Solo per i test: nessuna fonte né ascoltatore rimasti da un test all'altro.
export function resetHintSources(): void {
  sources.length = 0;
  listeners.clear();
}
