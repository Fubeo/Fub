// Editor markdown basato su CodeMirror 6, con l'esperienza in-editor di
// Obsidian (todo.md §6): comandi e scorciatoie (`editor-commands.ts`),
// autocompletamento di wikilink e tag (`completions.ts`), live preview dal
// tree Lezer (`livepreview.ts`). I tre moduli sono autonomi e ricevono i
// collegamenti col mondo (aprire una nota, cercare un tag, le sorgenti dei
// completamenti) da chi crea l'editor: qui si compone, non si decide.
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { temaEditor } from "./theme";
import { temaCorrente, type Tema } from "../theme/theme";
import { byteToCharIndex, charToByteIndex } from "../rules/offsets";
import { editingExtensions } from "./editor-commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview } from "./livepreview";

/// La selezione dell'editor come la capisce il kernel: **byte UTF-8** del
/// buffer, più il testo che ci sta dentro (vuoto = cursore). È metà di
/// `ViewContext.selection`; l'altra metà — se lo span sia vero anche per il
/// sorgente salvato — la sa solo chi conosce lo stato del buffer, cioè la shell.
export interface EditorSelection {
  start: number;
  end: number;
  text: string;
}

export interface Editor {
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
  /// La selezione corrente in byte UTF-8 (il ponte inverso, `offsets.ts`).
  selection(): EditorSelection;
  /// Accende o spegne la resa inline: è la differenza fra la modalità Live
  /// Preview e la modalità Sorgente (FEATURES 4.1).
  setLivePreview(on: boolean): void;
  /// Passa all'altra luce (§12.4).
  ///
  /// I **colori** non passano di qui — sono `var(--…)` e li cambia il CSS da
  /// solo, senza che l'editor lo sappia (`editor/theme.ts`). Passa di qui la
  /// sola cosa che il CSS non può dire a CodeMirror: in che luce si trova, che
  /// è un booleano nella sua configurazione.
  setTheme(tema: Tema): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente (non quando impostiamo il
  /// documento a livello di programma).
  onChange(text: string): void;
  /// Invocato quando cambia la selezione (cursore compreso), anche senza
  /// modifiche al testo: è ciò che la shell pubblica come contesto di sessione.
  onSelectionChange(): void;
  /// Mod-click su un wikilink nella live preview: `page` è la pagina nuda,
  /// senza alias né `#heading` (stringa vuota per i link interni `[[#…]]`).
  onOpenWikilink(page: string): void;
  /// Click su un `#tag` nella live preview: `tag` è il nome senza `#`.
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
  const livePreviewCollegata = () =>
    livePreview({
      openWikilink: opts.onOpenWikilink,
      searchTag: opts.onSearchTag,
    });

  // Il tema sta in un compartment per la stessa ragione della resa inline: si
  // cambia luce a caldo, senza ricostruire l'editor e quindi senza perdere né
  // il documento né la cronologia di undo. Il tema nasce con quello che la
  // pagina sta già portando — `theme/theme.ts` lo scrive sulla radice prima che
  // questa funzione venga chiamata — e non con un default cablato, che sarebbe
  // un lampo di scuro a ogni nota aperta in tema chiaro.
  const tema = new Compartment();
  let temaAttuale: Tema = temaCorrente();

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !programmatic) {
      opts.onChange(u.state.doc.toString());
    }
    // Anche una modifica sposta il cursore: chi ascolta vuole saperlo in
    // entrambi i casi, e un `setDoc` a livello di programma rimappa la
    // selezione, quindi conta pure lui.
    if (u.selectionSet || u.docChanged) {
      opts.onSelectionChange();
    }
  });

  // La configurazione sta in una funzione perché serve **due volte**: alla
  // costruzione e a ogni `setDoc`, che rifà lo stato da zero per non portarsi
  // dietro la cronologia di un altro documento (§13.3). I due compartment
  // partono da ciò che vale adesso, o cambiare nota rimetterebbe la modalità
  // Sorgente in Live Preview e riaccenderebbe il tema di sistema.
  const estensioni = () => [
    // Le scorciatoie di editing sono già in `Prec.high`: l'ordine rispetto
    // a `basicSetup` non conta, ma il popup dei completamenti (precedenza
    // massima) vince comunque su Enter/frecce quando è aperto.
    editingExtensions(),
    basicSetup,
    keymap.of([indentWithTab]),
    // La base GFM non è un dettaglio: senza, il parser non produce i nodi
    // di `~~barrato~~`/tabelle/todo e la live preview degrada in silenzio.
    markdown({ base: markdownLanguage }),
    tema.of(temaEditor(temaAttuale)),
    EditorView.lineWrapping,
    preview.of(previewOn ? livePreviewCollegata() : []),
    markdownCompletions(opts.completions),
    listener,
  ];

  const view = new EditorView({ parent, state: EditorState.create({ extensions: estensioni() }) });

  return {
    setDoc(text: string) {
      // Uno **stato nuovo**, non un `dispatch`: è ciò che porta via la
      // cronologia insieme al documento. CodeMirror non ha un «svuota la
      // history» — la si azzera ricostruendo, ed è anche la forma più onesta,
      // perché ciò che si sta facendo è appunto cominciare un altro documento.
      programmatic = true;
      view.setState(EditorState.create({ doc: text, extensions: estensioni() }));
      programmatic = false;
      // `setState` non passa dai listener di aggiornamento (non è una
      // transazione), quindi il cursore nuovo lo annuncia questa riga. Senza,
      // il contesto di sessione resterebbe quello del documento di prima —
      // che è metà del difetto che questa funzione esiste per non avere.
      opts.onSelectionChange();
    },
    syncDoc(text: string) {
      const attuale = view.state.doc.toString();
      if (attuale === text) return;
      // La modifica minima: il prefisso e il suffisso in comune non si toccano,
      // e ciò che resta in mezzo è l'unica cosa che è davvero cambiata. Un
      // `changes` che rimpiazza tutto il documento sarebbe corretto e
      // sposterebbe il cursore in fondo a ogni battuta dell'altro riquadro.
      let testa = 0;
      const minimo = Math.min(attuale.length, text.length);
      while (testa < minimo && attuale[testa] === text[testa]) testa++;
      let coda = 0;
      while (
        coda < minimo - testa &&
        attuale[attuale.length - 1 - coda] === text[text.length - 1 - coda]
      ) {
        coda++;
      }
      programmatic = true;
      view.dispatch({
        changes: {
          from: testa,
          to: attuale.length - coda,
          insert: text.slice(testa, text.length - coda),
        },
        annotations: Transaction.addToHistory.of(false),
      });
      programmatic = false;
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
    selection() {
      const text = view.state.doc.toString();
      const { from, to } = view.state.selection.main;
      return {
        start: charToByteIndex(text, from),
        end: charToByteIndex(text, to),
        text: text.slice(from, to),
      };
    },
    setLivePreview(on: boolean) {
      previewOn = on;
      view.dispatch({ effects: preview.reconfigure(on ? livePreviewCollegata() : []) });
    },
    setTheme(next: Tema) {
      temaAttuale = next;
      view.dispatch({ effects: tema.reconfigure(temaEditor(next)) });
    },
    revealByteOffset(byteOffset: number) {
      const pos = Math.min(
        byteToCharIndex(view.state.doc.toString(), byteOffset),
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
      view.focus();
    },
  };
}
