// Le regole che esistono **in due lingue**, e che una fixture generata tiene
// uguali.
//
// Ogni funzione di questo file ha una gemella in Rust dentro
// `crates/fubmd-abi/src/rules/` (o nel modello, per quelle che ci stavano da
// prima), e il legame non è un commento: `crates/fubmd-abi/tests/rules_mirror.rs`
// genera `__fixtures__/rules-samples.json` con la risposta di Rust caso per
// caso, e `rules-mirror.test.ts` pretende che qui esca la stessa. Cambiare la
// regola da un lato solo è rosso.
//
// Perché esistono due volte: sono tutte cose che la UI deve sapere **prima** di
// un giro IPC — che nome scrivere sotto un'icona mentre l'albero si disegna, se
// barrare una riga mentre si digita, se due nomi sono lo stesso nome per trovare
// la folder note di una cartella. Il traguardo dichiarato dal §6.2 è che questo
// file sparisca, compilando `fubmd-abi` a wasm32; fino ad allora la duplicazione
// resta, ma sotto lo stesso presidio dei tipi.
//
// **Non aggiungere qui una regola senza la sua gemella Rust e i suoi casi nella
// fixture**: sarebbe di nuovo una copia che nessuno confronta.

/// L'ultimo segmento di un path: `Progetti/Alpha.md` → `Alpha.md`.
///
/// Non ha una gemella Rust (di là è `rsplit('/')` scritto sul posto) ed è qui
/// perché [`pageName`] la usa.
export function childName(path: string): string {
  return path.split("/").pop() ?? path;
}

/// Il "nome pagina" di un `DocId`: basename senza l'ultima estensione.
///
/// Gemella di `DocId::page_name`. Si toglie ciò che segue l'ultimo punto, a
/// meno che il punto sia il primo carattere del basename — un dotfile non ha
/// estensione, il punto è parte del nome.
///
/// Non consulta le estensioni *gestite* (`VaultInfo.extensions`): un `DocId`
/// arriva dal vault, quindi un'estensione gestita ce l'ha già, e filtrarci sopra
/// era proprio ciò che faceva dissentire risoluzione e display — per
/// `note.backup` il kernel risolveva `note` e la UI mostrava `note.backup`.
export function pageName(id: string): string {
  const base = childName(id);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/// La chiave con cui due nomi si scoprono lo stesso nome: trim, NFC, minuscolo.
///
/// Gemella di `fubmd_abi::rules::path::resolution_key`, ed è **l'unico** modo in
/// cui questa parte del codice ha il diritto di confrontare due nomi di
/// documento. Il `toLowerCase()` da solo non basta: un vault sincronizzato con
/// macOS ha i nomi file in NFD (`e` + accento combinante) mentre il link
/// digitato è NFC, e senza `normalize` la folder note di `Città/` non si trova e
/// il nome ambiguo non si riconosce — su un vault Linux tutto sembra a posto,
/// che è il modo peggiore di sbagliare.
export function resolutionKey(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

/// Una casella è spuntata?
///
/// Gemella di `TaskMarker::checked()`: `x`/`X` è fatta, ogni altro simbolo — gli
/// stati personalizzati `[/]`, `[-]`, `[>]` — è uno stato **non** completato.
/// `null` è la casella vuota.
export function taskChecked(symbol: string | null): boolean {
  return symbol === "x" || symbol === "X";
}
