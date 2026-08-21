# 0100 — I tasti che arrivano da fuori

**Data:** 2026-08-05
**Voce:** [§23.13](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2313-un-vault-che-arriva-da-fuori-rimappa-la-tastiera)
**Commit:** *(questo commit)*

## Il fatto

La [0076](0076-le-impostazioni-vivono-nel-vault.md) ha messo le impostazioni
dentro il vault, e nel farlo ha smontato l'argomento di rischio con una frase
che quel giorno era vera: un vault che decide il tema, la lingua e il formato
dell'ora di chi lo apre fa una cosa **visibile e reversibile**. La
[0077](0077-una-scorciatoia-e-una-chiave.md) ha poi fatto di una scorciatoia una
chiave di impostazione — `keys.<comando>` — senza chiamare `per_machine()`, cioè
dentro il vault come tutte le altre.

Il prodotto delle due non è tema e lingua. Un vault che arriva da fuori — un
repo clonato, una cartella condivisa, un vault di esempio scaricato — **rimappa
i tasti di chi lo apre**, e la differenza con il tema non è di grado: un tema
sbagliato si vede, una scorciatoia spostata si scopre premendola.

Adesso una scorciatoia che arriva dal file di un vault e che **questa macchina
non ha mai visto** è *sospesa*: il valore c'è, il file non si tocca, e finché
nessuno risponde vale il default. La shell lo dice all'apertura e lo mostra nel
pannello, e la risposta si dà **una chiave alla volta**. Nessuna firma cambia,
nessun tipo nuovo, nessuna riga di WIT: nessun ritaglio.

## Tre premesse della voce, rilette e cadute

La voce proponeva tre strade. Rileggerla contro i verbali venuti dopo di lei ne
ha falsificate due e ha spostato il criterio della terza.

**La prima** — le scorciatoie diventano `per_machine()` — è peggio di come la
voce la descrive. Non costa soltanto la cosa buona della 0077 (portarsi la
propria tastiera da una macchina all'altra): fa **mentire il vocabolario**. Oggi
`SettingScope::Machine` vuol dire che il valore scritto nel vault viene ignorato
con un avviso, e la 0076 ha riservato quella parola a una proprietà vera — *«non
può dipendere da un vault aperto»* — che di una scorciatoia è falsa. Una
scorciatoia dipende eccome da chi apre, ed è precisamente per questo che è un
problema.

**La seconda** — restano nel vault ma il livello macchina vince — la voce la dà
per esistente: *«è già la forma dei due livelli della 0036 letta al contrario»*.
Non lo è più. La 0036 aveva la scala, la **0076 l'ha cancellata apposta**, con
l'argomento che un valore di macchina rimasto lì che vince sul default di un
vault è «esattamente il caso storto». Rimetterla per una famiglia sola significa
riscrivere «prima guardo qui, poi lì» dentro `resolve` per una famiglia sola: è
la cosa che la 0076 ha tolto.

**La terza** è quella giusta, ma il suo criterio no. La voce dice «un vault
**mai visto**», e non è la domanda. Un vault aperto ieri può ricevere tasti
nuovi stanotte da un client di sync; e la riga nel registro nasce alla **prima**
`note_opened`, che nessuno abbia mai risposto a niente. La domanda che regge
tutti e due i casi è *«ho già visto **questi** tasti»*, e si risponde
confrontando il valore di ieri con la lettura di oggi — la forma della
[0099](0099-una-rinomina-che-non-ha-visto-nessuno.md), scritta ieri per la
rinomina ad app chiusa.

## Il criterio che mancava: tre specie, non due

La voce chiedeva la riga che separa le impostazioni che descrivono **il vault**
da quelle che descrivono **chi lo guarda**. Misurata sulle chiavi che esistono,
quella riga taglia nel posto sbagliato: il tema descrive chi guarda e non fa
danno. Le specie sono tre, e si distinguono per **che cosa può fare il valore
peggiore**:

1. **Una sottrazione non concede.** `plugins.disabled`, le chiavi
   `<plugin>:permissions.<nome>` della
   [0098](0098-un-permesso-si-vede-e-si-nega.md): il caso peggiore è che il
   vault spenga qualcosa, e il risultato è il default che l'utente ha già
   accettato.
2. **Si vede e si disfa.** Tema, `locale.*`, pesi della ricerca, feature accese:
   la frase della 0076, che per questa specie resta vera.
3. **Cambia cosa fa un gesto dell'utente.** Oggi solo `keys.*`. Il valore non si
   vede finché non lo premi, e quando lo premi è già successo.

La regola sta scritta accanto al codice che la applica, in
`fub_host::settings::tasti_da_guardare`: *una chiave che viaggia col vault può
cambiare ciò che l'app mostra e ciò che l'app fa da sé; non ciò che fa un gesto
di chi la apre, finché quel gesto non è stato guardato.*

## Il prezzo, misurato invece che stimato

Tre misure sul codice, e la prima ribalta il senso della voce.

**Un vault che arriva da fuori non sposta le scorciatoie: le arma.** Fra tutti i
comandi registrati, `vault.undo` è **l'unico** che dichiari una scorciatoia
(`Mod-Alt-z`, dalla [0045](0045-l-undo-ha-due-pile.md)). Tutti gli altri comandi
del kernel nascono senza tasto: un vault estraneo non ruba un tasto a qualcosa
che c'era, dà un tasto a qualcosa che non ne aveva. È peggio, non meglio — il
gesto è nuovo e non c'è nessuna abitudine che protegga.

**Il comando che spaventa è a portata di un tasto solo.** `trash.empty` non ha
parametri e porta `.irreversible()`: una scorciatoia lo fa partire, senza una
riga da riempire in mezzo. Non è un'ipotesi sul futuro, è la superficie di oggi.

**La porta più grossa era già chiusa.** `settings.import` passa da
`program_writable`, quindi un vault non può scriversi le impostazioni degli
altri attraverso un comando. Il buco era solo il proprio file, che è già
abbastanza.

E un dettaglio d'ordine che valeva la pena verificare: in `allCommands()` i
comandi del kernel vengono prima, quindi una chiave del vault vince sulla
scorciatoia della shell, non il contrario.

## Sospendere, e chi sospende

Il meccanismo è una riga in `SettingsStore` e non è del kernel decidere quali
chiavi:

- il negozio tiene un insieme di chiavi **sospese**; in `resolve` una chiave
  sospesa di livello vault risponde come se il file non la contenesse
  (`SettingSource::Default`);
- **chi sospende non è quel modulo.** La regola sta in `fub-host`, che è l'unico
  posto che vede insieme il file del vault e il registro della macchina — cioè
  l'unico che possa fare il confronto;
- il registro dei vault guadagna un campo, `keys_seen`, che è **l'unico campo
  che non descrive il vault** ma il rapporto fra quella macchina e quel vault.
  Sta lì perché lì c'è già una riga per vault, e perché `forget` lo porta via
  col resto.

Il confronto è una funzione pura di due mappe, e guarda **quel che è cambiato,
non quel che è comparso**: una chiave già vista con lo stesso accordo non chiede
niente, la stessa chiave con un accordo diverso richiede.

## Scrivere risveglia, e una alla volta

La regola che vale più di tutte in questa decisione: **la risposta si dà una
chiave alla volta**. Non c'è un «sì» che adotti tutto il file.

- il pannello e l'avviso mostrano le chiavi in sospeso una per una, col titolo
  del comando e l'accordo proposto;
- «Usa quelle del vault» adotta **le chiavi mostrate**, non l'insieme dei
  sospesi — perché nel frattempo può essercene arrivata un'altra, e adottare ciò
  che non è stato mostrato è il sì per sbaglio che questa voce esiste per
  impedire;
- «Tieni le mie» azzera le chiavi mostrate, cioè **le toglie dal file** invece
  di lasciarle lì a richiedere all'apertura dopo;
- scrivere una chiave la risveglia, da sola. Chi rimappa a mano un comando
  mentre ne ha cinque in sospeso adotta quello e nient'altro.

Una chiave che il vault propone per un comando che **non esiste** su questa
macchina — un plugin spento, un componente non installato — non si mostra e
resta sospesa: risorgerà il giorno in cui quel componente si accende, che è il
giorno in cui la domanda ha senso.

## Il difetto che la misura ha trovato accanto

Rimappare un comando dal pannello e poi premere la combinazione nuova **non
faceva niente** fino alla riapertura della palette. La shell caricava le
scorciatoie all'avvio e mai più: nessuno riascoltava `setting_changed`. Non è un
caso di frontiera di questa voce, è la 0077 che non chiudeva il cerchio, e si
vedeva solo perché qui bisognava per forza scrivere una chiave e premerla
subito. Un `mountKeyOverrides()` accanto agli altri montaggi, e la regola vale
per tutti i chiamanti perché sta nel posto che tutti attraversano.

Accanto ce n'era un secondo, trovato da un controllo negativo diventato rosso:
scrivere una scorciatoia dal pannello toglieva la sospensione **in memoria**
senza mai aggiornare `keys_seen`, e alla riapertura Fub chiedeva di adottare una
scorciatoia che l'utente aveva scritto di suo pugno. È il falso positivo che
insegna a cliccare via le domande — cioè il modo esatto in cui un cancello
smette di valere. La correzione è una **porta della persona** nell'host
(`set_setting_for_user` / `reset_setting_for_user`, per cui passa la shell), che
ricorda; il kernel continua a non sapere niente di chi ha scritto.

## Cosa NON è questa decisione

Non è un permesso, e a M4 non lo diventa: il valore di un cancello qui è la
**dichiarazione**, non l'imposizione. Non c'è nessuna chiave che un vault non
possa contenere, e non c'è nessuna sandbox — un vault non esegue codice, e chi
ne apre uno altrui si fida già del suo contenuto. Ciò che è cambiato è che la
fiducia richiesta era **cresciuta senza che nessuno lo dichiarasse**, e adesso
la dichiara chi la richiede.

Non riapre la 0076, che resta giusta per la sua specie di chiavi; non tocca
`SettingScope`, che è nel WIT congelato; non introduce una scala fra livelli. E
non è la §16.3: quando la tastiera della shell diventerà configurabile come le
altre, i comandi rimappabili dall'esterno saranno tutti, e questa domanda li
coprirà senza cambiare forma — è per quello che sta sulla chiave e non
sull'elenco dei comandi.

## Il presidio

Otto test nuovi in `crates/fub-host/tests/tasti_da_fuori.rs`, su vault veri con
un `settings.json` scritto a mano: un vault mai visto non preme i tasti;
adottare vale adesso e al prossimo avvio; rifiutare toglie la chiave dal file;
un accordo cambiato ad app chiusa si richiede; scriverne una non adotta le
altre. Tre di questi otto sono **controlli negativi** — le scorciatoie scritte
qui viaggiano ancora col vault, un tema che arriva da fuori si applica ancora,
un vault che non porta tasti non fa domande — e devono restare verdi: sono la
prova che il cancello non ha chiuso la 0076 e la metà buona della 0077.

Sabotaggio: tolta la riga che sospende in `Host::open`, quattro degli otto
diventano rossi e i tre controlli negativi restano verdi.

Accanto: il round-trip fra `keybinding_key` e il suo gemello inverso in
`fub-abi`, con la lista negativa delle chiavi che *non* sono scorciatoie;
quattro test nel kernel sulla sospensione e sui due modi di risvegliarla; due
nella shell sul riconoscimento della chiave. La superficie IPC cresce di tre
comandi, e i tre portano la loro giustificazione nella dieta.

## Cosa resta fuori

`pending_keybindings` non è una `IndexQuery` e non poteva esserlo: la risposta
non si deriva dal vault, si deriva dal file del vault **accanto** a ciò che
questa macchina ha visto, che vive nel registro dei vault — fuori da ogni vault
([0029](0029-chiudere-un-vault-e-chiuderli-tutti.md)).

`keys_seen` sostituisce, non fonde: dopo una risposta contiene esattamente i
tasti del file che non sono sospesi. Una chiave tolta dal file sparisce anche da
lì, e se torna domani torna a essere una domanda. È voluto — «ho già visto
questo accordo per questa chiave» è un fatto sul file di adesso, non una memoria
che cresce.

Resta fuori la terza specie oltre `keys.*`: oggi non ce n'è un'altra, e la
regola è scritta perché quando ne nascerà una si sappia dove va. E resta fuori
il caso di due macchine che rispondono diverso allo stesso vault: è il
comportamento giusto — la risposta è di chi guarda — ma nessuno gliel'ha ancora
chiesto.
