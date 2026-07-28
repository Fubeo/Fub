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
- [ ] **E questo banco ha già un abitante che aspetta**, che è il modo in cui la
      voce ha smesso di essere teorica: il presidio della §8.4
      ([0026](../decisions/0026-due-query-insieme.md)) — *due ricerche stanno
      nell'indice insieme* — è oggi `#[ignore]` in `features/src/search.rs`.
      Non perché la proprietà sia falsa: perché **ogni colonna misura una
      trentina di millisecondi**, e a quella scala il tempo se lo prendono lo
      spawn dei thread e lo scheduling, che non scalano coi core. Su un runner
      condiviso il rapporto è venuto 0,97 con la suite verde in locale, cioè il
      presidio ha smesso di misurare la propria proprietà e ha cominciato a
      misurare il vicino di banco. Serve un carico che domini l'overhead **e**
      una macchina che non divida i core: sono le due cose che questa voce
      chiede, ed è la ragione per cui un test di prestazioni non può stare in
      mezzo agli altri e girare a ogni push. Finché non c'è, si lancia a mano
      (`cargo test -p fubmd-features --lib due_ricerche -- --ignored`).
- [ ] **Round-trip import/export**: il primo giro c'è con la [decisione 0006](../decisions/0006-import-export-come-trait.md)
      (`transfer_e2e.rs`: un vault esce in artefatti e rientra identico), ma su
      un vault scritto a mano. Resta da farlo **sul corpus** di qui sopra, dove
      la proprietà smette di essere un esempio e diventa una misura.

### 17.2 Test della shell

*ex §4.4 · presidi · **P2** — gira contro l'host finto della 1.3*

- [ ] **E2E** dell'app reale (tauri-driver/Playwright) sui flussi critici:
      apri vault, scrivi, rinomina, cerca, ripristina.
- [x] **Il check di accessibilità automatico è stato spostato al §12.4**, che
      possedeva già l'argomento («passata di accessibilità strutturale: ruoli
      ARIA, focus visibile, focus trap, navigazione da tastiera, skip link»). Due
      ragioni. La prima è che un presidio senza la passata che deve presidiare
      non ha niente da tenere fermo: si scrive **dopo**, e allora si scrive dove
      sta lei. La seconda è **il criterio di questa seduta applicato a se
      stesso**: qui si tiene ciò il cui costo *cresce* con l'attesa, e questo è
      l'unico caso in cui **cala**. I pannelli sono alberi `UiNode`, e la
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ci ha aggiunto
      venticinque specie di nodo, dieci superfici e i metadati di come una view
      si presenta: un check scritto prima avrebbe presidiato un DOM che quella
      seduta ha sostituito. Ora la resa è ferma, e la passata di accessibilità
      ha finalmente qualcosa di stabile su cui girare — resta il fatto che si
      scrive **dopo** la passata, dove sta lei.
      **Fatto**, insieme alla passata, dalla
      [decisione 0042](../decisions/0042-il-catalogo-della-shell.md):
      `frontend/src/ui/a11y-check.ts` e il suo presidio, che gira sulla scocca
      vera. La previsione era giusta — il costo è calato, e il check presidia
      una resa che nel frattempo si era fermata.

### 17.3 Osservabilità

*ex §4.5 · presidi · **P2** — raccolto dal diagnostic bundle della 15.2*

- [ ] **`tracing` al posto di `eprintln!`** con log su file, livelli
      configurabili e log per-plugin; il diagnostic bundle (§15.2) lo raccoglie.
