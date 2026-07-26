# 6. Le regole in un posto solo

Una **seduta** della [roadmap infrastrutturale](../todo.md): la stessa regola serve a tre consumatori: provider, shell, e a M5 un guest WASM.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Due voci, una seduta, e il sesto giro dice perché: la stessa risposta serve a
tre consumatori — i provider (che oggi non vedono le regole del kernel), la
shell (che le riscrive in TypeScript) e, a M5, un guest WASM. Vanno decise
insieme, **o le regole salgono nel contratto per i provider e restano duplicate
per la shell**.

Il §6.2 non ha una precedenza dura ma ha una scadenza morbida: ogni regola che
nasce prima di lui nasce senza presidio, e il capitolo 15 da solo ne porta sei.

### 6.1 Le regole che il contratto promette vivono nel kernel, private

*ex §1.37 · contratto · **P1** — additiva, quindi non scade — ma va con la 6.2*

- [ ] **Quattro `mod` senza `pub`**: `health`, `pathlink`, `properties`,
      `tag_counts` (`kernel/src/lib.rs:19-23`). Dentro ci sono esattamente le
      regole che la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) dichiara «in un posto solo»: come si confrontano due
      `PropertyValue` e cosa succede fra specie diverse (falso, non errore),
      dove ordina chi non ha la chiave, chi rompe la parità, come un path
      relativo diventa `DocId` (prima l'esatto, poi il senza estensione), come
      si normalizza una chiave di risoluzione, cosa conta come link rotto.
- [ ] **Ma «un posto solo» è vero finché l'implementazione è una.** Sono regole
      del **contratto** — la risposta a `IndexQuery::Properties` è la stessa
      domanda per chiunque la serva — e stanno in un crate che un provider non
      ha fra le mani: `fubmd-features` non dipende dal kernel *per invariante*,
      e un guest WASM a M5 nemmeno. Il secondo che le rifà risponderà
      diversamente alla stessa query, e la differenza non la vede nessun test,
      perché i due non si confrontano mai.
- [ ] **È il §4.2 visto dal lato delle regole invece che dei dati**: quello
      dice che un provider non vede la *struttura* di un documento, questo che
      non vede le *regole* con cui il kernel la interroga. E si compone col
      §5.1: finché il canale dati è kernel-owned la seconda implementazione non
      esiste, quindi il difetto non si vede; appena il canale si apre, esiste.
- [ ] **Il precedente è già in repo, e va letto come tale**: la [decisione 0003](../decisions/0003-modello-del-documento.md) ha fatto
      salire `heading_slug` e `canonical_tag` nel contratto **da funzioni
      private del provider markdown**, per la ragione identica — due provider
      davano due id allo stesso titolo. Questa voce è la stessa mossa applicata
      al kernel invece che a un provider.
- [ ] La forma da decidere: le funzioni pure salgono in `fubmd-abi`
      (`abi/src/rules/`) o nell'SDK (`sdk/src/rules/`), e il kernel le usa da
      lì. In `fubmd-abi` è additivo ed è raggiungibile anche da un guest — il
      crate è senza dipendenze pesanti (serde, serde_json, thiserror) e resta
      dentro l'invariante; nell'SDK è più comodo, ma rende l'SDK obbligatorio
      per chiunque voglia essere d'accordo col kernel. Il §6.2 ha bisogno della
      stessa risposta per un terzo consumatore (il TypeScript), quindi le due
      voci vanno decise insieme.

*Sblocca:* 9.2 (query di terzi che rispondono come il kernel), 22.1 (indice
semantico e vettoriale), 11 (colonne e funzioni di database), 15.1, 21.2 — e
rende utile il §5.1, che senza regole condivise sposterebbe soltanto il
problema dentro il primo provider che arriva.

### 6.2 I *tipi* al confine hanno un presidio; le *regole* no

*ex §4.11 · presidi · **P1** — leva alta: moltiplica per il numero di linguaggi in cui la stessa regola va scritta*

- [ ] **`ts_mirror.rs` + `mirror.test.ts` presidiano i tipi**, e sono uno dei
      test migliori del repo: nessuno dei due lati può cambiare da solo restando
      verde. Nessuno presidia le **regole**, che sono già scritte due volte:

| Regola | Rust | TypeScript |
|---|---|---|
| nome pagina di un `DocId` | `DocId::page_name` | `organizer.ts:43` |
| spunta di un task (`x`/`X`) | `TaskMarker::checked()` ([decisione 0003](../decisions/0003-modello-del-documento.md)) | `livepreview.ts:344` |
| risoluzione folder-note senza distinzione di caso | `graph::normalize` | `organizer.ts:118-122` |
| offset byte ↔ code unit | `format-markdown/src/offsets.rs` | `offsets.ts` |
| grammatica di wikilink, tag, evidenziato, checkbox | comrak + `sdk::scan` | `livepreview.ts` |

- [ ] **Una che sembrava della famiglia e non lo è: l'ordinamento.**
      `Workspace::documents` fa `ids.sort()` — ordine di byte, e il commento su
      `VaultHealth` dice perché (`workspace.rs:481-485`, `:1409-1412`): una
      risposta paginata che cambiasse ordine fra una pagina e l'altra
      ripeterebbe e salterebbe righe. La sidebar usa
      `Intl.Collator("it", {sensitivity: "base", numeric: true})`
      (`organizer.ts:17`), che è l'ordine di lettura di un umano. Non sono due
      copie della stessa regola: sono **due requisiti diversi che devono
      divergere**, e una fixture condivisa nascerebbe rossa e resterebbe rossa.
      Quello che manca non è un presidio ma una decisione — *il kernel espone
      un ordine di presentazione, o l'ordine di presentazione è della shell?* —
      e finché non la si prende, `IndexQuery` pagina su una chiave che nessuna
      UI mostrerà mai in quell'ordine (§5.5, e la paginazione della
      [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md)).
- [ ] **Una sola delle cinque ha un test che le lega**
      (`docid_page_name_agrees_with_the_frontend_on_hostile_names`), scritto a
      mano, e il commento sopra `pageName` dice «è la stessa regola, riga per
      riga» — cioè dichiara la duplicazione invece di toglierla. È la forma
      giusta con lo strumento sbagliato: per i tipi la stessa cura ha prodotto
      una fixture generata; per le regole no.
- [ ] **Il §4.4 nomina il caso più visibile — i due parser — come scelta
      dichiarata, e per le decorazioni sintattiche ha ragione.** Ma i due parser
      sono un membro di una famiglia, non la famiglia: ogni regola che la UI
      deve conoscere **prima** di un giro IPC (autocompletamento, validazione
      mentre si digita, live preview, ordinamento della sidebar) nasce in due
      copie. In arrivo: path policy e nomi riservati (§15.5), ignore policy
      (§15.6), slugify e ancore ([decisione 0003](../decisions/0003-modello-del-documento.md)), la convenzione `free_name` D3,
      canonicalizzazione dei tag, l'AST di query (§5.3). Sono altre sei.
- [ ] **Il minimo, che si fa adesso e vale per tutte quelle future**: un
      `crates/fubmd-abi/tests/rules_mirror.rs` che genera
      `frontend/src/__fixtures__/rules-*.json` — casi input→output — con il
      gemello vitest, esattamente il giro di `mirror-samples.json`
      (`UPDATE_MIRROR=1` rende rosso l'altro lato). La duplicazione resta, ma
      entra sotto lo stesso presidio dei tipi, e ogni regola nuova nasce con la
      sua fixture invece che con un commento.
- [ ] **Fine corsa**: `fubmd-abi` compilato a `wasm32-unknown-unknown` in
      `frontend/src/rules/` (la cartella c'è, decisione 0015) e la duplicazione sparisce. È praticabile
      proprio perché l'invariante del crate è stata tenuta — serde, serde_json,
      thiserror e nient'altro — ed è la stessa cartella che il §6.1 popola dal
      lato Rust: le due voci vanno decise insieme, o le regole salgono nel
      contratto per i provider e restano duplicate per la shell.

*Sblocca:* 4.2 e 5.2 (una sintassi nuova scritta una volta), 2.3 e 8.3 (naming e
path policy coerenti fra kernel e UI), 25.2 (collazione), 26.3 (una shell che
gira senza il backend ha comunque le regole giuste).
