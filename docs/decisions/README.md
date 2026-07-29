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
| [0038](0038-il-kernel-possiede-il-sidecar.md) | Il kernel possiede il sidecar: chi scrive l'organizzazione, e chi la porta dietro a un rename | §11.3 | 2026-07-28 |
| [0039](0039-il-locale-e-il-caso.md) | Il locale e il caso: ciò che l'host sa e nessuno gli aveva chiesto | §12.3 | 2026-07-28 |
| [0040](0040-chi-localizza.md) | Chi localizza: il testo che porta la propria provenienza | §12.1 | 2026-07-28 |
| [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) | Un errore è testo che qualcuno legge — e una domanda su cui qualcuno rama | §12.2 | 2026-07-28 |
| [0042](0042-il-catalogo-della-shell.md) | Il catalogo della shell, e la luce in cui si legge | §12.4 — chiude la [seduta 12](../roadmap/12-stringhe-errori-locale.md) | 2026-07-28 |
| [0043](0043-il-path-e-la-chiave.md) | Il path è la chiave, e un id stabile è una proprietà | §13.1 | 2026-07-28 |
| [0044](0044-lo-stato-per-documento.md) | Lo stato per-documento: un posto dichiarato, e chi ci passa dietro | §13.2 | 2026-07-28 |
| [0045](0045-l-undo-ha-due-pile.md) | L'undo ha due pile, e non si fondono | §13.3 — chiude la [seduta 13](../roadmap/13-identita-del-documento.md) | 2026-07-28 |
| [0046](0046-l-anagrafe-del-vault.md) | L'anagrafe del vault: cosa c'è, cosa ne so, e cosa non devo rileggere | §14.1 + §14.2 (**metà** della [seduta 14](../roadmap/14-entry-cartelle-lista.md)) | 2026-07-28 |
| [0047](0047-la-cartella-esiste-nel-kernel.md) | La cartella esiste nel kernel, e la lista si chiede per cartella | §14.3 + §14.4 ([seduta 14](../roadmap/14-entry-cartelle-lista.md)) | 2026-07-29 |
| [0048](0048-una-radice-sola.md) | Una radice sola, e la classe di un dato | §15.4 — la P0 della [seduta 15](../roadmap/15-il-disco.md) | 2026-07-29 |
| [0049](0049-una-posizione-dentro-un-documento.md) | Una posizione dentro un documento | §21.3 + §21.10 ([seduta 21](../roadmap/21-la-ricerca-predefinita.md)) | 2026-07-29 |
| [0050](0050-cosa-si-chiede-a-una-ricerca.md) | Cosa si chiede a una ricerca | §21.1 + §21.2 — con la 0049 chiude le quattro P0 della [seduta 21](../roadmap/21-la-ricerca-predefinita.md) | 2026-07-29 |
| [0051](0051-l-alimentazione-risponde.md) | L'alimentazione risponde, e risponde a lotti | §20.1 — l'**ultima P0** aperta del piano | 2026-07-29 |
| [0052](0052-cio-che-va-storto-e-un-evento.md) | Ciò che va storto è un evento, e il kernel smette di buttarlo | §20.2 (**meno una casella**) + §20.3 ([seduta 20](../roadmap/20-quando-qualcosa-va-storto.md)) | 2026-07-29 |
| [0053](0053-il-contratto-ha-una-sorgente.md) | Il contratto ha una sorgente, e due confini che non hanno la stessa forma | §16.4 + §16.5 ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-07-29 |
| [0054](0054-il-banco-del-lato-provider.md) | Il banco del lato provider: dove si prova un provider contro il contratto | §16.1 ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-07-29 |
| [0055](0055-il-banco-del-lato-host.md) | Il banco del lato host: un builder, perché i trentacinque non erano lo stesso vault | §16.2 ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-07-29 |
| [0056](0056-un-elenco-che-e-la-sorgente.md) | Un elenco che è la sorgente, e un insieme che il compilatore chiude | §16.7 — **meno la sua seconda metà**, che diventa la §16.8 ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-07-29 |
| [0057](0057-la-dieta-dell-ipc.md) | La dieta dell'IPC: un elenco che diventa rosso quando qualcosa si aggiunge | §16.6 (**meno una casella**) ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-07-29 |
| [0058](0058-un-nome-che-nasce.md) | Un nome che nasce non è un nome che c'è, e la sorgente è il file | §15.5 ([seduta 15](../roadmap/15-il-disco.md)) | 2026-07-29 |

Una decisione nuova prende il numero successivo — mai uno già usato, nemmeno se
il verbale che lo portava è stato superato — e il verbale ci si sposta **intero**
nel momento in cui la voce di `todo.md` si chiude.

La [0046](0046-l-anagrafe-del-vault.md) chiude **due voci in un verbale solo**,
ed è il caso opposto a quello della 0031/0032: là una voce era troppo grande per
un verbale, qui due voci erano lo stesso lavoro visto da due lati — il piano lo
diceva già («vanno fatte nella stessa passata»), e scriverle in due verbali
avrebbe voluto dire raccontare due volte la stessa scansione. La seduta 14 resta
aperta con le altre due, che sono l'altra coppia.

La [0044](0044-lo-stato-per-documento.md) è il primo verbale che esiste **per
via di un altro**: il §13.2 era una generalizzazione condizionale — «se
l'identità resta il path…» — e la [0043](0043-il-path-e-la-chiave.md) ha reso
vera la condizione. Le due si leggono in fila, come la 0031 e la 0032, ma per la
ragione opposta: là una voce era troppo grande per un verbale solo, qui erano due
voci e la prima ha deciso cosa fosse la seconda.

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

La [0049](0049-una-posizione-dentro-un-documento.md) e la
[0050](0050-cosa-si-chiede-a-una-ricerca.md) sono la prima **coppia decisa in una
volta sola**, e il taglio non è per numero di voci: la 0049 chiude le due che
chiedevano la stessa primitiva da due firme diverse (dove sta un risultato, dove
punta un riferimento), la 0050 le due che toccavano lo stesso record
(`TextQuery`). Deciderle in quattro verbali avrebbe voluto dire aprire due volte
la stessa firma; deciderle in uno avrebbe messo insieme due ragionamenti che non
si sostengono a vicenda. Il criterio resta quello della 0031/0032: un verbale è
un ragionamento intero, non una quota di lavoro.

La [0051](0051-l-alimentazione-risponde.md) e la
[0052](0052-cio-che-va-storto-e-un-evento.md) sono la seconda **coppia decisa in
una volta sola**, e la spartizione è di nuovo per ragionamento e non per numero
di voci: la 0051 dà un esito a chi non l'aveva, la 0052 gli dà una destinazione e
toglie di mezzo chi lo buttava. Ma c'è un precedente nuovo, ed è la 0052: chiude
**due voci meno una casella**. Il §20.3 si chiude intero; il §20.2 chiude la
forma — la variante, la severità, il soggetto, il primo consumatore — e lascia
dietro l'**adozione**, cioè i ventisette punti che scrivono su `stderr` e vanno
convertiti uno a uno. È il caso opposto alla mezza voce della
[0031](0031-chi-possiede-i-bundle.md): là mancava metà del *ragionamento* e la
voce è rimasta aperta, qui il ragionamento è intero e ciò che resta è lavoro che
non decide niente. Il criterio per distinguerli è sempre lo stesso: una casella
residua è ciò che si può fare **senza aprire un verbale**.

La [0053](0053-il-contratto-ha-una-sorgente.md) chiude due voci in un verbale
solo per la ragione della [0046](0046-l-anagrafe-del-vault.md) — erano lo stesso
lavoro visto da due lati — ma con una differenza che vale la pena: **lo diceva la
seduta, non il verbale**. Il file della [seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)
portava scritto in testa che «la 16.5 non è una voce autonoma: è la gamba TS della
domanda che pone la 16.4», e che deciderle separate avrebbe voluto dire decidere
due volte la stessa cosa, la seconda contro la prima. È il primo caso in cui
l'accorpamento è **dichiarato in anticipo** invece di essere scoperto scrivendo:
un cappello di seduta può decidere la forma del verbale che la chiuderà, ed è una
cosa che i cappelli fanno bene perché li si scrive guardando le voci insieme.

La [0054](0054-il-banco-del-lato-provider.md) e la
[0055](0055-il-banco-del-lato-host.md) sono la **terza coppia decisa in una volta
sola**, e portano il caso **opposto** a quello della 0053. Là il cappello della
seduta dichiarava in anticipo che due voci andavano chiuse **insieme**; qui lo
stesso cappello, con la stessa forma — una frase in testa che parla di entrambe
le voci —, dichiarava fra loro un **confine**: *«sono due banchi diversi… che non
possono stare nello stesso crate»*. E un confine fra due cose è precisamente ciò
che le rende due. Da tenere, perché altrimenti il precedente della 0053 si legge
storto: **un cappello va letto per cosa afferma, non per quante voci nomina** —
«sono la stessa domanda vista da due lati» chiede un verbale, «fra loro c'è un
confine» ne chiede due.

E ne inaugurano un altro, che è di metodo e non di forma: la 0054 chiude una voce
**smentendo un presidio che tutti credevano di avere**. Il cappello della seduta
16 diceva che il kernel dentro l'SDK «violerebbe l'invariante che
`dependency_invariant.rs` presidia»; quel file non nominava `fubmd-sdk` da
nessuna parte. È la **sesta** specie della famiglia che il §16.7 elenca, e la
peggiore: un conteggio invecchiato fa sopravvalutare una copertura, un *limite*
invecchiato la fa sottovalutare, ma una **garanzia dichiarata che non è mai
esistita** fa entrambe le cose insieme — e nessuno va a controllare una garanzia,
perché il motivo per cui la si scrive è smettere di doverci pensare.

La [0056](0056-un-elenco-che-e-la-sorgente.md) e la
[0057](0057-la-dieta-dell-ipc.md) sono la **quarta coppia decisa in una volta
sola**, e ripetono di proposito la forma che la 0054/0055 aveva prodotto per
caso: il cappello ha guardato le due voci insieme, ha trovato che ponevano lo
stesso difetto in due direzioni opposte — un elenco su cui si *itera* non nota le
aggiunte, uno con cui si *asserisce un'uguaglianza* non può che notarle — e ha
concluso che fra loro c'è un **confine**. Il confine è meccanico: *la produzione
può leggere l'elenco?* Sulle view sì, e l'elenco diventa la sorgente da cui la
cosa esiste; sui comandi Tauri no, perché una macro non itera, e l'elenco resta
una copia da confrontare. Stessa tassonomia, due risposte, due verbali.

E la 0056 inaugura un caso che non c'era: chiude una voce **meno la sua seconda
metà**, e quella metà non è una casella residua — è una **voce nuova**, la §16.8.
È il rovescio esatto della [0053](0053-il-contratto-ha-una-sorgente.md): là due
voci erano lo stesso ragionamento e sono diventate un verbale, qui una voce ne
teneva due e ne è nata una in più. Il criterio per distinguere questo caso da
quello della [0052](0052-cio-che-va-storto-e-un-evento.md) — la voce chiusa che
lascia una casella — è sempre lo stesso: **una casella residua è ciò che si può
fare senza aprire un verbale**. Presidiare la prosa che conta i sorgenti chiede
di decidere che forma abbia l'annotazione, quindi non lo è.

E c'è una seconda cosa che la [0053](0053-il-contratto-ha-una-sorgente.md)
inaugura: chiude una voce **smentendone la premessa**. Il §16.4 escludeva i tipi Rust perché «la sorgente autorevole è il
WIT, ed è già il repo a trattarlo così»; controllato contro `wit_conformance.rs`,
il repo tratta come autorevole esattamente Rust — parsa il WIT perché è ciò che
controlla. Le decisioni precedenti hanno corretto **numeri** di una voce (la
[0052](0052-cio-che-va-storto-e-un-evento.md) ne ha corretti quattro); questa
corregge un **fatto sull'architettura** su cui la voce poggiava per intero, e la
conclusione è cambiata di conseguenza: ha ragione il §16.5 sulla direzione, e
torto sullo strumento.

La [0058](0058-un-nome-che-nasce.md) inaugura un terzo modo di lasciare qualcosa
dietro, e va distinto dai due che ci sono. Una **casella residua**
([0052](0052-cio-che-va-storto-e-un-evento.md)) è lavoro che si può fare senza
aprire un verbale, e resta attaccata alla voce chiusa; una **voce nuova**
([0056](0056-un-elenco-che-e-la-sorgente.md)) nasce quando quel pezzo chiede una
decisione sua. Qui invece due righe della voce — i symlink, e i dotfile da
mostrare su richiesta — non erano né l'una né l'altra: erano **della voce
sbagliata**. Un symlink non è una domanda su un *nome*, è «questa voce di
directory partecipa», che è la domanda del §15.6; e sono state spostate là, dentro
la sua lista di caselle, invece di restare un residuo del §15.5.

Il criterio per riconoscere il caso è la stessa domanda che il §16.7 pone a un
elenco: *chi lo legge, lo trova?* Una casella residua vive nel paragrafo di
`todo.md` che le conta, e chi apre la voce che la eredita non la vede. Una riga
consegnata alla voce che la farà sta dove la cercherà chi la farà — e per questo
non entra in nessun totale delle caselle residue: non è rimasta indietro, ha
cambiato indirizzo.

La [0025](0025-la-ricerca-predefinita.md) è l'altra eccezione, ed è dichiarata come
tale: non chiude una voce, ne **apre** nove. Sta qui lo stesso perché il criterio
di questa cartella è il *perché*, non la direzione: chi fra un anno troverà nel
contratto congelato un modo di chiedere una ricerca tollerante ai refusi deve
poter leggere perché quella scelta è finita in una firma WIT invece che dentro un
provider.
