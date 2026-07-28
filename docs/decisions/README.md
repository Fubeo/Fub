# Decisioni

Qui stanno i **verbali** delle decisioni chiuse: il ragionamento con cui una
voce è stata risolta, cosa si è scartato e perché, e cosa resta scoperto dopo.
Non stanno in `todo.md` perché quel file è l'elenco di ciò che **resta da
fare**, e chi ci va dentro cerca il lavoro aperto, non l'archivio; ma buttarli
via non si può, perché sono «il perché, che è ciò che fra sei mesi non si
ricostruisce dal diff» (la frase è del §1.5, ora [decisione 0003](0003-modello-del-documento.md)).
Un file per decisione, numerazione progressiva e immutabile, in ordine
cronologico di chiusura.

| # | Decisione | § di provenienza | Data |
|---|---|---|---|
| [0001](0001-supply-chain-e-sbom.md) | Supply chain e compliance — la sola parte che non si recupera dopo | §4.9 | 2026-07-26 |
| [0002](0002-additivita-del-contratto.md) | L'additività del contratto è una promessa senza presidio | §4.10 | 2026-07-26 |
| [0003](0003-modello-del-documento.md) | Modello del documento — le lacune che si vedono solo a valle | §1.5 | 2026-07-26 |
| [0004](0004-il-grafo-e-i-link-non-wiki.md) | Il grafo conosce solo i wikilink — e la promessa vale a metà, in silenzio | §2.21 | 2026-07-26 |
| [0005](0005-canale-dati-verso-le-view.md) | `IndexQuery` — il canale dati verso le view | §1.6 | 2026-07-26 |
| [0006](0006-import-export-come-trait.md) | Import/export come trait, non come codice dell'app | §1.7 | 2026-07-26 |
| [0007](0007-contesto-di-sessione.md) | Contesto di una view — `active_document()` non regge tab, split né selezione | §1.9 | 2026-07-26 |
| [0008](0008-modifica-chirurgica.md) | Modificare un pezzo di documento — la primitiva che non c'è | §1.16 | 2026-07-26 |
| [0009](0009-registro-dei-comandi.md) | Comandi — il trait più importante che nessuno usa | §1.1 | 2026-07-26 |
| [0010](0010-comando-descritto-a-una-macchina.md) | Un comando si descrive a un umano, non a una macchina | §1.36 | 2026-07-26 |
| [0011](0011-il-lotto.md) | Il lotto — il kernel muta **un documento alla volta** | §1.12 | 2026-07-26 |
| [0012](0012-origine-degli-eventi.md) | Gli eventi non dicono chi li ha causati | §1.18 | 2026-07-26 |
| [0013](0013-elenco-delle-capacita.md) | `HostApi` — chiudere l'elenco delle capacità prima del freeze | §1.4 | 2026-07-26 |
| [0014](0014-i-verbali-fuori-da-todo.md) | La memoria del progetto sta in un file solo | §4.13 | 2026-07-26 |
| [0015](0015-la-forma-della-shell.md) | La forma della shell, e l'unica porta verso l'host | §1.1 + §1.3 | 2026-07-26 |
| [0016](0016-cosa-e-una-view.md) | Cosa è una view | §2.1–§2.8 | 2026-07-26 |
| [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) | Chi disegna ciò che il core non conosce | §3.1–§3.6 | 2026-07-26 |
| [0018](0018-chi-vede-il-modello-parsato.md) | Chi vede il modello parsato | §4.1–§4.3 | 2026-07-27 |
| [0019](0019-il-canale-dati.md) | Il canale dati: chi risponde, e chi instrada | §5.1–§5.5 | 2026-07-27 |
| [0020](0020-le-regole-in-un-posto-solo.md) | Le regole in un posto solo | §6.1–§6.2 | 2026-07-27 |
| [0021](0021-il-confine.md) | Il confine: quante volte si scrive la disciplina | §7.1–§7.6 | 2026-07-27 |
| [0022](0022-il-kernel-a-pezzi.md) | Il kernel a pezzi: cinque proprietari invece di ventiquattro campi | §8.1 | 2026-07-27 |
| [0023](0023-chi-monta-il-kernel.md) | Chi monta il kernel: un crate `fubmd-host`, e l'app ridotta a colla | §8.2 | 2026-07-27 |
| [0024](0024-chi-legge-non-aspetta-chi-legge.md) | Il lock: chi legge non aspetta chi legge, e chi salva non aspetta per sempre | §8.3 | 2026-07-27 |
| [0025](0025-la-ricerca-predefinita.md) | La ricerca predefinita: di classe *omnisearch*, e built-in | [FEATURES](../FEATURES.md) §9.1 → **apre** la [seduta 21](../roadmap/21-la-ricerca-predefinita.md) | 2026-07-27 |
| [0026](0026-due-query-insieme.md) | Due query insieme: nessuna dichiarazione, una misura | §8.4 | 2026-07-27 |
| [0027](0027-il-lavoro-lungo-vede-il-vault.md) | Il lavoro lungo vede il vault: un host per chiamata, non uno snapshot | §9.1 | 2026-07-27 |
| [0028](0028-come-un-componente-smette.md) | Come un componente smette: una chiusura obbligatoria, e una disattivazione che toglie davvero | §9.2 + §9.4 | 2026-07-27 |
| [0029](0029-chiudere-un-vault-e-chiuderli-tutti.md) | Chiudere un vault, e chiuderli tutti: l'ultimo giro, il punto di consistenza, e la mappa che il backend non aveva | §9.5 + §9.6 | 2026-07-27 |
| [0030](0030-il-rilevamento-si-puo-chiedere.md) | Il rilevamento si può chiedere: una bandiera sola, e gli esiti che smettono di essere buttati | §9.7 | 2026-07-27 |
| [0031](0031-chi-possiede-i-bundle.md) | Chi possiede i bundle: una strada sola per montare, e chi smette avvisato mentre è ancora intero | §9.3 (**prima metà**) | 2026-07-27 |
| [0032](0032-il-runner-dei-job.md) | Il runner dei job: chi esegue, chi lo può fermare, e chi non si porta via il vault | §9.3 (**seconda metà**) — chiude la voce e la [seduta 9](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md) | 2026-07-27 |
| [0033](0033-la-grana-di-un-abbonamento.md) | La grana di un abbonamento: il topic, il soggetto, e i prefissi che non sono `starts_with` | §10.1 | 2026-07-28 |
| [0034](0034-il-freno-e-il-raggruppamento.md) | Il freno e il raggruppamento: il tetto sta con chi ritira, la finestra è la velocità di chi consuma | §10.2 | 2026-07-28 |
| [0035](0035-il-lavoro-lungo-si-racconta.md) | Il lavoro lungo si racconta: chi guarda, cosa vede, e chi mette il nome sul progresso | §10.3 — chiude la [seduta 10](../roadmap/10-gli-eventi.md) | 2026-07-28 |
| [0036](0036-le-impostazioni-e-i-tre-stati.md) | Le impostazioni: chi dichiara una chiave, dove sta il suo valore, e chi la può scrivere | §11.1 — chiude il primo residuo della [0010](0010-comando-descritto-a-una-macchina.md) | 2026-07-28 |
| [0037](0037-lo-stato-di-vista.md) | Lo stato di vista: di chi è lo scroll, dove vive, e perché non viaggia col vault | §11.2 (**prima metà**) — resta il layout | 2026-07-28 |

Una decisione nuova prende il numero successivo — mai uno già usato, nemmeno se
il verbale che lo portava è stato superato — e il verbale ci si sposta **intero**
nel momento in cui la voce di `todo.md` si chiude.

La [0037](0037-lo-stato-di-vista.md) è il secondo caso di mezza voce, e
diversamente dal primo la seconda metà **non ha ancora una data**: il layout del
§11.2 aspetta il modello di layout, perché oggi l'area principale è un pannello
solo e non c'è nessuna disposizione da salvare. La voce resta aperta, come deve.

La [0031](0031-chi-possiede-i-bundle.md) è la prima che ne ha chiusa **mezza**:
il §9.3 chiedeva quattro cose, e le ultime tre — il runner, la cancellazione,
l'isolamento — andavano decise insieme o la prima si sarebbe riscritta per fare
posto alle altre. La voce è rimasta aperta finché non è arrivato il secondo
verbale, la [0032](0032-il-runner-dei-job.md), che la chiude: le due si leggono
in fila, e ognuna porta in testa il rimando all'altra. Un verbale per *pezzo di
voce* si scrive quando il pezzo è una decisione intera, non quando il lavoro è
lungo: il criterio è sempre quello, un ragionamento che fra sei mesi non si
ricostruisce dal diff.

La [0025](0025-la-ricerca-predefinita.md) è l'altra eccezione, ed è dichiarata come
tale: non chiude una voce, ne **apre** nove. Sta qui lo stesso perché il criterio
di questa cartella è il *perché*, non la direzione: chi fra un anno troverà nel
contratto congelato un modo di chiedere una ricerca tollerante ai refusi deve
poter leggere perché quella scelta è finita in una firma WIT invece che dentro un
provider.
