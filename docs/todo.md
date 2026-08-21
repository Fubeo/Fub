# Roadmap infrastrutturale — reggere il peso di FEATURES.md

Torna a [PIANO.md](PIANO.md).

Questo documento pone una domanda sola. **[FEATURES.md](FEATURES.md) elenca
~3000 voci. Quali pezzi di infrastruttura mancano per costruire queste voci
senza riscrivere ogni volta il kernel, il contratto e la shell?**

Dal 2026-08-10 la domanda ha una nuova chiave di lettura. Otto file di
[microfeature](microfeatures/) scompongono dodici sezioni di FEATURES.md in
**424 gesti** atomici (es. un tasto, un clic, un trascinamento per riga). La
domanda non cambia. Cambia la **grana** (la misura di precisione), da cui nasce
la [seduta 26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md).

Sono uscite 169 voci:

- novantanove voci da sette giri sulla stessa domanda.
- due voci da una **misura**. La §8.4 nasce dalla
  [0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md) e si chiude con la
  [0026](decisions/0026-due-query-insieme.md). La §20.5 nasce misurando la
  [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) contro il codice.
- nove voci da una **decisione di prodotto**. La
  [0025](decisions/0025-la-ricerca-predefinita.md) stabilisce che la ricerca di
  Fub è built-in e di classe *omnisearch* ([seduta
  21](roadmap/21-la-ricerca-predefinita.md)).
- venti voci da cinque **verifiche**:
  - §21.10 dal controllo di un'affermazione esterna contro il codice.
  - §22.1–§22.3 dal controllo di una lettura esterna di
    [FEATURES.md](FEATURES.md) ([seduta
    22](roadmap/22-cosa-sa-dire-un-abbonamento.md)).
  - §23.1–§23.3 dal controllo dei verbali ([seduta
    23](roadmap/23-cosa-costano-le-decisioni-chiuse.md)).
  - cinque voci (la **quarta** verifica) misurando i **primi dieci verbali**
    contro i sorgenti di oggi.
  - otto voci (la **quinta** verifica) rileggendo **tutti** i verbali con una
    lente dichiarata (§23.9–§23.16). Un lente è un focus preciso per la lettura.
  - una voce (la **undicesima**, §23.17) nata da un «resta fuori» ripetuto in
    tre verbali consecutivi.
- **due** voci da una **separazione**. La §16.8 nasce dal distacco dal §16.7
  ([0056](decisions/0056-un-elenco-che-e-la-sorgente.md)). La voce sull'orario nasce dal
  distacco dalla voce sull'abbonamento. «Alle 9» e «ogni ora» differiscono per i fusi orari
  ([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)).
- tre voci da un **consuntivo**. La seduta 24 rilegge contro i sorgenti
  novantadue problemi ignorati in `docs/issues.md`.
- **sette** voci da una **rilettura**. La [seduta
  25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) misura
  contro i sorgenti del 2026-08-07 debiti pregressi (smentendoli più di quanto
  li confermi).
- **otto** voci da una **misura fra due elenchi**. La [seduta
  26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) confronta 424 gesti
  di [microfeatures/](microfeatures/) contro i sorgenti. Cerca i punti dove **un
  gesto compiuto non ha nessun dato che lo dichiari**.
- **tre** voci da una **riscrittura**. La [seduta
  27](roadmap/27-tre-scommesse-che-nessuno-ha-provato.md) rifà
  [mappa-visuale.md](architecture/mappa-visuale.md) scrivendo per ogni riquadro
  *cosa costa*, e cerca i costi che **nessuno ha ancora pagato**: ciò che il
  freeze rende definitivo senza che niente l'abbia esercitato.
- **una** voce da un **cronometro sulla struttura**. La [seduta
  28](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md) misura la
  forma della compilazione invece del prodotto, e cerca **quanto costa a chi
  lavora sapere che niente si è rotto**.
- **diciassette** voci da tre giri sulla **GUI**, aperti da due decisioni di
  prodotto (2026-08-17 e 2026-08-19). La [seduta
  29](roadmap/29-chi-possiede-la-pelle.md) chiede *chi possiede* la pelle e ne
  fa un fascio sostituibile (sei). La [seduta
  30](roadmap/30-il-moto-e-del-tema.md) cerne il collocamento del moto, che la
  29 aveva deciso senza deciderlo (due). La [seduta
  31](roadmap/31-da-dove-viene-cio-che-si-vede.md) misura il **primo esemplare**
  contro l'architettura che lo porta, e chiede da dove venga ciascuna delle cose
  che si vedono (nove, cinque chiuse).

Centosessantadue voci sono chiuse. I loro verbali stanno in
[decisions/](decisions/README.md).
Le voci ancora aperte sono **dieci** [conta: voci-aperte]. Questo file è
il loro **indice** e consuntivo.

Il file conta una **terza specie**: i [difetti misurati](#i-difetti-misurati).
Un difetto è un problema misurato nel codice che non richiede una decisione e
non è una casella (lavoro residuo).

## Come è organizzato

Le voci si raggruppano per **seduta** e non per strato. Una seduta raggruppa
voci che è utile decidere in una volta sola. Ogni seduta ha un file dedicato in
[`roadmap/`](roadmap/).

Lo **strato** etichetta la voce per fissarne la **scadenza**:

- **contratto** — costa una migrazione di versione in M4. Rende la voce una P0.
- **kernel**, **shell**, **presidi** — seguono l'implementazione. Un presidio è
  un test che diventa rosso se una promessa smette di valere. Sono P0 solo se
  legati a una firma.

Priorità: **P0** prima del freeze, **P1** con M3, **P2** quando la scala lo
richiede.

## Il criterio

FEATURES.md si implementa se le voci diventano dei provider transitori nel
kernel (`ViewProvider`, `CommandProvider`, `IndexProvider`, `FormatProvider`,
`EventHandler`). Ogni voce che non può essere un provider diventa un comando
Tauri bespoke, un pannello cablato in `main.ts` e un ramo `if` nel kernel.

Si cercano le voci ponendo domande in questo ordine:

1. **Cosa manca**. Un pezzo assente.
2. **Cosa ha la forma sbagliata**. Firme da aggiungere o migrare per il freeze.
3. **Cosa c'è e non mantiene**. Promesse mantenute a metà.
4. **Quante volte è scritto**. Il moltiplicatore costa ad ogni voce successiva.
5. **Domande non poste**. Chi vede il modello, cosa è una view, come si spegne.
   Chiuse dalla [0018](decisions/0018-chi-vede-il-modello-parsato.md),
   [0016](decisions/0016-cosa-e-una-view.md),
   [0019](decisions/0019-il-canale-dati.md) (sette su nove varianti), e la
   [seduta 9](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md).
6. **Fallimenti silenziosi**. Apre la [seduta
   20](roadmap/20-quando-qualcosa-va-storto.md). `Result` o messaggi vanno
   persi. Il costo si paga subito, non scade col freeze.
7. **Decisioni a verbale**. La [0025](decisions/0025-la-ricerca-predefinita.md)
   crea voci decidendo il comportamento
   ([21](roadmap/21-la-ricerca-predefinita.md)).
8. **Verifiche**. La §21.10 corregge un'affermazione falsa sul contratto
   ([0003](decisions/0003-modello-del-documento.md)). Affermazioni esterne
   sull'architettura vanno verificate sul codice.
9. **Separazioni**. La chiusura sdoppia le voci. La §16.8 si stacca dal §16.7
   ([0053](decisions/0053-il-contratto-ha-una-sorgente.md)). La voce sull'orario si stacca
   dalla voce sull'abbonamento su «orario» vs «tempo»
   ([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)).
10. **Verifiche sui verbali**. Si rileggono le vecchie decisioni. Producono le
    tre voci originali (es. la premessa de
    [0069](decisions/0069-cosa-sa-dire-un-abbonamento.md) invalida la
    decisione). La [seduta 23](roadmap/23-cosa-costano-le-decisioni-chiuse.md)
    chiude cinque falsi positivi.
    - Il secondo giro su dieci verbali crea cinque voci, un doppione e tre falsi
      positivi. Si esegue il criterio sui verbali.
    - Il terzo giro su novanta verbali (cinque lotti) usa una lente (domanda
      stretta). Trova otto voci (§23.9–§23.16). Produce coppie (es. §23.3) che
      non si vedono leggendo un verbale solo.
11. **Elenchi di resti**. La §23.17 trova voci ripetute identiche («resta
    fuori») su [0095](decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md),
    [0096](decisions/0096-una-bozza-non-e-una-nota.md) e
    [0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)
    (tre commit su permessi). Un «resta fuori» ripetuto tre volte diventa una
    voce.
12. **Misure elenchi gesti**. Otto sezioni in [microfeatures/](microfeatures/)
    contengono 424 gesti che compongono FEATURES.md. [seduta
    26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) valuta gesti non
    dichiarati.
13. **Affermazioni mai messe alla prova**. Non ciò che manca e non ciò che è
    misurato sbagliato: ciò che *sembra vero perché è coerente*, e che il freeze
    rende definitivo senza che niente nel repo l'abbia esercitato. La lente
    nasce dal rifare [mappa-visuale.md](architecture/mappa-visuale.md) riquadro
    per riquadro scrivendo *cosa costa*, e trovarsi tre volte a scrivere un
    costo che nessuno ha ancora pagato ([seduta
    27](roadmap/27-tre-scommesse-che-nessuno-ha-provato.md)).
14. **Il costo del ciclo di lavoro**. Non l'app accesa e chi la usa: il repo
    fermo e chi ci lavora. Si cronometra la forma della compilazione — il grafo,
    i `crate-type`, quanti eseguibili escono da `tests/` — e si cerca la cifra
    che nessuno ha scelto. È la specie di costo che nessun presidio vede perché
    non fallisce mai ([seduta
    28](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md)).

## Le sedute

| # | Seduta | Perché insieme | Voci | Caselle |
| --- | --- | --- | --- | --- |
| **1** | [La forma della shell](roadmap/01-forma-della-shell.md) | dove sta cosa, prima che la superficie cresca | — | — |
| **2** | [Cosa è una view](roadmap/02-cosa-e-una-view.md) | le firme dicono insieme che una view è una funzione pura, sincrona, senza stato | — | — |
| **3** | [Chi disegna ciò che il core non conosce](roadmap/03-chi-disegna-cio-che-il-core-non-conosce.md) | una decisione sola vista da tre lati: sintassi, blocco, renderer nella shell | — | — |
| **4** | [Chi vede il modello parsato](roadmap/04-chi-vede-il-modello-parsato.md) | *chi vede la struttura di un documento?* | — | — |
| **5** | [Il canale dati: chi risponde, e chi instrada](roadmap/05-il-canale-dati.md) | *chi risponde a una query, e chi la instrada?* | — | — |
| **6** | [Le regole in un posto solo](roadmap/06-le-regole-in-un-posto-solo.md) | la stessa regola serve a tre consumatori: provider, shell, e a M5 un guest WASM | — | — |
| **7** | [Il confine](roadmap/07-il-confine.md) | la disciplina del confine, vista da chi lo attraversa e da chi lo presta | — | 0 |
| **8** | [Il kernel a pezzi, e chi lo monta](roadmap/08-il-kernel-a-pezzi.md) | l'oggetto-dio, chi lo monta e chi lo blocca: scomporlo senza decidere il lock lo avrebbe rifatto a grana grossa | — | — |
| **9** | [Il lavoro lungo, e come un componente smette](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | lo spegnimento visto per intero: un componente, un vault, tutti i vault, e chi esegue ciò che è ancora in corso | — | — |
| **10** | [Gli eventi: grana, freno, destinatari](roadmap/10-gli-eventi.md) | lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra | — | — |
| **11** | [Le impostazioni, e i tre stati](roadmap/11-impostazioni-e-i-tre-stati.md) | tre stati che, decisi separati, nascono con tre meccanismi che non si parlano | — | 1 |
| **12** | [Le stringhe, gli errori, il locale](roadmap/12-stringhe-errori-locale.md) | chi localizza le stringhe localizza anche gli errori, e a tutti e due serve prima il locale | — | — |
| **13** | [L'identità di un documento](roadmap/13-identita-del-documento.md) | la stessa domanda a tre distanze: l'identità, ciò che le sta attaccato, la sua storia | — | — |
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista | — | 1 |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra | — | 2 |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | **chiusa** — i banchi e i confini fra crate, **prima** di ciò che li moltiplica; l'ultima voce è andata via lasciando la casella che una condizione tiene fuori | — | 1 |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | **chiusa** — senza precedenze e senza scadenza: il criterio è se il costo cresce con l'attesa | — | 0 |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | **chiusa** — definita per esclusione: ciò che resta della shell e non appartiene a nessuna delle sedute sopra, code delle sedute 1-4 comprese | — | 4 |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: rimandi ai quattro giri di audit, e il lavoro sta nelle sedute che li hanno assorbiti | — | 2 |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | **chiusa** — lo stesso percorso interrotto in più punti: chi non può dirlo, chi lo butta via, chi non ha dove scriverlo | — | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | la ricerca è built-in e di classe *omnisearch*: qui sta la distanza fra quella frase e il repo | — | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | le cose che un abbonamento non sa dire — e il cappello che le teneva insieme si è rivelato sbagliato due volte su tre | — | 1 |
| **23** | [Cosa le decisioni chiuse costano a chi usa Fub](roadmap/23-cosa-costano-le-decisioni-chiuse.md) | **chiusa** — prezzi dichiarati da un verbale, ognuno in una riga, che nessun elenco ha poi sommato | — | 1 |
| **24** | [Tre firme che il freeze rende definitive](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) | **chiusa** — tre voci aperte perché toccavano una firma, e su due delle tre quel criterio non reggeva | — | — |
| **25** | [Sette scelte che il codice ha preso senza dirlo](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) | **chiusa** — sette punti in cui il codice ha già preso una posizione senza che nessuno la scegliesse, e in sei la risposta era già scritta altrove nel repo: [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md), [0136](decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md), [0137](decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md), [0138](decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md), [0139](decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md), [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md), [0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md) | — | 0 |
| **26** | [Otto gesti che l'app fa e nessuno può dichiarare](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) | otto gesti che l'app compie e che **nessun dato dichiara**: in tutti e otto la mossa che li renderebbe dichiarabili il repo l'ha già fatta accanto, su un problema confinante | 8 | 0 |
| **27** | [Tre scommesse che nessuno ha ancora provato](roadmap/27-tre-scommesse-che-nessuno-ha-provato.md) | tre affermazioni che il freeze rende definitive e che **niente nel repo ha mai esercitato**: il confine WASM, il momento in cui un plugin può intervenire, la dimensione dell'oggetto dietro il lucchetto. Il confine l'ha attraversato la [0146](decisions/0146-il-contratto-attraversa-il-confine.md), e non serviva un motore: `abi.wit` genera i binding guest del mondo intero e compilano a `wasm32`; il momento in cui un plugin può intervenire l'ha deciso la [0147](decisions/0147-il-contratto-osserva-dopo-e-non-si-interpone.md), ed è sempre *dopo*; la dimensione dell'oggetto dietro il lucchetto l'ha decisa la [0148](decisions/0148-un-prestito-lungo-non-si-vieta-si-dice.md), che non la cambia e la fa **dire**: un prestito esclusivo lungo non si vieta perché non si interrompe, e la `Custodia` lo misura per tutti | — | — |
| **28** | [Centoventuno eseguibili per provare una riga](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md) | **chiusa** — una voce sola, e il soggetto non era il prodotto ma **il ciclo di chi lo scrive**: la [0145](decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md) l'ha chiusa fuori dalle tre forme che proponeva, perché il costo non era il *numero* degli eseguibili ma il *peso* di ognuno | — | — |
| **29** | [Chi possiede la pelle della shell](roadmap/29-chi-possiede-la-pelle.md) | la stessa domanda di proprietà vista da sei lati: che cosa si sostituisce, con quale contratto, attraverso quali cancelli, su quale strada di montaggio, con quale gesto dell'utente, e dove vive | 5 | 0 |
| **30** | [Il moto è del tema](roadmap/30-il-moto-e-del-tema.md) | il collocamento della 29, cernito: scala del ritmo, montaggio con classi di coreografia, cambio di luce in dissolvenza, gesti per provenienza, grafo e moto ridotto, dove non si balla, presidi | 1 | 0 |
| **31** | [Da dove viene ciò che si vede](roadmap/31-da-dove-viene-cio-che-si-vede.md) | la stessa domanda su nove cose che si vedono — un colore, una voce di carattere, un bottone, una distanza, una preferenza, una soglia, la superficie di scrittura, un nome di classe, una consegna — e nove volte la stessa risposta di oggi: *da una scelta fatta una volta e mai più derivabile* | 4 | 1 |

## Le voci

Le voci aperte sono **dieci** [conta: voci-aperte].

È la [seduta 31](roadmap/31-da-dove-viene-cio-che-si-vede.md) (2026-08-19), e
la sua domanda cade **dentro** l'architettura che le due precedenti hanno
costruito: *da dove viene ciò che si vede?* Il tema di serie è il primo e unico
esemplare del fascio della 29, ed è cresciuto per accrezione — un colore scelto
una volta e poi difeso da un presidio, sessantasei regole che vestono un
bottone, quarantatré id al posto di un vocabolario, una tavolozza di sintassi
nata per un altro fondo e sette dei suoi dieci colori sotto la soglia in luce.
Nove voci, e in tutte e nove la mossa è la stessa: sostituire *scelto a mano*
con *derivato da una regola* — la ricetta al posto dell'esadecimale scritto a
mano ([0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)),
un'anatomia al posto di sessantasei, una tabella di soglie al posto di una
soglia. La prima non decide nessuna delle altre otto: costruisce **l'occhio**,
perché dei quattro presidi del tema tre leggono i CSS come testo e il quarto
conta gli elementi montati in un DOM finto — nessuno guarda, e
`frontend/banco/` non esiste. Nessuna scade col freeze, perché nessuna sta nel
WIT; tutte scadono con M3, perché il vocabolario degli hook si congela lì
(§29.2). La [0170](decisions/0170-una-componente-un-anatomia.md) lo ha chiuso;
la [0171](decisions/0171-la-stessa-nota-in-tre-modi.md) ha chiuso la §31.8 e
il residuo della §31.3. Restano aperte §31.5–§31.7 e §31.9.

Prima di lei, la [seduta 30](roadmap/30-il-moto-e-del-tema.md) (2026-08-17): il
moto della GUI, che la 29 aveva collocato — il ritmo nel foglio, le animazioni
nella pelle, il cancello nella struttura — ma non deciso. Sette decisioni: la
scala del vocabolario si allarga solo col consumatore in piedi (il `--duration-med`
mai consumato è la lezione), le ~14 superfici che aprono con `hidden` si
animano con classi di coreografia di shell — non `@starting-style`, non View
Transitions come base —, il cambio di luce diventa dissolvenza con un solo
foglio in volo, ogni gesto deve avere una frase di stato, il grafo scopre il
moto ridotto e l'editor resta fermo — i 60 fps su 10.000 parole sono il
pavimento, non l'obiettivo. Una voce aperta (§30.8).

Prima di lei, la [seduta 29](roadmap/29-chi-possiede-la-pelle.md)
(2026-08-17): la pelle
della shell — token, chrome, animazioni — smette di essere della shell e diventa
un **fascio sostituibile**, di cui il tema di serie è il primo esemplare. Un
tema di terzi **sostituisce** — un solo foglio caricato, mai sovrapposto — e i
cancelli di coerenza (ruoli completi, contrasto, moto ridotto, sanificazione)
girano al montaggio. Nessuna delle sei scade col freeze: il contratto del tema
non sta nel WIT, e il vocabolario degli hook si congela a fine M3, quando la
GUI si è assestata.

Prima di lei, la [seduta
26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) (2026-08-10). La misura
su 424 gesti in [microfeatures/](microfeatures/) ha rivelato omissioni non
dichiarate nei dati. È di contratto: dopo la
[0151](decisions/0151-il-terzo-registro-si-guarda-anche-senza-salire.md) non ne
resta nessuna di shell. Delle otto chiuse, la
§26.6 era la sola **P0** e la sola che scadesse prima del freeze: l'ha chiusa la
[0144](decisions/0144-una-spunta-sola-diceva-due-cose.md), spaccando
`fub:clipboard` in `fub:read-clipboard` e `fub:write-clipboard` prima che un
manifest scrivesse il nome unico. La §26.3 l'ha chiusa la
[0149](decisions/0149-la-grammatica-di-un-accordo-e-salita.md) trovandola già
fatta: la grammatica degli accordi era salita in `fub_abi::rules::tasti`
riparando il difetto che la voce stessa aveva depositato, e al verbale è
restato il residuo — dirla nel doc del tipo, nel WIT e nel campo dove
l'utente l'accordo lo scrive a mano. La §26.4 l'ha chiusa la
[0150](decisions/0150-il-piano-e-della-superficie.md) con un no al campo
`layer`: il piano è della superficie e non della view, e volere un piano diverso
è volere una superficie diversa — che si chiede aggiungendo un caso in fondo a
`view-surface`, additivo quanto il campo. La §26.2 l'ha chiusa la
[0151](decisions/0151-il-terzo-registro-si-guarda-anche-senza-salire.md) con la
forma che la voce raccomandava: i 102 accordi montati sull'editor adesso un
banco li guarda, e le tre collisioni che ne escono stanno scritte per nome —
un lucchetto e non uno zero, perché chi tiene `Ctrl+F` lo decide il fuoco
(0156). La §26.5 l'ha chiusa la
[0152](decisions/0152-il-bersaglio-di-un-clic-non-e-uno-stato.md) con un no al
bersaglio del clic dentro il contesto di sessione: uno stato che dura non è il
posto di un fatto vero per un istante, e la promessa che il contratto ne faceva
sopra `context-menu` era falsa — adesso è riparata, e un banco pretende che i
campi di `ViewContext` restino quattro. La §26.8 l'ha chiusa la
[0153](decisions/0153-non-c-e-una-terza-pila.md) senza una terza pila: una view
di terzi che vuole il proprio annulla compone comandi, e il prezzo di quella
strada — `fub:run-command` per ognuna — è il metro che dirà quando vale la pena
di cambiarla. E la §26.1 l'ha chiusa la
[0156](decisions/0156-un-accordo-non-dichiara-un-ambito.md) con un no al campo
`context`: un accordo non dichiara un ambito, il contesto si deriva dal fuoco —
dentro l'editor vince l'editor, fuori vince la shell — e i tasti nudi restano
fuori dal registro. Le tre collisioni di 0151 a runtime le decide il fuoco, e
`SCONTRI_NOTI` resta il lucchetto sugli elenchi. E la §26.7 l'ha chiusa la
[0157](decisions/0157-un-rilascio-aspetta-la-seconda-superficie.md) senza un
campo bersaglio su `ui-node`: il drag & drop resta della shell finché non esiste
una seconda superficie che trascina, e il vocabolario del bersaglio è già quello
della 0152 — viaggia con l'invocazione (`ui-action.payload`), non con lo stato.
Le dichiarazioni richiedono semplici
spostamenti, poiché le mosse sono già risolte per problemi confinanti.

La [seduta 27](roadmap/27-tre-scommesse-che-nessuno-ha-provato.md)
(2026-08-11) **è chiusa**, ed era di una specie che le altre venticinque sedute
non avevano: non cose che mancano e non cose misurate sbagliate, ma
**affermazioni che il freeze rende definitive senza che niente le abbia
esercitate**. Due erano di contratto e **P0** per la ragione della
[0002](decisions/0002-additivita-del-contratto.md); la terza, di kernel, era
**P1** per la stessa scadenza.

Il confine WASM che nessuno aveva attraversato (§27.1) l'ha chiuso la
[0146](decisions/0146-il-contratto-attraversa-il-confine.md) scoprendo
che attraversarlo non costava i giorni che la voce prezzava: `tools/varco-wasm/`
genera da `abi.wit` i binding guest del mondo intero — export implementati
compresi — e li compila a `wasm32-unknown-unknown` senza un errore, per un modulo

[Showing lines 1-300 of 704. Use :301 to continue]