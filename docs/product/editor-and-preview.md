# Editor e anteprima

> **Per chi:** chi usa o modifica l'esperienza di scrittura.
> **Risultato:** capire la sessione documento, il buffer condiviso, il
> salvataggio e le responsabilità locali.

## Modalità

Il catalogo delle modalità vive soltanto sulla superficie modeful montata
(`SurfaceModeful`), non nei contratti generici `EditorSurface` e
`TextEditorSurface`. I suoi id sono `SurfaceModeId`, un tipo locale della shell
indipendente da `PaneMode`. La superficie Markdown dichiara:

- **sorgente** (`source`), con la sintassi esplicita;
- **live preview** (`live_preview`), che mantiene l'editing e riduce il rumore
  della sintassi;
- **lettura** (`reading`), che mostra la resa senza cursore di testo.

Il `defaultMode` di Markdown è `live_preview`. Plain text dichiara soltanto
`source`, con `defaultMode: "source"`; fallback, viewer ed error non espongono
un catalogo. Il commutatore segue la superficie montata nel riquadro con il
focus: Markdown mostra Sorgente, Live e Lettura, plain text soltanto Sorgente.
La superficie possiede il catalogo e la modalità corrente nativi.

`PaneMode` resta l'ABI di `ViewContext.mode` e del layout legacy. Soltanto
pubblicando layout o `ViewContext`, `source`, `live_preview` e `reading`
conservano il rispettivo valore `PaneMode`; ogni altro `SurfaceModeId` si
proietta deterministicamente a `source`. Una richiesta di `SurfaceModeId` non
nel catalogo non cambia il riquadro, il contesto o la superficie. La resa di
Lettura richiede anche la capability `MarkdownEditorSurface`: il solo valore
`reading` non la abilita.

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

Force reload e la scelta `theirs` ricaricano transazionalmente: timer e stato
pulito cambiano soltanto dopo una lettura riuscita. Se la lettura fallisce o
diventa stantia per attività più recente, testo dirty, conflitto e bozza
restano invariati e nessun autosalvataggio sovrascrive un'autorità sconosciuta.
Al successo il testo da disco raggiunge tutte le superfici prima che la bozza
precedente sia eliminata; il fallimento dell'eliminazione è osservabile come
evento `draft-discard-failed` con id del documento ed errore.

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
ogni documento. Il registro appartiene alla shell (`apps/client/src`), mentre
ogni factory appartiene all'owner della registrazione che la espone; la shell
registra le factory Markdown e plain text.

L'API pubblica del registro è `register` (con disposer), `select` e `mount`.
`select` espone soltanto la chiave opaca della selezione; la factory resta
interna e `mount` è l'unico costruttore pubblico della superficie.

Un override sceglie una sola registrazione: per `registrationId`, per
`owner` più `formatKey`, oppure per `owner` più `family` e `profile`. Se
l'input è malformato o la registrazione indicata è stata rimossa, la superficie
mostra un errore esplicito e non applica un fallback silenzioso.

Il `destroy()` pubblico di una superficie montata e il disposer della
registrazione sono idempotenti. La disinstallazione rimuove i binding e
distrugge le superfici gestite; una superficie creata mentre la factory
disinstalla rientrantemente la propria registrazione viene pulita e il mount
fallisce, senza restituire una superficie non gestita.

Il pannello riusa la superficie soltanto quando coincidono sia la
`SurfaceSelectionKey` restituita da `mount` sia il `documentId` dell'istanza
montata; se cambia documento, esegue un nuovo `mount`. Dopo la costruzione, la
chiave restituita da `mount`, non quella prevista da `select`, è autorevole.
`family` e `profile` non sono l'identità di riuso: più registrazioni con la
stessa coppia restano
distinguibili. La selezione passa da override, `formatKey` esatto, `species`,
coppia `family`-`profile` non ambigua, viewer a byte, fallback testuale e
superficie di errore. Le collisioni sui binding esatti nominano entrambi gli
owner e non applicano “vince l'ultimo”; più corrispondenze `family`-`profile`
mostrano un errore visibile con entrambi gli owner.

Il fallback testuale è una superficie DOM con `family: "text"` e
`profile: "fallback"`, non un `TextEditorSurface`. Il viewer ha famiglia
`viewer`; gli errori hanno famiglia `error`. `DomSurface` espone
`role="region"`, aggiorna `aria-readonly` e `dataset.surfaceTheme`, e ha un
`destroy()` idempotente.

`TextEditorSurface` è generico e offre `setDoc`, `syncDoc`, `selections` e
`revealByteOffset`; non conosce Markdown. `MarkdownEditorSurface` con profilo
`markdown` aggiunge `setSyntaxForms` e `setLivePreview`. `PlainTextSurface` con
profilo `plain-text` non espone API Markdown vuote. Plain text è un client
architetturale della shell, non una funzionalità del vault: questa distinzione
non descrive un percorso in cui l'utente apre file `.txt` dal vault. Il fake
host tratta come documento soltanto `.md`.

L'identità del formato resta temporanea: `surfaceRequestForDocument(id)`
inferisce path ed estensione senza ricevere `handledExtensions`. Markdown usa
`md` e `markdown` o l'id `text/markdown`; testo piano usa `plain`, `text` e
`txt` o l'id `text/plain`; byte usa `bin`, `blob`, `bytes`, `dat`, `opaque` e
`binary`. Ogni altro id produce `family: "text"` e `profile: "unknown"` e
raggiunge il fallback testuale. Un'estensione gestita da un provider, come
`note` o `fubsheet`, non diventa automaticamente Markdown. `handledExtensions`
e `VaultInfo.extensions` restano dati per esploratore e note di cartella, non
identità del formato; non esiste un `format_id` IPC e `FormatDescriptor.id` in
Rust non è un campo di `VaultInfo`.

`SurfaceModeId` è locale alla shell e il pannello confronta ogni richiesta con
il catalogo della superficie montata nel riquadro con il focus prima di
aggiornare la sua modalità nativa. `PaneMode` resta l'ABI
`source | live_preview | reading` di `ViewContext.mode` e del layout legacy:
solo alla loro pubblicazione `source`, `live_preview` e `reading` conservano
quel valore, mentre ogni altro `SurfaceModeId` si proietta
deterministicamente a `source`. Una richiesta non supportata non cambia nulla;
la resa di Lettura richiede `MarkdownEditorSurface` oltre alla modalità
effettiva.

Una focus trap aperta possiede Escape e Tab e impedisce alle scorciatoie della
shell di agire. La sua acquisizione annulla immediatamente, tramite
`onKeyboardOwnershipChange(stopWaiting)`, ogni sequenza shell pendente, anche
senza un `keydown`. Il listener della shell osserva `defaultPrevented` dopo il
gesto gestito dalla superficie montata: un gesto consumato resta locale e
interrompe una sequenza pendente al suo primo gesto. Tutti gli altri gesti
passano all'unico dispatcher della shell, che tratta documento, riquadro e
globale come namespace di comandi, non come livelli di listener. Una modifica
di scorciatoia diventa attiva a runtime dopo il gesto che la cambia, senza un
percorso speciale legato all'ID del comando.

Un riquadro o una finestra vuoti contengono il solo chrome, senza un
`EditorView` Markdown finto. La `DocumentSession` coordina buffer, salvataggio,
bozza, conflitti e lifecycle; il pannello collega le superfici e aggiorna la
resa. Nessun profilo invia una chiamata IPC o WASM per ogni battuta.

Non esiste una griglia (`GridEngine`) né un percorso utente `.fubsheet`; il
contratto generico non consegna `live_preview` a questi percorsi.

## Dove si trova

- `apps/client/src/editors/core/registry.ts`
- `apps/client/src/editors/bootstrap.ts`
- `apps/client/src/editors/text/factories.ts`
- `apps/client/src/editor/`
- `apps/client/src/panels/document.ts`
- `apps/client/src/state/`
- `apps/client/src/ui/arbitration.ts`
- `apps/client/src/ui/keyboard.ts`
- `crates/fub-abi/src/edit.rs`
- `crates/fub-abi/src/session.rs`
- `crates/fub-kernel/src/drafts.rs`
