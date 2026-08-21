# 0160 — L'errore al confine è `kind` + `Text`, non un record di parametri

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la voce B «Forma
dell'errore al confine» di [todo.md](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

La voce chiedeva di decidere se l'errore al confine porta **codice + parametri**
— prerequisito dichiarato della localizzazione (25.2, §12.1), delle notifiche
(10.5) e dei retry delle automazioni (16.3) — perché *«un messaggio già composto
non si traduce e non si discrimina: la shell oggi indovina»*.

## La premessa, rimisurata

Rimisurata a `crates/fub-abi/src/error.rs` e all'IPC di `fub-app`.

- **`PluginError` ha dodici varianti, tutte con payload `Text`.** `UnknownCommand`,
  `UnknownView`, `UnknownJob`, `BadArgs`, `PermissionDenied`, `Internal`,
  `Conflict`, `Unserved`, `Cancelled`, `NotFound`, `AlreadyExists`, `Io`
  (`error.rs:117-190`). Sul filo è adiacentemente taggato —
  `#[serde(tag = "kind", content = "message", rename_all = "snake_case")]` —
  cioè `{"kind": "already_exists", "message": …}`, la forma scelta dalla
  [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) quando ha guadagnato il
  primo lettore.
- **L'IPC torna `Result<_, PluginError>`, non `String`.** Tutti i comandi Tauri
  di `crates/fub-app/src/lib.rs` — `open_vault`, `write_document`,
  `invoke_command`, `query_index`, `cancel_job`, `set_icon`, `set_pinned`,
  `set_space`, `set_order`, `set_setting`, `reset_setting` e gli altri —
  restituiscono `Result<_, PluginError>`. La premessa della voce — *«finiscono
  in `String` su tutti i comandi IPC»* — è **falsa da tempo**: la 0041 ha
  portato il tipo fino al confine, e la shell lo riconosce dalla **forma**
  (`frontend/src/host/errors.ts`, `asPluginError`), non da una classe.
- **0041 e 0132 hanno già applicato la decisione.** La
  [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) ha deciso che il payload
  è un `Text` (si localizza come ogni altra stringa, col catalogo di chi ha
  prodotto la frase) e che la specie sta in un `kind` discriminabile — *«un
  errore è testo che qualcuno legge ed è una domanda su cui qualcuno rama»* — e
  la [0132](0132-un-rifiuto-non-e-una-frase.md) ha esteso la stessa forma al
  caso che portava prosa nuda (`FormatError::Unsupported`), componendo la frase
  dai due dati dichiarati. La forma è già quella: **`kind` + `Text`**.
- **Il discrimine per retry e localizzazione è il `kind`, ed esiste.**
  `NotFound`/`AlreadyExists`/`Io`/`Conflict`/`Cancelled`/`PermissionDenied` sono
  le specie su cui chi riceve rama — il ripristino dal cestino distingue
  `AlreadyExists` da `Io` e da `PermissionDenied` (0041), e `Conflict` è
  l'unico errore che si **riprova** invece di correggerlo
  ([0008](0008-modifica-chirurgica.md)). La localizzazione non ha bisogno di
  parametri: il `Text` porta la chiave e gli argomenti, e la risoluzione sta
  sulla via d'uscita (`Workspace::localized`).

## La decisione

**L'errore al confine resta `kind` + `Text`, e non diventa un record di
parametri.** Il `kind` è il codice: è ciò su cui chi riceve rama, ed è già
discriminabile sul filo. Il `Text` è il messaggio: si localizza come ogni altra
stringa, col catalogo di chi ha prodotto la frase. Un campo `params`
strutturato ritiperebbe ogni variante — ogni `Text` diventerebbe un record di
campi — cioè una **major** su dodici varianti per servire una domanda che il
`kind` già risponde. La premessa della voce è caduta rimisurandola: il confine
non consegna più `String`, e la shell non indovina più.

## Le forme scartate

- **Codice + parametri additivi** — scartata: un campo `params` accanto al
  `Text` non si può aggiungere senza ritipare ogni variante (ogni payload
  diventerebbe un record), e il `kind` già discrimina. La forma additiva
  possibile — una variante nuova in coda, quando un cliente vero la legge — è
  quella che la 0041 ha già scritto come regola: *«una variante nasce quando
  qualcuno la legge»*.
- **Un errore come `String` nuda** — scartata dalla 0041: nessun ramo su cui
  decidere, e la shell tornerebbe a cercare sottostringhe nella prosa.

## Cosa resta scoperto

- **I `Text::Literal` di prosa italiana del kernel non sono traducibili** — è
  il debito dichiarato della 0132: ciò che fallisce prima che un provider sia
  stato chiamato è prosa del kernel, e si tradurrà il giorno in cui il §12.4
  darà al kernel il suo catalogo, in un posto solo.
- **Il successo parziale non è esprimibile** (`LinkRewrite` → `Io`, con la
  perdita dichiarata nella 0041): nessuna variante `partial`, perché nessun
  cliente la leggerebbe ancora.
