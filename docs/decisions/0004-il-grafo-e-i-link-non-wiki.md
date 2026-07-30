# 0004 — Il grafo conosce solo i wikilink — e la promessa vale a metà, in silenzio

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §2.21 (quinto giro) |
| **Commit** | `0a4ee40` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **`LinkGraph::register_links` scarta ogni `LinkTarget` che non sia
      `Wiki`** (`kernel/graph.rs`), e `link_rewrite_plan` fa lo stesso
      (`kernel/workspace.rs`). Quindi per un link markdown ordinario —
      `[testo](note/altra.md)`, che il 7.1 mette sullo stesso piano del
      wikilink, insieme a «link relativi» e «link a file allegato» — **non ci
      sono backlink, non c'è riscrittura su rinomina, non c'è arco nel grafo**.
- [x] **È la prima voce di questo piano che rende falsa una promessa già fatta,
      senza dirlo**: «aggiornamento link su rinomina» e «spostamento sicuro»
      (3.2, 7.2) oggi valgono per una parte dei link e non per l'altra, e la
      differenza la scopre l'utente quando un link si rompe. Non è un buco di
      capacità futura: è un comportamento sbagliato adesso.
- [x] **E senza di esso non esiste tutta la famiglia della salute del vault**:
      link rotti e loro report, note orfane, allegati inutilizzati, fix
      automatico (7.2, ~30 voci) — sono tutte interrogazioni sullo stesso grafo,
      e sono tutte cieche su metà degli archi. Idem 13.1 (riferimenti aggiornati
      su rinomina di un allegato, orfani, dedup), che non è nemmeno
      rappresentabile finché un `Path` non è un arco.
- [x] **La metà nel contratto è la [decisione 0003](../decisions/0003-modello-del-documento.md)** (`LinkTarget` che distingua "risorsa
      del vault" da "url esterno") e va decisa prima; questa è la metà kernel —
      risoluzione di un `Path` relativo a `DocId` (con le sue regole: relativo a
      cosa, con o senza estensione, case), archi nel grafo, e riscrittura al
      rename con la stessa disciplina chirurgica già scritta per i wikilink.

**Fatta la metà kernel.** `fub_abi::rules::path` (`abi/rules/path.rs`, dove
la [decisione 0020](0020-le-regole-in-un-posto-solo.md) le ha portate) è il posto — e
l'unico — dove sta scritto cosa significa un path dentro un documento: relativo
alla **cartella** del sorgente (con lo slash iniziale, alla radice del vault),
`.` e `..` risolti lì, un `..` di troppo che esce dal vault e quindi non risolve;
percent-encoding decodificato, così `[t](nota%20uno.md)` e `[t](<nota uno.md>)`
sono lo stesso arco; frammento (`#heading`, `#^blocco`) staccato prima di
risolvere e riattaccato dopo. Sull'estensione la regola è **prima l'esatto, poi
il senza**: `note/a.md` è `note/a.md` e non il `note/a.txt` che gli sta accanto,
`note/a` ricade sulla chiave dei wikilink, e `note/a.png` che non esiste **non**
ricade su `note/a.md` — chi scrive un'estensione l'ha scritta apposta. Il caso
passa dalla stessa `normalize` dei wikilink (trim, NFC, minuscolo), perché il
vault sincronizzato fra macOS e Linux è lo stesso vault.

Nel grafo la seconda specie di arco entra **senza un secondo meccanismo**: un
`LinkRef` porta il suo `RefKind`, il path si risolve alla registrazione (da lì in
poi la chiave è assoluta nel vault e nessuno deve più sapere da dove veniva), e
`watchers`/`refs_by_key` restano quelli — le due risoluzioni dipendono dallo
stesso paio di chiavi d'indice, quindi l'invalidazione incrementale non cambia di
una riga. Con una differenza di sostanza: un link markdown **non ricade su nome e
alias**. `[t](Mario)` non pesca l'alias "Mario"; è un path, e nei path non ci
sono alias.

La riscrittura al rename ha un caso in più del wikilink, e non è un dettaglio: un
path è relativo a chi lo scrive, quindi si rompe anche quando a spostarsi è la
**sorgente** — muovere `a.md` in `sub/` invalida ogni `[t](altra.md)` che
conteneva, e nessun backlink lo segnala perché il documento che si rompe è quello
che si è mosso. Quindi il documento rinominato è sempre fra le sorgenti del
piano, e i suoi link relativi si ri-basano sulla cartella nuova (quelli dalla
radice no: la radice non si muove). Il riferimento riscritto è relativo a *ogni*
sorgente — lo stesso bersaglio diventa `archivio/X.md` da uno e `../archivio/X.md`
da un altro — è percent-encoded per stare dentro `[]()` senza rompersi, e
riacquista sempre l'estensione: un path senza è ambiguo per costruzione, e
riscrivere un link vuol dire garantire che dopo punti ancora dove puntava. Un
link già rotto non si tocca: riscriverlo sarebbe indovinare.

Le prove: il test di proprietà `graph_incremental.rs` ora genera **entrambe le
specie** e osserva anche `resolve_path` per ogni coppia (sorgente, destinazione)
— incrementale e full-rebuild restano indistinguibili su 200 sequenze casuali più
una da 2 000 passi; dieci casi end-to-end sul rename in `rename_and_events.rs`; e
uno sul parser vero in `format-markdown/tests/vault_e2e.rs`, perché gli `Span`
dentro cui la sostituzione ritaglia sono quelli di comrak, non quelli di un
provider giocattolo.

*Sblocca:* 7.2 e 13.1 sul lato grafo (link rotti, orfani, riferimenti su
rinomina) — che ora vedono tutti gli archi, non metà.

**Resta aperta la metà modello ([decisione 0003](../decisions/0003-modello-del-documento.md)), e non è un residuo formale.** Un
`LinkTarget::Path` continua a essere una stringa che il kernel interpreta:
l'unica cosa che distingue una risorsa del vault da un url esterno è
`classify_url` nel provider markdown (`://` o `mailto:`), e un provider terzo può
non fare la stessa cosa. Soprattutto: **le immagini non entrano affatto in
`links`** (`parse.rs`), quindi 13.1 sugli allegati — riferimenti su rinomina
di un allegato, orfani, dedup — resta fuori portata: non perché il `Path` non sia
un arco, ma perché quell'arco non viene nemmeno raccolto. E in anteprima un
`.internal-path` porta già il suo `data-path`, ma nessuno lo clicca: la shell non
naviga né quelli né i wikilink (§3.x). L'arco adesso è vero; il clic no.
