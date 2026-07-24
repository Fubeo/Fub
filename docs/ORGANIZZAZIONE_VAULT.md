# Organizzazione del vault: albero, icone, folder notes, spazi

Torna a [PIANO.md](PIANO.md). Ispirazione dichiarata: il plugin
[make.md](https://www.make.md/) di Obsidian — ma **nell'app base**, non come
plugin, perché organizzare le note è il mestiere della sidebar, non
un'estensione.

## Contesto (perché questo documento esiste)

Fino a M2 la sidebar era una lista piatta di `DocId`: le cartelle esistevano
nei path (`Progetti/Alpha.md`) ma non venivano mai disegnate. Da make.md si
prendono i blocchi organizzativi, in questo ordine di valore:

- **Albero** con cartelle espandibili (prerequisito di tutto).
- **Icone** (emoji) su note e cartelle.
- **Folder notes**: la cartella *è* una nota; cliccarla la apre.
- **Spazi**: una cartella usata come radice della sidebar; note appuntate;
  ordinamento libero (drag & drop), non solo alfabetico.

**Fuori scope, deliberatamente**: i "Contexts" di make.md (cartelle come
database con proprietà e viste tabella/board/calendario). È un ordine di
grandezza più grande, tocca indice e modello, e merita una milestone sua —
vedi [appendix/funzionalita-future.md](appendix/funzionalita-future.md).

## Decisioni di design (con il perché)

| # | Decisione | Perché | Stato |
|---|---|---|---|
| O1 | Metadati in un **sidecar `.fubmd/workspace.json`** dentro il vault | Le note restano markdown puro (zero lock-in) e l'organizzazione viaggia col vault (sync, git). Stessa scelta di make.md. `.fubmd` è un dot-dir: scansione, watcher e indice lo ignorano già, nessuna modifica al kernel. | presa |
| O2 | Il sidecar è **autorevole**, non derivato | A differenza di `.fubmd-data` (indici, versioni: ricostruibili), qui dentro c'è ciò che l'utente ha scelto a mano. Illeggibile ⇒ si lavora col default ma **non si salva**: sovrascrivere in silenzio butterebbe via le scelte fatte. | presa |
| O3 | Il kernel **non sa nulla** dell'organizzazione | Icone, pin, ordine e spazi sono presentazione: vivono nell'app (2 comandi IPC di lettura/scrittura del sidecar) e nel frontend. Il contratto `fubmd-abi` non si tocca (freeze M4 non c'entra). | presa |
| O4 | L'albero nasce **dai path delle note**, non dal filesystem | Una cartella senza note dentro non esiste per la sidebar. Coerente con `Workspace::documents()`, che è l'unica verità che l'app ha in mano; le cartelle vuote arriveranno se/quando serviranno. | presa |
| O5 | Folder note = **`X/X.md`**, in mancanza `X/index.md` | Le due convenzioni più diffuse (make.md, folder-notes, MkDocs). Niente campo nel sidecar: è una convenzione sui path, leggibile da qualsiasi altra app. La folder note non compare tra i figli; la apre il click sulla cartella. | presa |
| O6 | "Converti in cartella" e spostamenti drag & drop = **`rename_document`** | `p/X.md` → `p/X/X.md` (o `cartella/X.md`) è un rename: il kernel crea le cartelle intermedie e riscrive i wikilink entranti. Nessun percorso nuovo da tenere coerente (stesso principio di D8 del versioning). | presa |
| O7 | Ordine scelto a mano = **lista di nomi per cartella**, chi manca segue in alfabetico | Una lista parziale o invecchiata (nota aggiunta da un'altra app) non fa sparire nessuno e non va riconciliata: i nuovi arrivati si accodano ordinati. Cartelle prima delle note; il riordino è tra fratelli dello stesso tipo. | presa |
| O8 | Stato di **vista** (cartelle aperte, spazio selezionato) in localStorage, non nel sidecar | Quali cartelle ho espanso e dove sto guardando è ergonomia di questa macchina; su un altro dispositivo è rumore. Nel sidecar va solo ciò che è organizzazione del vault. | presa |
| O9 | Spazi = **striscia di icone** in cima alla sidebar (stile make.md): "home" per primo (vault intero), poi le cartelle registrate in `spaces`, poi "+" | Gli spazi sono un set stabile tra cui saltare con un click, non una modalità in cui entrare e uscire. La *lista* è organizzazione (sidecar, O1); la *selezione* è vista (O8). | presa |

Aperto, da decidere strada facendo:
- **Spostare le cartelle** (drag & drop di una cartella dentro un'altra): sono
  N rename in cascata — il kernel li sa fare uno alla volta, ma l'operazione
  merita un comando composto e una conferma, non un gesto ambiguo. Per ora le
  cartelle si riordinano soltanto.
- **Nota in più spazi contemporaneamente** (make.md lo permette): richiede che
  lo spazio sia una collezione, non solo una radice. Rimandato a quando gli
  spazi avranno dimostrato di servire.
- **Cartelle vuote / crea nota qui**: `create_note` oggi crea solo nella
  radice; con gli spazi diventa naturale volere "nuova nota in questa
  cartella". Piccolo, ma tocca il kernel: prossima passata.

## Cosa c'è (2026-07-24)

- [x] Sidecar: `WorkspaceMeta` (`icons`, `pinned`, `order`, `space`) +
      comandi `read_workspace_meta`/`write_workspace_meta`
      (`crates/fubmd-app/src/lib.rs`), wrapper in `frontend/src/api.ts`.
- [x] Albero: `frontend/src/organizer.ts` (costruzione, ordinamento O7,
      folder note O5 — logica pura, senza DOM), rendering in `main.ts`.
- [x] Icone emoji su note e cartelle (menu contestuale → selettore).
- [x] Folder notes: click sulla cartella apre `X/X.md`/`X/index.md`;
      "Converti in cartella" su una nota (O6).
- [x] Appuntate: sezione in cima alla sidebar, toggle dal menu contestuale.
- [x] Riordino drag & drop tra fratelli (O7) e spostamento di una nota su una
      cartella (o sul titolo "Note" per riportarla alla radice) (O6).
- [x] Spazi (O9): striscia di icone in alto — 🏠 home, uno chip per spazio
      (icona sua), "+" per registrare una cartella; "Usa come spazio" dal menu
      di una cartella. Selezionato uno spazio, l'albero si radica lì e il
      titolo del pannello (che ne apre la folder note) mostra il suo nome; dal
      menu di uno chip: "Icona…", "Togli dagli spazi".
- [x] Migrazione dei metadati sul rename (`document_renamed` → icona, pin,
      posizione nell'ordine seguono la nota).

Nato nello stesso giro: fix del "doppio click per aprire una nota" — la lista
veniva ricostruita a ogni evento del kernel e un click a cavallo del rebuild
si perdeva (`mousedown` sul nodo vecchio, `mouseup` sul nuovo). Ora si
ricostruisce solo se la lista è cambiata davvero (`refreshFileList`).
