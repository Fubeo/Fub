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
| [0023](0023-chi-monta-il-kernel.md) | Chi monta il kernel: un crate `fub-host`, e l'app ridotta a colla | §8.2 | 2026-07-27 |
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
| [0059](0059-la-generazione-non-e-un-round-trip.md) | La generazione non è un round-trip, e la frase che lo diceva adesso è una rete | il doc di `FormatProvider::serialize` — la sesta specie della [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md), **non** una voce di [todo.md](../todo.md) | 2026-07-30 |
| [0060](0060-il-modello-dice-il-vero-sui-byte.md) | Il modello dice il vero sui byte del file, e un corpus che nessuno confronta non cresce | §17.1 (**prima metà**: il corpus e il fuzzing) — resta il banco delle prestazioni ([seduta 17](../roadmap/17-presidi-che-restano.md)) | 2026-07-30 |
| [0061](0061-un-giro-che-non-passa-dal-modello.md) | Un giro che non prende i byte dal modello, e uno che ci passa | §17.1 (**una casella su cinque**: il round-trip sul corpus) — resta il banco delle prestazioni ([seduta 17](../roadmap/17-presidi-che-restano.md)) | 2026-07-30 |
| [0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) | Il log è il pavimento, l'evento è la porta — `tracing` al posto di `eprintln!`, con log su file, livelli e log per-plugin | §17.3 — chiude la voce **e** la casella residua della §20.2: i ventisette punti di `stderr` hanno due destinazioni, non una ([seduta 17](../roadmap/17-presidi-che-restano.md)) | 2026-07-30 |
| [0063](0063-la-maschera-e-dell-esemplare.md) | La maschera è dell'esemplare, e la risposta stava già nell'elenco | §22.3 — chiude la voce **meno una casella**: la query incorporata in una nota, che non è un esemplare di `ViewSpec` ([seduta 22](../roadmap/22-cosa-sa-dire-un-abbonamento.md)) | 2026-08-01 |
| [0064](0064-il-supporto-sta-sotto.md) | Il supporto sta sotto, e la specie di una voce non segue il link | §15.1 — chiude la voce **meno una casella**: le tre righe di `.fub/` che scrivono con `write_atomic` e aspettano il §15.2 ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-01 |
| [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) | Una scrittura o c'è o non c'è, e i due casi in cui il file non è nostro | §15.2 (**metà voce**: la scrittura) **più** la casella residua della [0064](0064-il-supporto-sta-sotto.md) — resta il recovery ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-01 |
| [0066](0066-un-aggiornamento-non-e-una-scrittura.md) | Un aggiornamento non è una scrittura, e il lock costa una promessa | §15.2 (la *lost update*, che la [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) aveva rimandata) — resta il recovery ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-01 |
| [0067](0067-il-registro-di-cio-che-e-successo.md) | Il registro di ciò che è successo, e l'inverso al posto del contenuto | §15.2 (**una casella su tre** del recovery: il journal delle mutazioni) — restano il buffer di crash e i comandi di manutenzione ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-01 |
| [0068](0068-un-vault-si-apre-per-quel-che-si-legge.md) | Un vault si apre per quel che si legge, e dice cosa non ha letto | §15.7 (**la prima metà**: fallire in parte) — resta la forma dell'apertura ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-01 |
| [0069](0069-cosa-sa-dire-un-abbonamento.md) | Cosa sa dire un abbonamento: una dichiarazione che nessuno valuta mente a chi la scrive | §22.1 + §22.2 — chiude tutte e due le voci e ne **apre una**, la §22.4 ([seduta 22](../roadmap/22-cosa-sa-dire-un-abbonamento.md)) | 2026-08-01 |
| [0070](0070-un-vault-si-apre-in-due-tempi.md) | Un vault si apre in due tempi, e il secondo è un job | §15.7 (**la seconda metà**: la forma dell'apertura) — chiude la voce ([seduta 15](../roadmap/15-il-disco.md)) | 2026-08-03 |
| [0071](0071-una-feature-si-spegne-dove-si-dichiara.md) | Una feature si spegne dove si dichiara | §16.3 (**il primo tempo**: la cargo feature per bundle) — chiude **mezza** voce, il secondo tempo resta ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-08-03 |
| [0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) | Un numero si scrive accanto a come si ricava | §16.8 — chiude la voce, e con lei **l'ultima viva della seduta 16** oltre al secondo tempo della 16.3 ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-08-03 |
| [0073](0073-una-condizione-che-nessuno-valuta.md) | Una condizione che nessuno valuta è una scadenza senza data | §16.3 — **non chiude niente**: presidia la *condizione* che tiene fuori il secondo tempo, perché finora a valutarla non c'era nessuno ([seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)) | 2026-08-03 |
| [0074](0074-selezionare-non-e-raccontare.md) | Selezionare non è raccontare | §21.9 — chiude la voce, e con lei l'unica della [seduta 21](../roadmap/21-la-ricerca-predefinita.md) che chiedesse una **misura** invece di un comportamento | 2026-08-03 |
| [0075](0075-una-view-non-chiede-con-una-finestra.md) | Una view non chiede con una finestra, e chi scrive le versioni è chi le disegna | §1.2 (**una casella su due**: cestino e cronologia come `ViewProvider`) — resta il modello di layout ([seduta 18](../roadmap/18-editor-e-tastiera.md)); e **tre righe su cinque** del debito del §16.6 | 2026-08-03 |
| [0076](0076-le-impostazioni-vivono-nel-vault.md) | Le impostazioni vivono nel vault, e la macchina tiene solo ciò che serve quando il vault non si apre | **Revisione** della [0036](0036-le-impostazioni-e-i-tre-stati.md), §11.1 ([seduta 11](../roadmap/11-impostazioni-e-i-tre-stati.md)): non chiude una voce nuova, cambia dove sta un valore | 2026-08-03 |

| [0077](0077-una-scorciatoia-e-una-chiave.md) | Una scorciatoia è una chiave di impostazione, e un comando di shell è un comando | §18.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — chiude registro unico, palette fuzzy, conflitti e scorciatoie riconfigurabili; resta il solo accordo **in sequenza** | 2026-08-03 |
| [0078](0078-i-riquadri-sono-un-fatto-della-shell.md) | I riquadri sono un fatto della shell, e il buffer è del documento | §1.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)) — **chiude la voce**, ultima casella; chiude anche la metà rimasta del §11.2 e sblocca la §3.3. Zero firma: il `pane` del `ViewContext` c'era dalla [0007](0007-contesto-di-sessione.md) | 2026-08-03 |

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
`dependency_invariant.rs` presidia»; quel file non nominava `fub-sdk` da
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

La [0060](0060-il-modello-dice-il-vero-sui-byte.md) è il **terzo** caso di mezza
voce, e porta una ragione che i due precedenti non avevano. Nella
[0031](0031-chi-possiede-i-bundle.md) mancava metà del *ragionamento*; nella
[0037](0037-lo-stato-di-vista.md) mancava il modello su cui la seconda metà
poggia. Qui il ragionamento è intero e la metà che resta non aspetta una
decisione: aspetta **un posto dove girare** — un carico che domini l'overhead e
una macchina che non divida i core, che è ciò che la §8.4 ha già scoperto
misurando ([0026](0026-due-query-insieme.md)). Da tenere perché precisa il
confine con la casella residua della [0052](0052-cio-che-va-storto-e-un-evento.md):
una casella è ciò che si può fare **senza aprire un verbale**, e qui la seconda
metà lo sarebbe se ciò che le manca si comprasse scrivendo codice. Non si compra,
quindi la voce resta aperta.

E il taglio non l'ha scelto il verbale: l'ha scelto **il cappello della seduta**.
Quel cappello giudica le sue voci su *se il costo cresce con l'attesa* — un
criterio scritto per ordinare tre voci fra loro — e applicato **dentro** una l'ha
tagliata in tre: il corpus, il cui costo cresceva; il banco delle prestazioni, che
aspetta una macchina; e una riga che non stava né di qua né di là. È la terza cosa
che un cappello di seduta si scopre capace di fare, dopo l'accorpamento dichiarato
della [0053](0053-il-contratto-ha-una-sorgente.md) e il confine dichiarato della
[0054](0054-il-banco-del-lato-provider.md)/[0055](0055-il-banco-del-lato-host.md).

Le tre parti però si sono viste in due tempi, e per una ragione che vale un
criterio: **un cappello di seduta ordina ciò che vede da fuori.** La 0060 aveva già
scritto che delle cinque caselle del §17.1 «due sono chiuse, due aspettano la
macchina, e la quinta […] non aspetta nessuna delle due cose» — quella quinta
aspettava il corpus, cioè un pezzo della voce stessa, che un criterio scritto per
mettere in fila delle voci non ha modo di vedere. L'ha chiusa la
[0061](0061-un-giro-che-non-passa-dal-modello.md). Da tenere: **un taglio si
dichiara per quante parti ha**, e quel numero è un'affermazione su oggi — si
corregge dov'è scritto, come un conteggio e non come un ragionamento.

La [0061](0061-un-giro-che-non-passa-dal-modello.md) porta poi un caso che i tre
modi di lasciare qualcosa dietro non coprono, perché non è un modo di lasciare
qualcosa dietro: è un modo di **sbagliare la classificazione** di ciò che si lascia.
La 0060 aveva chiamato quella quinta casella «lavoro», che per il criterio di questa
cartella vuol dire *casella residua*: ciò che si fa senza aprire un verbale. E un
verbale è stato aperto. Il criterio non si emenda — **la previsione era sbagliata**:
la riga sembrava lavoro perché il round-trip sembrava uno, e facendola si è visto che
i versi del trasferimento sono due e non pretendono la stessa cosa, che è una
decisione intera e non una quota di lavoro. Non è quindi una casella residua, né una
voce nuova come nella [0056](0056-un-elenco-che-e-la-sorgente.md), né una riga
consegnata altrove come nella [0058](0058-un-nome-che-nasce.md): la riga è rimasta
dov'era e ci è stata spuntata. Ciò che vale la pena tenere è che classificare un
residuo è **prevedere**, e la previsione si fa guardando la riga — che può mentire.
La conseguenza è mite, ed è la ragione per cui il criterio resta com'è: sbagliarla
costa un verbale in più, cioè costa che una decisione venga scritta invece che no.

La [0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) inaugura un quarto
modo di lasciare qualcosa dietro, ed è il primo in cui a chiudersi è una **casella
residua di un'altra voce** — non per averla fatta a mano, ma per averne dato il
criterio. La [0052](0052-cio-che-va-storto-e-un-evento.md) aveva lasciato come
casella residua «portare dentro il canale i ventisette punti che scrivono su
`stderr`», e la classificava *casella residua* perché era lavoro senza decisione.
Facendola, si è visto che la domanda nascosta era un'altra: i ventisette non
avevano una destinazione sola, ne avevano **due** — il log per chi sviluppa, il
canale degli eventi per chi legge — e scegliere chi va dove era la decisione
intera della 0062. Fatta quella, la casella è scesa a zero da sé: il mestiere lo
ha svolto una voce che non era nata per lei. Vale la pena distinguerlo dalla riga
consegnata altrove della [0058](0058-un-nome-che-nasce.md): là una riga cambiava
indirizzo perché apparteneva a un'altra domanda; qui una casella si **chiude**
perché la decisione che la risolve è la stessa di un'altra voce. Le caselle residue
di `todo.md` scendono da nove a otto.

E una cosa di metodo, che vale la pena scrivere qui perché
[CONTRIBUTING.md](../CONTRIBUTING.md) dice che **i verbali sono immutabili**: la
0060 corregge un numero dentro la [0054](0054-il-banco-del-lato-provider.md), che
è già stata toccata una volta dopo la chiusura — quando il §16.7 ha mostrato che
la specie che rivendicava era la sesta e non la quinta. Le due cose non sono in
contrasto, perché ciò che non si riscrive è il **ragionamento**: cosa si è deciso,
cosa si è scartato, perché. Un **conteggio dei sorgenti** dentro un verbale non è
un ragionamento — è un'affermazione su oggi che invecchia da sola, e in quel caso
invecchiava già nel commit che la scriveva. Si corregge dov'è, e il caso si
consegna alla [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md), che è la voce
che tiene quell'elenco.

La [0064](0064-il-supporto-sta-sotto.md) lascia una **casella residua** — la
terza specie, quella della [0052](0052-cio-che-va-storto-e-un-evento.md) — con
una precisazione che le altre non avevano: sa **quale voce** le darà il criterio.
Le tre righe di `.fub/` che scrivono con `write_atomic` hanno già la proprietà
che il supporto non promette, quindi portarle sopra il trait adesso vorrebbe dire
toglierla; il criterio lo dà il §15.2. È il rovescio della
[0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md), dove una casella si è
**chiusa** perché la decisione di un'altra voce la risolveva senza esserne nata
per lei: qui una casella si **apre** già indirizzata. Il criterio per
distinguerla da una mezza voce resta quello di sempre — non manca un
ragionamento a questa decisione, manca un pezzo di lavoro a un'altra.

E ne inaugura una che non è un modo di lasciare qualcosa dietro: un **buco
dichiarato**. `plugin_data_dir` consegna a un provider nativo una vera cartella
del filesystem, e su un supporto che cifra è il punto in cui la cifratura si
ferma. Non è lavoro rimandato — è un fatto sulla forma dei provider nativi, la
cui risposta è M5 — quindi non è una casella e non entra in nessun totale; ma sta
scritto nel verbale perché chi implementerà quel supporto deve **trovarlo** prima
di scoprirlo. La differenza con una casella è che una casella si spunta, un buco
dichiarato si legge.

La [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) chiude la casella che la
[0064](0064-il-supporto-sta-sotto.md) aveva aperto **già indirizzata**, ed è il
secondo caso in cui una casella residua si chiude dentro un'altra voce dopo
quello della [0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md). La
differenza fra i due è tutta nella previsione: la 0052 aveva lasciato i
ventisette punti di `stderr` senza sapere chi li avrebbe presi, e a prenderli è
stata una voce che non era nata per loro; la 0064 aveva scritto **quale voce**, e
quella voce ha fatto esattamente ciò che c'era scritto. Vale la pena tenerlo
perché di indirizzi scritti su una casella ce n'era uno solo, e adesso si sa che
non era un auspicio: le caselle residue di [todo.md](../todo.md) scendono da
dieci a nove, e i posti da sei a cinque.

Ed è la **quarta mezza voce**, dopo la [0031](0031-chi-possiede-i-bundle.md), la
[0037](0037-lo-stato-di-vista.md) e la
[0060](0060-il-modello-dice-il-vero-sui-byte.md), con una ragione che nessuna
delle tre aveva. Nella 0031 mancava metà del ragionamento; nella 0037 il modello
su cui la seconda metà poggia; nella 0060 una macchina su cui girare. Qui la metà
che resta è **un'altra domanda**: la 0065 dice cosa promette una scrittura, e ciò
che resta — il buffer di crash, il journal, i comandi di manutenzione — non è la
scrittura ma il **recovery**, cioè cosa si fa dopo che è andata storta. Il titolo
della voce le nominava entrambe («durabilità *e* recovery») e le teneva insieme
perché sembravano lo stesso argomento; farne una ha mostrato che il taglio era
già scritto nel titolo. Con una sola eccezione, e sta nella prima metà per una
ragione tecnica e non concettuale: la *lost update* è durabilità, non recovery, e
resta aperta perché la primitiva che la chiude — `std::fs::File::lock` — chiede
di alzare l'MSRV, che è una decisione sua.

La [0066](0066-un-aggiornamento-non-e-una-scrittura.md) chiude quell'eccezione, e
porta due cose che vale la pena tenere.

La prima è una **previsione confermata**, ed è il rovescio esatto del caso che la
[0061](0061-un-giro-che-non-passa-dal-modello.md) aveva inaugurato. Là la 0060
aveva classificato «lavoro» una riga che si è rivelata una decisione intera, e il
criterio non si era emendato perché a sbagliare era stata la previsione. Qui la
0065 aveva classificato **decisione** una riga che poteva sembrare lavoro — un
lock è quattro righe di codice — e aveva ragione: la riga che è costata non è il
lock, è l'**MSRV**. Le due insieme dicono cosa vale davvero il criterio di questa
cartella: *una casella residua è ciò che si può fare senza aprire un verbale* si
applica guardando la riga, e la riga si può leggere in entrambi i versi. Costa un
verbale in più quando si sbaglia per difetto, e una decisione presa di straforo
dentro un verbale su un altro argomento quando si sbaglia per eccesso — che è il
verso caro.

La seconda è che è il primo verbale il cui costo non è codice ma una **promessa
verso l'esterno**. Le decisioni di questa cartella si pagano quasi sempre in
lavoro nostro; questa si paga in `rust-version`, cioè in una riga che
[versionamento.md](../versionamento.md) chiama parte del contratto e che qualcun
altro legge per sapere se può compilare. La forma che ne segue è quella che il
verbale ha: le due strade — alzare l'MSRV, o prendere una dipendenza — si sono
guardate come **due promesse a due platee diverse**, non come due implementazioni,
e ha deciso quale delle due platee può fare qualcosa in risposta. Chi ricompila
oggi aggiorna la toolchain; chi installa una dipendenza in più se la tiene per
sempre.

La [0067](0067-il-registro-di-cio-che-e-successo.md) porta due precedenti, e
nessuno dei due riguarda cosa ha deciso.

Il primo è la terza specie di **premessa sbagliata** che una voce può contenere, e
va distinta dalle due che ci sono. La [0053](0053-il-contratto-ha-una-sorgente.md)
ha chiuso una voce smentendone un **fatto sull'architettura**; la
[0052](0052-cio-che-va-storto-e-un-evento.md) ne ha corretti dei **numeri**. Qui
la riga sbagliata era una **classificazione**: «append-only in `.fub/data/`», cioè
un dato autorevole scritto sotto la radice di ciò che si butta e si rifà. Non è
un fatto verificabile contro i sorgenti come quello della 0053 — nel momento in cui
la riga è stata scritta il file non esisteva — ed è più insidioso di un numero,
perché una classe sbagliata non diventa falsa col tempo: nasce falsa e ha l'aria di
un'istruzione. La regola che la smentisce è la [0048](0048-una-radice-sola.md), che
era già scritta e che nessuno aveva riletto scrivendo la riga. Da tenere come
criterio: **una riga di `todo.md` che dice *dove* va un dato è una previsione, e si
verifica contro la regola prima di eseguirla** — è il gemello, sull'asse della
classe, di ciò che la §21.10 ha insegnato sull'asse delle affermazioni esterne.

Il secondo è di metodo, e riguarda le frasi che stanno in testa ai moduli. Quella
di `storage.rs` diceva «sette operazioni, e chi ne aggiunge un'ottava sta chiedendo
al supporto di sapere qualcosa sul contenuto», e l'ottava è arrivata. Non l'ha
aggiunta chi non l'aveva letta: l'ha aggiunta il verbale che ci ha argomentato
contro, e la frase è rimasta nel modulo — riscritta come **metro** e non come
divieto — perché è quella che ha costretto a trovare il criterio vero, che stava
poche righe sotto (*ciò che si compone dalle altre ha un default e non è una
capacità in più*). È il rovescio della **garanzia dichiarata che non esisteva**
della [0054](0054-il-banco-del-lato-provider.md): là una frase in prosa aveva fatto
credere a una copertura che nessuno aveva, qui una frase in prosa ha impedito
un'aggiunta finché non c'era la ragione per farla. Le due insieme dicono cosa vale
una frase scritta in testa a un modulo: **non presidia niente e orienta tutto**, e
si tocca scrivendo perché, non cancellandola.

La [0025](0025-la-ricerca-predefinita.md) è l'altra eccezione, ed è dichiarata come
tale: non chiude una voce, ne **apre** nove. Sta qui lo stesso perché il criterio
di questa cartella è il *perché*, non la direzione: chi fra un anno troverà nel
contratto congelato un modo di chiedere una ricerca tollerante ai refusi deve
poter leggere perché quella scelta è finita in una firma WIT invece che dentro un
provider.

La [0068](0068-un-vault-si-apre-per-quel-che-si-legge.md) porta un precedente
sul criterio di questa cartella, ed è il **terzo** modo in cui una voce si può
dividere a metà.

I due che c'erano dividevano per **proprietà**: la [0031](0031-chi-possiede-i-bundle.md)
ha preso una domanda di possesso e lasciato l'esecuzione alla
[0032](0032-il-runner-dei-job.md), che era un confine fra due argomenti. Qui il
taglio è fra un **prerequisito** e ciò che lo richiede, e la differenza si vede
nel fatto che le due metà non sono scambiabili: la seconda — l'apertura a fasi,
col progresso e la cancellazione — non si sarebbe potuta prendere per prima,
perché un'apertura osservabile che si interrompe al primo documento illeggibile
mostra una barra di avanzamento che arriva al 40% e poi dice che non si apre
niente. Da tenere come criterio: **quando una voce nomina due cose e una regge
l'altra, il taglio è già dichiarato dalla voce**, e non serve un cappello che lo
autorizzi.

E una seconda nota, che riguarda i presidi e non il taglio. Dei suoi otto
sabotaggi il più utile non ha **confermato** niente: togliere gli scarti
dall'insieme che `reconcile` dichiara completo ha reso rosso un test scritto
per un'altra ragione, e ha mostrato che l'insieme costruito dai soli documenti
indicizzati avrebbe detto agli indici che una nota illeggibile è sparita. Il
difetto non esisteva prima di questa voce — non poteva, perché prima un
documento non letto non lasciava aprire il vault — ed è nato e morto dentro lo
stesso turno. È l'argomento della [0054](0054-il-banco-del-lato-provider.md)
sull'altro verso: là un presidio dichiarava una copertura che non aveva, qui un
presidio ha coperto qualcosa che chi lo scriveva non stava cercando.

La [0069](0069-cosa-sa-dire-un-abbonamento.md) porta due precedenti, e nessuno
dei due riguarda cosa ha deciso.

Il primo è un accorpamento **dichiarato da un cappello che ha torto**, ed è il
caso che mancava fra i due che ci sono. La [0053](0053-il-contratto-ha-una-sorgente.md)
ha chiuso due voci in un verbale perché il cappello della sua seduta lo diceva in
anticipo; la [0054](0054-il-banco-del-lato-provider.md)/[0055](0055-il-banco-del-lato-host.md)
ne ha chiuse due in due perché lo stesso genere di frase dichiarava fra loro un
**confine**. Qui il cappello afferma che le tre voci della seduta sono «tre
estensioni della stessa maschera», e quell'affermazione **era già stata smentita**
dalla [0063](0063-la-maschera-e-dell-esemplare.md): la §22.3 non è finita in un
campo di `EventMask`, è diventata una funzione su un'altra interfaccia. Eppure
l'accorpamento regge — per una ragione che il cappello non aveva visto: non è il
*record* a legare le voci, è la **regola** che il ritiro della 0063 aveva messo a
verbale (*una dichiarazione che il kernel non valuta mente a chi la scrive*), e
applicarla una volta sola dà due case diverse. Da tenere perché precisa il
criterio della 0054: un cappello va letto per cosa afferma, sì — e ciò che
afferma può essere **falso** senza che la sua conclusione lo sia. Un cappello
sbagliato non si eredita e non si butta: si rifà il ragionamento, e si scrive
quale delle due parti ha retto.

Il secondo è la **terza specie di premessa sbagliata**, e va distinta dalle due
che la [0067](0067-il-registro-di-cio-che-e-successo.md) elenca. La
[0053](0053-il-contratto-ha-una-sorgente.md) ha smentito un *fatto
sull'architettura*, sbagliato nel momento in cui fu scritto; la 0067 una
*classificazione*, nata falsa e con l'aria di un'istruzione. Qui la premessa della
[0013](0013-elenco-delle-capacita.md) — «il kernel è sincrono e non possiede
thread» — era **vera quando è stata scritta**, e l'ha resa falsa la
[0032](0032-il-runner-dei-job.md), cioè un'altra voce, che non sapeva di toccarla.
Non è un errore di nessuno: è la specie di riga che invecchia perché il repo si
muove sotto di lei, ed è la più difficile da vedere, perché rileggerla contro i
sorgenti *del suo tempo* non la smentisce. Il criterio che ne segue: **una voce
che eredita la conclusione di un verbale eredita anche la sua premessa, e quella
è un'affermazione su ieri** — si riverifica contro il repo di oggi prima di
appoggiarcisi. Qui la conclusione ha retto lo stesso, ma per l'altra regola della
stessa 0013, e il verbale dice quale.

La [0070](0070-un-vault-si-apre-in-due-tempi.md) porta un precedente sui
**sabotaggi**, e va nel verso scomodo. Il metodo delle 0066/0067/0068 è
sabotare il codice e guardare quale presidio diventa rosso; la 0068 aveva già
mostrato che un sabotaggio serve anche quando **non** conferma — là ne aveva
trovato un difetto. Qui due dei sei non hanno confermato niente e non hanno
trovato niente: sono rimasti **verdi**, e il verde diceva che le due promesse
più centrali della voce — un'indicizzazione si ferma, chi la ferma riceve
comunque un esito — non erano presidiate affatto. Nessuno se n'era accorto
perché i presidi dell'host le attraversano tutte e due senza asserirle.

Da tenere come criterio: **un sabotaggio verde è un risultato, non un
passaggio a vuoto**, e la sua risposta non è indebolire la frase del verbale
finché diventa vera — è scrivere il presidio che manca. Il che porta con sé
la ragione per cui mancava: entrambe le promesse, su un pool acceso, si
osservano solo indovinando un istante. I due presidi nuovi mettono in scena
quel momento — `avanza_apertura` chiamata a mano con la bandiera già alzata, un
pool fermato **senza thread** — invece di aspettarlo, ed è la stessa regola con
cui la [0032](0032-il-runner-dei-job.md) aveva provato le bandiere su `Flags` e
non su dei thread veri. La regola vale anche al contrario: se un sabotaggio non
si può rendere rosso in modo deterministico, il posto da cui provarlo non è
quello.

La [0071](0071-una-feature-si-spegne-dove-si-dichiara.md) porta un precedente
che è il §16.8 visto **dal lato in cui la prosa falsa si crea**, e non da quello
in cui si scopre. `[FeatureUfficiale; 8]` e le sei righe che dicevano «gli otto
bundle», «le nove righe», «nessuna delle nove» erano tutte vere fino al commit
che ha reso quel numero condizionale. Il criterio: **chi rende condizionale un
conteggio è l'unico che sa dove sono le righe che lo ripetono**, e riscriverle è
parte del lavoro, non una pulizia successiva.

E un secondo, sui presidi che diventano rossi per un caso nuovo e **legittimo**:
non si indeboliscono, si circoscrivono. Il conto «zero view non è una suite»
della [0056](0056-un-elenco-che-e-la-sorgente.md) è rimasto identico; è cambiata
la condizione in cui gli si fa la domanda (`any(backlinks, outline, tags,
stats)`). Abbassare la soglia avrebbe spento il presidio anche nel caso per cui
era stato scritto — che è la differenza fra le due mosse, ed è l'unica che conta.
