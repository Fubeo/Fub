# 0082 — Una porta per chi cerca, e la ricerca dentro la nota aperta

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §21.4 ([seduta 21](../roadmap/21-la-ricerca-predefinita.md)) — **chiude la voce**; e **mezza** §21.5, che resta aperta con le due superfici che mancano. Il criterio della mezza voce è quello della [0031](0031-chi-possiede-i-bundle.md) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[la ricerca predefinita, 0025](0025-la-ricerca-predefinita.md) ·
[il canale dati, 0019](0019-il-canale-dati.md) ·
[una posizione dentro un documento, 0049](0049-una-posizione-dentro-un-documento.md)
· [cosa si chiede a una ricerca, 0050](0050-cosa-si-chiede-a-una-ricerca.md) ·
[un accordo ha un proprietario, 0081](0081-un-accordo-ha-un-proprietario.md)

---

Le due voci si decidono insieme perché sono la stessa cosa vista dai due lati.
La §21.4 dice che manca **una superficie** — cercare dentro la nota aperta —, la
§21.5 dice che le superfici che cercano sono quattro e rischiano di nascere con
quattro ranking. Costruire la prima senza decidere la seconda avrebbe aggiunto
la quinta.

## La regola, ed è una riga

**Tutto ciò che nella shell accetta del testo e propone delle note passa da
`IndexQuery::Documents`.**

Non «dovrebbe»: è la porta, e chi ne vuole un'altra sta aggiungendo un motore di
ricerca. Le configurazioni sono diverse — il quick switcher pesa i campi sul
nome (`TextField::Name`, che esiste per questo), la casella del vault non mette
vincoli sui campi, la ricerca nella nota aggiunge un letterale `Docs` — ma è
**una porta con due o tre configurazioni**, non due o tre porte.

Il motivo per cui vale la pena scriverlo adesso, e non quando le superfici
esisteranno: il costo delle due mosse è asimmetrico. Un ranking deciso adesso si
paga una volta; quattro implementazioni che divergono si pagano ogni volta che
qualcuno cambia i pesi, aggiunge la tolleranza ai refusi, o si accorge che una
superficie trova ciò che un'altra non trova. E la prova che la forma giusta è
già stata trovata una volta c'è: la palette dei comandi non cabla nessun id —
legge le spec e disegna ([0009](0009-registro-dei-comandi.md)).

Dove sta scritta, la regola, conta quanto la regola: le query si compongono in
`host/contract.ts`, accanto a `testoCercato` e `questiDocumenti`, e non dentro
il pannello che le usa. Una superficie che si compone la propria query in casa è
già una seconda implementazione — piccola finché la si guarda, e non più piccola
il giorno in cui il ranking cambia.

### Il combinatore che non abbiamo scritto

La ricerca dentro la nota è `Docs { docs: [la nota] }` in AND con un `Text`,
cioè **una clausola di due letterali** del linguaggio della
[0019](0019-il-canale-dati.md). La tentazione era un `and(a, b)` generico fra
due `QueryExpr`.

Scartato: una `QueryExpr` è un OR di clausole, e l'AND di due OR è il prodotto
delle clausole. Un combinatore che lo fa in silenzio è il posto dove nasce la
query che sembra una cosa e ne fa un'altra — e la sua prima vittima sarebbe chi
la legge sei mesi dopo. Quindi `testoNelDocumento(docs, testo, mentreSiDigita)`
scrive la clausola per esteso: due letterali, uno accanto all'altro, come li
leggerebbe chi apre il file.

## La §21.4, e perché è corta

La ricerca dentro la nota è un modale (`panels/doc-search.ts`), su `Mod-f` — la
coppia che le dita si aspettano, ora che `Mod-Shift-f` è tornato alla ricerca
del vault ([0081](0081-un-accordo-ha-un-proprietario.md)). **Non è il
trova/sostituisci**, ed è la distinzione che regge tutta la voce: quello è
editing e cammina sulle occorrenze grezze in ordine di posizione; questa cerca
con lo **stesso motore** di fuori — per rilevanza, con gli estratti, e domani
tollerante ai refusi senza che il pannello debba saperlo.

Il codice è poco perché le due cose che servivano erano già arrivate:

- il **linguaggio** la sapeva già dire (sopra), quindi zero varianti nuove di
  `IndexQuery` e zero firma toccata — la quarta volta di fila;
- le **coordinate** ci sono dalla
  [0049](0049-una-posizione-dentro-un-documento.md), quindi `righeDaMostrare` e
  `revealByteOffset` sono le stesse identiche del pannello di ricerca. Senza, i
  risultati sarebbero stati un elenco di conferme che qualcosa esiste dentro un
  documento che si sta già guardando.

L'unica decisione rimasta al pannello è **quale** nota: `state.currentDoc`, cioè
il documento del riquadro col fuoco — e se non ce n'è uno il modale lo dice
invece di cercare in tutto il vault. Una ricerca che cambia raggio in silenzio è
peggio di una che non parte.

Due cose sono uscite dal pannello per strada, e sono uscite perché la seconda
superficie le ha rese comuni: l'estratto evidenziato (`ui/highlight.ts`, che
tiene le due invarianti — testo del provider mai come HTML, offset in byte e non
in code unit — in un posto solo, con un banco che prima non aveva) e la forma
della modale, che era `#command-palette` e adesso è la classe `.modale`: da
quando le modali sono due, l'aspetto di una modale è un fatto della shell e non
una proprietà della palette.

## L'autocompletamento: la query con prefisso, non la lista spinta

È la parte della §21.5 che era davvero da decidere, perché l'autocompletamento
dei wikilink (`editor/completions.ts`) è la quarta superficie ed è **già
scritta**: chiede al canale dati l'elenco intero del vault a ogni apertura di
`[[`, col commento che lo dichiara provvisorio. È la regola di sopra vista dalla
superficie che la viola per prima.

E su questa la regola non basta, perché il suo budget non è per invocazione: è
**per battuta**. Le altre tre pagano un giro quando si aprono; questa lo
pagherebbe a ogni tasto, e su un vault da 50k note l'elenco intero non è una
risposta — né come costo di trasporto né come cosa da ordinare nella shell.

Le uscite erano due, e si decide per la prima: **la query con prefisso** (§21.2,
già nel linguaggio dalla [0050](0050-cosa-si-chiede-a-una-ricerca.md)). Un giro
per battuta, ma piccolo e con la finestra, contro *nessun giro* della lista di
candidati spinta nella shell e tenuta aggiornata dagli eventi.

La seconda uscita perde per una ragione che il progetto ha già scritto, e non
per una stima: **una lista di candidati mantenuta dagli eventi è un indice
alimentato dagli eventi**, cioè la cosa che [PIANO.md](../PIANO.md) rifiuta con
l'argomento «un indice che perde un aggiornamento non tace: risponde sbagliato,
in silenzio». E il ponte verso la shell perde **per progetto**: freno e
raggruppamento dalla [0034](0034-il-freno-e-il-raggruppamento.md), col tetto
della raffica che emette `Event::Overflow` al posto di ciò che ha scartato.
Spingere si potrebbe, ma solo con la rigenerazione su `Overflow` — e oggi quel
segnale arriva al confine e nella shell non lo legge nessuno. Senza,
l'autocompletamento proporrebbe un vault vecchio e non lo direbbe: la
[0051](0051-l-alimentazione-risponde.md) trasportata dall'altra parte del
confine, dove però non abbiamo ancora niente di equivalente.

Vale la pena dirlo anche al contrario, perché la porta resta aperta: se un
giorno la shell leggerà `Overflow` e saprà rigenerare, la lista spinta torna
discutibile — su un dato **derivato e rigenerabile**, che è la classe in cui
sta. Ciò che non torna discutibile è farlo prima di quel giorno.

## Cosa resta aperto della §21.5

Due superfici, e sono lavoro, non più decisioni:

- **il quick switcher (§8.1) non esiste ancora.** Quando nascerà, nasce su
  questa porta con i campi pesati sul nome. La ragione per cui la voce lo nomina
  è che è la superficie più battuta dell'app, e se nasce da sé nasce su
  `list_documents` con un confronto di sottostringhe — una seconda ricerca,
  peggiore della prima, sulla strada più percorsa;
- **l'autocompletamento va migrato** alla query con prefisso decisa qui.

E un residuo minore, dichiarato perché altrimenti si dimentica:
`panels/search.ts` ha ancora la sua copia privata dell'evidenziazione, gemella
di quella che è salita in `ui/highlight.ts`. Le due sono identiche oggi; a
riunirle è il prossimo che tocca quel pannello.
