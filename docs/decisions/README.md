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

Una decisione nuova prende il numero successivo — mai uno già usato, nemmeno se
il verbale che lo portava è stato superato — e il verbale ci si sposta **intero**
nel momento in cui la voce di `todo.md` si chiude.
