# HANDOFF — completare integralmente audit e superfici di editing

Sei il successore dell'agente che sta lavorando sul repository `Fubeo/Fub`.

Il tuo compito **non è produrre un resoconto, non è chiudere un singolo gate e non è fermarti a un checkpoint verde**. Devi continuare autonomamente finché **entrambi** i workstream indicati sotto non hanno raggiunto integralmente la propria Definition of Done.

## Le due fonti operative da completare

Leggi integralmente, prima di agire:

1. [`PIANO-AZIONE-FUB-AUDIT-2026-09-01.md`](PIANO-AZIONE-FUB-AUDIT-2026-09-01.md) — piano operativo dell'audit, dei 56 finding, dei contratti C-01..C-10 e dei gate G0..G15;
2. [`docs/project/todo-superfici-di-editing-condivise.md`](docs/project/todo-superfici-di-editing-condivise.md) — piano/TODO delle superfici di editing condivise.

Leggi inoltre `AGENTS.md`, `CONTRIBUTING.md` e la documentazione canonica pertinente prima di modificare le rispettive aree.

Il primo documento governa la sicurezza dell'audit, la readiness Phase 9 e il vincolo sul merge. Il secondo governa il completamento tecnico delle superfici condivise. Se emergesse un conflitto, **non indebolire mai i contratti non negoziabili dell'audit**: applica l'interpretazione compatibile più restrittiva e documenta la decisione.

## Regola assoluta: non fermarti dopo uno solo dei due TODO

Non dichiarare concluso questo incarico quando l'audit raggiunge `READY FOR PHASE 9` o `GO` se il TODO delle superfici è ancora aperto.

Non dichiarare concluso questo incarico quando il TODO delle superfici è completato se l'audit ha ancora gate, finding, rischi bloccanti o verifiche aperte.

**L'incarico è concluso soltanto quando entrambi i workstream sono realmente completi e verificati.**

Finché esiste un passo operativo determinabile e consentito, eseguilo. Se una CI è rossa, individua il primo errore reale, correggilo, rilancia e continua. Se un workstream è temporaneamente bloccato da un impedimento esterno non risolvibile, registra causa ed evidenza e continua ogni attività indipendente dell'altro workstream o dello stesso piano che non dipende da quel blocco.

## Workstream A — audit completo

Non fidarti degli SHA o degli stati riportati in questo handoff: **rifetcha sempre lo stato live** della branch prima di operare.

Devi portare il piano audit fino alla sua conclusione reale, rispettandone dipendenze, criteri di stop e gate. In particolare:

- riconcilia la baseline live prima di affidarti a snapshot storici;
- lavora su `fix/audit-integration` e non modificare `main` prima dell'autorizzazione prevista dal piano;
- completa G0..G15 senza saltare i gate dipendenti;
- chiudi `ARCH-001` dal call graph completo, non dai messaggi di commit;
- dimostra C-01..C-10 senza workaround o test indeboliti;
- porta la matrice a 56/56 finding con evidenza completa;
- prima di G14 devono esserci 0 `NOT_RECONSTRUCTED`, 0 `PARTIAL` e 0 `IMPLEMENTED_UNVERIFIED`;
- ogni patch critica deve avere regressione pertinente e documentazione coerente;
- nessun callback provider/codice esterno deve restare sotto `Custody<Workspace>`;
- nessun `Host::workspace` generico deve diventare una scorciatoia;
- nessun WIT frozen esistente deve essere modificato;
- storage, CAS, mount, ABI/WASM, UI/THEME, SEC, DOC/PLAN e architettura residua devono soddisfare i gate del piano;
- rimuovi ogni `.audit-*`, workflow monouso, log/helper e scaffolding temporaneo prima della certificazione finale;
- certifica lo **stesso SHA finale** con tutti i job richiesti, inclusi Ubuntu, macOS, Windows, Rust/fmt/Clippy, invarianti, client, documentazione, visual/accessibilità, supply-chain e SBOM dove previsti;
- registra un `GO` esplicito secondo G15 prima di qualsiasi merge in `main`.

Non confondere un workflow helper verde con una certificazione finale.

## Workstream B — superfici di editing condivise

Completa integralmente `docs/project/todo-superfici-di-editing-condivise.md` secondo la sua sequenza tecnica e la sua Definition of Done.

Al momento della stesura di questo handoff il file dichiarava fasi 0–4 concluse e fasi 5–10 aperte; **questo è solo uno snapshot e va riconciliato con il tree live**.

Devi quindi chiudere ogni elemento ancora realmente aperto, includendo dove richiesto dal TODO:

- `DocumentSurfaceRegistry`, selezione/fallback e ownership/unregister;
- modalità e arbitrato tastiera per superficie;
- vertical slice `.fubsheet` e `GridEngine`;
- riuso di `TextEngine` per formula bar e cell editor;
- separazione corretta di undo testuale e undo del foglio;
- accessibilità e banchi visuali della griglia;
- protocollo incrementale e limiti payload;
- contratti pubblici/ABI/WIT/SDK/host nativo/WASM soltanto quando i criteri del TODO lo richiedono;
- fallback e negoziazione;
- lifecycle senza renderer, timer, observer, listener o istanze orfane;
- tutti gli invarianti, test, guardie, documentazione e ADR richiesti;
- tutta la CI pertinente verde.

Non spuntare checklist sulla base dell'intenzione: il comportamento deve essere realmente consegnato nel punto previsto dal TODO. Quando la Definition of Done è interamente soddisfatta, applica anche la regola di gestione finale del TODO (confluenza delle invarianti stabili nella documentazione/ADR ed eliminazione del TODO quando previsto).

## Disciplina Git e concorrenza

Prima di **ogni write**:

1. rifetcha `fix/audit-integration`;
2. verifica l'HEAD corrente;
3. verifica lo SHA corrente dei file che modifichi;
4. se la branch è avanzata, confronta il lavoro concorrente e integralo soltanto se compatibile;
5. non forzare mai una ref per cancellare lavoro concorrente.

Mai force-push. Mai reset distruttivi. Mai sovrascrivere alla cieca. Non usare CodeRabbit.

Mantieni commit semantici piccoli e verificabili. I commit `ci(temp): ...` sono soltanto strumenti diagnostici e devono sparire dal tree semantico finale insieme al relativo scaffolding.

## Snapshot osservato durante la creazione di questo handoff

Questo snapshot **non è una baseline da imporre**; serve solo a riconoscere eventuale drift:

- repository: `Fubeo/Fub`;
- branch di lavoro: `fix/audit-integration`;
- HEAD osservato prima della materializzazione documentale: `b70dbc39205c11beae72e16c84897ac2ffd48397` (`ci(temp): prova la tranche query G3`);
- `main` osservato: `96eba1695bcb8b92af3cd8e70c1b085f10e849c9`;
- il lavoro G3 era attivo e la branch poteva avanzare durante questa stessa operazione.

Rifetcha quindi immediatamente: **vince sempre lo stato live compatibile con la cronologia, non questo snapshot**.

## Condizione finale dell'incarico

Puoi fermarti soltanto quando sono vere entrambe queste condizioni:

1. il piano audit ha raggiunto la propria conclusione verificata, incluso G15/GO secondo i suoi criteri;
2. `docs/project/todo-superfici-di-editing-condivise.md` ha soddisfatto integralmente la propria Definition of Done ed è stato chiuso/ritirato secondo le sue regole.

Se anche una sola delle due condizioni manca, **NON HAI FINITO**.
