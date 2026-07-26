# 17. I presidi che restano

Una **seduta** della [roadmap infrastrutturale](../todo.md): senza precedenze e senza scadenza — il criterio è se il costo cresce con l'attesa.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci senza precedenze e senza scadenza, che non bloccano nulla e per questo
rischiano di non essere fatte mai. Il criterio con cui giudicarle è quello che il
piano ha già applicato alla supply chain
([decisione 0001](../decisions/0001-supply-chain-e-sbom.md)): non «quanto sblocca»,
ma **se il costo cresce con l'attesa**. Per il corpus cresce (ogni sintassi nuova
è un caso in più da scrivere a posteriori); per gli e2e e per il tracing no.

### 17.1 Corpus, fuzzing, prestazioni

*ex §4.3 · presidi · **P2** — il round-trip import/export ha già il primo giro (decisione 0006)*

- [ ] **Fuzzing del parser** markdown (e dell'HTML in ingresso): 5.3 lo chiede
      esplicitamente, e un parser che pania è un vault che non si apre.
- [ ] **Corpus di conformità** CommonMark/GFM + snapshot Obsidian-flavored.
- [ ] **Benchmark su vault sintetici grandi** (10k/100k note) in CI, con soglie:
      tempo di apertura, ricerca, memoria. Senza numeri, "supporto vault enormi"
      non è verificabile.
- [ ] **Round-trip import/export**: il primo giro c'è con la [decisione 0006](../decisions/0006-import-export-come-trait.md)
      (`transfer_e2e.rs`: un vault esce in artefatti e rientra identico), ma su
      un vault scritto a mano. Resta da farlo **sul corpus** di qui sopra, dove
      la proprietà smette di essere un esempio e diventa una misura.

### 17.2 Test della shell

*ex §4.4 · presidi · **P2** — gira contro l'host finto della 1.3*

- [ ] **E2E** dell'app reale (tauri-driver/Playwright) sui flussi critici:
      apri vault, scrivi, rinomina, cerca, ripristina.
- [ ] **Check di accessibilità** automatico sui pannelli.

### 17.3 Osservabilità

*ex §4.5 · presidi · **P2** — raccolto dal diagnostic bundle della 15.2*

- [ ] **`tracing` al posto di `eprintln!`** con log su file, livelli
      configurabili e log per-plugin; il diagnostic bundle (§15.2) lo raccoglie.
