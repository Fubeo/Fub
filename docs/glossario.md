# Glossario

Il lessico di Fub è preciso e **non è standard**: lotto, porta, ponte, anagrafe,
sidecar, superficie, revisione, ricongiungimento, derivato, autorevole. Ogni
parola è stata scelta per dire una cosa sola, quasi sempre in un verbale, e da lì
è finita nei nomi dei tipi, nei commenti e nei messaggi di commit. Chi arriva la
incontra prima di incontrare la sua definizione.

Questo file la raccoglie. **Non è una spiegazione dell'architettura**: per quella
c'è [architecture/](architecture/), e ogni voce qui sotto rimanda al documento
che tratta la cosa per esteso. Qui c'è la frase minima che permette di leggere
gli altri documenti senza fermarsi.

Le parole del **metodo** — come questo repo organizza il proprio lavoro — non
stanno qui: sono in [leggimi-prima.md](leggimi-prima.md).

## Come si legge

Ogni voce ha la stessa forma:

> ### il termine
> `TipoRust` · [`file.rs:riga`](../crates/fub-abi/src/lib.rs) · [verbale](decisions/README.md)
>
> Cos'è, in due o tre righe.

Le tre coordinate non sono decorazione:

- Il **tipo** è il nome da cercare nei sorgenti.
- Il **file** è un link vero, quindi il
  [check dei link](../.github/scripts/check-doc-links.mjs) diventa rosso se quel
  file si sposta o sparisce. Un glossario che invecchia in silenzio sarebbe
  peggio di nessun glossario.
- Il **verbale** è dove sta il perché, che qui non si ripete.

Il numero di riga è indicativo e nessuno lo controlla: si muove a ogni modifica
del file, ed è lì per far atterrare la ricerca vicino, non per essere esatto. Il
nome del tipo, quello, è esatto.

**Non c'è un indice alfabetico.** Sarebbe un secondo elenco degli stessi
termini, e una voce dimenticata lì dentro non romperebbe niente: si cerca con
`Ctrl-F`, che è quello che si fa comunque in un glossario. Le famiglie sono
sei, in ordine di quanto presto le si incontra, e dentro ognuna i termini sono
in ordine alfabetico.

| Famiglia | Cosa raccoglie |
|---|---|
| [Il documento](#il-documento) | ciò che sta dentro una nota, una volta parsata |
| [Il vault](#il-vault) | ciò che sta sul disco, e ciò che il kernel se ne ricorda |
| [Il contratto e il confine](#il-contratto-e-il-confine) | come si estende Fub, e cosa si può negare a chi la estende |
| [Il canale dati](#il-canale-dati) | come si fa una domanda al kernel e chi risponde |
| [Gli eventi e il lavoro lungo](#gli-eventi-e-il-lavoro-lungo) | come si racconta che qualcosa è cambiato, o sta ancora succedendo |
| [L'interfaccia](#linterfaccia) | come il core descrive una vista e la shell la disegna |

---

## Il documento

### ancora
`Anchor` · [`abi/model.rs:776`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

L'identificatore che un blocco si porta dentro il testo — la forma `^id` in coda
a un paragrafo — perché un link possa puntare a *quel* punto e non alla nota
intera. Ogni blocco ha un `anchor: Option<String>` con un accessore totale. Le
regole di forma (`canonical_anchor`, `valid_anchor`) stanno in `rules/`, dove
vanno le regole condivise con la shell.

### blocco
`Block` · [`abi/model.rs:316`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

L'unità di primo livello del documento: paragrafo, titolo, lista, tabella,
citazione, blocco di codice, riga orizzontale, e l'escape hatch `Custom`. È un
enum chiuso di proposito: ciò che nessun formato conosce passa da `Custom`
invece di allargare l'enum a ogni formato nuovo.

### frontmatter
`Frontmatter` · [`abi/model.rs:192`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

Il blocco YAML in testa a una nota, proiettato su JSON. L'ordine delle chiavi si
conserva (`serde_json` con `preserve_order`), perché riscrivere un file
dell'utente non deve riordinargli le proprietà: è fedeltà, non estetica.

### inline
`Inline` · [`abi/model.rs:512`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

Ciò che sta *dentro* un blocco: testo, enfasi, codice, link, immagine, tag,
interruzione. Stessa logica del blocco, incluso il `Custom`.

### modello del documento
`DocumentModel` · [`abi/model.rs:243`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

Il documento parsato in una forma che **nessun formato possiede**: né markdown
né altro. È il centro dell'idea architetturale — il kernel lavora su questo, e il
markdown è solo il primo provider che sa produrlo. Dettaglio in
[architecture/data-model.md](architecture/data-model.md).

### proprietà
`PropertyValue` · [`abi/model.rs:1126`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md)

Un valore del frontmatter letto con un tipo invece che come JSON nudo: scalare,
data, ora, lista. Serve a chi interroga (ordinare per data, filtrare per stato)
senza costringere ogni consumatore a indovinare che forma abbia una chiave.

### revisione
`Revision` · [`abi/edit.rs:168`](../crates/fub-abi/src/edit.rs) · [0008](decisions/0008-modifica-chirurgica.md)

L'identità del testo su cui si sta per calcolare una modifica. È **opaca**: solo
l'uguaglianza è contratto, come l'host la derivi non è promesso a nessuno.
Serve a fare in modo che una modifica calcolata su un testo non venga applicata
a un altro.

### sorgente
`String` · [`abi/model.rs:22`](../crates/fub-abi/src/model.rs) · [0058](decisions/0058-un-nome-che-nasce.md)

I **byte del file decodificati, integralmente**: il BOM se c'era, i terminatori
di riga come stanno sul disco, nessuna normalizzazione. È ciò che
`read_document` restituisce, ciò su cui la [revisione](#revisione) è calcolata,
ciò che `write_document` scrive, e il sistema di coordinate di ogni
[span](#span).

La parola ha una voce sua perché l'altra lettura possibile — «un testo già
normalizzato» — è indistinguibile da questa. Se ne accorge solo quando un
provider calcola degli offset su una e l'host li applica sull'altra.

### span
`Span` · [`abi/model.rs:169`](../crates/fub-abi/src/model.rs) · [0003](decisions/0003-modello-del-documento.md), [0058](decisions/0058-un-nome-che-nasce.md)

L'intervallo di [sorgente](#sorgente) da cui un nodo del modello proviene, in
**byte**. È ciò che rende possibile la live preview: la decorazione CodeMirror
sa a quali byte del file attaccarsi perché il modello se li ricorda. Che cosa
sia quella sorgente è la 0058, e non è un dettaglio: gli span di due parti che
la intendono diversamente cadono in punti diversi dello stesso file.

### wikilink
`LinkTarget::Wiki` · [`abi/model.rs:550`](../crates/fub-abi/src/model.rs) · [0004](decisions/0004-il-grafo-e-i-link-non-wiki.md)

Il link in stile Obsidian `[[Pagina#Titolo^blocco]]`, con i tre pezzi separati
nel contratto. La risoluzione segue le regole di Obsidian — nome, alias, path, e
shortest-path fra omonimi — ed è l'unica specie di link che il grafo conosce (il
perché, e il prezzo, stanno nella 0004).

Fra gli omonimi le chiavi sono **due** e fanno due lavori diversi:

- `resolution_key`
  ([`abi/rules/path.rs:48`](../crates/fub-abi/src/rules/path.rs)) fa trim, NFC e
  minuscolo, e dice **chi è candidato**.
- `exact_key` ([`abi/rules/path.rs:65`](../crates/fub-abi/src/rules/path.rs)) fa
  trim e NFC senza minuscolare, e dice **chi ha ragione fra i candidati**. È la
  scelta che prima toccava all'ordine ASCII.

Dove nemmeno quella può decidere — due file che differiscono per una maiuscola
nella **radice** del vault, dove nessun wikilink disambigua — non si sceglie
affatto: lo dice `HealthCheck::CollidingPaths`
([0107](decisions/0107-il-caso-di-una-lettera.md)).

---

## Il vault

### anagrafe
`VaultEntry` (il tipo del contratto) reso durevole da `EntryStore` · [`kernel/entries.rs:177`](../crates/fub-kernel/src/entries.rs) · [0046](decisions/0046-l-anagrafe-del-vault.md)

Ciò che il kernel si ricorda di ogni file per **non doverlo rileggere**:
frontmatter, outline, e quanto basta a decidere se il file su disco è ancora
quello di prima. Salta la rilettura con `mtime` + `size`, che bastano a saltare
ma non a fidarsi — è il caso *racily clean* di git.

Elenca ciò che **esiste**, che non è ciò che è **indicizzato**: dalla
[0068](decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md) un documento
che non si è potuto leggere resta in anagrafe e non arriva a nessun indice.

### autorevole
`FUB_DIR` · [`kernel/vault.rs:32`](../crates/fub-kernel/src/vault.rs) · [0048](decisions/0048-una-radice-sola.md)

Un dato che, perso, **non si ricostruisce da niente**: l'organizzazione della
sidebar, le impostazioni del vault, gli snapshot del versioning. Chi lo tiene,
se non riesce a leggerlo, **non lo sovrascrive**. Oggi la classe non è dicibile
nel contratto e si legge dal path — direttamente sotto `.fub/` — che è il §15.4
ancora aperto per metà. Il suo opposto è [derivato](#derivato).

### cestino
`TrashEntry` · [`abi/traits.rs:144`](../crates/fub-abi/src/traits.rs) · [0003](decisions/0003-modello-del-documento.md)

Dove finisce ciò che si cancella dall'app, con il path originale per rimetterlo
dov'era. Vive in `.trash/` dentro il vault. Insieme al versioning è la rete di
sicurezza dell'utente, ed è per questo che [SECURITY.md](SECURITY.md) tratta un
percorso che la aggira come un problema di sicurezza e non come un bug.

### derivato
`data_root` · [`kernel/vault.rs:49`](../crates/fub-kernel/src/vault.rs) · [0048](decisions/0048-una-radice-sola.md)

Un dato che si può **buttare e rifare** dal vault: l'indice di ricerca,
l'anagrafe, le cache. Chi lo tiene, se non riesce a leggerlo, non avvisa
nessuno: lo rifà. Vive sotto `.fub/data/`, ed è l'unico posto in cui la sua
classe è scritta.

Non dice «senza valore» ma «ricostruibile». Che sotto quella radice ci sia anche
roba che nessuno saprebbe rifare — gli snapshot del versioning — è il problema
che il §15.4 esiste per togliere. Il suo opposto è [autorevole](#autorevole).

### entry
`VaultEntry` · [`abi/traits.rs:203`](../crates/fub-abi/src/traits.rs) · [0046](decisions/0046-l-anagrafe-del-vault.md)

**Ogni file del vault**, non solo le note: un PNG, un PDF e un `.md` sono tutti
entry. La distinzione fra loro non si salva su disco — dipende da chi è
registrato adesso, e un file diventa una nota il giorno in cui qualcuno sa
parsarlo.

### esclusione
`IgnorePolicy` · [`kernel/ignore.rs:214`](../crates/fub-kernel/src/ignore.rs) · [0110](decisions/0110-la-struttura-non-e-una-preferenza.md)

Cosa di una cartella **non** fa parte del vault, e sono **due** cose che non si
somigliano:

- La *preferenza* è dato di questo vault e si dichiara: le cartelle escluse
  (`files.excluded-folders`) e se i file nascosti siano documenti
  (`files.show-hidden`).
- La *struttura* — `.fub/`, `.trash/`, il temporaneo di una scrittura — non la
  dichiara nessuno e nessuna impostazione la rivela: mostrarla vorrebbe dire
  indicizzare l'indice e riesumare il cestino.

Le due porte che la chiedono sono la scansione e il watcher, e chiedono alla
stessa politica. Un nome dichiarato e un nome che arriva dal disco si
confrontano per **chiave** (`resolution_key`,
[`abi/rules/path.rs:48`](../crates/fub-abi/src/rules/path.rs)) e non per byte:
la stessa dichiarazione deve escludere la stessa cartella su ogni macchina da
cui il vault si apre, e `Node_Modules` su macOS è la cartella che
`node_modules` nomina.

### finestra di conservazione
`journal.retention.days` · [`kernel/journal.rs:193`](../crates/fub-kernel/src/journal.rs) · [0103](decisions/0103-un-registro-dice-cosa-e-successo.md)

Per quanti giorni una riga resta nel [registro delle
mutazioni](#registro-delle-mutazioni): fuori dalla finestra cade, qualunque sia
il conto. **Zero — il default — vuol dire per sempre**, perché il registro è
[autorevole](#autorevole) e accorciare da soli un dato che non si ricostruisce
da niente, in un vault che si è appena aggiornato, non è difendibile.

Non è il tetto dei diecimila record, che resta e non è la stessa cosa: quello è
una scadenza che dipende da quanto si scrive, questa da cosa si vuole tenere.
Vale da quando è dichiarata e da lì a ogni volta che la si cambia — chi la
stringe a trenta giorni lo fa per far cadere ciò che c'è **adesso**.

### folder note
— · [`frontend/src/rules/organizer.ts`](../frontend/src/rules/organizer.ts) · [0038](decisions/0038-il-kernel-possiede-il-sidecar.md)

La nota che *è* la sua cartella: aprendo la cartella si apre lei. Convenzione
presa da make.md, e una delle regole che stanno in `rules/` perché il Rust e la
shell devono applicarla nello stesso modo.

### impronta di una modifica
`EditFootprint` · [`kernel/journal.rs:318`](../crates/fub-kernel/src/journal.rs) · [0103](decisions/0103-un-registro-dice-cosa-e-successo.md)

Ciò che il [registro](#registro-delle-mutazioni) tiene di una modifica
chirurgica: **dove** ha toccato — lo [span](#span) — e **quanti** byte c'erano
al suo posto, mai quali.

Ha preso il posto dell'inverso dell'edit, che erano i byte appena sostituiti
dall'utente conservati in chiaro dentro un file che sopravviveva alla nota da
cui venivano. Anche il nome è parte della decisione: `inverse` prometteva di
poter tornare indietro, e un nome che lo promette prima o poi qualcuno prova ad
applicarlo. Si perde la facoltà di disfare un edit da lì — mai esercitata,
perché l'annullamento vero è l'[undo a due pile](#undo-a-due-pile), in memoria —
e si guadagna un conto che l'inverso perdeva: quanti edit erano.

### organizzazione
`Organization` · [`abi/organization.rs:61`](../crates/fub-abi/src/organization.rs) · [0038](decisions/0038-il-kernel-possiede-il-sidecar.md)

Come l'utente ha disposto la sidebar: icone, note appuntate, ordine manuale,
spazi. Non è nel vault come contenuto, sta nel *sidecar*, e dalla 0038 è il
kernel a possederlo — con la migrazione al rename inclusa.

### registro delle mutazioni
`Journal` / `JournalOp` · [`kernel/journal.rs:272`](../crates/fub-kernel/src/journal.rs) · [0067](decisions/0067-il-registro-di-cio-che-e-successo.md), [0103](decisions/0103-un-registro-dice-cosa-e-successo.md)

`.fub/journal.jsonl`: una riga per ogni mutazione che il kernel ha fatto al
vault — quando, chi l'ha chiesta (l'[origine](#origine)), dentro quale
[lotto](#lotto), e quale nota è stata creata, salvata, modificata, cestinata,
ripristinata o rinominata. È [autorevole](#autorevole), si scrive in coda dopo
che la mutazione è riuscita, porta la versione di schema **su ogni riga** e
**non si spegne**: un registro che si può perdere non serve a niente.

Dice cosa è successo, **non cosa c'era scritto**: dalla 0103 il testo
dell'utente non ci passa più nemmeno per una modifica chirurgica, dove resta
l'[impronta](#impronta-di-una-modifica). Ciò che ne rimane — i path e i tempi —
ha una [finestra di conservazione](#finestra-di-conservazione) che l'utente
dichiara e un comando che lo svuota, `vault.clear-journal`.

### ricongiungimento
`rejoin_renamed_while_closed` · [`kernel/workspace.rs:6432`](../crates/fub-kernel/src/workspace.rs) · [0099](decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md)

Riconoscere all'apertura una nota **rinominata mentre Fub era chiuso**: sparita
da un path e ricomparsa sotto un altro con la stessa impronta, quindi la stessa
nota.

Serve perché il path è la chiave
([0043](decisions/0043-il-path-e-la-chiave.md)) e chi rinomina da fuori — un
client di sync, il Finder — scollegherebbe la bozza non salvata, le versioni e
lo spazio per-documento. Accoppia **uno a uno o niente**, e nel dubbio non
accoppia *e non raccoglie*: fra le due mosse, quella irreversibile si sospende.

### sidecar
`.fub/workspace.json` · [`kernel/organization.rs:74`](../crates/fub-kernel/src/organization.rs) · [0038](decisions/0038-il-kernel-possiede-il-sidecar.md)

Il file accanto al vault che tiene ciò che riguarda il vault ma non è contenuto
di nessuna nota. Sta in `<vault>/.fub/`, cioè direttamente nella radice unica e
non sotto `data/`, perché è [autorevole](#autorevole); viaggia col vault se lo
si copia, e porta un numero di schema (vedi
[versionamento.md](versionamento.md)).

### sospensione
`tasti_da_guardare` · [`host/settings.rs:84`](../crates/fub-host/src/settings.rs) · [0100](decisions/0100-i-tasti-che-arrivano-da-fuori.md)

Una chiave che sta nel file del vault ma **non vale ancora**: il valore c'è, il
file non si tocca, e `resolve` risponde il default finché qualcuno non decide.

Serve per una specie sola di impostazioni — quelle che **cambiano cosa fa un
gesto dell'utente**, cioè oggi le sole `keys.*` — perché un tema che arriva da
un vault altrui si vede e si disfa, una scorciatoia si scopre premendola. Chi
sospende non è il kernel ma l'host, l'unico che veda insieme il file del vault e
i tasti che questa macchina ha già visto; e la risposta si dà **una chiave alla
volta**.

### spazio
— · [`frontend/src/panels/explorer.ts`](../frontend/src/panels/explorer.ts) · [0038](decisions/0038-il-kernel-possiede-il-sidecar.md)

Una vista salvata della sidebar: un sottoinsieme del vault con una radice e un
ordine propri. Sta nell'organizzazione, quindi nel sidecar.

### spazio dati
`DataRead` / `DataWrite` · [`abi/traits.rs:694`](../crates/fub-abi/src/traits.rs) · [0013](decisions/0013-elenco-delle-capacita.md)

La cartella privata di un componente, dove tiene ciò che non è una nota: un
indice, una cache, un manifest. È `.fub/data/plugins/<id>/`, l'host la assegna e
la impone, e ci si accede per path relativo. Le due metà — leggere e scrivere —
sono capacità distinte perché negarle vuol dire due cose diverse.

Che oggi sia una sola e valga per entrambe le classi è il §15.4: la
[0048](decisions/0048-una-radice-sola.md) ha scelto la forma — una seconda
famiglia per il derivato — e non l'ha ancora scritta.

### vault
`Vault` · [`kernel/vault.rs`](../crates/fub-kernel/src/vault.rs) · —

Una cartella di file markdown, aperta come spazio di lavoro. È il termine di
Obsidian e vuol dire la stessa cosa: **nessun formato proprietario, nessun
database**, i file restano file.

Il vault contiene due alberi che non sono contenuto:

- `.fub/`, la **radice unica** di ciò che Fub scrive
  ([0048](decisions/0048-una-radice-sola.md)) — in cima l'autorevole, sotto
  `data/` il derivato.
- `.trash/`, che sta fuori perché è il cestino **condiviso con Obsidian**.

La mappa è
[architecture/on-disk-layout.md](architecture/on-disk-layout.md).

### versione di schema
`SchemaVersion` · [`abi/schema.rs:76`](../crates/fub-abi/src/schema.rs) · [0106](decisions/0106-un-formato-si-presenta.md), [0128](decisions/0128-una-versione-di-schema-e-un-tipo.md)

Quale **formato** sono i byte di un file che Fub ha scritto. Ce n'è una per
formato e sono indipendenti fra loro (undici oggi, la tabella è in
[versionamento.md](versionamento.md#3-le-versioni-degli-schemi-su-disco)): gli
schemi cambiano in momenti diversi, e legarli vorrebbe dire migrare dieci file
per una modifica a uno.

È un **tipo** e non una costante che si è chiamata bene: finché il controllo che
le cerca guardava il nome, una versione chiamata in un altro modo gli passava
accanto senza che nessuno avesse sbagliato niente. Su disco resta un intero nudo
(`#[serde(transparent)]`), perché quei file sono già sui dischi delle persone.

### versioning
`SCHEMA_VERSION` · [`features/versioning.rs:254`](../crates/fub-features/src/versioning.rs) · —

Gli snapshot che Fub tiene di ogni nota mentre la si modifica: la memoria di
com'era il file prima. Vive in `.fub/data/`, che è ignorato da git — anche in
questo repo, dove `docs/` è aperta come vault di prova. Sta sotto la radice del
[derivato](#derivato) e non lo è: è il caso che il §15.4 porta come prova.

---

## Il contratto e il confine

### additività
— · [`abi/tests/wit_additivity.rs`](../crates/fub-abi/tests/wit_additivity.rs) · [0002](decisions/0002-additivita-del-contratto.md)

La promessa che dopo il freeze il contratto **cresca solo per aggiunta**: un
campo in fondo a un record, un caso in fondo a un variant, una funzione nuova.
Cosa conta esattamente come aggiunta sta in
[architecture/wit-congelato.md](architecture/wit-congelato.md), ed è verificato
a ogni push contro la linea di base congelata.

### bundle
`Bundle` · [`host/registry.rs:55`](../crates/fub-host/src/registry.rs) · [0031](decisions/0031-chi-possiede-i-bundle.md)

Un pacchetto di provider che si monta e si smonta insieme: la feature nativa dei
backlink è un bundle, e a M5 lo sarà un plugin WASM. Esiste perché montare
doveva avere **una strada sola**, la stessa per chi è nativo e per chi non lo è.

### capacità
`HostApi` · [`abi/traits.rs:1438`](../crates/fub-abi/src/traits.rs) · [0013](decisions/0013-elenco-delle-capacita.md), [0021](decisions/0021-il-confine.md)

Ciò che un componente può chiedere all'host: leggere il vault, scriverlo,
cambiarne la struttura, leggere i propri dati, emettere eventi, interrogare
l'indice, invocare comandi, sapere che ora è. Sono venticinque, e non stanno in
un trait solo — vedi [famiglia](#famiglia).

### confine
— · [architecture/plugin-boundary.md](architecture/plugin-boundary.md) · [0021](decisions/0021-il-confine.md)

La linea fra il kernel e chi lo estende. Oggi è una linea di tipi, perché ogni
provider è codice nativo compilato nello stesso binario. A M5 diventa il confine
di un componente WASM, e la 0021 esiste per fare in modo che le due cose abbiano
la **stessa firma**, non due discipline scritte due volte.

### contratto
`fub-abi` · [`abi/src/lib.rs`](../crates/fub-abi/src/lib.rs) · —

L'insieme dei tipi e dei trait definiti **una volta sola** in `fub-abi`, di cui
il markdown è solo il primo provider e il WASM sarà solo l'ultimo consumatore.
Non conosce `comrak`, né `tauri`, né `wasmtime`, ed è un'invariante verificata.
Mappa in [architecture/traits.md](architecture/traits.md).

### famiglia
`VaultRead`, `VaultWrite`, … · [`abi/traits.rs:356`](../crates/fub-abi/src/traits.rs) · [0021](decisions/0021-il-confine.md)

Uno dei **quindici** gruppi in cui le capacità sono divise, e il criterio è
**cosa vuol dire negarne una**: leggere il vault è separato dallo scriverlo, e
scriverlo dal cambiarne la struttura. Chi le implementa tutte lo dichiara una
volta sola (`HostApi` è una somma con una impl generica, e `ReadApi` è la somma
delle sei di sola lettura). Al confine WIT ogni famiglia è un'`interface` — sono
quindici `host-*` in `abi.wit` — e negarne una non è un rifiuto a runtime, è
l'**assenza della funzione**.

Dal lato di **chi concede** i nomi sono **diciotto**, e `Capability` ne porta
tre che nel contratto non hanno un trait loro:

- Due per la [0095](decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md), perché
  `HostEnv` presta dallo stesso metodo una cosa della macchina (l'orologio) e
  due dell'utente (quale nota guarda, cosa ci ha selezionato).
- Una per la [0096](decisions/0096-una-bozza-non-e-una-nota.md), perché
  `HostQuery` porta una domanda — le **bozze** — il cui contenuto non è nel
  vault, e il cancello guarda quindi *quale* richiesta passa.

L'invariante che il compilatore presidia è quindi «nessun trait senza almeno una
famiglia», non «una famiglia, un trait».

### freeze
— · [milestones/M4-wit-hardening.md](milestones/M4-wit-hardening.md) · [0002](decisions/0002-additivita-del-contratto.md)

Il momento (M4) in cui la superficie del contratto smette di poter cambiare
forma. È la scadenza che rende una voce di roadmap **P0**: prima costa un campo,
dopo costa una migrazione di versione.

### handle di trasferimento
`SourceHandle`, `ArtifactHandle` · [`abi/transfer.rs`](../crates/fub-abi/src/transfer.rs) · [0102](decisions/0102-i-byte-non-stanno-nel-record.md)

Una chiave che l'host timbra e che solo lui sa risolvere, per non far viaggiare
i byte di un trasferimento **dentro** il record. Non si costruisce, si riceve, e
nomina esattamente la sorgente che l'utente ha scelto: è la stessa forma con cui
il confine tiene fuori il filesystem, applicata al *contenuto* invece che al
*percorso*.

Leggere da un handle è **posizionale** (`offset` e `len`, non «il prossimo
pezzo»), perché la cosa che si importa più spesso è un archivio e la directory
di un archivio sta in fondo.

### linea di base
`wit/frozen/0.1.0.wit` · [`crates/fub-abi/wit/frozen/`](../crates/fub-abi/wit/frozen/README.md) · [0002](decisions/0002-additivita-del-contratto.md)

La copia del contratto **com'era** quando una versione è stata pubblicata: non
un archivio, ma il termine di paragone contro cui l'additività si verifica. Una
rottura deliberata prima del freeze si fa *ritagliandola*, con un commit che la
tocca e dice perché — così si vede in review.

### manifest
`PluginManifest` · [`abi/traits.rs:3793`](../crates/fub-abi/src/traits.rs) · [0013](decisions/0013-elenco-delle-capacita.md)

La carta d'identità di un componente: id, nome, versione dell'ABI dichiarata, e
i permessi che chiede. Anche una feature nativa ne ha uno, e non per simmetria:
se si dichiarasse solo chi non esiste ancora, il punto di applicazione non
sarebbe provato da nessuno.

### metro del guest
— · [architecture/plugin-boundary.md](architecture/plugin-boundary.md) · [0104](decisions/0104-la-superficie-di-scrittura-si-presta.md)

Le domande con cui si decide se una cosa può essere **solo** un guest. Le prime
tre pesano un **costo** — posizione rispetto al prestito, frequenza × payload,
prima o dopo la scrittura — e chi inciampa in una sola non può esserlo.

La **quarta**, *se la superficie esiste*, non pesa niente: nomina chi le passa
tutte e resta fuori lo stesso, perché una porta non c'è. È arrivata dopo,
misurando: un metro che sa dire solo «quanto costa» lascia quel caso non
vietato, non caro e non previsto.

### permesso
`permission::*` · [`abi/options.rs:18`](../crates/fub-abi/src/options.rs) · [0013](decisions/0013-elenco-delle-capacita.md)

La stringa con cui un manifest chiede una capacità: `fub:read-vault`,
`fub:write-vault`, `fub:network`, `fub:read-clipboard`, `fub:run-command`… È il
lato
dichiarativo di ciò che la [famiglia](#famiglia) è dal lato dei tipi.

Sono **quattordici** [conta: permessi-dichiarabili], e l'elenco è chiuso: sta in
`permission::ALL`, e ciò che non è lì dentro un manifest lo può scrivere ma
nessun cancello lo consuma.

**Quattro portano un parametro, e uno solo lo fa leggere a qualcuno.** Quello è
`fub:network`
([0097](decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)): il
valore della chiave è una allowlist di host, e il `Guard` la **legge**. Gli
altri tre — i prefissi di path di `read-vault`, `write-vault` ed `external-fs` —
sono scritti nei manifest e non li guarda nessuno (la casella del
[§7.1](roadmap/07-il-confine.md#la-casella-rimasta)), quindi per loro vale
ancora che *presente = acceso e basta*.

È la ragione per cui il pannello dei permessi mostra il parametro **solo** della
rete: mostrare gli altri sarebbe scrivere una promessa che l'app non mantiene.
Ed è anche la ragione per cui `fub:network` **senza** elenco significa
*qualunque host* invece di *nessuno*: ribaltarlo avrebbe reso questa l'unica
chiave la cui assenza di parametro significa il contrario che altrove, e ciò che
cambia deve restare nella frase che l'utente legge accettando, non nella regola
di lettura della mappa.

Di norma sono uno per famiglia, e i due della sessione — `fub:read-session`
(quale nota guardo) e `fub:read-selection` (cosa ci ho selezionato),
[0095](decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) — sono i soli a
governare **un metodo solo** in due: la scelta che servivano a dare all'utente
sta in mezzo, e un permesso solo non sapeva esprimerla.

`fub:read-drafts` ([0096](decisions/0096-una-bozza-non-e-una-nota.md)) fa la
stessa cosa a `query_index`, con una differenza che vale saperla: quei due si
**sommano** — senza `read-session` il testo non ha dove stare — mentre questo
sta **al posto** di `fub:read-vault` sulla variante `Drafts`. Sommarli avrebbe
reso indicibile la frase di chi ha bisogno solo di quelle: un pannello che
recupera ciò che non è stato salvato dopo un crash.

**E si negano uno per uno**
([0098](decisions/0098-un-permesso-si-vede-e-si-nega.md)). Ciò che un manifest
dichiara è concesso finché qualcuno non dice di no, e il «no» è una chiave
d'impostazione che il kernel fabbrica per ogni coppia componente-permesso —
`com.acme:permissions.network` — allo stesso modo in cui fabbrica quella di una
scorciatoia. Vale **subito** e sopravvive allo spegnimento del componente. La
frase che si legge negandolo la scrive la shell e non il manifest, perché chi
chiede un permesso non deve poter scrivere la frase con cui glielo si concede.

### porta verso un terzo
`safety::Gate` · [`kernel/safety.rs`](../crates/fub-kernel/src/safety.rs) · [0105](decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md)

Un punto del kernel da cui si entra in **codice di un terzo**, e quindi un punto
in cui serve la [rete al confine](#rete-al-confine).

Sono **tredici** [conta: porte-verso-un-terzo], una per specie — un comando, una
view che disegna, una che agisce, un servizio, un evento consegnato, le quattro
degli indici, il `parse` di un formato, l'innesto di una regola di sintassi, il
disegno di un renderer, un job. E sono un **enum**, non una frase: finché
stavano in prosa il conto diceva otto ed era sbagliato. Da non confondere con
[porta](#porta) nell'altra famiglia, che è il passaggio unico verso l'host.

Ogni porta dice il **verbo** della frase che l'utente legge quando un componente
esplode («eseguendo `x`»), il sito che chiama dice il soggetto. `Gate::what` è
un `match` senza `_`, quindi una porta nuova non compila finché non ha una frase
e finché non è dichiarato dove è provata.

### provider
`FormatProvider`, `ViewProvider`, … · [`abi/traits.rs:1852`](../crates/fub-abi/src/traits.rs) · —

Chi implementa un trait del contratto e si registra: è **il** modo in cui Fub si
estende. Il criterio di tutta la roadmap è che la stragrande maggioranza delle
voci di [FEATURES.md](FEATURES.md) sia un provider — ciò che non può esserlo
diventa un comando cablato e un `if` nel kernel.

### rete al confine
`safety::calling` · [`kernel/safety.rs`](../crates/fub-kernel/src/safety.rs) · [0032](decisions/0032-il-runner-dei-job.md), [0105](decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md)

Il `catch_unwind` attorno alla chiamata di un provider, e a niente di più: un
panico costa **la chiamata, non il vault**. Non è un `Result` in più nel
contratto — un panico resta un difetto — e non è una disattivazione: sta lì per
non avvelenare il lock e lasciare il vault irraggiungibile fino al riavvio. Sta
su tutte e tredici le [porte verso un terzo](#porta-verso-un-terzo), in tre
maglie a seconda che chi ha chiamato possa ricevere un no (`calling`, `caught`)
o non aspetti niente (`reporting`).

Presuppone una cosa sola, **che un panico srotoli**, e a verificarla non è un
test ma il compilatore: un `#[cfg(panic = "abort")] compile_error!` rifiuta quel
profilo. Un test non lo vedrebbe — Cargo ignora `panic` per i profili `test` e
`bench` — e resterebbe verde attestando una rete che nel binario spedito non c'è
più.

### superficie
— · [architecture/wit.md](architecture/wit.md) · [0002](decisions/0002-additivita-del-contratto.md)

L'insieme di ciò che il contratto espone e che qualcuno di esterno può nominare:
firme, campi, varianti. «Congelare la superficie» vuol dire promettere che
quelle forme non cambieranno. Da non confondere con [superficie di
vista](#superficie-di-vista), che sta nell'altra famiglia.

### WIT
`fub:abi@0.1.0` · [`crates/fub-abi/wit/`](../crates/fub-abi/wit/README.md) · —

Lo stesso contratto detto nella lingua del component model di WebAssembly. Vive
accanto al crate che rispecchia, ed è verificato contro di lui a ogni push
(`wit_conformance`). Perché esista e cosa controlla:
[architecture/wit.md](architecture/wit.md).

---

## Il canale dati

### canale dati
`IndexQuery` / `IndexResult` · [`abi/traits.rs:2563`](../crates/fub-abi/src/traits.rs) · [0005](decisions/0005-canale-dati-verso-le-view.md), [0019](decisions/0019-il-canale-dati.md)

L'unico modo in cui chi disegna chiede dati al kernel: si costruisce una query,
si ottiene un risultato. Esiste perché una view non deve poter chiamare il
kernel a modo suo — e perché la stessa domanda posta da un plugin WASM deve
attraversare lo stesso tubo.

### canale metadata
`HostQuery::query_index` · [`abi/traits.rs:1059`](../crates/fub-abi/src/traits.rs) · [0005](decisions/0005-canale-dati-verso-le-view.md)

Il canale dati visto dal lato di chi lo usa per i **metadati** — backlink,
outline, tag, statistiche — invece che per il testo. È il canale che ha reso i
pannelli nativi dei `ViewProvider` veri invece che rami privilegiati del kernel.

### finestra
`Page` / `Paged<T>` · [`abi/traits.rs:1960`](../crates/fub-abi/src/traits.rs) · [0019](decisions/0019-il-canale-dati.md)

Il modo di chiedere *venti* invece di tutto, con il totale nella risposta.
`None` resta «tutto», perché chi ha davvero bisogno dell'insieme intero non deve
inventarsi un tetto; ma senza finestra ogni giro clona il vault.

### indice
`IndexProvider` · [`abi/traits.rs:3448`](../crates/fub-abi/src/traits.rs) · [0019](decisions/0019-il-canale-dati.md)

Chi sa rispondere a una parte delle query. Ce n'è più di uno — il grafo e
l'anagrafe stanno nel kernel, la ricerca full-text è un provider su tantivy — e
il canale dati esiste anche per non far sapere a chi chiede quale sia quale.

### instradamento
`QueryRoute` · [`abi/traits.rs:3113`](../crates/fub-abi/src/traits.rs) · [0019](decisions/0019-il-canale-dati.md)

Come il kernel decide **a chi** mandare una query. Si dichiara alla
registrazione, non si scopre per tentativi: la tabella delle rotte
(`index/routing.rs`) rifiuta due provider che dichiarino la stessa cosa invece
di sceglierne uno a caso.

### pianificatore
`QueryPlan` · [`kernel/index/plan.rs:437`](../crates/fub-kernel/src/index/plan.rs) · [0026](decisions/0026-due-query-insieme.md)

Chi decide come eseguire una query che tocca più di un indice. Dalla 0026 può
mandarne due **insieme**: non è una dichiarazione nel contratto, è una misura —
la ricerca è passata da 1,0× a 6,8× su otto thread.

### risultato
`DocumentMatch` · [`abi/traits.rs:2327`](../crates/fub-abi/src/traits.rs) · [0019](decisions/0019-il-canale-dati.md)

Un documento che risponde a una query, con quello che serve per mostrarlo: il
punteggio, lo snippet, ciò che ha fatto scattare la corrispondenza. È il tipo su
cui pesavano tre delle voci di firma della [seduta
21](roadmap/21-la-ricerca-predefinita.md): sono state prese prima del freeze, e
in tutto il repo non resta aperta **nessuna** P0.

### query di testo
`TextQuery` · [`abi/query.rs:133`](../crates/fub-abi/src/query.rs) · [0025](decisions/0025-la-ricerca-predefinita.md)

Come si chiede una ricerca full-text: il testo, il modo, i campi. La 0025 ha
stabilito che la ricerca di Fub è **built-in e di classe *omnisearch***, e da lì
è venuto ciò che a questo record mancava:

- `tolerance` — un'intenzione (`Exact`/`Typos`), mai una distanza di edit — e
  `partial_last_term` per il prefisso mentre si digita
  ([0050](decisions/0050-cosa-si-chiede-a-una-ricerca.md)).
- Le occorrenze dentro la nota aperta
  ([0049](decisions/0049-una-posizione-dentro-un-documento.md)).

Il fuzzy vero resta lavoro di provider, e non scade.

---

## Gli eventi e il lavoro lungo

### attore
`Actor` · [`abi/event.rs:172`](../crates/fub-abi/src/event.rs) · [0012](decisions/0012-origine-degli-eventi.md)

Chi ha **chiesto** l'operazione da cui un evento nasce — non chi l'ha eseguita:
l'utente, il watcher (cioè il filesystem), il kernel, un plugin. È un enum
chiuso, perché un campo su cui ognuno inventa la propria convenzione non serve a
decidere. La domanda per cui esiste è una sola: «questa l'ho scritta io?».

### bus
`EventBus` · [`kernel/bus.rs:459`](../crates/fub-kernel/src/bus.rs) · [0033](decisions/0033-la-grana-di-un-abbonamento.md)

Dove gli eventi del kernel passano, e da dove chi si è abbonato li ritira.
L'abbonamento ha una grana: un *topic*, un *soggetto*, **cosa è cambiato**, e
prefissi che non sono `starts_with`.

### evento
`Event` · [`abi/event.rs:374`](../crates/fub-abi/src/event.rs) · [0012](decisions/0012-origine-degli-eventi.md)

Il fatto che qualcosa nel vault è cambiato, con l'[origine](#origine) attaccata.
Ogni evento porta anche un `EventKind` e un `Subject`, e un `DocumentChanged`
porta **cosa** è cambiato: sono ciò su cui una maschera filtra. Uno solo non
nasce da un fatto del vault — `TimerFired`, che lo fa nascere una
[sveglia](#sveglia).

### freno
— · [`host/bridge.rs`](../crates/fub-host/src/bridge.rs) · [0034](decisions/0034-il-freno-e-il-raggruppamento.md)

Il tetto che il [ponte](#ponte) mette a quanti messaggi consegna. Sta **con chi
ritira**, non con chi emette, e la finestra non è temporale: il ciclo aspetta il
primo avviso e poi drena ciò che c'è già.

Se il vault è fermo, la raffica è di uno e la latenza è zero. Se il kernel corre
più del webview, la raffica è grande esattamente quanto il ritardo. Nessuna
costante da indovinare.

### job
`JobSpec` / `JobId` · [`abi/traits.rs:48`](../crates/fub-abi/src/traits.rs) · [0027](decisions/0027-il-lavoro-lungo-vede-il-vault.md), [0032](decisions/0032-il-runner-dei-job.md)

Il lavoro lungo: import, export, reindicizzazione, backup, OCR. Gira **fuori**
dal giro sincrono del kernel, riceve l'`HostApi` per chiamata — non uno
snapshot, perché camminare il vault era esattamente ciò che non poteva fare — e
si ferma a bandiera. Il runner tiene un pool per vault.

### lotto
`BatchId` · [`abi/event.rs:146`](../crates/fub-abi/src/event.rs) · [0011](decisions/0011-il-lotto.md)

Il raggruppamento di più scritture in **una** operazione dal punto di vista di
chi guarda: una rinomina che tocca duecento backlink è un lotto, e chi disegna
ridisegna una volta invece di duecento. L'id è opaco e **non ordinabile**:
confrontarlo con `<` assume un ordine che un host con più sessioni non deve a
nessuno.

### maschera
`EventMask` · [`abi/event.rs:945`](../crates/fub-abi/src/event.rs) · [0033](decisions/0033-la-grana-di-un-abbonamento.md)

Cosa un abbonato vuole ricevere. Dalla 0033 dice anche **dove** — non solo la
specie dell'evento ma il suo soggetto, così un pannello che guarda una cartella
non si sveglia per il resto del vault — e dalla
[0069](decisions/0069-cosa-sa-dire-un-abbonamento.md) anche **cosa**, per
aspetto. Non dice, e non dirà, *quando*: una maschera filtra ciò che accade, e
un timer fa accadere.

### origine
`Origin` · [`abi/event.rs:201`](../crates/fub-abi/src/event.rs) · [0012](decisions/0012-origine-degli-eventi.md)

L'[attore](#attore) più il [lotto](#lotto): da dove viene un evento.
`batch: None` non vuol dire «non importante», vuol dire che quella scrittura sta
da sola.

### ponte
— · [`host/bridge.rs`](../crates/fub-host/src/bridge.rs) · [0034](decisions/0034-il-freno-e-il-raggruppamento.md)

Il pezzo che porta gli eventi dal bus del kernel a chi guarda: il webview, ma
anche una CLI o un flusso SSE. Ha un [freno](#freno) e un
[raggruppamento](#raggruppamento), e sta nell'host proprio perché chi guarda non
è per forza un webview.

### progresso
`JobProgress` · [`abi/traits.rs:89`](../crates/fub-abi/src/traits.rs) · [0035](decisions/0035-il-lavoro-lungo-si-racconta.md)

Come un job racconta a che punto è. È un evento come gli altri, e l'id glielo
**timbra la porta**: non lo dichiara chi lo emette, così un componente non può
raccontare i progressi di un altro.

### raggruppamento
— · [`host/bridge.rs`](../crates/fub-host/src/bridge.rs) · [0034](decisions/0034-il-freno-e-il-raggruppamento.md)

La prima delle due riduzioni del ponte: dentro una raffica, ciò che dice due
volte la stessa cosa la dice una — e si tiene l'**ultima** occorrenza, non la
prima.

---

## L'interfaccia

### sveglia
`TimerSpec` · [`abi/traits.rs`](../crates/fub-abi/src/traits.rs) · [0069](decisions/0069-cosa-sa-dire-un-abbonamento.md)

Un nome e ogni quanto suona, dichiarati nel [manifest](#manifest) di un
componente. Quando scade, l'host emette un `Event::TimerFired`: informa, quindi
è un evento e non una capacità
([0013](decisions/0013-elenco-delle-capacita.md)). Si misura in tempo trascorso
— `every` e `after` — e non in orario di parete, che vuole un fuso (§22.4).

### azione
`UiAction` / `ActionId` · [`abi/ui.rs:789`](../crates/fub-abi/src/ui.rs) · [0016](decisions/0016-cosa-e-una-view.md)

Ciò che l'utente può fare dentro una view, dichiarato dal core e non cablato
nella shell. Il giro si chiude con un `ViewUpdate`: la view riceve l'azione,
risponde con cosa deve cambiare.

### comando
`CommandSpec` · [`abi/command.rs:103`](../crates/fub-abi/src/command.rs) · [0009](decisions/0009-registro-dei-comandi.md), [0010](decisions/0010-comando-descritto-a-una-macchina.md)

L'unità di azione dell'app, registrata e non cablata: la palette la mostra, una
scorciatoia la invoca, un'automazione la chiamerà. La 0013 ha trasformato in
comandi le azioni strutturali della shell, e sei comandi Tauri sono spariti.

### esito parziale
`Partial` / `Failure` · [`abi/command.rs:605`](../crates/fub-abi/src/command.rs) · [0101](decisions/0101-una-voce-non-e-un-passo.md)

*Di N cose, quante e quali non sono riuscite.* Non è una terza parola accanto a
riuscito e fallito: un'operazione a metà **è riuscita** per la parte che ha
fatto, e chi la annulla annulla quella parte.

I guasti stanno uno per uno col proprio `PluginError`, perché un conto non dice
quale nota riaprire e la specie dell'errore dice se ha senso riprovare. Assente
vuol dire *non è mancato niente*, e non *non lo so*: dichiararsi a metà senza
esserlo insegna a cliccare via gli avvisi.

Il resto — `attempted - done - failures` — non ha un campo apposta: ci si arriva
sia perché non c'era **niente da fare**, sia perché non è stato **provato**, e
un nome solo farebbe mentire uno dei due.

### cucitura
`host/` · [`frontend/src/host/ipc.ts`](../frontend/src/host/ipc.ts) · [0015](decisions/0015-la-forma-della-shell.md)

L'unico punto della shell che parla con l'esterno. Nessun modulo importa
`@tauri-apps` fuori da `host/ipc.ts` e `host/dialog.ts` — **anche per i tipi**,
o la regola si aggira con una parola — e un test lo verifica leggendo i
sorgenti. Non è stile: è il prerequisito del PWA, del mobile e degli e2e
headless.

### esemplare
`ViewInstance` · [`abi/traits.rs:1594`](../crates/fub-abi/src/traits.rs) · [0037](decisions/0037-lo-stato-di-vista.md)

Una particolare apparizione di una view: la stessa specie di pannello può essere
aperta due volte, e le due hanno stato diverso. La chiave dello stato la compone
**l'host** con l'esemplare, non un `PaneId` — che è ciò che la 0037 ha corretto.

### intento
`ShellIntent` · [`frontend/src/ui/intents.ts:23`](../frontend/src/ui/intents.ts) · [0016](decisions/0016-cosa-e-una-view.md)

Ciò che la shell sa eseguire quando qualcosa glielo chiede: `Navigate`,
`Reveal`, `RunSearch`. Il tipo è letteralmente l'unione delle due sorgenti — un
`ViewUpdate` di una view (meno `replace`, che non è un intento ma un rimpiazzo)
e un `CommandEffect` di un comando — perché sono gli stessi intenti: sono
**della shell**, non del chiamante.

Da non confondere con `Intent` di
[`abi/ui.rs:98`](../crates/fub-abi/src/ui.rs), che è tutt'altro: il **tono** di
un nodo di interfaccia (`Neutral`, `Primary`, `Danger`). Stessa parola, due
famiglie diverse.

### porta
— · [`frontend/src/host/ipc.ts`](../frontend/src/host/ipc.ts) · [0015](decisions/0015-la-forma-della-shell.md), [0035](decisions/0035-il-lavoro-lungo-si-racconta.md)

Il punto di passaggio unico verso l'host. La parola torna in un secondo senso
nella 0035 — «la porta che timbra l'id» — ed è lo stesso concetto applicato agli
eventi: se il passaggio è uno solo, è l'unico posto in cui si può mettere un
controllo che nessuno aggira.

### protocollo di UI
`UiNode` / `UiKind` · [`abi/ui.rs:238`](../crates/fub-abi/src/ui.rs) · [0017](decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)

Il modo in cui il core **descrive** un'interfaccia e la shell la disegna, senza
che il core conosca il DOM. Ha un escape hatch (`WebView`, un iframe isolato) e
una regola su quando è lecito usarlo:
[architecture/ui-protocol.md](architecture/ui-protocol.md).

### selezione
`SelectionSet` · [`abi/session.rs:293`](../crates/fub-abi/src/session.rs) · [0007](decisions/0007-contesto-di-sessione.md), [0093](decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md)

Ciò che è selezionato in un pannello — o dove stanno i cursori, che sono
selezioni vuote. Sono **N**, con la **primaria** nominata da un campo e non
dedotta dalla posizione. O sono tutte *ancorate* al sorgente che il kernel ha in
mano, o non lo è nessuna: a deciderlo è lo stato del **buffer**, che è uno per
pannello.

### shell
`frontend/` · [`frontend/src/main.ts`](../frontend/src/main.ts) · [0015](decisions/0015-la-forma-della-shell.md)

Il frontend: Vite, TypeScript, CodeMirror 6. Ha un albero dichiarato — `host/`,
`state/`, `ui/`, `panels/`, `editor/`, `rules/` — e la mappa da consultare
quando si scrive un file nuovo è [architecture/shell.md](architecture/shell.md).

### stato di vista
`ViewStateRead` · [`abi/traits.rs:796`](../crates/fub-abi/src/traits.rs) · [0037](decisions/0037-lo-stato-di-vista.md)

Dove si era rimasti: lo scroll, la selezione, il pannello aperto. Sta sul file
della **macchina** e non nel vault, perché non è una proprietà del contenuto —
copiare un vault su un altro computer non deve portarsi dietro dove si era
arrivati a leggere.

### superficie di scrittura
`ViewSurface::Main` · [`abi/traits.rs:1520`](../crates/fub-abi/src/traits.rs) · [0104](decisions/0104-la-superficie-di-scrittura-si-presta.md)

L'editor visto come una superficie che **si presta**: *«l'editor è della
shell»* vuol dire questo editor, non l'editing, e un terzo che porti la propria
esperienza di scrittura — una modalità modale, un editor strutturato — è un
cliente previsto. Non vietata, **non attrezzata**: mancano un evento di tastiera
nel contratto e una via di disegno non riservata a `Trust::Core`, ed è un *buco
dichiarato*, non un divieto.

### superficie di vista
`ViewSurface` · [`abi/traits.rs:1520`](../crates/fub-abi/src/traits.rs) · [0016](decisions/0016-cosa-e-una-view.md)

**Dove** una view può apparire: sidebar sinistra o destra, fondo, area
principale, modale, barra di stato, ribbon, menu. Il contratto deve poter
nominare l'area principale prima che la shell sappia dividerla in due — che la
shell di oggi abbia un documento aperto e nessun modello di tab non è
un'obiezione.

### undo a due pile
`Undo` / `UndoStep` · [`abi/command.rs:712`](../crates/fub-abi/src/command.rs) · [0045](decisions/0045-l-undo-ha-due-pile.md)

Le due pile che **non si fondono**: quella dell'editor (il testo) e quella
strutturale (rinomina, spostamento, cestino). L'inverso di un'operazione
strutturale è un comando, non una voce di vocabolario, e `vault.undo` sta su
`Mod-Alt-z` perché `Mod-z` è dell'editor.

Una voce **non è un passo, è una lista**, e dalla
[0101](decisions/0101-una-voce-non-e-un-passo.md) porta due conti: se
l'operazione era già a metà quando è stata fatta, e se l'annullamento si è
fermato al passo caduto. Se non è cambiato niente resta un errore — è il *mezzo*
che aveva bisogno di un nome, non il fallimento.

### view
`ViewProvider` / `ViewSpec` · [`abi/traits.rs:1646`](../crates/fub-abi/src/traits.rs) · [0016](decisions/0016-cosa-e-una-view.md)

Un pannello dichiarato dal core: cosa mostra, dove sta, cosa si può fare dentro.
Backlink, outline, tag e statistiche sono view vere — non rami del kernel — ed è
la prova che il canale dati basta.
