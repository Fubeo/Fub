# HANDOFF — completare integralmente audit e superfici di editing

Sei il successore dell'agente che sta lavorando sul repository `Fubeo/Fub`.

Il tuo compito **non è produrre un resoconto, non è chiudere un singolo gate e non è fermarti a un checkpoint verde**. Devi continuare autonomamente finché **tutti** i workstream indicati sotto non hanno raggiunto integralmente la propria Definition of Done.

## Le due fonti operative da completare

Leggi integralmente, prima di agire:

1. [`PIANO-AZIONE-FUB-AUDIT-2026-09-01.md`](PIANO-AZIONE-FUB-AUDIT-2026-09-01.md) — piano operativo dell'audit, dei 56 finding, dei contratti C-01..C-10 e dei gate G0..G15;
2. [`docs/project/todo-superfici-di-editing-condivise.md`](docs/project/todo-superfici-di-editing-condivise.md) — piano/TODO delle superfici di editing condivise.

Leggi inoltre `AGENTS.md`, `CONTRIBUTING.md` e la documentazione canonica pertinente prima di modificare le rispettive aree.

Il primo documento governa la sicurezza dell'audit, la readiness Phase 9 e il vincolo sul merge. Il secondo governa il completamento tecnico delle superfici condivise. Se emergesse un conflitto, **non indebolire mai i contratti non negoziabili dell'audit**: applica l'interpretazione compatibile più restrittiva e documenta la decisione.

## Riconciliazione operativa del 9 settembre 2026

Il piano audit resta vigente: **NOT READY FOR PHASE 9 — NON MERGIARE IN main**.
Questa decisione non ritira G14/G15 e non accetta rischi per implicito. La CI
verde di una PR M5 o documentale non autorizza il merge in `main`.

La verifica live ha confrontato `main` a
`cf50f60fd17e53d11e74ff2e7af96d572f69b10e` con `fix/audit-integration` a
`1b1187065e65b8ebec72996adc700c95208ff0a3`. L'antenato comune è
`96eba1695bcb8b92af3cd8e70c1b085f10e849c9`: 284 commit audit erano assenti da
main e due commit main erano assenti dalla linea audit. Gli SHA precedenti
nel piano e nell'handoff restano snapshot storici, non istruzioni di reset.
La correzione #22 va preservata; non è un bug da riaprire senza regressione.

La [PR #25](https://github.com/Fubeo/Fub/pull/25) propone la riconciliazione
verso la sola linea audit, conservando entrambe le storie. La
[PR #26](https://github.com/Fubeo/Fub/pull/26) ne usa il candidato come base
per portare soltanto la discovery di #23, senza sovrascrivere `BundleMount`,
il default-deny o i test audit. Nessuna delle due completa #8 o C-04.

Il resto di [#23](https://github.com/Fubeo/Fub/pull/23) richiede mount,
invocazione e teardown senza callback sotto `Custody<Workspace>` e consenso
esplicito prima di activate. Il vecchio passaggio `plugin()` → `register()`
con Weak non deve sostituire il lifecycle esplicito già introdotto dall'audit.
Solo dopo questo adattamento si riallinea e integra
[#24](https://github.com/Fubeo/Fub/pull/24) nella linea corretta, aggiornando la
prosa al risultato reale. Ogni nuovo SHA o base richiede nuova certificazione.

Prima di qualunque merge ricontrollare entrambe le branch, piano, diff e CI.
L'integrazione in una branch audit non è un G15/GO e non certifica il successivo
SHA risultante. Nessun finding cambia stato per effetto di questa decisione.

## Regola assoluta: non fermarti dopo uno solo dei due TODO

Non dichiarare concluso questo incarico quando l'audit raggiunge `READY FOR PHASE 9` o `GO` se il TODO delle superfici è ancora aperto.

Non dichiarare concluso questo incarico quando il TODO delle superfici è completato se l'audit ha ancora gate, finding, rischi bloccanti o verifiche aperte.

**L'incarico è concluso soltanto quando audit, superfici e gli altri workstream di roadmap richiesti sono realmente completi e verificati.**

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

## Workstream C — roadmap e prima release

L'incarico del 9 settembre estende, non sostituisce, i due TODO. L'ordine del
lavoro prodotto è M5 (#8/#10), affidabilità dati (#5/#7), Graph View (#12/#6),
evidenze visuali (#17), superfici (#11), temi (#13), decisione esplicita su #9
e prima release. Le dipendenze di sicurezza dell'audit restano vincolanti.

#17 richiede anche revisione del foglio di contatto e ripetibilità, non solo
un job verde. #11 riparte dalle fasi 5–10, senza rifare le fasi 0–4 concluse.
#9 va completata se blocker oppure motivatamente classificata come lavoro
successivo nella roadmap, senza chiuderla artificialmente. Versione, tag,
artifact, compatibilità e distribuzione seguono le regole correnti del repo.

La conclusione richiede i criteri di accettazione di tutte le issue applicabili,
la prima release verificata e G14/G15 sul candidato finale. Il verde di un
incremento, la sola integrazione di #23 o la fine di M5 non sono punti di uscita.

## Disciplina Git e concorrenza

Prima di **ogni write**:

1. rifetcha `fix/audit-integration`;
2. verifica l'HEAD corrente;
3. verifica lo SHA corrente dei file che modifichi;
4. se la branch è avanzata, confronta il lavoro concorrente e integralo soltanto se compatibile;
5. non forzare mai una ref per cancellare lavoro concorrente.

Mai force-push. Mai reset distruttivi. Mai sovrascrivere alla cieca. Non usare CodeRabbit.

Mantieni commit semantici piccoli e verificabili. Non creare nuovi helper `.audit-*` o workflow audit monouso: le istruzioni storiche che li proponevano non sono più operative. La loro eventuale rimozione dal tree non autorizza riscritture distruttive della cronologia. Usa test e workflow permanenti.

## Snapshot osservato durante la creazione di questo handoff

Questo snapshot **non è una baseline da imporre**; serve solo a riconoscere eventuale drift:

- repository: `Fubeo/Fub`;
- branch di lavoro: `fix/audit-integration`;
- HEAD osservato prima della materializzazione documentale: `b70dbc39205c11beae72e16c84897ac2ffd48397` (`ci(temp): prova la tranche query G3`);
- `main` osservato: `96eba1695bcb8b92af3cd8e70c1b085f10e849c9`;
- il lavoro G3 era attivo e la branch poteva avanzare durante questa stessa operazione.

Rifetcha quindi immediatamente: **vince sempre lo stato live compatibile con la cronologia, non questo snapshot**.

## Condizione finale dell'incarico

Puoi dichiarare il lavoro terminato soltanto quando sono vere tutte queste condizioni:

1. il piano audit ha raggiunto la propria conclusione verificata, incluso G15/GO secondo i suoi criteri;
2. `docs/project/todo-superfici-di-editing-condivise.md` ha soddisfatto integralmente la propria Definition of Done ed è stato chiuso/ritirato secondo le sue regole;
3. tutti gli altri workstream applicabili del Workstream C e la prima release sono verificati, con issue e documentazione coerenti e tutta la CI obbligatoria verde sullo stesso candidato finale.

Se anche una sola condizione manca, **NON FINITO**: indicare il prossimo gate, i commit prodotti, le prove effettive e i controlli mancanti senza presentarli come completati.
