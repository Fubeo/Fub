// Editor markdown basato su CodeMirror 6, con l'esperienza in-editor di
// Obsidian (todo.md §6): comandi e scorciatoie (`editor-commands.ts`),
// autocompletamento di wikilink e tag (`completions.ts`), vivi preview dal
// tree Lezer (`livepreview.ts`). I tre moduli sono autonomi e ricevono i
// collegamenti col mondo (aprire una nota, cercare un tag, le sorgenti dei
// completamenti) da chi crea l'editor: qui si compone, non si decide.
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
// `basicSetup` viene dal pacchetto ombrello `codemirror`, che a sua volta
// dipende da `@codemirror/state` come questo file. È l'import che il difetto
// 0015 chiamava «due copie dello stato a un aggiornamento di distanza», e la
// misura ha corretto la frase: la copia oggi è **una** — `npm ls
// @codemirror/state` risponde `6.7.1` e undici `deduped`, e nel lock non c'è
// nessun `node_modules/x/node_modules/y`. Due copie sarebbero due insiemi di
// identità per i `Facet`, cioè extensions che la configurazione non vede, e la
// rottura sarebbe muta: nessun errore di tipo, nessuna eccezione, solo una vivi
// preview che non fa niente. A tenerle una è `.github/scripts/check-npm-copie.mjs`,
// perché quella promessa la mantiene l'albero delle dipendenze e non questa riga.
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { editorTheme } from "./theme";
import { currentTheme as getCurrentTheme, type Theme } from "../theme/theme";
import { byteToCharIndex, charToByteIndices } from "../rules/offsets";
import { editingExtensions } from "./editor-commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview } from "./livepreview";
import type { SyntaxForm } from "../host/contract";

/// Una selezione dell'editor come la capisce il kernel: **byte UTF-8** del
/// buffer, più il testo che ci sta dentro (vuoto = cursore).
export interface EditorRange {
  start: number;
  end: number;
  text: string;
}

/// Tutte le selezioni dell'editor, con la **primaria** distinta.
///
/// La primaria è `state.selection.main`, cioè `ranges[mainIndex]`: non è la
/// prima della lista, ed è di norma l'ultima aggiunta. Pubblicarla come «la
/// prima» sarebbe stata una conversione che la perde, ed è la ragione per cui
/// di là dal confine è un campo (decisione 0093).
///
/// È metà di `ViewContext.selections`; l'altra metà — se le coordinate siano
/// vere anche per il sorgente salvato — la sa solo chi conosce lo stato del
/// buffer, cioè la shell.
export interface EditorSelections {
  primary: EditorRange;
  /// Le altre, in ordine di posizione (CodeMirror tiene `ranges` ordinato).
  secondary: EditorRange[];
}

export interface Editor {
  /// Aggiorna la dichiarazione sintattica letta dal canale runtime.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Mette nell'editor un testo che **l'utente non ha scritto**: un'altra nota,
  /// il vuoto della chiusura, il file riletto dal disco dopo che qualcun altro
  /// lo ha cambiato.
  ///
  /// Azzera la cronologia di annullamento, e non è un di più (§13.3). Finché
  /// era un `dispatch` di `changes` normali, quelle modifiche entravano nella
  /// history di `basicSetup` come qualunque battuta di tastiera: un Ctrl-Z dopo
  /// un cambio nota **riscriveva nel documento aperto il testo del
  /// precedente**, e il salvataggio automatico lo persisteva. Marcare il solo
  /// dispatch come non annullabile non basterebbe — resterebbero in pila le
  /// modifiche *dell'altra nota*, applicabili a questa.
  ///
  /// La cronologia del testo è per-documento perché il documento è il suo
  /// soggetto: la pila delle **operazioni** è un'altra cosa, sta nel kernel e
  /// non passa di qui (vedi la 0045).
  setDoc(text: string): void;
  /// Porta l'editor su un testo che ha scritto **un altro editor sullo stesso
  /// documento** — la stessa nota aperta in due riquadri (§1.2).
  ///
  /// Non è `setDoc`, e la differenza è tutta nelle due cose che qui non devono
  /// succedere. La prima: il cursore di chi guarda non si muove. `setDoc`
  /// ricostruisce lo stato e riporta il cursore a zero, che su un riquadro in
  /// cui non si sta scrivendo è un salto senza causa visibile; qui si applica la
  /// **modifica minima** — prefisso e suffisso comuni — e CodeMirror rimappa la
  /// selezione da sé, come fa per ogni altra modifica.
  ///
  /// La seconda: la modifica **non entra nella pila di undo** di questo editor.
  /// È la regola della 0045 vista da un'altra angolazione — le pile non si
  /// fondono: un Ctrl-Z qui deve disfare ciò che si è scritto *qui*, non ciò che
  /// ha scritto l'altro riquadro. Chi ha scritto ha la sua pila e se lo disfa da
  /// sé, e la disfatta arriva di qua per questa stessa via.
  ///
  /// Chiamarla con un testo identico a quello che c'è non fa niente: è il caso
  /// normale — l'eco del proprio salvataggio — e costa un confronto.
  syncDoc(text: string): void;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento (es. l'inizio
  /// di un heading da `ViewUpdate::Reveal`). Converte al volo byte→code unit.
  revealByteOffset(byteOffset: number): void;
  /// Le selezioni correnti in byte UTF-8 (il ponte inverso, `offsets.ts`).
  selections(): EditorSelections;
  /// Accende o spegne la resa inline: è la differenza fra la modalità Live
  /// Preview e la modalità Sorgente (FEATURES 4.1).
  setLivePreview(on: boolean): void;
  /// Smonta l'editor: la vista di CodeMirror, i suoi ascoltatori, i suoi
  /// osservatori del DOM.
  ///
  /// Serve perché un riquadro **si chiude** (§1.2): `costruisciStruttura` in
  /// `panels/document.ts` toglie dalla mappa i riquadri che il layout non
  /// nomina più e ne stacca la radice dal documento. Togliere il nodo non è
  /// distruggere la vista: un `EditorView` tiene un `MutationObserver` sul
  /// proprio DOM, un `ResizeObserver`, e degli ascoltatori sulla finestra per
  /// sapere quando rimisurarsi — nessuno dei tre se ne va perché un antenato è
  /// stato staccato. Ogni divisione chiusa ne lasciava dietro uno, e il modo
  /// per accorgersene era usare l'app per un pomeriggio.
  ///
  /// Non è la stessa cosa di una `Lifetime` (`ui/lifetime.ts`), ed è la ragione per cui
  /// è un metodo qui: ciò che si perde non è un ascoltatore che questo file ha
  /// registrato, è un oggetto di una libreria che sa smontarsi da sé. Chi ha
  /// una `Lifetime` lo affida a lei con `vita.aggiungi(editor.destroy)`.
  destroy(): void;
  /// Passa all'altra luce (§12.4).
  ///
  /// I **colori** non passano di qui — sono `var(--…)` e li cambia il CSS da
  /// solo, senza che l'editor lo sappia (`editor/theme.ts`). Passa di qui la
  /// sola cosa che il CSS non può dire a CodeMirror: in che luce si trova, che
  /// è un booleano nella sua configurazione.
  setTheme(theme: Theme): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente (non quando impostiamo il
  /// documento a livello di programma).
  onChange(text: string): void;
  /// Invocato quando cambia la selezione (cursore compreso), anche senza
  /// modifiche al testo: è ciò che la shell pubblica come contesto di sessione.
  onSelectionChange(): void;
  /// Mod-click su un wikilink nella vivi preview: `page` è la pagina nuda,
  /// senza alias né `#heading` (stringa vuota per i legame interni `[[#…]]`).
  onOpenWikilink(page: string, heading: string | null, block: string | null): void;
  /// Click su un `#tag` nella vivi preview: `tag` è il nome senza `#`.
  onSearchTag(tag: string): void;
  /// Da dove arrivano i completamenti di `[[` e `#`: la shell passa l'IPC,
  /// i test passano liste finte.
  completions: CompletionSources;
}

/// Crea l'editor.
export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  let programmatic = false;

  // La resa inline sta in un compartment perché la modalità Sorgente è
  // esattamente "quella stessa configurazione, senza questa estensione": si
  // riconfigura a caldo, senza ricostruire l'editor e senza perdere né
  // documento né cronologia di undo.
  const preview = new Compartment();
  // Cosa i due compartment stanno portando **adesso**: `Compartment.get` lo
  // direbbe, ma solo di uno stato vivo, e `setDoc` costruisce il prossimo prima
  // di avere il vecchio sotto mano. Tenerlo qui è anche ciò che rende la
  // ricostruzione una funzione di due valori invece che di uno stato.
  let previewOn = true;
  let syntaxForms: readonly SyntaxForm[] | undefined;
  const livePreviewExtension = () =>
    livePreview(
      {
        openWikilink: opts.onOpenWikilink,
        searchTag: opts.onSearchTag,
      },
      syntaxForms,
    );

  // Il tema sta in un compartment per la stessa ragione della resa inline: si
  // cambia luce a caldo, senza ricostruire l'editor e quindi senza perdere né
  // il documento né la cronologia di undo. Il tema nasce con quello che la
  // pagina sta già portando — `theme/theme.ts` lo scrive sulla radice prima che
  // questa funzione venga chiamata — e non con un default cablato, che sarebbe
  // un lampo di scuro a ogni nota aperta in tema chiaro.
  const theme = new Compartment();
  let currentTheme: Theme = getCurrentTheme();

  /// Il documento **nella forma in cui sta sul disco**.
  ///
  /// Dichiarare il separatore non basta da solo, e la misura lo dice: dentro,
  /// un a capo è un carattere solo qualunque forma abbia, e `Text.toString` lo
  /// ricompone sempre a LF — la forma dichiarata la rende `sliceString`, ed è
  /// `state.lineBreak` che la sa. Chi esce di qui passa da questa riga: il
  /// salvataggio, la bozza, il riquadro gemello, la selezione (difetto 0207).
  const rendered = (state: EditorState = view.state) =>
    state.doc.sliceString(0, state.doc.length, state.lineBreak);

  /// La stessa posizione, contata sul testo reso: sotto CRLF ogni a capo che
  /// sta prima vale un carattere in più, e sono tanti quante le righe finite.
  const renderedOffset = (pos: number) =>
    view.state.lineBreak === "\n" ? pos : pos + view.state.doc.lineAt(pos).number - 1;

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !programmatic) {
      opts.onChange(rendered(u.state));
    }
    // Anche una modifica sposta il cursore: chi ascolta vuole saperlo in
    // entrambi i casi, e un `setDoc` a livello di programma rimappa la
    // selezione, quindi conta pure lui.
    if (u.selectionSet || u.docChanged) {
      opts.onSelectionChange();
    }
  });

  /// **Con che cosa questo documento va a capo**, o `null` per «come capita».
  ///
  /// CodeMirror spezza su `/\r\n?|\n/` e ricompone sempre con `\n`: un file
  /// scritto su Windows, aperto e toccato in un punto solo, tornava sul disco
  /// con **ogni riga cambiata** — un diff che non si legge, e in un vault sotto
  /// git una cronologia che non serve più a niente (difetto 0207). La forma
  /// originale non la ricordava nessuno perché la si perdeva all'ingresso, e
  /// dichiararla a CodeMirror è il modo di non perderla affatto: il documento
  /// *è* fatto di quelle righe, quindi anche l'a capo che si batte adesso è
  /// quello, e chiunque legga `getDoc` — il salvataggio, la bozza, la
  /// selezione — riceve ciò che c'era senza doverselo ricordare.
  ///
  /// Solo se il file è **tutto** CRLF. Un file misto non ha una forma da
  /// preservare, e prendere il CRLF come separatore vorrebbe dire che i suoi
  /// `\n` solitari smettono di essere righe: lì la normalizzazione di prima è
  /// la risposta meno peggio, e resta.
  const lineSeparator = (text: string): string | null =>
    text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : null;

  // La configurazione sta in una funzione perché serve **due volte**: alla
  // costruzione e a ogni `setDoc`, che rifà lo stato da zero per non portarsi
  // dietro la cronologia di un altro documento (§13.3). I due compartment
  // partono da ciò che vale adesso, o cambiare nota rimetterebbe la modalità
  // Sorgente in Live Preview e riaccenderebbe il tema di sistema.
  const extensions = (convertLineBreaks: string | null = null) => [
    // Prima di `basicSetup` e di tutto il resto perché non è un'estensione fra
    // le altre: è come il documento si legge.
    ...(convertLineBreaks === null ? [] : [EditorState.lineSeparator.of(convertLineBreaks)]),
    // Le scorciatoie di editing sono già in `Prec.high`: l'ordine rispetto
    // a `basicSetup` non conta, ma il popup dei completamenti (precedenza
    // massima) vince comunque su Enter/frecce quando è aperto.
    editingExtensions(),
    basicSetup,
    keymap.of([indentWithTab]),
    // La base GFM non è un dettaglio: senza, il parser non produce i nodi
    // di `~~barrato~~`/tabelle/todo e la vivi preview degrada in silenzio.
    markdown({ base: markdownLanguage }),
    theme.of(editorTheme(currentTheme)),
    EditorView.lineWrapping,
    preview.of(previewOn ? livePreviewExtension() : []),
    markdownCompletions(opts.completions),
    listener,
  ];

  const view = new EditorView({ parent, state: EditorState.create({ extensions: extensions() }) });

  return {
    setDoc(text: string) {
      // Uno **stato nuovo**, non un `dispatch`: è ciò che porta via la
      // cronologia insieme al documento. CodeMirror non ha un «svuota la
      // history» — la si azzera ricostruendo, ed è anche la forma più onesta,
      // perché ciò che si sta facendo è appunto cominciare un altro documento.
      programmatic = true;
      view.setState(
        EditorState.create({ doc: text, extensions: extensions(lineSeparator(text)) }),
      );
      programmatic = false;
      // `setState` non passa dai listener di aggiornamento (non è una
      // transazione), quindi il cursore nuovo lo annuncia questa riga. Senza,
      // il contesto di sessione resterebbe quello del documento di prima —
      // che è metà del difetto che questa funzione esiste per non avere.
      opts.onSelectionChange();
    },
    syncDoc(text: string) {
      // **L'a capo resta quello con cui il documento è nato.** Qui non si rifà
      // lo stato — è tutto il punto di questa funzione, che tiene il cursore
      // dove sta — quindi un file che cambia fine riga *sul disco* a nota
      // aperta continua a essere letto con la vecchia: è un limite dichiarato e
      // non un caso da indovinare, perché la forma la decide chi apre e
      // riaprire la nota la rimisura.
      // Dentro si conta a LF — le posizioni della transazione sono di lì — ma
      // ciò che si **inserisce** deve nascere già con la forma del documento:
      // sotto un separatore CRLF un `\n` solitario non è un a capo, è un
      // carattere in mezzo a una riga.
      const sep = view.state.lineBreak;
      const normalizedText = sep === "\n" ? text : text.split(sep).join("\n");
      const convertLineBreaks = (t: string) => (sep === "\n" ? t : t.split("\n").join(sep));
      const current = view.state.doc.toString();
      if (current === normalizedText) return;
      // La modifica minima: il prefisso e il suffisso in comune non si toccano,
      // e ciò che resta in mezzo è l'unica cosa che è davvero cambiata. Un
      // `changes` che rimpiazza tutto il documento sarebbe corretto e
      // sposterebbe il cursore in fondo a ogni battuta dell'altro riquadro.
      let prefixLength = 0;
      const minimum = Math.min(current.length, normalizedText.length);
      while (prefixLength < minimum && current[prefixLength] === normalizedText[prefixLength]) prefixLength++;
      let queue = 0;
      while (
        queue < minimum - prefixLength &&
        current[current.length - 1 - queue] === normalizedText[normalizedText.length - 1 - queue]
      ) {
        queue++;
      }
      programmatic = true;
      view.dispatch({
        changes: {
          from: prefixLength,
          to: current.length - queue,
          insert: convertLineBreaks(normalizedText.slice(prefixLength, normalizedText.length - queue)),
        },
        annotations: Transaction.addToHistory.of(false),
      });
      programmatic = false;
    },
    getDoc: () => rendered(),
    focus: () => view.focus(),
    selections() {
      // Il testo reso, e le endpointstà contate su di lui: questi offset li usa
      // chi taglia i **byte del file**, e in un file CRLF una posizione di
      // CodeMirror è indietro di una riga per ogni riga che la precede.
      const text = rendered();
      const { ranges, mainIndex } = view.state.selection;
      const endpoints = new Array<number>(ranges.length * 2);
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        endpoints[2 * i] = renderedOffset(range.from);
        endpoints[2 * i + 1] = renderedOffset(range.to);
      }
      // Una conversione sola per tutte le endpointstà: `charToByteIndex` è una
      // scansione dall'inizio, e questa funzione gira a ogni battuta di
      // tastiera. Vedi `charToByteIndices`.
      const byte = charToByteIndices(text, endpoints);
      const selections = ranges.map((_, i) => {
        const from = endpoints[2 * i];
        const to = endpoints[2 * i + 1];
        return {
          start: byte[2 * i],
          end: byte[2 * i + 1],
          text: text.slice(from, to),
        };
      });
      return {
        primary: selections[mainIndex],
        secondary: selections.filter((_, i) => i !== mainIndex),
      };
    },
    destroy() {
      view.destroy();
    },
    setLivePreview(on: boolean) {
      previewOn = on;
      view.dispatch({ effects: preview.reconfigure(on ? livePreviewExtension() : []) });
    },
    setSyntaxForms(forms: readonly SyntaxForm[]) {
      syntaxForms = forms;
      if (previewOn) view.dispatch({ effects: preview.reconfigure(livePreviewExtension()) });
    },
    setTheme(next: Theme) {
      currentTheme = next;
      view.dispatch({ effects: theme.reconfigure(editorTheme(next)) });
    },
    revealByteOffset(byteOffset: number) {
      const text = rendered();
      const renderedPos = byteToCharIndex(text, byteOffset);
      const crlfBefore = text.slice(0, renderedPos + 1).match(/\r\n/g)?.length ?? 0;
      const pos = Math.min(view.state.doc.length, renderedPos - crlfBefore);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
      view.focus();
    },
  };
}
