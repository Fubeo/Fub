# 0042 — Il catalogo della shell, e la luce in cui si legge

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §12.4 (seduta 12) — **chiude la seduta** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/12-stringhe-errori-locale.md)

---

Il §12.4 era una voce con quattro punti che sembravano quattro lavori diversi —
token e temi, una passata di accessibilità, il suo presidio, il catalogo delle
stringhe — e sono lo stesso: **chi guarda FubMD non lo guarda come chi lo
scrive.** In una luce diversa, con la tastiera invece del mouse, senza vedere lo
schermo, in un'altra lingua. Ognuno dei quattro punti è uno di quei modi, e ogni
volta la domanda è la stessa: *questa cosa è dichiarata in un posto solo, o è
ricopiata in due che devono restare d'accordo?*

La risposta è stata quattro volte la stessa, e vale la pena scriverla prima dei
dettagli:

> **Un valore che vive in due posti diverge, e diverge quello meno guardato.**

Il colore che sta nei token *e* dentro il pacchetto dell'editor. Il nome
accessibile che sta nell'`aria-label` *e* nel titolo della view. La parola che
sta nel catalogo *e* nell'HTML. Il conteggio che sta nel testo fermo *e* nel
codice che conosce il numero. Ogni punto di questa voce è una di quelle coppie
sciolta.

Le tre facce precedenti della seduta erano già chiuse: la
[0039](0039-il-locale-e-il-caso.md) ha dato il locale all'host, la
[0040](0040-chi-localizza.md) ha deciso **chi localizza** — `Text::Literal` per
i dati, `Text::Message` per ciò che si traduce, risolto dal kernel sulla via
d'uscita dal contratto — e la [0041](0041-un-errore-e-testo-che-qualcuno-legge.md)
ha portato la stessa forma agli errori. Questa è l'ultima, ed è quella che la
0040 aveva **ristretto** invece di allargare.

## Ciò che la 0040 ha lasciato scoperto, ed è esattamente questo

La 0040 ha tolto da questa voce tutto ciò che appartiene a un provider: le
stringhe di un componente le porta il componente, e la shell non conosce le
chiavi di nessuno. Ciò che è rimasto è **ciò che la shell scrive di suo** — il
cestino, l'esplora, la palette, i tre pannelli di sistema, il testo fermo di
`index.html` — più una coda che la 0040 aveva nominata: sei feature ufficiali su
otto non avevano ancora un catalogo, e continuavano a restituire italiano
cablato.

Le due metà sono state fatte con lo stesso criterio e hanno prodotto due
soluzioni diverse, ed è la parte più interessante di questo verbale.

### Da parte Rust: un catalogo per feature, e un presidio che cammina

`outline`, `stats`, `blocks`, `search`, `versioning`, `commands` hanno adesso il
loro catalogo di manifest, come `tags` e `backlinks` già avevano; il core ne ha
due (`fubmd-host/src/settings.rs` e `fubmd-kernel/src/locale.rs`), e
`mount.rs` li lega con `.speaking(…)`.

I due presidi nuovi (`fubmd-features/tests/i_cataloghi.rs`,
`fubmd-host/tests/i_cataloghi.rs`) camminano sui cataloghi e verificano tre
cose: che le lingue siano simmetriche, che ogni chiave dichiarata abbia una
voce, e che **nessuna spec porti prosa cablata**. Il terzo è quello che vale: è
il modo in cui una feature nuova non può nascere con l'italiano dentro.

Una riga dell'ABI è stata corretta lungo la strada, ed era un difetto vero:
`Strings::template` restituiva il **primo** catalogo trovato per una lingua
invece di sommarli. Con un catalogo per bundle non si vedeva; col core che ne ha
due, in due crate diversi, metà delle sue chiavi sarebbe stata invisibile.

### Da parte shell: un catalogo tipizzato, che è ciò che in Rust costa un test

`frontend/src/i18n/strings.ts`. Il catalogo italiano è la **forma**, `Chiave` è
l'unione delle sue chiavi, e le altre lingue sono `Record<Chiave, string>`:
**una chiave dimenticata in inglese non compila**.

È la stessa promessa che dall'altro lato costa un test che cammina sui
cataloghi, e qui il compilatore la regala perché lì un catalogo è dato di
manifest con chiavi `&str`, e qui è un letterale. Vale la pena prendersela: una
chiave mancante è il tipo di difetto che altrimenti si scopre da una
segnalazione, mesi dopo, da qualcuno che usa l'app in una lingua che chi la
scrive non apre mai.

La scala di ripiego è **quella del contratto** — `it-IT` → `it` → l'italiano →
la chiave nuda — e lo è di proposito: due scale diverse per la stessa app
vorrebbero dire che una stringa della shell e una di un provider possono cadere
in due lingue diverse sullo stesso schermo.

## Le decisioni prese, da NON ridiscutere senza motivo

### Una stringa ha **un** proprietario, e il conteggio decide chi

Il testo fermo di `index.html` nomina le chiavi in quattro attributi
(`data-i18n`, `-title`, `-placeholder`, `-label`), e `applicaStringhe` li
riempie. Quattro nomi e non un mini-linguaggio dentro un attributo, che è la
forma che si finisce per dover parsare: un pulsante ha un testo **e** un
`title`, un campo ha un segnaposto **e** un nome accessibile.

Ma tre stringhe della scocca **non** ce l'hanno, e la regola per cui non ce
l'hanno è la cosa da ricordare:

> **Se una frase porta un numero, la scrive chi conosce il numero.**

«Attività 3», «Avvisi 7», e il titolo del pannello note — che a casa dice
«Note» e dentro uno spazio dice il nome dello spazio. Un `data-i18n` su quegli
elementi non sarebbe stato inutile: sarebbe stato **attivamente sbagliato**.
`applicaStringhe` gira a ogni cambio di lingua e scriverebbe «Attività», cioè
cancellerebbe il conteggio; sul titolo dello spazio riporterebbe «Note» proprio
quando l'utente non ha cambiato spazio. Due proprietari per la stessa parola
sono un difetto che si manifesta solo cambiando lingua e guardando bene, che è
la definizione di difetto che nessuno trova.

Quei tre si iscrivono da sé con `onLingua`, e questo è il secondo pezzo della
regola: **chi disegna del testo sa di disegnarlo**. L'alternativa era un elenco
in `main.ts` di chi va richiamato al cambio di lingua — cioè un elenco che si
scopre incompleto nello stesso modo in cui si scopre il difetto di sopra. Ciò
che passa da `main.ts` è solo `refreshAllPanels()`, perché i pannelli hanno già
un registro che sa chiamarli tutti (§1.2).

### Il plurale non esiste, quindi le frasi non lo chiedono

Il motore dei template — questo e quello del contratto — sostituisce `{nome}`
con un argomento. **Non sa scegliere una forma plurale**, e non è una mancanza
da colmare: sceglierla vuol dire conoscere le regole di ogni lingua (l'arabo ne
ha sei categorie, il polacco tre), e portarsele dietro nel kernel per scrivere
«2 note» è un costo che nessun cliente ha ancora chiesto.

Quindi le frasi sono riscritte in forma che il plurale non lo chiede, col numero
come argomento:

| prima | adesso |
|---|---|
| `${n} risultat${n === 1 ? "o" : "i"}` | `Risultati: {count}` |
| `${n} version${n === 1 ? "e" : "i"}` | `Versioni: {count}` |
| `Grafo — ${n} not${…}, ${m} collegament${…}` | `Grafo — Note: {note} · Collegamenti: {archi}` |
| `${nome} — ${n} ${n === 1 ? "modifica" : "modifiche"}` | `{doc} — Modifiche: {count}` |
| `Cancellare per sempre ${n} element${…}?` | `Cancellare per sempre tutto il cestino? Elementi: {count}` |

È la stessa cura presa dall'altro lato del confine in `stats::conteggi`
(«Parole: 3», non «3 parole»), e la ragione per cui vale la pena scriverla qui è
che **una frase con un ternario dentro non è traducibile e non lo dice**: passa
i tipi, passa i test, e produce una frase sbagliata in ogni lingua che non
declina come l'italiano.

### Chiavi, non parole, in ogni tabella

`ui/palette.ts` aveva `REACH_LABELS`, una tabella `Record<reach, string>` a
livello di modulo. Una tabella di stringhe si risolve **all'import**: una volta
sola, nella lingua di quel momento. Cambiare lingua avrebbe lasciato la palette
a parlare quella di prima, e non lo avrebbe detto nessuno.

Adesso è `REACH_KEYS`, una tabella di `Chiave`, e `t()` la risolve alla
chiamata. La regola generale: **le chiavi non invecchiano, le parole sì** — e
ogni volta che una stringa viene calcolata prima del momento in cui si vede, è
lì che va guardato.

Lo stesso vale per la composizione: `scrive · più note · non reversibile` era
concatenato in TypeScript. Adesso sono tre template (`palette.reads`,
`palette.writes`, `palette.irreversible`), perché una lingua che mette il verbo
dopo l'oggetto riscrive **il template**, e non ha modo di riscrivere un
`${a} · ${b}` scritto nel codice. Idem per la provenienza di un'impostazione:
«vale per questa macchina» e «vale per questo vault» sono la stessa frase solo
in italiano.

### Il banco di prova gira in una lingua dichiarata

Questa non era prevista, ed è la scoperta più utile della voce.

`t()` risolve sulla lingua di chi guarda, e nei test chi guarda è
`navigator.language` — cioè **il locale della macchina che lancia `vitest`**.
Lasciato così, `scopeLabel` restituisce «scrive · più note» sul computer di chi
ha scritto il presidio e «writes · several notes» su quello di chiunque altro: la
suite passa o fallisce *secondo chi la lancia*. Cinque presidi che asserivano
prosa italiana sono diventati rossi appena il catalogo è entrato in funzione, e
avevano ragione a farlo — stavano dicendo che non c'era nessuna lingua
dichiarata.

`src/test-setup.ts` la dichiara, una volta, per tutta la suite: **l'italiano**,
che è la lingua in cui questa shell è scritta. Chi vuole provare *la traduzione*
— che è un'altra domanda — non passa di lì: passa da `catalogoPer`, che prende
la lingua come argomento apposta.

Vale la pena nominare il difetto per quello che è, perché è peggio di un
presidio che fallisce: **un presidio che dice cose diverse a persone diverse**
non mente, ma non serve a niente, e se ne accorge solo il secondo contributore.

### Il catalogo marcisce, quindi un presidio lo pota

`i18n/strings.test.ts` presidia le quattro cose che stanno fuori dalla portata
dei tipi: le chiavi nominate da `index.html`, gli argomenti dei template (un
`{count}` diventato `{n}` traducendo non rompe niente e non lo dice nessuno), la
scala di ripiego, e **le chiavi che non usa più nessuno**.

L'ultimo è quello che ha già pagato: al primo giro ha trovato `graph.title`, una
chiave che nessuno nominava più. È il modo esatto in cui un catalogo marcisce —
si riscrive un pannello, la chiave resta, e la si traduce per anni in ogni
lingua che arriva. È stata tolta, che è la risposta giusta: una chiave senza
cliente non si conserva «per sicurezza», si cancella.

Quel presidio ha una condizione per funzionare, ed è scritta accanto:
**le chiavi si nominano come letterali, mai composte**. Una chiave costruita
(`` `palette.reach.${x}` ``) è una chiave che nessun presidio sa cercare e che
quindi nessuno saprà mai cancellare. È anche la ragione per cui `REACH_KEYS`
elenca le cinque chiavi per esteso invece di comporle da un prefisso: costa
cinque righe e le rende trovabili.

### Due guardie contro il presidio che passa a vuoto

Ripetute qui perché è la seconda volta che servono in questo repo (la prima è il
`css: true` di `vite.config.ts`, messo perché il presidio di `hidden` cercava
una regola dentro una stringa vuota):

- il conto delle chiavi trovate in `index.html` è **asserito**, non solo usato:
  se il `?raw` restituisse la stringa vuota, il test «ogni chiave esiste» non ne
  troverebbe nessuna e direbbe che va tutto bene;
- il glob che legge i sorgenti asserisce di aver letto qualcosa.

E una terza, sulla forma del presidio invece che sul suo input: la prima stesura
cercava `data-i18n="…">testo<` con un'espressione regolare, e ne trovava
**dodici su venticinque** — tutte e sole quelle in cui l'attributo era l'ultimo
prima del `>`. Le altre tredici, cioè quasi tutti i pulsanti, non erano
presidiate e il test passava lo stesso. Adesso `index.html` si parsa con un
`DOMParser`, che sull'ordine degli attributi non ha opinioni.

### I colori vengono da dove già stanno

Il primo punto della voce — token e temi — aveva la stessa forma. `oneDark` era
`import` di una riga e sembrava la scelta più economica possibile; costava che i
colori della superficie del documento erano dichiarati **due volte**, una in
`theme/tokens.css` (dove li leggono la modalità Lettura e la live preview) e una
dentro il pacchetto (dove li legge la modalità Sorgente). Uguali perché
ricopiate a mano, con il commento accanto ai token che lo ammetteva.

Con un tema chiaro la cosa smette di essere teorica: `oneDark` è scuro per
definizione, e nessun valore di `tokens.css` lo può schiarire. O si montava un
secondo pacchetto — e le liste diventavano tre — o i colori venivano da dove già
stanno. `editor/theme.ts` li scrive tutti come `var(--…)`, e il guadagno che non
si vede nel diff è che **cambiare tema non ricostruisce l'editor**: cambia
l'attributo sulla radice, i colori seguono, documento e cronologia di undo
intatti.

Il presidio è `theme/contrast.test.ts`: legge i token col `?raw` e verifica una
tabella di coppie dichiarate contro la soglia che ognuna deve (4,5 per il testo,
3 per i segni), settantatré asserzioni in tutto. Ha trovato diverse coppie sotto
soglia mentre il tema chiaro veniva scritto, e la più grave stava nel posto
peggiore: `--accent-soft` era **lo sfondo** delle righe in hover e di quelle
selezionate, cioè il contrasto peggiore dell'app era proprio sotto il puntatore
del mouse. Quelle tre regole prendono adesso `--bg-hover`, e `--accent-soft`
torna a fare il mestiere per cui è dichiarato — **inchiostro**, non fondo.

Il conto esatto di quante fossero non è ricostruibile e non lo si scrive: prima
di questa voce il tema chiaro **non esisteva**, quindi metà di quelle coppie
sono nate insieme al presidio invece di essere state trovate da lui. Ciò che
resta vero e verificabile è che oggi passano tutte, e che i due debiti rimasti
sono dichiarati per iscritto (qui sotto).

### L'accessibilità si presidia dove nasce, non dove si vede

Il terzo punto chiedeva un check automatico sui pannelli, e la
[0014](0014-i-verbali-fuori-da-todo.md) dice perché va nella stessa seduta della
passata: *una promessa senza presidio meccanico decade*.

La riga che vale più delle altre non è nel presidio, è in `ui/node.ts`:
`attivabile(el)` sta dentro `collega()`, che è il punto da cui passa **ogni**
azione di **ogni** nodo dichiarativo. Cliccabile e attivabile da tastiera sono
la stessa cosa, e da lì in poi lo sono *per costruzione* — anche per i pannelli
che non sono ancora stati scritti. È la differenza fra una passata di
accessibilità e una regola: la prima copre i pannelli di oggi, la seconda anche
quelli di domani.

## Cosa si è trovato e **non** si è toccato

**`SettingKind::rejects()` porta italiano cablato dentro l'ABI**
(`crates/fubmd-abi/src/settings.rs`): «`{n}` è fuori dall'intervallo ammesso
(…)», «`{v}` non è fra le scelte ammesse (…)».

Non è stato corretto, e la ragione è che **non è un fix meccanico**: nessun
catalogo appartiene all'ABI. Il contratto definisce la forma di un catalogo, non
ne possiede uno — darne uno all'ABI vorrebbe dire decidere che il contratto ha
una voce propria, che è una decisione di forma e non una svista da riparare in
coda a un'altra voce.

La conseguenza si vede in `settings.import`: le ragioni dei valori rifiutati
attraversano il confine come **dato** (`{reasons}`), quindi la frase attorno si
traduce e le ragioni dentro restano italiane. È motivato accanto al codice, ed è
esattamente il degrado garbato che la 0040 aveva previsto — ma qui va detto che
è il *contratto* a non essersi dichiarato, non un componente che ha dimenticato.

## Cosa si è scartato, e perché

- **Un `data-i18n` sui due pulsanti della barra di stato e sul titolo dello
  spazio.** Avrebbe cancellato il conteggio a ogni cambio di lingua. Vedi sopra:
  è il caso che ha prodotto la regola.
- **Un elenco in `main.ts` di chi ridisegnare al cambio di lingua.** Si scopre
  incompleto solo cambiando lingua e guardando bene. `onLingua` mette
  l'iscrizione dove sta il disegno.
- **Tradurre i `title` dei pannelli nel registro** (`registerPanel({ title })`).
  Sono l'unica stringa della shell fuori dal catalogo, e non per dimenticanza:
  `registeredPanels()` non ha ancora un lettore — è il pezzetto di §7.6 che
  riguarda la shell — e tradurla oggi vorrebbe dire risolverla **al montaggio**,
  cioè congelarla nella lingua di quel momento. Un nome che non si vede e che,
  il giorno che si vedesse, sarebbe già quello sbagliato. Sta scritto accanto al
  campo, con cosa fare il giorno che l'inventario avrà una superficie.
- **Insegnare il plurale al motore dei template.** Vedi sopra: sei categorie in
  arabo, e nessun cliente che l'abbia chiesto.
- **Conservare `graph.title` «per sicurezza».** Una chiave senza cliente è il
  primo passo della marcescenza che il presidio è lì per impedire.
- **Una `@media (prefers-color-scheme: dark)` al posto della risoluzione in
  TypeScript.** Avrebbe scritto i valori del tema scuro due volte — una nella
  media query, per chi non ha scelto, e una in `[data-theme="dark"]`, per chi ha
  scelto scuro su un sistema chiaro — e diverge quella meno guardata. Il
  guadagno secondario è che «quale tema vale» è una funzione pura di due
  argomenti, e una funzione pura si prova; una media query si prova solo aprendo
  l'app in due sistemi diversi.

## Cosa resta scoperto (e dove è scritto)

- **`SettingKind::rejects()`.** Vedi sopra. Vuole una decisione su chi possiede
  il catalogo del contratto, o su come si esprime un rifiuto senza prosa.
- **Un'impostazione di macchina non è leggibile finché non si apre un vault.**
  Debito dichiarato dalla [0036](0036-le-impostazioni-e-i-tre-stati.md) e ancora
  aperto: le impostazioni si leggono dal canale dati, che vuole un vault. Tema e
  lingua lo coprono con una cache in `localStorage`, che li rende giusti dal
  secondo avvio in poi; la soluzione vera — il livello macchina raggiungibile
  senza vault — è lavoro delle impostazioni, e inventare qui un comando IPC
  apposta avrebbe allargato il confine (§16.6) per due clienti.
- **Il dark `--accent-contrast` su `--accent` sta a 4,51:1**, cioè AA senza un
  filo di margine. È motivato nel commento accanto al valore, e la via d'uscita
  è la §25.1 (alto contrasto), non un ritocco che sposterebbe l'accento di tutta
  l'app.
- **La tavolozza di sintassi ha un debito AA dichiarato.** L'elenco delle coppie
  sotto soglia è una costante del presidio (`SOTTO_AA`) e dev'essere **esatto in
  entrambe le direzioni**: aggiungerne una fallisce, e ripararne una senza
  toglierla dall'elenco fallisce pure. Un debito con un lucchetto sopra non
  cresce in silenzio.
- **Il testo fermo di `index.html` è italiano.** È il ripiego, ed è ciò che si
  vede se `applicaStringhe` non gira: un ripiego che è già la lingua di ripiego.
  Il presidio verifica che sia **esattamente** quello del catalogo, o l'HTML
  sarebbe un secondo catalogo che nessuno aggiorna.
- **Il kernel e l'host parlano ancora `Text::Literal` in italiano** dove non
  hanno un catalogo. Il core adesso ne ha due (impostazioni e locale), quindi la
  superficie è più piccola di quella che la 0041 aveva dichiarato — ma non è
  zero.
