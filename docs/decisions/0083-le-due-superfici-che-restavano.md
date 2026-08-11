# 0083 — Le due superfici che restavano, e il giro per battuta misurato

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §21.5 ([seduta 21](../roadmap/21-la-ricerca-predefinita.md)) — **chiude la voce**, di cui la [0082](0082-una-porta-per-chi-cerca.md) aveva chiuso la metà che era decisione |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[una porta per chi cerca, 0082](0082-una-porta-per-chi-cerca.md) ·
[cosa si chiede a una ricerca, 0050](0050-cosa-si-chiede-a-una-ricerca.md) ·
[selezionare non è raccontare, 0074](0074-selezionare-non-e-raccontare.md) ·
[un accordo ha un proprietario, 0081](0081-un-accordo-ha-un-proprietario.md) ·
[la ricerca predefinita, 0025](0025-la-ricerca-predefinita.md)

---

La [0082](0082-una-porta-per-chi-cerca.md) ha lasciato scritto cosa restava, e
che non erano più decisioni: **il quick switcher, che non esisteva**, e
**l'autocompletamento dei wikilink, da migrare** alla query con prefisso. Questo
verbale è quel lavoro, più la cosa che la 0082 aveva dichiarato di dover fare e
non aveva fatto: **misurare** il giro per battuta invece di assumerlo.

## Il quick switcher esiste, e non ha portato una seconda ricerca

`panels/quick-switcher.ts`, su `Mod-o` — l'accordo di Obsidian, libero in tutti
e tre i registri di scorciatoie che questa shell tiene. Due dei tre li guarda il
presidio della [0081](0081-un-accordo-ha-un-proprietario.md); il terzo, la
keymap dell'editor (`editor/editor-commands.ts`), non lo guarda nessuno ancora
ed è stato controllato a mano — vale la pena scriverlo qui perché è la stessa
forma di difetto che la 0081 ha appena riparato, un gradino più in basso.

Ciò che rende questa superficie **non** una seconda ricerca sta in due righe che
non sono in questo file: la query si compone in `host/contract.ts`
(`nomeCercato`) e il giro si fa in `host/query.ts` (`noteDalNome`). Il pannello
disegna e basta. È la regola della 0082 scritta come posizione dei file, ed è
verificabile senza fiducia: nel pannello non compare né `IndexQuery` né
`QueryExpr`.

`nomeCercato` è la **terza configurazione** della porta unica — dopo la casella
del vault (campi liberi) e la ricerca dentro la nota (un letterale `Docs` in
più): `fields: ["name"]` e il prefisso acceso per default. La differenza fra
questa e `testoCercato` non è di ranking ma di **dominio**: cercare `rust`
ovunque trova le trecento note che ne parlano, e chi ha premuto la scorciatoia
per aprire la nota *Rust* non le voleva. Che le due restino due è un banco
(`host/contract.test.ts`), perché un giorno qualcuno restringerà l'una pensando
all'altra.

## L'autocompletamento: la riga che è sparita è la voce intera

`wikilinkSource` restituiva `validFor: /^[^\[\]\n]*$/`, e quella riga **era** la
ragione per cui chiedere l'elenco intero del vault stava in piedi: con lei la
sorgente parte una volta per `[[` e CodeMirror rifiltra da sé mentre si digita.
Con la query sul prefisso il filtro lo fa chi ha l'indice, quindi la sorgente
deve ripartire a ogni battuta — e `validFor` non solo diventa inutile, diventa
**sbagliata**: terrebbe buona una finestra calcolata su un prefisso più corto.

Al suo posto ne è arrivata un'altra, `filter: false`, ed è la stessa decisione
vista dall'altro lato. L'ordine di quelle opzioni **è** la rilevanza calcolata
da chi ha i dati per calcolarla; il fuzzy di CodeMirror, lasciato acceso, la
riordinerebbe e la scarterebbe secondo un criterio suo. Sarebbero due ricerche
dentro un elenco solo — e nessuna delle due avrebbe torto abbastanza da farsi
notare, che è il modo peggiore in cui una cosa può essere rotta.

`noteCompletions` continua a prendere `string[]` e non `DocumentMatch[]`, ed è
una scelta e non un'omissione: di un match qui servirebbe solo il punteggio, e
il punteggio **è già** l'ordine dell'array. Portarsi dietro il record intero per
un dato che l'ordine contiene sarebbe una firma più larga per la stessa
informazione. La cosa che invece è cambiata sotto, e che sta scritta accanto
alla funzione: l'ambiguità dei nomi omonimi si guarda ora dentro la finestra e
non su tutto il vault. Due note omonime combaciano *identicamente* col prefisso
che le nomina, quindi arrivano vicine nell'ordine e una finestra che ne contenga
una sola è tagliata esattamente fra due pari merito; resta possibile, e il verso
dello sbaglio è quello buono — si inserisce il nome nudo, cioè ciò che l'utente
avrebbe scritto a mano, e a decidere quale nota sia resta chi risolve i link.

## Il giro per battuta, misurato

La 0082 ha scelto il prefisso contro la lista spinta con un argomento di
**correttezza** (una lista tenuta dagli eventi è un indice alimentato dagli
eventi) e ha dichiarato che il costo andava misurato. Il banco della seduta ha
ora una quinta fase (`una_ricerca.rs`), sullo stesso vault sintetico di tutte le
altre misure — 2000 note, vocabolario ristretto:

```text
solo nome, senza estratti: "n"          2,87 ms    20 resi / 2001 combaciano
solo nome, senza estratti: "nota"       3,31 ms    20 resi / 2001 combaciano
solo nome, senza estratti: "nota 1"     3,19 ms    20 resi / 1111 combaciano
ovunque, con estratti:     "nota"       4,89 ms    20 resi / 2001 combaciano
ovunque, con estratti:     "nota 1"     8,65 ms    20 resi / 2000 combaciano
l'elenco intero (com'era, per apertura) 0,13 ms  2001 resi / 2001 combaciano
```

Tre cose, e la seconda non è quella che ci si aspetta.

**Il prefisso costa ~3 ms per battuta, non 0,1.** La riga «solo nome "Nota 7"»
della fase 2 costava 0,09 ms: la differenza non è il prefisso in sé, è **quante
note combaciano** — un termine esatto ne trova una, `n` ne trova duemila e vanno
tutte punteggiate. Il caso peggiore è la **prima lettera**, e il costo scende
appena il prefisso seleziona.

**L'elenco intero, dal lato del kernel, costa meno.** 0,13 ms contro 3: se il
confronto fosse solo questo, la lista spinta vincerebbe. Non lo è, e vale la
pena dirlo per esteso invece di lasciarlo implicito: quella riga misura **metà**
della cosa — mancano 2001 righe da serializzare, far passare per l'IPC e
ordinare nella shell, e mancano tutte le volte in cui quella lista è vecchia. La
misura non ribalta la 0082: la **circoscrive**, dicendo che ciò che si compra
con quei 3 ms è la correttezza, non la velocità.

**Gli estratti sono metà del budget, e qui non servono.** 3 ms contro 4,9 sulla
stessa domanda: chi propone dei **nomi** non disegna estratti, quindi
`noteDalNome` chiede `Excerpts::Omit` — la variante che la
[0074](0074-selezionare-non-e-raccontare.md) ha messo nel contratto per il
pianificatore, e che si è rivelata giusta per una superficie che allora non
esisteva. È il secondo cliente di quella decisione, ed è arrivato da solo.

Su un vault dieci volte più grande quei 3 ms diventano ~30, sempre sul caso
peggiore di una lettera sola: sopravvivono al freno di 180 ms che tutte queste
superfici hanno, e non sopravviverebbero senza. Il freno non è quindi una
comodità — è ciò che tiene la scelta dentro il suo budget, e va tolto solo da
chi avrà rimisurato.

## A mani vuote: le recenti, e perché in memoria

Il quick switcher a query vuota mostra le **note aperte di recente**, come
Obsidian. L'alternativa (le prime venti del vault, in ordine di path) è un
elenco arbitrario che costringe comunque a scrivere: una scorciatoia premuta
deve mettere qualcosa sotto le dita.

Una cronologia però è materia della **§21.7** e del capitolo 23 — *cosa si è
aperto* dice di una persona più di cosa ha scritto, e quella voce la vuole
opzionale e spegnibile. Quella decisione qui non si anticipa, e ciò che si può
fare senza anticiparla è una lista che **vive quanto la finestra**
(`state/recenti.ts`): non tocca il disco, si perde chiudendo l'app, e non c'è
niente da spegnere perché non resta niente. Il giorno in cui la §21.7 deciderà
dove si scrive una cronologia, quel modulo ne diventa il lettore invece di
essere un secondo posto da riconciliare.

Due dettagli che sono la stessa regola di sempre. Le recenti si alimentano da
`active-doc` — il documento del riquadro col fuoco — e non da `openDocument`,
perché «aperto di recente» vuol dire *guardato*, e tornare su una tab già aperta
non passa da lì. E non si ripuliscono ascoltando `document_removed`: passano da
`documentiEsistenti`, una domanda sola per tutte, fatta nel momento in cui una
modale si apre e nessuno la sente. Uno stato tenuto d'accordo col vault dagli
eventi è esattamente ciò che la 0082 ha appena rifiutato; sarebbe stato curioso
reintrodurlo dieci righe più in là.

Le stesse recenti rispondono al prefisso vuoto dell'autocompletamento — `[[`
appena scritto — e la decisione sta in `panels/document.ts`, cioè in chi inietta
la sorgente: `editor/completions.ts` non conosce né il vault né la memoria
corta, e continua a non conoscerli.

## Cosa questa voce lascia dietro

Il residuo dichiarato dalla 0082 è ancora lì, e resta: `panels/search.ts` ha la
sua copia privata dell'evidenziazione, gemella di `ui/highlight.ts`. Non si è
toccato quel file perché c'è del lavoro in corso sopra; a riunirle è chi lo
atterrerà.

E una cosa che si nota solo mettendo in fila le quattro superfici:
`righeDaMostrare` e `evidenziato`, saliti a comune con la 0082, **non li usa
nessuna delle due superfici nuove**. Non è uno spreco ed è la conferma del
taglio: mostrano estratti le due superfici che cercano *dentro* le note, e
mostrano nomi le due che servono a **spostarsi**. Ciò che le quattro hanno in
comune non è il disegno — è la porta.
