# Decisioni architetturali

Questa cartella è l'archivio delle decisioni chiuse. Ogni file conserva:

- il problema osservato;
- le alternative considerate;
- la scelta presa;
- il prezzo e gli eventuali residui della scelta.

I verbali sono **centosettantotto** [conta: verbali]. Il numero e il nome del
file non cambiano; il contenuto decisionale resta stabile, mentre la forma può
essere migliorata secondo la
[decisione 0143](0143-i-verbali-si-possono-riscrivere.md).

Tra i verbali sono tracciati **dieci** buchi dichiarati
[conta: buchi-dichiarati]: compromessi noti che non devono essere scambiati per
garanzie già offerte.

## Come trovare una decisione

I file sono ordinati per numero, da
[`0001`](0001-supply-chain-e-sbom.md) a
[`0178`](0178-il-contrasto-sceglie-la-soglia.md). Il nome del file descrive la
scelta; la ricerca del repository è l'indice principale.

Esempi:

```bash
# per numero
find docs/decisions -maxdepth 1 -name '0042-*.md'

# per parola nel titolo o nel contenuto
grep -Rni --include='*.md' 'tema' docs/decisions
```

La vecchia tabella riassuntiva non viene mantenuta: duplicava in forma molto più
lunga ciò che è già scritto nei singoli ADR e diventava una seconda fonte da
sincronizzare.

## Cosa non va qui

- Il lavoro aperto vive in [`../todo.md`](../todo.md).
- La direzione corrente vive in [`../PIANO.md`](../PIANO.md).
- Le sedute preparatorie vivono in [`../roadmap/`](../roadmap/README.md).
- Le istruzioni operative vivono nelle cartelle numerate della guida.

Quando una scelta è ancora aperta, non creare un ADR “provvisorio”: mantenerla
nel backlog. Quando è chiusa, il backlog perde la voce e questo archivio guadagna
un file numerato.
