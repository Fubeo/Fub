# 0087 — Il testo che sta dentro gli allegati

*Chiude la [§21.8](../roadmap/21-la-ricerca-predefinita.md#218-il-testo-che-sta-dentro-gli-allegati),
e con lei la [seduta 21](../roadmap/21-la-ricerca-predefinita.md).*

---

## La voce chiedeva una cosa che era già successa

La §21.8 nominava due blocchi, e nessuno dei due esisteva più come scritto.

Il primo diceva: «finché `Vault::list_documents` filtra per estensione dei
`FormatProvider`, un PDF **non esiste**». La
[0046](0046-l-anagrafe-del-vault.md) ha tolto `list_documents` da `vault.rs`, e
`IndexQuery::Entries` porta un `VaultEntry` per **ogni** file del vault. Un PDF
esiste, ha una dimensione e una data, e il controllo di salute lo distingue da
uno che manca.

Il secondo diceva: «`parse(source: &str)` e `Vault::read -> String`. Un formato
binario non entra nel contratto». Metà era già falsa: `FormatProvider::parse`
prende un `&DocumentSource` dalla
[0017](0017-chi-disegna-cio-che-il-core-non-conosce.md), `DocumentSource::Bytes`
c'è, e la regola per chi lo riceve senza volerlo è scritta accanto alla firma —
un provider testuale che riceve dei byte risponde `Unsupported` invece di
indovinare l'encoding.

E la terza casella chiedeva di **dichiarare che la ricerca è il cliente** di
quel lavoro, «così che chi aprirà la §14.1 sappia chi lo aspetta a valle». Ma la
§14.1 è chiusa dalla 0046, e le tre caselle che le restano — l'impronta degli
allegati, la politica della cartella allegati, le derivate — non sono «estrarre
testo da un PDF». La voce dichiarava un cliente a un lavoro che non aveva più il
contenitore che lo aspettava.

**Quindi questa voce non si è chiusa facendo ciò che chiedeva.** Si è chiusa
misurando cosa fosse rimasto vero sotto di lei, e il residuo non era né
l'anagrafe né il parser.

## Cosa mancava davvero: il tragitto

Fra un file sul disco e un indice ci sono due passaggi, e uno solo dei due
guardava il descrittore.

`FormatDescriptor::source` **era già consultato**, dentro
`DocumentStore::parse_from_disk`: `SourceKind::Text` legge con `Vault::read`,
`SourceKind::Bytes` con `Vault::read_bytes`. Il ramo dei byte non era dichiarato
e morto — era percorso, dai tre chiamanti di `parse_from_disk`, che sono chi
apre un documento e chi ne disegna l'anteprima.

Chi **indicizza** non era fra loro. `Workspace::index_batch` faceva due letture
per conto proprio — una per prendere l'impronta, una per parsare — e tutte e due
con `Vault::read`, che decodifica in `String` e fallisce su ciò che non è UTF-8.
Il risultato non era «gli allegati non si indicizzano»: era peggio, ed è la
ragione per cui questa voce valeva un verbale. **Lo stesso documento aveva due
destini a seconda di chi lo leggeva.** Un provider che avesse dichiarato di
volere i byte vedeva i propri documenti quando l'utente li apriva, e li vedeva
scartare in silenzio all'apertura del vault — con un `Trouble` che dice «non è
UTF-8» a proposito di un file che nessuno aveva promesso fosse testo.

La riparazione è di una specie che vale la pena nominare, perché non è
«aggiungere un ramo»: è **togliere la seconda decisione**. Il descrittore adesso
si consulta in un posto solo, `DocumentStore::source_from_disk`, e
`parse_from_disk` è una riga sopra di lui. Chi indicizza chiama quello. Finché
la scelta stava dentro `parse_from_disk`, era una scelta *di quella funzione*, e
chiunque leggesse per altre ragioni ne aveva un'altra — cioè nessuna.

### L'impronta si prende sui byte, e resta la stessa

`Revision::of` prendeva un `&str`, e su una sorgente a byte non c'era niente da
darle. La funzione nuova è `Revision::of_bytes`, e `of` **è** lei — stesso
FNV-1a, sugli stessi byte che `as_bytes` avrebbe dato.

Che sia la stessa impronta e non una seconda famiglia non è un'economia: è la
proprietà che tiene in piedi `up_to_date`. Un documento di testo non cambia
impronta il giorno che qualcuno lo rivendica a byte, quindi rivendicarlo non
costa una riscansione del vault. E un allegato che non cambia non si riestrae,
che è la regola della 0046 applicata a un anello in più — fra il file e ciò che
l'indice tiene ora ci sono due passaggi invece di uno, e la domanda che li salta
è la stessa.

## Il confine dei plugin, e perché è ora o mai

`VaultRead` sapeva dire una cosa sola: `read_document -> Result<String, …>`. Il
kernel sapeva leggere a byte per conto proprio dalla 0017; quel sapere si
fermava sul confine.

Il caso che questo chiude non è ipotetico ed è esattamente quello che la §21.8
nominava: PDF, OCR, audio e video trascritti sono nove voci di FEATURES §9.1, e
in omnisearch arrivano da **un'estensione a parte** che estrae il testo e glielo
passa. Un estrattore scritto come provider di terzi, con un confine che parla
solo testo, non ha modo di chiedere ciò su cui deve lavorare: gli arriverebbe un
errore di decodifica al posto del suo PDF.

Quindi `read-document-bytes`, accanto a `read-document` e non al posto suo — per
la stessa ragione per cui nel kernel `read` e `read_bytes` sono due funzioni e
non una che decodifica opzionalmente: chi legge del testo non deve **poter
dimenticare** di decodificare.

Due scelte dentro questa, che sono le uniche parti discutibili:

- **Stesso permesso.** `read-document-bytes` sta sotto `fub:read-vault` come
  ogni altra lettura del vault, e non sotto uno suo. Leggere del testo e leggere
  dei byte non sono due gradi di fiducia: chi può leggere una nota può già
  leggerne i byte, decodificandoli lui. Un permesso in più avrebbe descritto una
  differenza che non c'è, e i permessi che descrivono differenze inesistenti si
  concedono a tutti per abitudine.
- **È additiva, quindi non ritaglia la linea di base.** Per la tabella di
  [`wit-congelato.md`](../architecture/wit-congelato.md) una funzione **nuova**
  in un'interfaccia esistente è additiva; `wit/frozen/0.1.0.wit` non si tocca, e
  `wit_additivity` resta verde avendo ragione. Ma il momento conta lo stesso, e
  in un verso solo: dopo il freeze di M4 una firma nuova sarebbe possibile e
  **inutile**, perché i plugin già compilati non l'avrebbero — un estrattore di
  terzi resterebbe impossibile per tutta la vita di `fub:abi@0.1.0`.

## Il banco: un cliente, non un estrattore

Un ramo che nessuno percorre è indistinguibile da un ramo rotto — e infatti era
rotto, per settanta verbali, mentre la suite dei test era verde. Quindi la
riparazione arriva con qualcuno che ci passi.

`EstrattoreDiProva` (in `fub-testkit`) dichiara `SourceKind::Bytes` su
un'estensione e produce testo dai byte. **Non è un estrattore di PDF, ed è
deliberato**: la voce chiedeva il canale, non l'estrattore, e nessun crate di
parsing entra in questo workspace senza una decisione sua. Decodifica latin-1,
che non è una scelta di prodotto ma la più corta che tenga insieme le due
proprietà che servono — dei byte che il canale del testo **rifiuterebbe**, e che
portano comunque del testo **cercabile**.

I quattro test stanno in
[`kernel/tests/il_testo_negli_allegati.rs`](../../crates/fub-kernel/tests/il_testo_negli_allegati.rs),
e tre di loro sono stati visti fallire con il codice di prima: senza la
riparazione il documento non arriva all'indice affatto (`NotFound`).

E `MemoryHost` tiene ora i documenti **a byte** e non come `String`. Non è un
dettaglio del doppio: un banco che non sa rappresentare un allegato è un banco
su cui l'estrattore di cui sopra non si può scrivere, e il lato provider del
§16.2 esiste apposta perché un provider si provi **contro il contratto** e non
contro un kernel.

## Cosa questa decisione non fa

- **Non estrae niente da niente.** Nessun PDF, nessun OCR, nessuna trascrizione:
  quelle restano nove voci di FEATURES §9.1 e sono lavoro di provider.
- **Non decide dove vive il testo estratto.** Un testo ricavato da un PDF è
  **ricalcolabile**, quindi per la [0048](0048-una-radice-sola.md) è cache e non
  dato autorevole — `.fub/cache/` e non `.fub/data/`. Ma finché nessuno estrae,
  non c'è niente da mettere via: il modello vive dentro la chiamata che lo
  produce, come per ogni altro documento. Quando un estrattore vero arriverà, il
  posto è già dichiarato e la casella residua della §14.1 sulle derivate lo
  aspetta — questa voce non ne inventa un terzo.
- **Non inventa un secondo modo di fare lavoro lungo.** Estrarre testo da mille
  PDF è un job, con il pool per vault della [0032](0032-il-runner-dei-job.md) e
  il progresso come evento della [0035](0035-il-lavoro-lungo-si-racconta.md).
- **Non tocca la porta di chi cerca.** Un allegato indicizzato è un documento in
  più nell'indice ([0082](0082-una-porta-per-chi-cerca.md)), non una query
  nuova.

## La riga che questa voce rende falsa

`strozzature.md` diceva in una riga «`parse(source: &str)` e
`Vault::read -> String`: un formato binario non entra» e in un'altra, nella
stessa tabella, che `DocumentSource::Bytes` fa entrare anche i non-testo. Erano
in contraddizione da prima di questa voce, e la prima aveva torto dal giorno
della 0017. È corretta qui, perché è la riga che la §21.8 esisteva per nominare
— ed è il terzo caso, in quel file, di una riga che ha detto «manca» per decine
di verbali dopo che la cosa c'era.

## Cosa resta aperto

Niente della seduta 21: era la sua ultima voce, e la seduta si chiude con **otto
verbali** — la 0049 e la 0050 per le quattro P0, poi la 0074, la 0082, la 0083,
la 0084, la 0086 e questa.

Di quegli otto, **tre** hanno speso contratto: le due P0 e la 0074, che ha
insegnato al canale a dire *«per adesso mi bastano gli id»*. Questa è la quarta,
ed è la sola arrivata **dopo** che le P0 erano state chiuse — cioè la sola firma
che il freeze di M4 non aveva già visto arrivare. Che sia una sola, e non sei, è
il verdetto a posteriori su come quelle quattro P0 erano state trovate: la
distanza fra «la ricerca è di classe *omnisearch*» e il repo era quasi tutta
lavoro, e la parte che era contratto era stata vista quasi tutta al primo giro.
