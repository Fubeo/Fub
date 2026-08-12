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

Sono uscite 152 voci:

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
  ([0056](decisions/0056-un-elenco-che-e-la-sorgente.md)). La §22.4 nasce dal
  distacco dalla §22.1. «Alle 9» e «ogni ora» differiscono per i fusi orari
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

Centoquarantasette voci sono chiuse. I loro verbali stanno in
[decisions/](decisions/README.md).
Le voci ancora aperte sono **sette** [conta: voci-aperte]. Questo file è il
loro **indice** e consuntivo.

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
   ([0053](decisions/0053-il-contratto-ha-una-sorgente.md)). La §22.4 si stacca
   dalla §22.1 su «orario» vs «tempo»
   ([0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)).
10. **Verifiche sui verbali**. Si rileggono le vecchie decisioni. Producono le
    tre voci originali (es. la premessa de
    [0069](decisions/0069-cosa-sa-dire-un-abbonamento.md) invalida la
    decisione). La [seduta 23](roadmap/23-cosa-costano-le-decisioni-chiuse.md)
    chiude cinque falsi positivi.
    - Il secondo giro su dieci verbali crea cinque voci (§23.4–§23.8), un
      doppione e tre falsi positivi. Si esegue il criterio sui verbali.
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
| **7** | [Il confine](roadmap/07-il-confine.md) | la disciplina del confine, vista da chi lo attraversa e da chi lo presta | — | 1 |
| **8** | [Il kernel a pezzi, e chi lo monta](roadmap/08-il-kernel-a-pezzi.md) | l'oggetto-dio, chi lo monta e chi lo blocca: scomporlo senza decidere il lock lo avrebbe rifatto a grana grossa | — | — |
| **9** | [Il lavoro lungo, e come un componente smette](roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | lo spegnimento visto per intero: un componente, un vault, tutti i vault, e chi esegue ciò che è ancora in corso | — | — |
| **10** | [Gli eventi: grana, freno, destinatari](roadmap/10-gli-eventi.md) | lo stesso canale a tre distanze: chi si abbona, quanti messaggi passano, chi li mostra | — | — |
| **11** | [Le impostazioni, e i tre stati](roadmap/11-impostazioni-e-i-tre-stati.md) | tre stati che, decisi separati, nascono con tre meccanismi che non si parlano | — | 1 |
| **12** | [Le stringhe, gli errori, il locale](roadmap/12-stringhe-errori-locale.md) | chi localizza le stringhe localizza anche gli errori, e a tutti e due serve prima il locale | — | — |
| **13** | [L'identità di un documento](roadmap/13-identita-del-documento.md) | la stessa domanda a tre distanze: l'identità, ciò che le sta attaccato, la sua storia | — | — |
| **14** | [Le entry, le cartelle, la lista](roadmap/14-entry-cartelle-lista.md) | lo stesso lavoro visto da quattro lati: entry, metadati, cartelle, lista | — | 3 |
| **15** | [Il disco: storage, durabilità, politiche](roadmap/15-il-disco.md) | il supporto, e le politiche di cosa ci finisce sopra | — | 3 |
| **16** | [I crate, l'SDK, i banchi di prova](roadmap/16-crate-sdk-banchi-di-prova.md) | **chiusa** — i banchi e i confini fra crate, **prima** di ciò che li moltiplica; l'ultima voce è andata via lasciando la casella che una condizione tiene fuori | — | 2 |
| **17** | [I presidi che restano](roadmap/17-presidi-che-restano.md) | **chiusa** — senza precedenze e senza scadenza: il criterio è se il costo cresce con l'attesa, e su una voce ha deciso in tre pezzi invece che in due | — | 2 |
| **18** | [L'editor e la tastiera, e ciò che resta della shell](roadmap/18-editor-e-tastiera.md) | **chiusa** — definita per esclusione: ciò che resta della shell e non appartiene a nessuna delle sedute sopra, code delle sedute 1-4 comprese | — | 4 |
| **19** | [Debito riportato dal quarto audit](roadmap/19-debito-quarto-audit.md) | nessuna voce propria: rimandi ai quattro giri di audit, e il lavoro sta nelle sedute che li hanno assorbiti | — | 2 |
| **20** | [Quando qualcosa va storto, chi lo dice e a chi](roadmap/20-quando-qualcosa-va-storto.md) | **chiusa** — lo stesso percorso interrotto in più punti: chi non può dirlo, chi lo butta via, chi non ha dove scriverlo | — | — |
| **21** | [La ricerca predefinita, e cosa le manca per esserlo](roadmap/21-la-ricerca-predefinita.md) | la ricerca è built-in e di classe *omnisearch*: qui sta la distanza fra quella frase e il repo | — | — |
| **22** | [Cosa sa dire un abbonamento](roadmap/22-cosa-sa-dire-un-abbonamento.md) | le cose che un abbonamento non sa dire — e il cappello che le teneva insieme si è rivelato sbagliato due volte su tre | — | 2 |
| **23** | [Cosa le decisioni chiuse costano a chi usa Fub](roadmap/23-cosa-costano-le-decisioni-chiuse.md) | **chiusa** — prezzi dichiarati da un verbale, ognuno in una riga, che nessun elenco ha poi sommato | — | 3 |
| **24** | [Tre firme che il freeze rende definitive](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) | **chiusa** — tre voci aperte perché toccavano una firma, e su due delle tre quel criterio non reggeva | — | — |
| **25** | [Sette scelte che il codice ha preso senza dirlo](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) | **chiusa** — sette punti in cui il codice ha già preso una posizione senza che nessuno la scegliesse, e in sei la risposta era già scritta altrove nel repo: [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md), [0136](decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md), [0137](decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md), [0138](decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md), [0139](decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md), [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md), [0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md) | — | 2 |
| **26** | [Otto gesti che l'app fa e nessuno può dichiarare](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) | otto gesti che l'app compie e che **nessun dato dichiara**: in tutti e otto la mossa che li renderebbe dichiarabili il repo l'ha già fatta accanto, su un problema confinante | 7 | 1 |
| **27** | [Tre scommesse che nessuno ha ancora provato](roadmap/27-tre-scommesse-che-nessuno-ha-provato.md) | tre affermazioni che il freeze rende definitive e che **niente nel repo ha mai esercitato**: il confine WASM, il momento in cui un plugin può intervenire, la dimensione dell'oggetto dietro il lucchetto. Il confine l'ha attraversato la [0146](decisions/0146-il-contratto-attraversa-il-confine.md), e non serviva un motore: `abi.wit` genera i binding guest del mondo intero e compilano a `wasm32`; il momento in cui un plugin può intervenire l'ha deciso la [0147](decisions/0147-il-contratto-osserva-dopo-e-non-si-interpone.md), ed è sempre *dopo*; la dimensione dell'oggetto dietro il lucchetto l'ha decisa la [0148](decisions/0148-un-prestito-lungo-non-si-vieta-si-dice.md), che non la cambia e la fa **dire**: un prestito esclusivo lungo non si vieta perché non si interrompe, e la `Custodia` lo misura per tutti | — | — |
| **28** | [Centoventuno eseguibili per provare una riga](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md) | **chiusa** — una voce sola, e il soggetto non era il prodotto ma **il ciclo di chi lo scrive**: la [0145](decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md) l'ha chiusa fuori dalle tre forme che proponeva, perché il costo non era il *numero* degli eseguibili ma il *peso* di ognuno | — | — |

## Le voci

Le voci aperte sono **sette** [conta: voci-aperte], e stanno tutte in una
seduta sola.

Sono la [seduta
26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md) (2026-08-10). La misura
su 424 gesti in [microfeatures/](microfeatures/) ha rivelato omissioni non
dichiarate nei dati. Sei di contratto, una di shell. L'ottava era la §26.6, la
sola **P0** e la sola che scadesse prima del freeze: l'ha chiusa la
[0144](decisions/0144-una-spunta-sola-diceva-due-cose.md), spaccando
`fub:clipboard` in `fub:read-clipboard` e `fub:write-clipboard` prima che un
manifest scrivesse il nome unico. Le dichiarazioni richiedono semplici
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
di 275 073 byte che è il pedaggio di un plugin che non fa niente. Serviva un
generatore, non un motore; il **costo** del passaggio, che il motore lo vuole,
resta di M5 e sta scritto nel verbale.

La P0 di contratto era il momento in cui un plugin può intervenire, che oggi è
sempre *dopo* (§27.2), e la [0147](decisions/0147-il-contratto-osserva-dopo-e-non-si-interpone.md)
l'ha chiusa nella forma **(c)** — «com'è oggi», e non per inerzia: i tre clienti
che la voce elencava hanno già una casa decisa altrove. Il sync è un servizio
del core (il metro di plugin-boundary nomina già il punto «prima o dopo la
scrittura»), la cifratura sta sotto `VaultStorage`, un tratto del kernel già
sostituibile, e la politica di vault non è in nessun piano. Zero caselle.

La P1 di kernel era la dimensione dell'oggetto dietro il lucchetto (§27.3), e
l'ha chiusa la
[0148](decisions/0148-un-prestito-lungo-non-si-vieta-si-dice.md) nella forma
**(a)** senza il pezzo di contratto che la voce le attribuiva: un tetto
dichiarato non si può far rispettare, perché un prestito esclusivo non si
interrompe. Resta la metà che vale — la `Custodia` misura quanto è durata la
presa esclusiva e sopra un quarto di secondo lo dice —, e sta nella porta,
quindi la ereditano tutti e cinquantacinque i siti che quel prestito lo
prendono. Zero caselle.

E la scadenza si è sciolta tre volte allo stesso modo: ciò che il freeze incassa
è quel che il contratto **dichiara**, e in nessuna delle tre la cosa temuta era
dichiarata lì.

La [seduta
28](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md) (2026-08-11) è
**chiusa il giorno stesso in cui è stata aperta**, e la sua voce sola era la
prima il cui soggetto non fosse il prodotto ma **il ciclo di lavoro di chi lo
scrive**. La [0145](decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md)
l'ha chiusa **fuori dalle tre forme che proponeva**, perché la premessa non
reggeva: i quattro minuti fra una riga cambiata nel kernel e il primo test che
parte non erano il *numero* degli eseguibili di `tests/` ma il *peso* di ognuno,
e il peso non l'aveva scelto nessuno — era il default di cargo, che ricopia
l'informazione di debug dentro ogni binario. Una riga di `[profile.dev]` la
lascia nei `.o`: mediana di un eseguibile di prova da 62,4 a 25,6 MB, i
centotrentasette insieme da 13,8 a 4,94 GB, e non si perde un byte.

La roadmap infrastrutturale di M4 resta finita. La [seduta
25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md) aveva chiuso
sette voci:

- §25.1: Chiusa da
  [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md). Forma (a)
  attuata, (b) rimane casella.
- §25.2: Chiusa da
  [0136](decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md).
  Quarantaquattro regole unificate.
- §25.6: Chiusa da
  [0137](decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md).
  `scriviStato` ha cinque chiamanti, in tre moduli e con quattro chiavi, quindi
  la coda sta nel posto che tutti attraversano e non in `store.ts`.
- §25.4: Chiusa da
  [0138](decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md). 220
  caratteri per link in `fub-abi::rules::snippet`. Risolve `0110` (969 KB, 54
  MB).
- §25.5: Chiusa da
  [0139](decisions/0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md). Emette
  un `Event::Trouble` di severità `Warning`, una volta per sessione, e la porta
  è un tiraggio.
- §25.7: Chiusa da
  [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md). La chiave
  del carico di un `kind` di terzi è `source`, e si dichiara in
  `fub-abi::rules::carichi` invece di essere campionata a tre chiavi cablate.
  Lascia aperta la forma (a), un campo `carichi` nel WIT.
- §25.3: Chiusa da
  [0141](decisions/0141-la-prima-fotografia-di-un-vault-esce-dalla-fase-1.md).
  Finestra scoperta ridotta a zero.

La [seduta 24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) aveva
aperto tre voci (toccano la firma):

- §24.1: [0130](decisions/0130-ogni-tipo-del-contratto-si-vede-dalla-radice.md)
  per additività di `pub use`.
- §24.2: [0131](decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md) per
  `enabled`.
- §24.3: [0132](decisions/0132-un-rifiuto-non-e-una-frase.md).

**Se una voce è in questa tabella, è aperta.** Non ci sono spunte da leggere.
Una voce chiusa **sparisce**: dalla tabella, dal conteggio della sua seduta e
dal file della seduta. Il suo verbale va in [decisions/](decisions/README.md), e
il numero della voce si ritrova nella [corrispondenza](roadmap/numerazione.md).

**I numeri non scalano.** Un numero chiuso si **ritira**: non si riusa e non
viene rimpiazzato dal seguente. `§4.4` è ancora `§4.4` anche adesso che la voce
sta nella seduta 18, dove le code delle prime quattro sedute stanno accanto alle
voci con cui si incastrano: l'ordine in cui si sbloccano (§1.2 → §3.3) si vede
solo tenendole nello stesso file. Un `§X.Y` è citato nei commenti del codice e
nei messaggi di commit, e una numerazione che si ricompatta trasforma ogni
citazione in un rimando cieco.

**La tabella è stata vuota un giorno solo.** Dal 2026-08-09, quando la §25.3 ne
è uscita, al 2026-08-10, quando ci sono entrate le otto della seduta 26. Le
sedute erano arrivate a zero una per volta, e ogni volta lo zero diceva che
**una domanda** aveva finito di produrre voci: quello delle ventiquattro diceva
che la roadmap infrastrutturale è finita, quello della 25 che aveva finito anche
la rilettura. Le otto del giorno dopo non smentiscono nessuno dei due: vengono
da un elenco più fine che prima non c'era. Il conto era nato per reggere proprio
quel giorno: `voci-aperte` porta un `|| true` in coda **apposta**, perché
`grep -c` esce 1 quando non trova niente, e a tabella vuota il registro direbbe
«non ha contato» invece di «zero».

La seduta 20 si è chiusa con la
[0111](decisions/0111-il-budget-e-un-tetto-sul-lavoro.md) e non lascia nemmeno
una casella. La seduta 23 era diciassette voci, la più grande mai aperta qui, e
la sua riga resta solo per consuntivo. La seduta 16 si è chiusa con la
[0116](decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
e lascia una casella che aspetta una **condizione**, valutata dal
[0073](decisions/0073-una-condizione-che-nessuno-valuta.md).

**Una casella residua è lavoro già deciso che qualcuno deve ancora fare.** Non è
una voce: una voce aperta è lavoro ancora da **decidere**. Le due somme restano
separate perché contano cose separate.

Le caselle residue oggi sono **venticinque**, e stanno in venti posti:

- [§11.2](roadmap/11-impostazioni-e-i-tre-stati.md) — una: i workspace salvati
  con un nome. La casa è decisa, il formato aspetta di vedere assetti veri.
- [§14.1](roadmap/14-entry-cartelle-lista.md#141-il-vault-non-è-solo-documenti)
  — tre: l'impronta degli allegati, la politica della cartella allegati, le
  derivate.
- [§15.4](roadmap/15-il-disco.md#154-i-dati-persistiti-non-hanno-né-una-mappa-né-una-classe)
  — una: l'implementazione additiva delle due radici.
- [§16.3](roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature)
  — una: lo split di `fub-features` in un crate per bundle. È l'unica casella
  che non aspetta qualcuno ma una **condizione** — il primo import fra due
  moduli di feature che non sia un link di documentazione — ed è l'unica con un
  guardiano che la valuta invece di una riga che la ricorda
  ([0073](decisions/0073-una-condizione-che-nessuno-valuta.md)).
- [§16.6](roadmap/16-crate-sdk-banchi-di-prova.md#166-dieta-dellipc) — una: i
  due bespoke del render ancora da migrare. Erano cinque fino alla
  [0075](decisions/0075-una-view-non-chiede-con-una-finestra.md). È la prima
  casella che **non vive in una riga di prosa**: il suo numero lo asserisce un
  test.
- [§3.3](roadmap/18-editor-e-tastiera.md#33-la-ui-di-un-plugin-non-ha-modo-di-entrare-nella-shell)
  — una: aprire in un riquadro una view principale che **non** sia il grafo.
  Oggi lo fa `shell.graph`, che è il comando di quel componente, e il secondo
  cliente vorrà un gesto generico.
- [seduta 19](roadmap/19-debito-quarto-audit.md) — due rimandi. Il terzo, le
  «tre copie» custodite da un flag TS, è caduto con la
  [0089](decisions/0089-da-cosa-e-partita-una-scrittura.md): non fondendo le
  tre, ma togliendo a una il compito di avere ragione.
- [§22.3](roadmap/22-cosa-sa-dire-un-abbonamento.md#223-la-maschera-di-ridisegno-è-della-view-non-dellesemplare)
  — una: la query incorporata in una nota. Non è un esemplare di `ViewSpec` e
  non ha un canale di invalidazione affatto.
- [§22.4](roadmap/22-cosa-sa-dire-un-abbonamento.md#224-un-orario-di-parete-non-è-un-intervallo)
  — una: il recupero di una sveglia di parete **attraverso un riavvio**. La
  finestra di `catch_up_seconds` è onorata dentro una sessione e attraverso il
  sonno della macchina, non attraverso una chiusura: lo scheduler non persiste
  dove è arrivato.
- [§23.4](roadmap/23-cosa-costano-le-decisioni-chiuse.md#234-selection-ne-porta-una-sola-e-il-tipo-di-un-campo-non-è-additivo)
  — una: `note.task.toggle` su più cursori. Il comando spunta il task sotto
  **il** cursore, e la sua posizione è un argomento scalare di una `CommandSpec`
  pubblicata: farne una lista è una decisione di firma che la
  [0093](decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) non ha preso
  di straforo.
- [§23.3](roadmap/23-cosa-costano-le-decisioni-chiuse.md#233-due-bloccanti-caduti-e-la-rete-non-se-nè-accorta)
  — una: fermare una richiesta di rete **già partita**. La
  [0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) ha
  staccato la `fetch` dal prestito del workspace e rilegge il permesso a ogni
  chiamata, ma chi annulla un job non aspetta la rete: aspetta il tetto di tempo
  dell'host, fino a un minuto che l'utente **vede**.
- [§17.3](roadmap/17-presidi-che-restano.md#173-osservabilità) — una: la porta
  da cui si è entrati non arriva nell'evento. La
  [0105](decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) ha
  fatto delle tredici porte un dato, `Gate`, ma nell'`Event::Trouble` della
  [0052](decisions/0052-cio-che-va-storto-e-un-evento.md) arriva ancora solo la
  frase. Portarla dentro è un campo in un tipo del contratto, cioè una decisione
  sulla firma che quella voce non chiedeva.
- [§7.1](roadmap/07-il-confine.md#la-casella-rimasta) — una, e **ristretta**: le
  allowlist dei permessi hanno un **parametro**, e fino alla
  [0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) non
  ne leggeva nessuno. Adesso `fub:network` sì, quindi restano i **prefissi di
  path** di `read-vault` e `write-vault`: un plugin ristretto a `Progetti/`
  legge ancora tutto. Restano una casella a sé perché un host e un path non si
  confrontano allo stesso modo, che è la ragione per cui `Policy::denies_host` è
  stretta invece di generica. La [0021](decisions/0021-il-confine.md) l'aveva
  lasciata in attesa del §15.5, chiuso poi dalla
  [0058](decisions/0058-un-nome-che-nasce.md).
- [§23.7](roadmap/23-cosa-costano-le-decisioni-chiuse.md#237-una-data-scritta-come-la-scrive-lutente-non-è-una-data-e-non-cè-modo-di-dirlo)
  — una: i **nomi dei mesi**. `5 luglio 2026` non è un ordine di campi ma una
  tabella per lingua, e le tabelle non ci sono. La casella aspetta un secondo
  cliente per quelle tabelle.
- [§15.6](roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione)
  — due. La prima è leggere il `.gitignore`: la
  [0110](decisions/0110-la-struttura-non-e-una-preferenza.md) ha fatto della
  politica di esclusione un dato per-vault, e un **file** come sorgente di quel
  dato ha una sintassi propria, una precedenza propria e un proprietario che non
  è Fub. Il posto dove atterrare c'è — un terzo modo di costruire un
  `IgnorePolicy` — la forma no. La seconda è cambiare le cartelle escluse
  **dall'app**: chi le cambia sarebbe il comando che le scrive, e per questa
  chiave quel comando non esiste, perché la chiave non è `program_writable` di
  proposito.
- [§17.1](roadmap/17-presidi-che-restano.md#171-corpus-fuzzing-prestazioni) —
  una: le otto famiglie dell'indice del kernel che costruiscono tutto per
  mostrarne venti. La [0113](decisions/0113-il-banco-conta-le-operazioni.md) ha
  portato al banco la sola anagrafe e ne ha misurata una: `Folders` costa otto
  allocazioni per nota, e il prezzo sta *dentro* la costruzione di ogni riga che
  si tiene. A tutte manca la riga di banco che dica quanto costano.
- [§2.9](roadmap/18-editor-e-tastiera.md#29-prestazioni-della-ui) — due. La
  prima è la **finestra scorrevole** vera, e con lei il gesto «mostra le altre»:
  la [0114](decisions/0114-una-finestra-non-si-omette.md) ha fatto la metà che
  sta prima del layout, e disegnare ciò che si vede vuole il layout, che in
  `happy-dom` non esiste — è il buco n. 5 della
  [0112](decisions/0112-un-e2e-contro-un-host-finto-prova-il-cablaggio.md). La
  seconda è il **rendering incrementale dell'anteprima**: la precondizione è
  quella della [0018](decisions/0018-chi-vede-il-modello-parsato.md), ma la
  casella resta ferma perché il suo primo cliente non esiste. `updatePreview`
  gira quando cambia il documento del riquadro e quando si entra in Lettura, mai
  a ogni battuta, perché `PaneMode` è un enum di modalità esclusive.
- [§4.4](roadmap/18-editor-e-tastiera.md#44-due-parser-per-la-stessa-sintassi) —
  una: il **canale a runtime** che porti la sintassi dichiarata alla superficie
  di scrittura. La [0115](decisions/0115-la-verita-e-la-dichiarazione.md) ha
  fatto leggere alla shell la dichiarazione invece di riscriverla, ma il file
  che gliela porta è generato alla compilazione: conosce le regole del core e
  non quelle di un plugin che si registra a caldo. La rotta è decisa — una
  variante di `IndexQuery`, perché un elenco è dati e i dati hanno un canale
  solo ([0013](decisions/0013-elenco-delle-capacita.md)) — e la risposta esiste
  già, `Workspace::syntax_forms`. Manca che chi serve il canale dati possa
  arrivarci: il `SyntaxRegistry` vive sotto il prestito esclusivo di chi scrive,
  quindi condividerlo è una decisione sulla concorrenza del kernel
  ([0024](decisions/0024-chi-legge-non-aspetta-chi-legge.md)).
- [§25.1](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#251-una-rinomina-che-atterra-su-una-nota-viva)
  — una: la **forma (b)**, migrare senza mai schiacciare. La
  [0135](decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md) ha preso
  la (a), che toglie il 100% della perdita misurata. La (b) ha un modello già
  scritto: la politica di collisione in `versioning.rs`, accanto a
  `VersionStore::rename`, che le due storie le unisce in ordine di tempo. Ma le
  politiche da scrivere sono tre, una per canale, e due bozze non salvate non si
  fondono senza inventare un testo che nessuno ha scritto.
- [§25.7](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#257-dove-stanno-i-byte-di-un-kind-di-terzi)
  — una: la **forma (a)**, un campo `carichi` in fondo a `syntax-rule-spec`. La
  [0140](decisions/0140-dove-stanno-i-byte-di-un-kind-di-terzi.md) l'ha lasciata
  aperta prendendo la (b). La casella ha un innesco scritto e non una data: il
  primo `kind` di terzi che deve dichiarare il proprio carico. Finché non
  esiste, la (a) costerebbe un tipo additivo per sempre — il prezzo che la
  [0002](decisions/0002-additivita-del-contratto.md) rende caro — per un caso
  che nessuno esercita.

Queste non diventano voci: non reggerebbero il criterio in testa al file. Ma non
devono nemmeno sparire senza essere state fatte.

**Un indirizzo dice chi potrà, non chi lo farà.** Una casella su cui è scritto
quale voce la risolverà vale più di una scritta a vuoto, e la prima ad averlo —
le tre righe di `.fub/` che scrivevano con `write_atomic` — è stata risolta
proprio da quella voce. La seconda mostra l'altro esito: il filtro per prefisso
dei permessi aspettava il §15.5, il §15.5 è chiuso da trentadue verbali, e
nessuno è tornato a prendere la casella.

| § | Voce | Seduta | Strato | |
| --- | --- | --- | --- | --- |
| **§26.1** | [Un accordo ha un contesto, o non ce l'ha](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.2** | [Cinque registri di tastiera, e il presidio ne guarda due](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#262-cinque-registri-di-tastiera-e-il-presidio-ne-guarda-due) | 26. Otto gesti che l'app fa e nessuno può dichiarare | shell | **P1** |
| **§26.3** | [La grammatica di un accordo non sta nel contratto](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#263-la-grammatica-di-un-accordo-non-sta-nel-contratto) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P2** |
| **§26.4** | [Il livello di una superficie non è un dato](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#264-il-livello-di-una-superficie-non-è-un-dato) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.5** | [Il menu contestuale: la superficie c'è, il bersaglio del clic no](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#265-il-menu-contestuale-la-superficie-cè-il-bersaglio-del-clic-no) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.7** | [Il trascinamento è un dato, il rilascio no](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#267-un-rilascio-si-consegna-un-bersaglio-non-si-dichiara) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P1** |
| **§26.8** | [La terza pila l'annulla dentro una view che non è del core](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#268-la-terza-pila-lannulla-dentro-una-view-che-non-è-del-core) | 26. Otto gesti che l'app fa e nessuno può dichiarare | contratto | **P2** |

## I difetti misurati

Sono **dodici** [conta: difetti-aperti] e non voci. Nessuno richiede una
decisione.

**Il primo blocco viene da un audit del 2026-07-31**, che aveva prodotto
novantadue osservazioni in `docs/issues.md`. Nessuno aveva mai lavorato quel
file, e settantuno righe rimandavano a voci **mai committate** — il rimando
cieco che [`roadmap/numerazione.md`](roadmap/numerazione.md) esiste per
impedire, arrivato dal lato che quella disciplina non copre. Rilette una per una
contro i sorgenti del 2026-08-06: sedici erano già chiuse, cinque non erano
difetti ma comportamenti decisi, e una era **falsa il giorno stesso** —
`note.task.toggle` che «non spunta mai un task», mentre un banco prova il
contrario (`commands_e2e.rs:688`). Settanta reggevano: **tre** sono diventate la
[seduta 24](roadmap/24-tre-firme-che-il-freeze-rende-definitive.md) perché
toccano una firma, queste sessantasette sono il resto. `issues.md` non esiste
più: il file si è **svuotato**, non è stato tolto.

Il secondo blocco (da `0093`) conta diciassette misure che vivevano in un
file-diario non tracciato, riscritto a ogni giro e che nessun presidio guardava.
Rimisurate sui sorgenti prima di entrare.

Il terzo blocco (`0110`–`0145`) di trentasei righe arriva dalla [seduta
25](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md). Undici
formano il residuo delle sette voci. Una trentasettesima riga era pronta e non è
stata scritta, perché *dove* stia la prima fotografia di un vault è precisamente
la
[§25.3](roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#253-dove-sta-la-prima-fotografia-di-un-vault):
un difetto la cui riparazione dipende da una decisione non è un difetto. Il suo
numero, `0115`, è andato a un'altra misura — e attenzione, `0115` è **sia** una
decisione **sia** un difetto.

Il quarto blocco (`0148`–`0150`) proviene dalla [seduta
26](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md). Anche qui una riga era
pronta e non è stata scritta: `Mod-f` è dichiarato due volte, da
`shell.doc.search` e dalla ricerca di CodeMirror, ma *chi dei due debba tenerlo*
è precisamente la
[§26.1](roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha).
Il quinto blocco (`0151`–`0222`) arriva da una caccia su centodiciannove
osservazioni. Esclude difetti la cui riparazione richiede decisioni (es.
`renameat2(RENAME_NOREPLACE)` in `VaultStorage`, o la
[0067](decisions/0067-il-registro-di-cio-che-e-successo.md)).
Il sesto blocco (`0223`–`0224`) copre le duplicazioni silenziose nel
compilatore.
Il settimo blocco (`0225`–`0226`) identifica ventuno definizioni mancanti e il
bisogno di file d'ingresso. Hanno corretto undici voci nel glossario in
duecentodiciassette file il 2026-08-10.
L'ottavo blocco (`0227`–`0228`) è **una riga sola di codice vista da due
momenti**, e non arriva da una lettura: arriva da un cronometro. La domanda era
se la gestione dei file fosse inutilmente complessa, e la risposta misurata è
no — la stratificazione regge, l'apertura a caldo è lineare (96 ms su 5 000
note, 306 ms su 20 000) e una lettura non contesa del workspace costa 68 ns.
Quello che non regge è il versioning, che si aggancia a ogni scrittura e copia
il vault intero per fotografarne una nota: si vede alla prima apertura
(`0227`) e a ogni salvataggio (`0228`). Le due righe restano due perché i due
momenti si misurano con due strumenti diversi e uno può guarire senza l'altro.
Il nono blocco (`0229`) viene dallo stesso cronometro puntato però sul repo
fermo invece che sull'app accesa, e la domanda era se la struttura del progetto
Rust fosse inutilmente complessa. Sugli otto crate la risposta è no, ed è
misurata: il grafo è profondo quattro, senza cicli, `fub-features` dipende dal
solo `fub-abi` e compilare tutte le librerie costa una manciata di secondi. La
riga sola che ne esce è meccanica — tre `crate-type` per 883 righe di sorgente —
mentre l'altra metà della misura chiede di decidere e quindi è una voce, la
[§28.1](roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md#281-ogni-file-di-prova-è-un-eseguibile-e-sono-centoventuno).

**Il numero è quello di `issues.md` e non scala**, per la stessa regola dei `§`:
è citato dai verbali e dai messaggi di commit. I buchi nella sequenza sono le
ventidue righe che non sono sopravvissute alla rilettura. Il conto perciò conta
le **righe**, e da `0100` ha voluto un pattern più largo: quello vecchio si
fermava a `0099` e avrebbe dichiarato meno difetti di quanti ce ne sono.

**L'ancora è al simbolo, non alla riga.** Ogni riga porta il posto misurato al
2026-08-06: i numeri di riga si saranno mossi, il simbolo no. Chi ne prende una
**riconta**, non deduce.

| # | Difetto | Dove | Famiglia |
| --- | --- | --- | --- |
| 0112 | l'anagrafe non ha forma incrementale: `EntryStore::open` deserializza l'intera `BTreeMap<DocId, StoredEntry>` e `EntryStore::store` la riserializza e la sostituisce tutta con una `VaultStorage::write`, così ogni apertura paga il vault intero anche quando non è cambiato un file | `fub-kernel` · `entries.rs` `EntryStore::store` | prestazioni |
| 0113 | il prestito esclusivo di `finish_index` copre in fila cinque fasi, tre delle quali toccano il disco — ricostruzione integrale del grafo, riconciliazione degli indici, flush degli indici, ricongiungimento delle rinomine che cammina l'anagrafe persistita, riscrittura integrale di `entries.json` — così un lettore concorrente aspetta la somma di tutte e cinque e non la sola indicizzazione | `fub-kernel` · `workspace.rs` `Workspace::finish_index` | lock e I/O |
| 0130 | due letture che rispondono con dei dati hanno un comando IPC proprio invece di una variante di `IndexQuery`, e siccome `IndexQuery` non ha una variante di resa e l'`HostApi` non ha una capacità di render, un `ViewProvider` non ha nessuna porta per mostrare un documento reso mentre la shell ne ha due | `fub-app` · `lib.rs` `render_preview` / `render_embed` | regole |
| 0168 | fra la rinomina del documento e la migrazione del suo docdata c'è una finestra di crash non coperta da niente: il file è al nome nuovo e i suoi dati per-documento sono ancora sotto la chiave vecchia, dove la prima `collect` successiva li spazza perché non corrispondono a nessun documento vivo | `fub-kernel` · `workspace.rs` `rename_document_in_batch` (con `docdata.rs` `migrate`) | lock e I/O |
| 0188 | l'indice di ricerca scrive i propri segmenti direttamente sul filesystem invece che attraverso `VaultStorage`, che il repo dichiara **il supporto unico** dei byte: quei file non passano da temp+rename, non passano da lock, non li vede un doppio in memoria, e ogni banco che monta un supporto finto ha un pezzo di vault che gli sfugge | `fub-kernel` · `index` (segmenti tantivy) | regole |
| 0189 | `EntryStore::store` riscrive l'anagrafe senza prendere il lock che le altre riscritture integrali prendono: due processi che chiudono insieme si sovrascrivono l'anagrafe a vicenda, e vince l'ultimo che finisce | `fub-kernel` · `entries.rs` `EntryStore::store` | lock e I/O |
| 0191 | il log del kernel non regge né due processi né il mondo esterno: la rotazione non è protetta fra installazioni e può far perdere il file vecchio, le scritture non sincronizzano mai, e se qualcuno elimina o ruota il file da fuori il `FileSink` non se ne accorge e continua a scrivere in un descrittore morto **per sempre**, cioè proprio quando il log servirebbe per capire cos'è successo | `fub-kernel` · `log.rs` `FileSink` | lock e I/O |
| 0194 | `controlla_path` è solo lessicale: confronta i segmenti come sono scritti e non risolve i link, quindi un symlink piazzato dentro il vault porta una scrittura fuori dal vault passando una guardia che crede di aver controllato | `fub-kernel` · `path` `controlla_path` | regole |
| 0197 | il watcher legge un file mentre qualcuno lo sta ancora scrivendo: non c'è nessuna prova di stabilità — né un secondo `stat` che confermi la stessa dimensione, né un'attesa — quindi un file grande scritto da un'applicazione esterna entra in anagrafe a metà e ci resta finché non arriva un altro evento | `fub-host` · `watcher` (ingestione dell'evento) | lock e I/O |
| 0198 | una rinomina esterna lenta viene spezzata in due dal debounce: se l'evento di partenza e quello di arrivo cadono in due finestre diverse, il montaggio non li riconosce come la stessa mossa, l'identità del documento si perde e con essa la bozza non salvata che ci stava attaccata | `fub-host` · `watcher` (debounce delle rinomine) | regole |
| 0199 | la parte «da» di una rinomina orfana non esce mai: quando l'evento di arrivo manca, quello di partenza resta appeso in attesa del gemello e nessuno lo emette come rimozione, quindi il documento sparito dal disco resta vivo in anagrafe finché non si riapre il vault | `fub-host` · `watcher` (accoppiamento delle rinomine) | regole |
| 0204 | `ricorda_i_tasti_visti` legge l'insieme dei tasti già visti, lo modifica e lo riscrive senza tenerlo fermo in mezzo: due sessioni che imparano un tasto nello stesso momento se ne perdono uno | `fub-host` · `session.rs` `ricorda_i_tasti_visti` | lock e I/O |

## Dove va una regola scritta due volte

La regola va posizionata nel modulo che ha il diritto di imporla
([`util.rs`](../crates/fub-format-markdown/src/util.rs)).

Le case sono cinque:

| Dove | Cosa ci va | Il precedente |
| --- | --- | --- |
| `fub-abi` | ciò che vale per chiunque risolva la stessa domanda: l'ultimo segmento di un path, nome ed estensione, «sta dentro questa cartella», il primo nome libero, l'impronta, gli accessor di `IndexResult` | `heading_slug`, `fub_abi::html` |
| `fub-testkit` | l'impalcatura dei banchi: la cartella usa-e-getta, i provider giocattolo, il montaggio di un vault di prova, la camminata del modello | `TestoDiProva`, `Banco` |
| un modulo privato del crate | ciò che non esce di lì: il controllo di versione dei file di macchina, la fusione sotto lock, il prologo dei comandi | `update_atomic` in `storage.rs` |
| i moduli che il frontend ha già (`ui/`, `rules/`) | la modale, il freno, l'avviso di guasto, il predicato di scopo | `ui/highlight.ts`, `ui/corsa.ts` |
| **nessuna casa — si presidia** | tutto ciò che è scritto una volta in Rust e una in TypeScript | `rules_mirror.rs` → `rules-samples.json` |

Un crate nuovo non costituisce una casa (aggiunge oneri come
`check-cargo-versioni`, `check-cargo-feature-default`).
Le regole gemelle non si estraggono a mano (es. difetto `0224`).

## Come si semplifica la documentazione

Esegui tre mosse obbligatorie.

### 1. Chiudere il glossario (difetto `0225`)

Aggiungi undici voci a [glossario.md](glossario.md), nella sezione `## Il
metodo`.

| termine | volte in `docs/` | cosa vuol dire, in una riga | dove è già usato per esteso |
| --- | --- | --- | --- |
| `banco` | 423 | un test — il tipo `Banco` di `fub-testkit` è il costruttore che quasi tutti usano | [PIANO.md](PIANO.md), `crates/fub-testkit/src/lib.rs` |
| `casa` | 59 | il modulo che ha **il diritto** di imporre una regola, che è dove la regola va scritta una volta sola | la sezione qui sopra, `crates/fub-format-markdown/src/util.rs` |
| `casella` | 367 | ciò che resta da fare dopo che una decisione è chiusa: nessuna scelta, solo lavoro | l'apertura di questo file |
| `difetto` | 530 | qualcosa di misurato nel codice che si ripara senza decidere niente — se la riparazione dipende da una decisione, non è un difetto | l'apertura di questo file |
| `gemella` | 45 | una funzione scritta due volte in due linguaggi che devono restare d'accordo | `crates/fub-abi/tests/rules_mirror.rs` con `frontend/src/rules/rules-mirror.test.ts` |
| `gesto` | 171 | una singola interazione dell'utente — un tasto, un clic, un trascinamento — presa alla grana più fine | [FEATURES.md](FEATURES.md) §32, [microfeatures/](microfeatures/) |
| `grana` | 92 | quanto è fine la misura che si sta facendo: «alla grana del gesto» vuol dire un'osservazione per interazione | questo file, [roadmap/](roadmap/) |
| `innesco` | 13 | l'evento che fa scattare una casella, scritto al posto di una data quando la data non si sa | questo file |
| `lente` | 12 | la domanda stretta con cui si guarda il codice in una seduta, dichiarata **prima** di guardare | questo file, §23.9 |
| `residuo` | 45 | ciò che di una voce non aveva niente da decidere e diventa un difetto o una casella | questo file |
| `specie` | 267 | una delle tre categorie che questo file conta separatamente: voci, caselle, difetti | l'apertura di questo file |

Regole fisse della voce: `DocumentModel` · [`file`](roadmap/numerazione.md) ·
[verbale](decisions/README.md). Due o tre righe massime, usa
[check-doc-links](../.github/scripts/check-doc-links.mjs). Le eccezioni in
`glossario.md` e [README.md](README.md) vanno aggiornate col commit `441d376`.

### 2. Il file d'ingresso (difetto `0226`)

Crea il file `docs/leggimi-prima.md`.
Requisiti: scrivi per studenti, omettendo dettagli architetturali (vedi
[architecture/mappa-visuale.md](architecture/mappa-visuale.md)). Contenuto:
cos'è Fub, com'è diviso, elenco di quattro documenti (`decisions/`, `todo.md`,
`architecture/`, `FEATURES.md`), dizionario del dialetto. Sviluppo delegato a
[CONTRIBUTING.md](CONTRIBUTING.md).

Aggiorna [README.md](README.md) (punta a `leggimi-prima.md` e a `PIANO.md`).
Aggiorna [PIANO.md](PIANO.md). Attenzione ai due numeri testuali: vanno cambiati
manualmente.

### 3. La sostituzione dei termini — che è una decisione, non un difetto

Rinominare `banco` a `test` (423 occorrenze) non è un difetto (`0143`). Si
richiede l'apertura della seduta 27. Valutazioni richieste:

1. `docs/decisions/` raccoglie 143 verbali, cioè quasi due terzi dei file di
   `docs/`. Il divieto di toccarli non c'è più — la
   [0143](decisions/0143-i-verbali-si-possono-riscrivere.md) distingue contenuto
   da forma ([CONTRIBUTING.md](CONTRIBUTING.md)) — ma resta il costo: una
   sostituzione di termine passa su tutti e 143.
2. Terminologia radicata nei nomi (`roadmap/16-crate-sdk-banchi-di-prova.md`,
   `roadmap/17-presidi-che-restano.md`,
   `crates/fub-abi/tests/una_sola_tabella_di_escape.rs`). Usa `check-doc-links`
   per ricalcolare 4.572 link.
3. `presidio` indica una classe di regressione (`una_sola_impronta.rs`).

## Gli allegati

- [Le voci a leva più alta](roadmap/leva.md)
- [Dove il contratto si strozza](roadmap/strozzature.md)
- [Corrispondenza fra la numerazione vecchia e questa](roadmap/numerazione.md)
- [I verbali delle decisioni chiuse](decisions/README.md) —
  **centoquarantotto** [conta: verbali], uno per file. Diceva
  «cinquantasette» quando erano cinquantanove, e il comando che lo ricava era
  già scritto qui accanto senza che nessuno lo eseguisse: dalla
  [0072](decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) lo
  esegue la CI.
