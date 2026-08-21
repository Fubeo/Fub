# 0114 — Una finestra non si omette, e ciò che resta fuori si dice

**Stato**: accolta **Data**: 2026-08-06 **Chiude**:
[§2.9](../roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) **Commit**:
*(questo commit)*

---

## La domanda

La §2.9 chiedeva tre cose:

> - **Virtualizzazione** di file tree, risultati di ricerca, liste lunghe e
>   tabelle […] la finestra che serve è quella che `Page` già esprime nelle
>   query — il pezzo che manca è chi la chiede.
> - **Rendering incrementale dell'anteprima** e lazy loading di immagini/embed.
> - **Il numero che dice se è ora**: le soglie su vault sintetici da 10k/100k
>   note stanno nel §17.1.

E arrivava con un'eredità: nell'albero c'erano centocinquantasei righe di shell
scritte da un giro interrotto a metà, verdi e **mai lette da nessuno**. La prima
domanda quindi non era «cosa si fa» ma «quel progetto è la voce» — e la risposta
onesta richiedeva di misurare *dopo* aver letto, non prima.

## La decisione, in una riga

**Chiedere tutto è una risposta che si scrive, non un'omissione che succede**:
la finestra diventa il primo argomento e non ha default, `SENZA_FINESTRA` è un
`unique symbol` che il conto `finestre-aperte` sa vedere, e ciò che una finestra
lascia fuori l'albero **lo dice**. Delle tre caselle, due si chiudono e la terza
si chiude a metà, con la metà che resta **dichiarata** invece che finta.

## Il diff ereditato: tenuto, e perché

L'idea sotto le centocinquantasei righe è giusta, e non per gusto: è la stessa
forma della [0092](0092-una-base-si-dichiara.md), dove *scrivere ciechi ha
smesso di succedere omettendo ed è diventato un caso da nominare*. Prima, la
finestra era un parametro opzionale in coda; ometterlo voleva dire «tutto il
vault», e ometterlo è la cosa che si fa **senza deciderlo**. Le tre superfici
che ne approfittavano non erano state scelte da nessuno: la palette dei comandi
chiedeva l'anagrafe intera per riempire un `<datalist>` di suggerimenti, il menu
«nuovo spazio» ogni cartella a ogni profondità, un livello d'albero tutte le
note della cartella.

Cinque delle sei premesse del progetto ereditato reggono alla misura. La sesta
no, e non era una premessa sul codice: era una **promessa scritta in un
commento**. `host/query.ts` diceva che «`SENZA_FINESTRA` si conta da fuori
(`conteggi.mjs`, `finestre-aperte`)», e quel conto **non esisteva** — un
presidio promesso e mai scritto, che è peggio di nessun commento, perché il
prossimo lettore ci si appoggia. Renderlo vero è costato una voce in
`conteggi.mjs`; renderlo *difendibile* è costato un tipo.

### `SENZA_FINESTRA` era una stringa, e una stringa si scrive

Un conto che legge il sorgente vale quanto vale il modo di aggirarlo (trappola
0a della [0109](0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md), misurata
dodici volte in un giro solo). Con
`export const SENZA_FINESTRA = "senza-finestra"` il tipo della costante è il
letterale `"senza-finestra"`, quindi **scrivere quel letterale al posto della
costante compilava**: una domanda aperta in più senza una riga in più da
contare. Adesso è un `unique symbol`, che non si scrive: si nomina. Il conto e
il compilatore stanno d'accordo **per costruzione** invece che per attenzione,
ed è la forma che il `6d35a1f` aveva già scelto per le code del dispatcher —
*dal conto al compilatore*.

Le domande aperte oggi sono **due**, e sono nominate: `documentiEsistenti` (dove
la risposta è già limitata dall'ingresso — non può contenere più righe di quante
ne chiede il chiamante) e i tag dell'autocompletamento (dove il vault risponde
col proprio **vocabolario**, che cresce col numero di concetti e non col numero
di note: troncare lì non taglierebbe una risposta grande, taglierebbe
l'alfabeto, e i tag dopo la lettera del taglio smetterebbero di completarsi
senza che nessuno lo dica).

### `archiDelVault` è stata tolta, e questo è un giudizio

Chiedeva i vicini a un passo di **ogni** documento, senza finestra, e non la
chiamava nessuno: il grafo è un `ViewProvider` dalla
[0079](0079-il-grafo-esce-dall-overlay.md) e quegli archi se li prende da dentro
il kernel, dove non attraversano il ponte. Una funzione che chiede l'intero
vault e che nessuno esercita non è codice inerte: è un **esempio**, ed è il più
comodo da copiare per il prossimo pannello.

## La virtualizzazione non è quello che si è fatto, e va detto

Virtualizzare vuol dire disegnare ciò che si **vede**, e *cosa si vede* è una
domanda di layout. In `happy-dom` il layout non esiste — è il buco dichiarato n.
5 della [0112](0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md), e questo
verbale ne **cita** uno invece di dichiararne uno suo — e scrivere qui una
finestra scorrevole vorrebbe dire scrivere codice che nessun presidio di questo
repo può guardare. Ciò che si è fatto è la metà che sta *prima* del layout, ed è
la metà che la voce stessa nominava: **quanto attraversa il ponte e quanti
elementi nascono**. Duecento voci per livello, e il numero è il costo di un
ridisegno e non una stima di quanto sia grande una cartella — l'albero si
ricostruisce intero a ogni cambiamento, e ogni voce costa tre elementi e sette
ascoltatori, cioè novemila elementi creati e buttati per salvare una nota dentro
una cartella da tremila.

L'altra metà resta scoperta e **non si chiude di straforo**: è la casella
residua della voce, insieme al gesto che manca — «mostra le altre». La riga che
dice quante ne sono rimaste fuori non è attivabile, perché dirlo senza saperlo
fare è più onesto che non dirlo.

## La seconda casella: una metà fatta, una metà argomentata

La voce teneva insieme due cose che la misura ha separato.

**Il lazy loading delle immagini si è potuto fare**, e senza layout: la shell
non calcola cosa si vede — non ha layout qui e non l'avrebbe gratis nemmeno in
una webview vera — ma può **dichiarare che non vuole deciderlo lei**.
`loading="lazy"` sposta la decisione al browser, che è il solo a sapere dove sta
la finestra. Sta nel punto unico in cui dell'HTML entra nella webview (§3.6), e
non nell'anteprima, per la ragione di sempre: vale per **ogni** HTML che entra,
quindi si scrive nel posto che tutti attraversano — il secondo cliente lo
eredita senza saperlo. C'era già il precedente della stessa forma, tre righe
sotto: un `<a>` che esce dall'app riceve `rel`/`target` da lì.

**Il lazy loading degli embed no**, e la ragione è la stessa che vieta la
virtualizzazione: caricare un embed quando lo si vede è una domanda di layout.
Ma misurando è saltato fuori qualcosa di peggio, che layout non ne vuole: la
**profondità** dell'idratazione era limitata (`MAX_EMBED_DEPTH`), la
**larghezza** no, e le due si moltiplicano — una nota che trasclude dieci note
che ne trascludono altre dieci faceva partire diecimila `render_embed` sul ponte
per un documento che di note distinte ne nomina venti, e un `![[Glossario]]`
ripetuto tre volte nella stessa nota erano tre viaggi identici. Adesso la stessa
pagina (e lo stesso punto dentro la pagina) si chiede una volta per corsa di
idratazione, e la correttezza non è una scommessa sul kernel: è scritta nella
firma di `FormatProvider::render_html`, che promette che *«la resa di un blocco
dipende dal blocco, non dal resto del documento»*. Il memo muore con l'anteprima
che l'ha aperto, quindi non è una cache e non porta con sé la domanda «quando si
invalida».

**Il rendering incrementale resta una casella residua dichiarata**, e non per
stanchezza. Due misure:

1. La sua precondizione è quella che la
   [0018](0018-chi-vede-il-modello-parsato.md) ha nominato e non costruito —
   sapere da quale byte del sorgente viene un elemento reso, cioè una chiave di
   `RenderOptions` che faccia scrivere le coordinate nell'HTML. È lavoro di
   `fub-abi` e del provider markdown, non della shell: la voce è di strato
   *shell*, e questa metà non lo è.
2. Soprattutto: **il suo primo cliente non esiste**. La voce diceva che la
   precondizione «si costruisce quando questa voce diventa il suo primo
   cliente», e misurando la lettura non è il cliente che sembra. `updatePreview`
   viene chiamata in due punti soli — quando il documento del riquadro cambia, e
   quando si entra in Lettura — e mai a ogni battuta, perché `PaneMode` è un
   enum di modalità **esclusive** e ciò che si rende è il sorgente **salvato**.
   Rendere incrementalmente vuol dire non rifare la parte che non è cambiata; se
   si rifà quando è cambiato il **documento**, non è cambiata nessuna parte:
   sono cambiate tutte. Il cliente vero di quella precondizione è un'anteprima
   affiancata che segue chi scrive, e quella superficie qui non c'è.

Scriverla come fatta sarebbe stato il modo peggiore di chiuderla: la roadmap
toglie dalla tabella ciò che è chiuso, e l'assenza è il segnale.

## La terza casella: il numero, che è un conto e non un tempo

La voce rimandava al §17.1 per delle soglie su vault da 10k/100k note. **Quel
rimando è scaduto**: la [0113](0113-il-banco-conta-le-operazioni.md) ha chiuso
il §17.1 decidendo l'opposto — un banco conta **operazioni**, perché su una
macchina condivisa il tempo non è un segnale — e qui vale identico con
un'aggravante, che il tempo di un fotogramma in `happy-dom` non esiste proprio.

`ridisegno.test.ts` conta **elementi nel DOM** e **domande al ponte**, e la
forma che dice di più non è una soglia ma un'**uguaglianza**: due vault che
differiscono per quattromila note disegnano lo stesso albero. Una soglia («meno
di mille elementi») sarebbe un numero da rinegoziare a ogni riga aggiunta a una
voce dell'albero; l'uguaglianza dice la sola cosa che conta, cioè che il prezzo
è funzione della finestra e non del vault.

## Cosa la verifica del rosso ha cambiato

È la parte che il giro interrotto non aveva fatto, ed è quella che ha prodotto
metà di questo lavoro. Su quattro rami di produzione del diff ereditato, **uno
solo era rosso e tre erano verdi**:

- **La finestra della palette**: toglierla lasciava cinquecentootto test verdi.
  Il banco filtrava le domande *dell'avvio*, e `listDocuments` è pigra — parte
  quando si apre il pannello, cioè mai, dentro quel banco. La riparazione **non
  è un test**: un pannello che si apre a comando lo si può sempre non aprire, e
  un banco dinamico non copre per costruzione le vie pigre. L'attore giusto è
  quello della [0110](0110-la-struttura-non-e-una-preferenza.md) — *il
  compilatore prende la variante che non vuol dire niente, il conto prende la
  variante che nessuno ha elencato, il test prende il comportamento* — e qui la
  variante è **una che nessuno ha elencato**. Col conto `finestre-aperte`
  scritto, rimettere la palette a chiedere tutto porta `finestre-aperte` da due
  a tre e **`check-prosa` diventa rosso**; ometterla del tutto non compila. Il
  presidio che mancava a quel ramo *era* il conto che il commento prometteva.
- **`altreCartelle` forzato a zero**: verde, perché il banco usava un vault
  **piatto**. Metà del troncamento — le cartelle — non era esercitata da niente.
  Nasce un secondo vault di prova fatto di sole cartelle, dove le note in radice
  sono zero: la riga che compare parla solo di `altreCartelle`, e forzarlo a
  zero adesso è rosso.
- **Il menu «nuovo spazio»**: interamente scoperto, stringa
  `explorer.altre_cartelle` compresa, con zero occorrenze in tutti i
  `*.test.ts`. Il secondo cliente della finestra non attraversava nessun
  presidio. Adesso il banco clicca il `+` della striscia degli spazi e conta le
  voci del menu.

Le altre cinque prove di rosso, fatte una alla volta e ripristinate: togliere la
riga «altre N» dall'albero (rosso, tre presidi); togliere gli attributi imposti
alle immagini (rosso); togliere il memo degli embed (rosso, due); togliere il
**punto** dalla chiave del memo, cioè unificare per pagina invece che per pagina
*e* sezione (rosso — è il guasto che renderebbe muto il memo, mostrando tre
volte la stessa sezione senza dirlo); scrivere il letterale `"senza-finestra"`
al posto della costante (non compila).

## Il difetto peggiore stava fuori dalla voce, per il quindicesimo giro

**Il type-check della shell non ha un nome.** `vite build` traspila senza
controllare i tipi, `vitest` nemmeno, e la coppia che tutto il repo cita per
verificare un lavoro di shell — `npm run test && npm run build` — non lo esegue.
Il comando esisteva solo dentro `ci.yml`, scritto come `npx tsc --noEmit`: cioè
in un file che chi lavora non apre, e sotto una forma che non compare in nessuno
`script` di `package.json`.

Non è un sospetto: **è successo dentro questo giro**. Due errori di tipo miei —
un memo tipizzato su `RenderedDocument` invece che su `EmbedContent`, e un
`.at(-1)` che è ES2022 mentre questa shell compila a ES2021 — sono passati
*verdi* attraverso cinquecentotredici test e una build riuscita, e li ha presi
solo un `tsc` lanciato a mano per un'altra ragione. Chiunque avesse verificato
il proprio lavoro come questo repo dice di verificarlo avrebbe mandato in CI del
codice che non compila, e lo avrebbe scoperto da un'altra parte.

La riparazione è di due righe e non è cosmetica: `npm run typecheck` esiste, e
la CI esegue **quello** invece di una riga che vive solo lì. Un comando che
nessuno può eseguire con lo stesso nome con cui la CI lo esegue è un comando che
la gente salta.

## Il prezzo, e cosa NON si è toccato

Zero firme nel contratto, zero tipi nuovi di là dal confine, WIT congelato
intatto: `Finestra` è un alias TypeScript locale al modulo delle query, e
`ContenutoDiCartella` un record della shell. Nessuna dipendenza nuova. Il kernel
non è stato toccato — è una voce di strato shell e lo è rimasta, che è anche la
ragione per cui la prima metà della seconda casella si è potuta fare e la
seconda no.

## Le zone cieche, dichiarate

- Il conto `finestre-aperte` ancora l'argomento mandato a capo:
  `f(\n SENZA_FINESTRA,\n)` non ha la virgola sulla stessa riga. `prettier` non
  spezza una chiamata così corta, e se lo facesse il conto **scenderebbe**
  invece di salire — cioè si vedrebbe.
- Il conto non vede un tetto travestito da finestra:
  `{ offset: 0, limit: 100000 }` è una finestra per il tipo e per il conto, e
  non lo è per nessun altro. Sta scritto accanto alla costante che passare un
  limite grande è la cosa sbagliata, ed è tutto ciò che si può fare senza
  inventare un secondo tipo.
- Il banco guarda l'**avvio**: ciò che la shell chiede solo aprendo un pannello
  non ci passa. È esattamente il buco che il conto copre, e le due coperture
  sono complementari di proposito.
- Il memo degli embed non copre il caso in cui due placeholder della stessa
  pagina stiano a **profondità** diverse e una delle due sia oltre
  `MAX_EMBED_DEPTH`: la prima vince, la seconda riceve la risposta condivisa e
  poi si ferma sul controllo di profondità. È il comportamento giusto, ma non è
  presidiato.
