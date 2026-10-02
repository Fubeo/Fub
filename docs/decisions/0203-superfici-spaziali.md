# 0203 — Le superfici spaziali modificano sorgenti SVG con operazioni testuali

- **Stato:** proposta
- **Data:** 2026-10-02
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub non ha una superficie per disegnare. Serve un editor di schizzi, forme e
annotazioni con la penna. La famiglia `canvas` esiste, con owner
`fub.shell.canvas` e i profili `canvas` e `source` della lavagna JSON Canvas. I
file `.svg` non hanno un formato: la famiglia `text` li apre con il profilo
`svg` e le note li mostrano come immagini del vault.

I vincoli che contano:

- un componente WASM non può disegnare: i renderer `ui-custom` sono codice del
  bundle della shell (`apps/client/src/ui/custom.ts`), `host-vault-write` non è
  collegato al guest e ogni chiamata ha un tetto di memoria e di tempo;
- la `DocumentSession` è testuale: accetta `SurfaceEdit { text, operation }` e
  valida l'operazione applicandola al buffer;
- il protocollo Grid della [0201](0201-superfici-strutturate-a-finestre.md)
  serve un documento più grande della finestra mostrata e un valutatore che vive
  in Rust; un disegno si rende per intero e la sua geometria serve alla shell per
  selezione, hit test e snap;
- caricare risorse è una decisione della shell: i media del vault passano da un
  lease del kernel e dal protocollo `fub-asset:`, e la sanitizzazione esclude
  `data:` e `blob:` negli `<img>`.

## Decisione

1. La famiglia `canvas` ottiene il profilo `vector`, legato al formato `svg`
   in `CANVAS_MOUNT` (`apps/client/src/editors/canvas/surface.ts`). L'owner
   resta `fub.shell.canvas`, perché il registro ammette un solo owner per
   famiglia; la factory sceglie il motore in base al profilo e la lavagna non
   cambia. Le modalità del profilo sono `draw` e `read`, proiettate su
   `live_preview` e `reading`. La famiglia resta interna alla shell: nessuna
   porta IPC e nessuna famiglia WIT nuove.
2. Il formato lo porta una feature Cargo `draw` di `fub-host`, che registra il
   provider in `mount_with_formats` (ADR 0198). La feature è fuori dal
   `default` ed è dichiarata in `FUORI_DAL_DEFAULT` con il passo di CI che la
   compila. Senza la feature il profilo `vector` resta inerte e un `.svg` resta
   un file senza formato, aperto dal profilo `svg` della famiglia `text`.
3. Con la feature accesa il profilo `svg` della famiglia `text` resta
   raggiungibile: il comando «Apri come sorgente» imposta l'override del
   riquadro a `{ family: "text", profile: "svg" }` sulla stessa sessione.
4. La sorgente autorevole è il testo SVG nella `DocumentSession`. La superficie
   analizza il testo, applica operazioni strutturate per id e consegna
   `SurfaceEdit` con una `TextOperation` limitata agli span toccati; per un
   gruppo di operazioni basta la patch prefisso/suffisso di `operationFromText`.
   Gli offset sono quelli UTF-16 su testo normalizzato a LF usati da
   `TextEngine`; il testo consegnato è quello grezzo con le stesse modifiche,
   così i terminatori non toccati restano identici. Un riallineamento arriva
   come `syncDoc` e ricostruisce la scena.
5. Il formato è un sottoinsieme modificabile di SVG, con attributi propri nel
   namespace `https://fubeo.github.io/ns/scene/1`. Ciò che è fuori dal
   sottoinsieme si conserva byte per byte e non entra mai nel DOM vivo, ma solo
   in un `<img>` da blob creato dalla superficie. Un SVG senza `fub:version` si
   mostra come immagine inerte finché non lo si adotta con «Modifica».
6. Il provider `svg` (`crates/fub-format-svg`, costruito su `crates/fub-scene`)
   non modifica i documenti: `parse` produce il modello per indice, ricerca,
   link e outline; `render_html` emette un segnaposto
   `figure[data-embed-kind="scene"]`, mai un `<img>`; `serialize` genera
   soltanto documenti nuovi; `rewrite_links` aggiorna gli `a href` quando la
   destinazione cambia nome.
7. Un disegno incorporato in una nota resta un'immagine del vault:
   `hydrateVaultMedia` lo mostra in un `<img>` servito come `image/svg+xml` con
   `nosniff`. Non nasce un secondo percorso per gli embed.
8. Le fixture del formato sono generate da `fub-scene` e lette dai test della
   superficie, con il meccanismo `UPDATE_MIRROR` dei test di mirror.
9. La camera di `apps/client/src/graph/render/camera.ts` diventa un modulo
   condiviso, con limiti di scala scelti da ogni consumatore.

Sono obbligatori i punti 1–7. Restano conseguenze possibili un profilo `pdf`
nella stessa famiglia e una proiezione pubblica della famiglia, il giorno in cui
un plugin di terzi ne avrà bisogno.

## Conseguenze

### Positive

- disegnare non richiede contratti nuovi fra shell, host e plugin;
- sessioni, bozze, conflitti, undo per superficie e indicizzazione valgono anche
  per i disegni;
- i file restano SVG leggibili fuori da Fub, con diff riga per riga;
- gli embed riusano la risoluzione dei media che la shell ha già.

### Negative

- la lettura del formato esiste in due linguaggi, Rust per l'indice e
  TypeScript per l'editor, e le fixture devono tenerli allineati;
- con la feature attiva tutti gli SVG del vault diventano documenti: si salvano
  con `writeDocument` invece che come byte, diventano candidati a nota di
  cartella e cambiano esplorazione, indice e conteggi del grafo;
- la logica di editing vive nella shell e un plugin di terzi non può estenderla
  finché non esisterà un renderer per terzi;
- il contenuto estraneo si modifica solo come blocco: rimuovere o spostare;
- un disegno non si apre nella finestra documento a parte, che monta solo
  l'editor di testo.

## Alternative scartate

### Superficie strutturata a finestre come Grid

Sessioni Rust, finestre e patch tipizzate avrebbero dato all'editor lo stesso
impianto del foglio, con una famiglia IPC, il suo mirror e una proiezione WIT.
È scartata perché un disegno si rende per intero e la geometria serve comunque
alla shell: il costo dei contratti non toglierebbe lavoro al frontend.

### Editor come plugin WASM

Era plausibile per l'invariante secondo cui una feature ufficiale è ciò che
scriverà un plugin di terzi. È scartata perché il guest non può disegnare né
scrivere nel vault, e un tratto non può attraversare WASM a ogni campione.

### Una famiglia nuova per il disegno

Una famiglia `draw` con un owner proprio era possibile, perché la famiglia è un
nome aperto. È scartata perché disegno e lavagna condividono la natura della
superficie: carta infinita, camera, puntatore e selezione di oggetti. Due
famiglie spaziali duplicherebbero firma di mount e modalità senza separare
responsabilità diverse.

### Formato JSON proprietario o estensione propria

Un JSON sarebbe stato più semplice da analizzare, un'estensione come `.fubsvg`
avrebbe lasciato intatti gli SVG esistenti. Sono scartati perché il file non si
leggerebbe fuori da Fub e le stesse figure avrebbero due formati, mentre gli SVG
sono già nei vault degli utenti. L'estensione propria resta il ripiego se
rivendicare `.svg` fa regredire il vault.

### SVG inline nell'anteprima sanitizzata

Mostrare l'SVG come markup dentro l'HTML sanitizzato avrebbe evitato il blob.
È scartata perché allargherebbe la sanitizzazione a un linguaggio con
riferimenti esterni, stili e script, mentre un `<img>` non esegue nulla.

## Verifica

- vettori di prova delle operazioni: `tryApplyOperation(prima, op)` restituisce
  `dopo`, la scena ricostruita coincide e i byte fuori dalle modifiche non
  cambiano;
- fixture generate da `fub-scene` e lette dalla superficie;
- vault con SVG preesistenti, con la feature `draw`: specie, indice, ricerca,
  backlink da `a href`, rinomina, note di cartella ed embed;
- la CI compila e prova `fub-host` con e senza la feature `draw`;
- due superfici sullo stesso documento, con undo locale, sincronizzazione ed
  esito `realigned`; «Apri come sorgente» sulla stessa sessione;
- nessun nodo estraneo nel DOM vivo della superficie;
- mount e unmount ripetuti senza listener residui, con un test della superficie
  oltre al controllo statico di `check-listeners`;
- `axe` e baseline visuali della scena nel banco.
