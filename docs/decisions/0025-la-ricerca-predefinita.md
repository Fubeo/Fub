# 0025 — La ricerca predefinita: di classe *omnisearch*, e built-in

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | una domanda su [FEATURES.md](../FEATURES.md) §9.1, non una voce di `todo.md` |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta che apre](../roadmap/21-la-ricerca-predefinita.md)

---

**Questo verbale va nel senso inverso agli altri ventiquattro.** Gli altri
chiudono una voce di `todo.md` e la fanno sparire; questo ne **apre nove**, e la
[seduta 21](../roadmap/21-la-ricerca-predefinita.md) nasce da qui. Sta fra le
decisioni lo stesso, per il criterio con cui questa cartella esiste: è il
*perché*, che fra sei mesi non si ricostruisce dal diff. Chi troverà
`TextMode::Fuzzy` nel contratto congelato deve poter leggere perché una modalità
di ricerca è finita in una firma WIT invece che dentro un provider.

## La domanda

FEATURES.md elenca settantatré voci di ricerca (§9.1) e non nomina mai
**omnisearch** — l'estensione con cui, di fatto, gli utenti di Obsidian
intendono «una ricerca che funziona»: tolleranza ai refusi, prefisso mentre si
digita, estratti ordinati per rilevanza con i termini evidenziati, un modale
solo che guarda titoli, corpo, heading e tag, e un secondo modale che cerca
**dentro** la nota aperta.

La domanda era se quel comportamento sia una feature che un giorno si potrà
installare, o **la ricerca dell'app**.

## La risposta, in una frase

**È la ricerca dell'app: built-in, accesa di default, e l'unica.** Non c'è una
ricerca "base" sotto di essa da cui il fuzzy sia un miglioramento opzionale.

Spegnibile resta — il principio della
[spegnibilità totale](../appendix/funzionalita-future.md) non ha eccezioni — ma
spegnerla significa restare **senza ricerca**, non tornare a una ricerca
peggiore.

## Perché non un plugin, in quattro argomenti

- **In Obsidian è un plugin perché sotto c'è già una ricerca nativa. Qui sotto
  non c'è niente.** Tenere due motori — uno esatto di serie, uno tollerante da
  installare — vorrebbe dire due indici sullo stesso vault, due ranking e due
  risposte alla stessa domanda, con l'utente a scegliere quale delle due creda.
  È la stessa ragione per cui i backlink sono serviti **dal grafo** e non
  duplicati in un indice ([PIANO.md](../PIANO.md), "Decisioni"): due verità che
  possono divergere sono peggio di una verità sola.
- **La ricerca non è un pannello: è la strada per cui si arriva a tutto il
  resto.** Ci passano il quick switcher (8.1), la palette dei comandi
  ([0009](0009-registro-dei-comandi.md)), il click su un tag
  (`ViewUpdate::RunSearch`, già in repo), le collezioni (8.4), le viste salvate
  (8.3) e `vault.replace`. Se il comportamento buono sta in un plugin, ognuna di
  quelle superfici deve sapere **se quel plugin c'è** — cioè avere due modi di
  comportarsi, per sempre.
- **Le parti che contano scadono col freeze di M4.** `TextQuery`, `TextMode`,
  `TextField` e `DocumentMatch` sono già nel contratto e già nel WIT
  ([`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit)).
  Una variante aggiunta oggi costa una variante; dopo il freeze costa una minor,
  e toglierla una major. La decisione non poteva aspettare che qualcuno avesse
  voglia di scrivere il motore: doveva arrivare prima che la firma si chiudesse.
- **Un motore che indovina, su un canale che scrive, è un difetto.** Lo stesso
  `IndexQuery::Documents` che serve la casella di ricerca serve `vault.replace`,
  le collezioni e i template. Se la tolleranza ai refusi è una **politica del
  provider** invece che un **campo della query**, chi interroga non ha modo di
  chiedere l'esattezza quando l'esattezza conta, e un giorno «sostituisci in
  queste note» tocca una nota che nessuno ha nominato. È l'argomento decisivo, e
  vale al contrario di come si legge: il fuzzy va nel contratto **non** perché
  sia importante, ma perché deve poter essere **spento per singola query**.

## Cosa entra, cioè cosa vuol dire «di classe omnisearch»

Il comportamento, non l'implementazione. In ordine di quanto si nota usandolo:

1. **Tolleranza ai refusi**, di default nella casella di ricerca (§21.1).
2. **Prefisso mentre si digita**: `arch` trova *architettura* prima che la
   parola sia finita (§21.2).
3. **Estratti ancorati al documento**, più d'uno per nota, e un modo di portarci
   il cursore (§21.3).
4. **Ricerca dentro la nota aperta**, che è il secondo modale di omnisearch e
   non è il trova/sostituisci (§21.4).
5. **Una porta sola**: casella, quick switcher e palette non hanno tre ranking
   diversi (§21.5).
6. **Pesi per campo**, con un default sensato e non una costante di compilazione
   (§21.6).
7. **Ricerche recenti**, e la nota che non c'è creata dalla query che non ha
   trovato nulla (§21.7).
8. **Il testo degli allegati** quando ci sarà chi lo estrae (§21.8).

Tutto questo è già **dietro** l'interfaccia giusta: `IndexQuery::Documents`, il
linguaggio della [0019](0019-il-canale-dati.md) e l'`IndexProvider` che
`SearchIndex` implementa. Non si sta aggiungendo una superficie — si sta
riempiendo quella che c'è.

## Cosa resta fuori, con la ragione

- **La ricerca semantica e vettoriale** (22.1). È un **altro indice**, non una
  modalità di questo, e la [0019](0019-il-canale-dati.md) ha già deciso come
  convive: si registra accanto, dichiara le proprie `QueryRoute`, e il
  pianificatore gli manda ciò che rivendica. Farla entrare qui vorrebbe dire
  decidere adesso come si compongono due rilevanze — cosa che `DocumentMatch` ha
  già scelto di **non** fare (`absorb` tiene la maggiore, non la somma).
- **OCR, PDF, audio trascritto** (13, 9.1). Non è una questione di ricerca ma di
  §14.1: finché un PNG **non esiste** per `Vault::list_documents`, non c'è
  nessun documento da indicizzare. La ricerca è il *cliente* di quel lavoro, non
  il suo posto: resta come §21.8 con la dipendenza dichiarata.
- **Il server HTTP** che omnisearch espone per farsi interrogare da fuori. Non è
  ricerca: è la **27.2**, l'API locale, e ci arriverà come ci arriva ogni altra
  query — dal montaggio riusabile della [0023](0023-chi-monta-il-kernel.md),
  senza portarsi dietro un webview.
- **Un id di plugin `fub.omnisearch`.** Il provider resta `fub.search`
  (`SEARCH_ID`), e il suo spazio dati resta `.fub-data/plugins/fub.search/`.
  Rinominarlo per un nome di prodotto vorrebbe dire buttare gli indici di
  chiunque abbia già aperto un vault, in cambio di niente: **omnisearch qui è un
  comportamento atteso, non un marchio da appiccicare**. È la ragione per cui il
  nome non compare in nessun identificatore, e compare solo dove serve a dire
  *quale* comportamento — questo verbale, la seduta, e la riga di FEATURES.

## Cosa cambia, e cosa no

**Non cambia nessun codice, oggi.** Questo verbale non ha un commit di
implementazione dietro: cambia la documentazione, e mette nove voci in
`todo.md`, tre delle quali **P0** perché sono firma — la §21.1, la §21.2 e la
§21.3, chiuse poi dalla [0050](0050-cosa-si-chiede-a-una-ricerca.md) e dalla
[0049](0049-una-posizione-dentro-un-documento.md) insieme alla §21.10.

Quello che cambia è il **criterio**: da qui in poi una domanda sulla ricerca non
si risolve chiedendosi se valga la pena, ma verificando cosa fa omnisearch e
perché eventualmente da noi debba fare altro.

## Verifica

- `node .github/scripts/check-doc-links.mjs` — verde: i rimandi nuovi (questo
  verbale, la seduta 21, le righe di `todo.md`, `PIANO.md`, `strozzature.md`,
  `leva.md`, `numerazione.md`, `FEATURES.md`, `M2`, `traits.md` e `README.md`)
  risolvono tutti, ancore comprese.
- Nessuna modifica al codice, quindi nessun test coinvolto: `cargo test` è
  quello della [0024](0024-chi-legge-non-aspetta-chi-legge.md), 55 suite verdi.
  Il primo test di questa decisione nascerà con la §21.1, e sarà una query che
  chiede l'esattezza e la **ottiene**.
