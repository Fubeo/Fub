# 0115 — La verità è la dichiarazione, e i parser non erano due

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§4.4](../roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi)
**Commit**: *(questo commit)*

---

## La domanda

La §4.4 la pone così: il **buffer** è di Lezer, il **file** è del modello, le due
grammatiche restano — ma restano *perché sono su due oggetti diversi*, non perché
nessuno abbia deciso. Quindi: **chi dei due è la verità?** E, sopra, la
[0104](0104-la-superficie-di-scrittura-si-presta.md) ha posato un vincolo che la
voce non poteva conoscere: la superficie di scrittura **si presta a un terzo**,
quindi la live preview della shell non è *l'editor*, è *un* editor.

La voce chiede tre cose in tre caselle: dichiarare il confine, **togliere il
moltiplicatore** (≈50 estensioni del capitolo 5.2, ognuna da scrivere due volte
in due linguaggi con due nozioni di offset), e scrivere un **corpus** su cui le
due passate debbano concordare.

## Cosa la misura ha cambiato, prima di progettare

**I parser non erano due.** Il titolo della voce è la premessa più grossa, ed è
falsa. Dentro `frontend/` la stessa sintassi era scritta **tredici** volte in
**sei** costrutti, in tre moduli che non si parlavano: `livepreview.ts` per
decorare, `editor-commands.ts` per i gesti, `completions.ts` per il popup. E non
erano tre copie: erano tre regole **diverse**, che sulla stessa riga rispondevano
cose diverse. Le due che mordevano di più, misurate leggendo le regex e poi
riprodotte in un banco:

- su `> - [ ] x` la live preview disegnava una casella (la sua regex accetta il
  prefisso di citazione) e `parseListItem` leggeva una **citazione**, quindi
  `Mod-Enter` non la spuntava e Invio non la continuava;
- su `-··[ ] x` (due spazi) la live preview vedeva una todo e i comandi un
  bullet: `editor-commands.ts` pretendeva **esattamente uno** spazio dopo il
  pallino, contro l'uno-a-quattro di CommonMark.

**La terza copia diverge anche dal modello, e quella è peggio.** `RE_TAG` di
`livepreview.ts` esigeva inizio riga o `[\s([{]` prima del `#`, mentre la regola
del contratto vieta solo un carattere **alfanumerico**: su `vedi.#tag`,
`(#altro)`, `"#terzo"` e `_#quarto` il modello indicizza un tag e la live preview
non decorava niente. In direzione opposta, la classe dei caratteri del nome
includeva `\p{M}`: su un `#Café` scritto decomposto — cioè quello che arriva da
un vault sincronizzato con macOS — il tag *visto* era più lungo del tag
*indicizzato*. E `completions.ts` aveva **una terza** risposta ancora: apriva il
popup dove la live preview non decorava. È la stessa specie di difetto della
[0107](0107-il-caso-di-una-lettera.md) e della riparazione
`568874c`, un gradino più a monte.

**La premessa sulle spec, invece, è vera**, e vale la pena dirlo perché è la
sola: `SyntaxRuleSpec` porta davvero il trigger come **dato**, e `format_of` dice
davvero quali sintassi capisce un documento. Il `==` di `livepreview.ts` era
letteralmente `HighlightRule::spec().trigger` riscritto a mano — e stava scritto,
nel doc della regola: *«è anche il §4.4 visto da vicino: la live preview della
shell riconosce già `==…==` per conto suo, e finché il modello non le arriva
quella regola resta scritta due volte»*.

**Una quarta divergenza, trovata mentre si misurava**: `[ xX]`. Il provider
markdown ha `relaxed_tasklist_matching` acceso apposta — `- [/] in corso` è una
task nel modello, e il §10.1 ci poggia sopra — mentre entrambe le regex della
shell accettavano solo tre simboli. Conseguenza: `taskChecked`, che esiste in
`mirrored.ts` **per** gli stati personalizzati e li documenta uno per uno, non
poteva riceverne nemmeno uno.

## La decisione

**Nessuno dei due parser è la verità: la verità è la dichiarazione.**

Con la 0104 le regex della shell non possono essere la verità nemmeno per la
shell, perché un terzo porterà la propria superficie e non le vedrà mai. Con la
[0018](0018-chi-vede-il-modello-parsato.md) il modello non può esserlo per un
buffer sporco, che al di qua del confine non conosce nessuno. Ciò che resta, e
che vale per **tutte** le superfici, è ciò che il contratto dichiara: il
vocabolario di `options::syntax` più il trigger di chi ne ha uno. Chi decora
**interpreta** quella dichiarazione; ciò che la dichiarazione non porta, lo
riscrive — e la parte nuova è che adesso si sa **quale delle due**.

Da qui, quattro mosse.

**1. `SyntaxForm` nel contratto**: un nome e un `Option<SyntaxTrigger>`.
`trigger` assente non vuol dire «nessuna forma»: vuol dire che la forma è nella
grammatica del provider, ed è il confine esatto oltre il quale chi decora si
arrangia. È tutto il valore del tipo rispetto a un elenco di nomi: dice **dove
finisce** ciò che si può generare. `Workspace::syntax_forms` lo serve — è
`format_of` per chi disegna invece di parsare.

**2. La shell legge la dichiarazione invece di riscriverla.**
`frontend/src/rules/sintassi.generated.ts` è emesso da un **montaggio vero**
(`fub-host/tests/sintassi_dichiarata.rs`), con la forma dei derivati che il repo
ha dalla [0053](0053-il-contratto-ha-una-sorgente.md). `==` non è più scritto
nella shell. Provato: cambiando il trigger di `HighlightRule` da `==` a `%%`,
cinque test della shell diventano rossi e la live preview smette di decorare
`==` — cioè il moltiplicatore è tolto per la famiglia `Inline`, che il contratto
stesso dichiara essere quella in cui è scritta *«la maggioranza delle ~50
estensioni del 5.2»*.

Sta in `fub-host` e non dove stanno i tipi per la ragione di
`le_view_ufficiali.rs`: la domanda non è quali regole **esistono**, è quali sono
**montate**, e un elenco che descrive il montaggio è falso il giorno in cui
qualcuno registra qualcosa senza passare di lì.

**3. Il riconoscimento del `#tag` sale nel contratto.** `extract_tags` stava in
`fub_sdk::scan`, cioè nel toolkit di *chi parsa* — e l'argomento per cui non
doveva starci era già scritto **tre righe più sotto**, nel doc di
`parse_wikilink_inner`: *la grammatica di `Page#Heading^block|Alias` descrive i
campi di `LinkTarget::Wiki`, quindi è una regola di ciò che il contratto dichiara
— come `canonical_tag` — e non del toolkit di chi lo usa.* Vale identico per il
`#tag`, che descrive i campi di `Tag`. Adesso è `fub_abi::rules::tag::scan_tags`,
l'SDK la ri-esporta, e la shell ne ha la **gemella rispecchiata** in
`mirrored.ts`, legata dalla fixture di `rules_mirror.rs`: cambiarla da un lato
solo è rosso.

**4. Nella shell la sintassi si riconosce in un posto solo.**
`frontend/src/rules/sintassi.ts`. I tredici siti diventano uno, e le tre specie
di regola che ci convivono sono dichiarate: **generata** (i delimitatori
inline), **rispecchiata** (i tag), **scritta una volta** (il wikilink e la voce
di lista). L'ultima categoria non è un residuo da rimpicciolire a tutti i costi:
la voce di lista è una regola di **gesto** — quale riga continua premendo Invio —
e nel modello non esiste, quindi una gemella sarebbe una gemella di niente.

### Ciò che NON si è fatto, e perché non è una scusa

**Il canale a runtime non c'è**, ed è la casella che questa decisione lascia
dietro di sé. Il generato è compilato, quindi conosce le regole del **core**; una
`SyntaxRule` di un plugin di terzi si registra a caldo, in un vault che nessun
test monterà mai, e di lei la superficie di scrittura non sa niente — la sua
sintassi arriva al modello e non arriva all'editor.

Il canale giusto ha un nome e una forma già decisi altrove: una variante di
`IndexQuery`, perché *un elenco è dati e i dati hanno un canale solo*
([0013](0013-elenco-delle-capacita.md)), e **non** un comando IPC, che sarebbe
visibile alla shell e non a un plugin — cioè esattamente il contrario di ciò che
la 0104 ha appena deciso. Non si apre qui per una ragione misurata e non per
prudenza: chi serve `IndexQuery` è `CoreIndex`, che ha già `Arc<FormatRegistry>`
ma **non** il `SyntaxRegistry` — quello vive dentro `DocumentStore`, sotto il
prestito esclusivo di chi scrive, e `parse_source` lo attraversa a **ogni**
parse. Condividerlo vuol dire mettere un lock su quella rotta, ed è una decisione
sulla concorrenza del kernel ([0024](0024-chi-legge-non-aspetta-chi-legge.md)),
non un pezzo di questa voce. L'accessore che quel canale servirebbe **esiste già**
ed è `Workspace::syntax_forms`: ciò che manca è la rotta, non la risposta.

## Il corpus, che è la parte che si paga adesso

La voce lo dice meglio di come lo direbbe questo verbale: finché le due
grammatiche restano due, la loro divergenza non è rossa da nessuna parte, e il
difetto che ne esce non è un crash — è che *ciò che si vede mentre si scrive* e
*ciò che viene reso e indicizzato* dicono due cose diverse sullo stesso testo, sul
caso che nessuno prova.

`il_corpus.rs` emette ciò che il **modello** dice delle sue sorgenti — tag,
wikilink e marcatori di task, con gli span già convertiti in code unit — e
`frontend/src/editor/corpus.test.ts` ci passa la passata della shell. È la mossa
della [0060](0060-il-modello-dice-il-vero-sui-byte.md) applicata all'altro asse.
Le sorgenti sono le **stesse** che `il_corpus.rs` già confronta col modello e che
`transfer_e2e.rs` già fa uscire e rientrare da un vault: un costrutto nuovo entra
là perché quelle proprietà lo pretendono, e arriva qui da solo.

Sta dentro `il_corpus.rs` e non in un binario suo, e la ragione è un presidio di
qualcun altro: `corpus/mod.rs` non ha un `allow(dead_code)`, e il perché ci sta
scritto — `clippy --all-targets` è il solo posto che si accorgerebbe di un caso
del corpus che nessuno semina più. Un terzo binario che ne usasse **una parte**
avrebbe reso quel guardiano rumoroso, e il modo di zittirlo sarebbe stato
spegnerlo.

**Le divergenze si dichiarano.** Tre, ognuna con la sua ragione:

- il modello **inventa un tag** dentro `[[#Sezione]]` (già dichiarata dal lato
  Rust in `divergenti()`): qui ha ragione la shell;
- un `\r\n` diventa `\n` nel buffer di CodeMirror, quindi da lì in poi gli offset
  scalano di uno. Un `\r` **nudo** invece diventa un `\n`, un carattere per un
  carattere, e non sposta niente: quale delle due forme costi non era ovvio, ed è
  emerso dichiarando tutti e tre i casi «cr» e vedendone **due** diventare rossi
  perché non divergevano;
- la shell decora dentro il **frontmatter**: su `relazione: "[[Nota]]"` disegna
  un wikilink cliccabile e per il modello quello è il valore di una proprietà.
  Non si ripara qui, e il perché chiude il cerchio della voce: per escludere il
  frontmatter la shell dovrebbe **riconoscerlo**, cioè scrivere una seconda
  grammatica di `fub:frontmatter` — il moltiplicatore. Nel file generato quel
  confine si vede a occhio: `fub:frontmatter` ha `trigger: null`.

## Il difetto peggiore stava fuori dalla voce, per il sedicesimo giro

Due, e il secondo è del presidio che stavo scrivendo.

**`Mod-click` su `[[Nota#Sezione]]` apriva la nota in cima.** La live preview
faceva `interno.split("#")[0].trim()` e buttava via heading e blocco;
`LivePreviewCallbacks.openWikilink` prendeva solo `page`. Lo stesso link cliccato
in **Lettura** arrivava alla sezione, perché di là il payload viaggia nei
`data-wikilink-*` che il render Rust produce — cioè due risposte per lo stesso
link, che è la §4.4 nella sua forma più piccola. Riparato portando nel DOM il
bersaglio **come sta scritto** e ripassandolo dalla stessa `parseWikilinkInner`:
una ri-serializzazione sarebbe stata una grammatica in più. `openWikilink` di
`document.ts` accettava già i tre campi dalla
[0049](0049-una-posizione-dentro-un-documento.md): arrivavano fin lì e si
fermavano un piano sopra.

**Il corpus saltava i casi vuoti, ed è la metà che conta di più.** Scritto per
confrontare ciò che il modello trova, non aveva niente da dire sui casi in cui il
modello non trova niente — cioè sull'unica forma in cui si vede una passata che
riconosce **di troppo**. Misurato: togliendo alla shell l'esclusione delle righe
di codice, il corpus restava **verde** su tutte e sessantatré le sorgenti. Adesso
nessun caso si salta, e il corpus ha due sorgenti nuove fatte apposta — un
recinto e un codice inline che **contengono** ciò che fuori sarebbe sintassi.

Nello stesso spirito, un terzo: il nome dell'attributo con cui il payload viaggia
nel DOM era scritto in due grafie (`"data-fub-page"` di qua, `dataset.fubPage` di
là) a trecento righe di distanza. Un refuso lì non è un errore di compilazione: è
un click che non fa niente. Adesso è una costante, letta con `getAttribute`.

## Verificare il rosso

Sette rami, uno alla volta, ripristinati e riconfermati verdi:

1. il trigger di `HighlightRule` da `==` a `%%` → il generato è stantio (rosso), e
   rigenerandolo diventano rossi **cinque** test della shell: il `==` viene
   davvero da di là;
2. la regola del `#` che torna «più stretta» → rosso il mirror **e** il corpus,
   due presidi indipendenti (il secondo solo dopo aver aggiunto al corpus la
   sorgente `tag ai confini della regola`: prima era cieco, ed è il primo caso
   costruito apposta);
3. `voceDiLista` che perde il prefisso di citazione → cinque rossi, fra cui il
   gesto di continuazione della citazione annidata;
4. la casella che torna `[ xX]` → due rossi, di cui uno nel corpus (`task a stato
   personalizzato`);
5. il bersaglio del wikilink che torna a essere la sola pagina → **un** solo
   rosso, ed è nel banco delle decorazioni: la via del click non ha un presidio,
   perché il ponte e la webview sono il buco n. 5 della
   [0112](0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md). È la ragione
   per cui l'attributo è diventato una costante: dove non arriva un test, il
   difetto lo si toglie invece di presidiarlo;
6. l'esclusione dell'intervallo di un wikilink tolta → rossa la divergenza
   dichiarata `wikilink al solo heading/tag`, **nel verso opposto**: «non diverge
   più, togli la riga». La lista non può diventare un ricordo;
7. le esclusioni del codice (recinto e inline) tolte, una per volta → rosse le
   due sorgenti nuove del corpus.

## Le zone cieche, dichiarate

- **Il generato conosce il core, non i terzi**: una `SyntaxRule` registrata a
  caldo non arriva alla shell. È la casella residua, e sopra c'è scritto perché il
  canale non si apre qui.
- **Il corpus confronta tre famiglie**, non tutte: enfasi, heading, fence e link
  markdown li riconosce Lezer, e su quelli il confronto non c'è. Non è
  un'omissione comoda — sono i costrutti che il parser del buffer conosce per
  conto suo, cioè quelli che *non* sono scritti due volte — ma è dove una
  divergenza resterebbe invisibile a questo file.
- **La voce di lista non ha gemella**, quindi il suo unico presidio è il banco
  della shell. Se il modello cambiasse idea su cosa sia una voce di lista,
  nessuno di questi test lo direbbe.
- **Nessun attore vede una quattordicesima regex** scritta domani in un modulo
  nuovo della shell. Un conto di `conteggi.mjs` è stato scritto e **buttato**:
  misurato sul repo di adesso ne trovava due file, e uno era `completions.ts`
  per una riga di **commento** che cita una classe di caratteri. È la specie di
  conto cieco che il giro dei verbali 0107-0113 ha misurato dodici volte, e un
  conto che presidia una sillaba è peggio di nessun conto, perché resta verde.
  Ciò che tiene il posto è più debole e va detto: il generato, la fixture e il
  corpus prendono chi **cambia** una regola, non chi ne **aggiunge** una accanto.
