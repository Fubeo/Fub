# 0157 — Un rilascio aspetta la seconda superficie, e il vocabolario è già quello dell'invocazione

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: §26.7 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.7](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#267-un-rilascio-si-consegna-un-bersaglio-non-si-dichiara)
chiedeva se un nodo dell'albero di una view possa dire *«qui si può lasciar
cadere»*, e che cosa arriva insieme al rilascio — un `DocId`, un `json` opaco,
un tipo dichiarato. La voce misurava che il contratto conosce il trascinamento
del puntatore e non il rilascio su un bersaglio, e che la shell lo fa in un file
solo, senza che nessun dato lo dichiari.

## La premessa, rimisurata

Rimisurata a `b333ab4`.

- **Nel contratto, zero, e le tre righe che il `grep` trova sono tutte
  altro.** `grep -inE 'drag|drop'` su `crates/fub-abi/wit/fub/abi.wit` dà tre
  righe: il commento e la dichiarazione di `record event-overflow { dropped:
  u64 }` (eventi persi) e la parola `Drop` di Rust in un commento. Il
  trascinamento del puntatore — `preferred-size`, *«poi comanda ciò che
  l'utente ha trascinato»* — c'è; il rilascio su un bersaglio no.
- **Il vocabolario della UI non ha il concetto.** `UiKind` ha 33 varianti e
  nessuna è un bersaglio; `UiAction` ha tre campi (`action`, `payload`,
  `fields`) e nessun mittente di trascinamento.
- **La shell lo fa, in un file solo.** Gli ascoltatori di trascinamento su
  tutto `frontend/src/` stanno in `panels/explorer.ts` e sono **otto**, in due
  funzioni: `wireDrag` (`:898-919`, cinque) e `wireRootDropTarget` (`:995-1006`,
  tre). Il renderer generico degli alberi, `frontend/src/ui/node.ts`, ha
  quattro `addEventListener` in tutto e nessuno di trascinamento: **nessun
  evento di drop raggiunge mai `on_action`**.
- **I due gesti dello stesso `drop` finiscono in due canali diversi.** Il
  riordino chiama `setOrder` → `api.setOrder` → `invoke("set_order")`, un
  comando Tauri bespoke (`crates/fub-app/src/lib.rs:612`) **fuori dal registro
  `COMANDI`**; lo spostamento in cartella passa dal registro. Il secondo si
  annulla con `Mod-Alt-z`, il primo no — e sono lo stesso gesto per chi lo
  compie.
- **`dropGesture` decide `before`/`after`/`into` con una soglia numerica**
  (`explorer.ts:946`, `y > 0.3 && y < 0.7`) che nessun altro pannello erediterà.
- **Il corpus chiede 14 drag & drop veri** in cinque file; le altre nove righe
  di trascinamento sono pan, ridimensionamento o selezione col puntatore, che
  non hanno bisogno di un bersaglio.
- **La 0152 non uccide la (a).** Il no di quel verbale era al bersaglio-come-
  stato: `view-context` è uno stato che dura, e un fatto vero per un istante non
  ci abita. La (a) di questa voce dichiara **sul nodo** e consegna **con
  l'invocazione** — lo stesso canale che la 0152 ha lasciato aperto («con
  l'invocazione, non con lo stato»). Le due decisioni non si toccano.

## La decisione

**Niente campo bersaglio su `ui-node` oggi. Il drag & drop resta della shell
finché non esiste una seconda superficie che trascina.** Il vocabolario del
bersaglio è già quello della
[0152](0152-il-bersaglio-di-un-clic-non-e-uno-stato.md): viaggia con
l'**invocazione** (`ui-action.payload`), non con lo stato (`view-context`). Il
giorno della seconda superficie — canvas, blocchi, preferiti trascinabili — la
forma è la **(a)** della voce: un campo in fondo a `ui-node` (additivo per
`wit_additivity`, quindi non scade col freeze) e il carico nel `payload` che
esiste già. Oggi quel giorno non c'è.

La ragione è la stessa che ha chiuso le altre voci di questa seduta: **il
secondo chiamante non esiste.** Canvas e blocchi stanno solo nel corpus; i
preferiti sono in `explorer.ts` una lista piatta non-draggable. Scrivere il
campo per un produttore solo — la shell, che il bersaglio ce l'ha già in mano
nell'ascoltatore — è precisamente il primo chiamante che la
[0150](0150-il-piano-e-della-superficie.md) e la 0152 hanno rifiutato. La (a)
resta la forma **finale**, non la forma **oggi**: si irrigidisce solo la
posizione del campo, che è cosmetica.

**Il lavoro portato è il fatto scritto dove ci si inciampa.** Il doc di
`ui-node` nel WIT e quello di `UiNode` in `ui.rs` dicono adesso che un nodo
**non** dichiara se accetta un rilascio, e che il trascinamento del puntatore
(`preferred-size`) non è un bersaglio di drop; il doc di `ui-action` e quello
di `UiAction` dicono che se un rilascio un giorno attraversa il confine, il
carico sta in `payload` — con l'invocazione, non con lo stato. Nessun campo
nuovo: la porta è il canale che la 0152 ha lasciato aperto.

**Presidio: nessuno, e la ragione è che sarebbe sbagliato.** Un banco che
pretenda «zero campi drop» su `ui-node` diventerebbe rosso sulla mossa giusta —
il campo additivo del giorno della seconda superficie — e la
[0153](0153-non-c-e-una-terza-pila.md) ha già spiegato perché un lucchetto che
diventa rosso per la mossa giusta è peggio di nessun lucchetto.

## Le forme scartate

- **(a) adesso** — scartata sopra: il secondo chiamante non esiste, e scrivere
  il campo per un produttore solo è il primo chiamante che 0150 e 0152 hanno
  rifiutato. Resta la forma finale, additiva e riapribile per sempre.
- **(b) da sola** — consegna senza dichiarazione: ogni `Row` si illumina e poi
  rifiuta. La voce stessa lo dice: sposta il costo sull'utente invece che sul
  manutentore. Non è una risposta, è un altro modo di non decidere.
- **(c) `UiKind::Custom` con un `ns` privato** — due plugin che fanno la stessa
  cosa la fanno con due `ns` che nessuna shell condivide: è il `Custom` come
  strada unica che la [0019](0019-il-canale-dati.md) ha già chiuso.
- **(d) come risposta di contratto** — una primitiva riusabile di qua, come
  `showContextMenu` in `ui/menu.ts` è la primitiva del menu, risolve il
  moltiplicatore fra i pannelli del core e lascia fuori chi non è core, che è
  la metà della domanda. È la fotografia di `shell.md:65` — *«l'albero, gli
  spazi, le appuntate, il drag & drop»* come cosa di un file solo — non una
  porta.

## Cosa resta scoperto

- **Le 14 richieste del corpus restano scritte come oggi**: 14 copie di
  `wireDrag` in 14 pannelli, ognuna con la propria idea di che cosa sia un
  rilascio. Questa decisione non le apre: nomina la strada per quando la
  seconda superficie le chiederà di essere una sola.
- **`set_order` resta fuori dal registro**: niente palette, niente scorciatoia,
  niente chiave, niente undo sul riordino. Farlo passare dal registro sarebbe
  una voce diversa — palette e undo del riordino — e non è questa.
- **`dropGesture` resta una soglia numerica in un file solo** (`0.3`/`0.7` in
  `explorer.ts:946`), che nessun altro pannello erediterà finché la seconda
  superficie non esiste.
- **La (a) resta la forma quando nasce la seconda superficie**: un campo in
  fondo a `ui-node` è additivo e non scade col freeze, e il carico sta nel
  `payload` che esiste già. Il giorno che un canvas o una lista di preferiti
  trascinabile chiederà un bersaglio, la domanda di che cosa si trascina — un
  `DocId`, un `json` opaco, un tipo dichiarato — si porrà lì, con un secondo
  chiamante vero.
