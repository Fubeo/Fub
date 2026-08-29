# Editor e anteprima

> **Per chi:** chi usa o modifica l'esperienza di scrittura.
> **Risultato:** capire la sessione documento, il buffer condiviso, il
> salvataggio e le responsabilità locali.

## Modalità

Il documento Markdown può essere mostrato come:

- **sorgente**, con la sintassi esplicita;
- **live preview**, che mantiene l'editing e riduce il rumore della sintassi;
- **lettura**, che mostra la resa senza cursore di testo.

Il provider Markdown interpreta la sorgente. La shell possiede CodeMirror,
focus, selezione, scroll, tema e lifecycle.

## Flusso

```mermaid
flowchart LR
    FILE["file e revisione"] --> SESSION["DocumentSession"]
    SESSION --> BUFFER["buffer autorevole"]
    SESSION --> SAVE["debounce e scrittura"]
    SESSION --> SURFACE_A["superficie nel riquadro A"]
    SESSION --> SURFACE_B["superficie nel riquadro B"]
    SURFACE_A -->|modifica tipizzata| SESSION
    SURFACE_B -->|modifica tipizzata| SESSION
    SESSION -->|sincronizzazione| SURFACE_A
    SESSION -->|sincronizzazione| SURFACE_B
    SAVE --> FILE
```

## Documento e superficie

Un documento aperto in più riquadri condivide, tramite un'unica
`DocumentSession`:

- testo;
- revisione di base;
- stato dirty;
- coda di salvataggio;
- bozza;
- ultimo esito di scrittura.

La sessione coordina questo buffer autorevole e il suo lifecycle. Ogni
superficie conserva invece:

- cursore e selezioni;
- scroll;
- modalità;
- focus;
- la propria history nativa di undo e redo.

Questa distinzione impedisce di creare due copie concorrenti dello stesso
buffer e, allo stesso tempo, evita che il cursore di un riquadro muova quello
dell'altro. Il pannello collega e scollega le superfici visibili, ma non
coordina il buffer, il salvataggio o il fan-out delle modifiche.

## Offset e terminatori

Il contratto Rust usa span in byte UTF-8. CodeMirror usa offset JavaScript. Il
ponte di conversione è una responsabilità esplicita e coperta da test.

La sorgente conserva i terminatori di riga. Caricare o sincronizzare un
documento non deve normalizzare CRLF involontariamente.

## Undo, redo e selezione

L'editor offre due piani distinti:

1. undo e redo del contenuto, legati alla superficie;
2. undo di un comando applicato dal core, descritto nel suo esito.

Nel piano del contenuto, i comandi visibili sono `Mod-z` per annullare e
`Mod-y` per rifare. Sono disponibili anche `Mod-Shift-z` su macOS e
`Ctrl-Shift-z` su Linux per rifare. `Mod-u` annulla l'ultima selezione e `Alt-u`
la rifà; su macOS il redo della selezione è `Mod-Shift-u`. `Mod` indica il
modificatore della piattaforma.

Gli undo e redo del contenuto sono disponibili anche negli eventi di modifica
del browser `historyUndo` e `historyRedo`. Le battute adiacenti vengono
raggruppate secondo le regole native dell'editor; composizione, incolla,
cancellazione, sostituzione e modifiche multi-cursore conservano i propri
confini osservabili. La history della selezione è distinta da quella del
contenuto.

Una modifica ricevuta da un altro riquadro aggiorna il testo ma non diventa una
battuta nella history della superficie destinataria. Se il cambio esterno è
disgiunto, i rami locali restano disponibili e seguono il nuovo testo. Se
invece tocca in modo ambiguo il contenuto che una superficie potrebbe ancora
annullare, l'editor mantiene il testo esterno e scarta in sicurezza i rami undo
e redo di quella superficie. Questa perdita conservativa impedisce a un undo
stale di riportare contenuto già sovrascritto.

## Salvataggio e conflitti

La `DocumentSession` accoda le scritture per documento. Il core applica la
revisione di base. Un contenuto esterno più recente produce un conflitto
esplicito.

Il rilascio dell'ultima tab esegue il flush della scrittura e, se necessario,
della bozza prima di chiudere la sessione; il lifecycle del riquadro e
dell'editor resta separato da quello del documento. Durante la conferma di una
cancellazione gli editor del documento restano aperti ma in sola lettura finché
la decisione non risolve.

## Preview e contenuto non fidato

La preview usa le forme prodotte dal provider e le policy della webview. HTML
grezzo o contenuto attivo non deve diventare automaticamente codice eseguibile.

La UI dichiarativa di un plugin WASM dovrà passare da
`UiNode::validate_untrusted()` prima di raggiungere la shell; questo lavoro è
tracciato nell'issue [#10](https://github.com/Fubeo/Fub/issues/10).

## Superfici condivise

`TextEngine` è il motore testuale della shell e
`DocumentSurfaceRegistry` è il registro interno che sceglie la superficie per
ogni documento. Le note del vault con un'estensione in
`state.handledExtensions` restano Markdown: il registro monta `TextEngine` con
`MarkdownProfile`. Un documento `txt` o `text/plain` usa `PlainTextProfile`
sullo stesso motore.

Il registro appartiene alla shell e applica l'ordine di risoluzione descritto
nell'architettura: override, binding, fallback testuale, viewer per byte o
superficie di errore. Le collisioni sono esplicite e nominano gli owner.

`FormulaProfile` resta usato soltanto dai test e dalle fixture: non è una
superficie utente. `createEditor()` non è un percorso utente; l'adapter di
compatibilità resta nel modulo tecnico, mentre il pannello monta la superficie
scelta dal registro.

Un riquadro vuoto contiene il solo chrome e non conserva un editor Markdown
finto. La `DocumentSession` coordina buffer, salvataggio, bozza, conflitti e
lifecycle; il pannello collega le superfici e aggiorna la resa. Nessun profilo
invia una chiamata IPC o WASM per ogni battuta.

La griglia e il foglio sono assenti dal percorso utente.

## Dove si trova

- `apps/client/src/editors/core/registry.ts`
- `apps/client/src/editors/bootstrap.ts`
- `apps/client/src/editors/text/factories.ts`
- `apps/client/src/editor/`
- `apps/client/src/panels/document.ts`
- `apps/client/src/state/`
- `crates/fub-abi/src/edit.rs`
- `crates/fub-abi/src/session.rs`
- `crates/fub-kernel/src/drafts.rs`
