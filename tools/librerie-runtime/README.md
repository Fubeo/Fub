# La prova delle librerie a runtime

Questa cartella prova il livello 3 del piano dei componenti (K0): componenti
Rust in librerie dinamiche, caricati a runtime da un ospite, con le dipendenze
comuni in una libreria condivisa. La prova gira su Linux, macOS e Windows.

> **Per chi:** chi decide se Fub può caricare componenti nativi a runtime, o
> rifà la prova dopo un aggiornamento di Rust.
> **Risultato:** sapere che cosa tiene e quanto pesa la consegna.

## Che cosa c'è

Un workspace a sé, fuori da quello di Fub, perché si compila con
`-C prefer-dynamic`, che il resto di Fub non usa:

| Cartella | Che cosa fa |
|---|---|
| `comune/` | la libreria condivisa (`dylib`): la versione dell'ABI, il nome del simbolo d'ingresso, la `Descrizione` `repr(C)` e un contatore di chiamate; riesporta `serde_json` |
| `componente-a/` | un componente (`dylib`): scrive un documento JSON e ne conta i byte |
| `componente-b/` | un componente (`dylib`): legge un documento JSON e ne somma i valori |
| `ospite/` | il programma: carica con `libloading` ogni componente che trova in una cartella; con la feature `statico` ha invece i due componenti dentro |

Ogni componente esporta `fub_componente_v1`, che restituisce la sua
`Descrizione`. La chiamata al lavoro passa da `catch_unwind`: un panic non
attraversa il confine. L'ospite statico spegne la feature `ingresso` dei
componenti, perché due simboli con lo stesso nome nello stesso binario non si
legano.

## Come si fa girare

Dalla radice del repository:

```bash
node tools/librerie-runtime/prova.mjs --out DIR
```

Lo script compila, mette insieme la consegna in `DIR/consegna/` (l'ospite, la
libreria comune e la libreria standard di Rust in `bin/`, i componenti in
`componenti/`) e controlla:

1. che l'ospite carichi tutti e due i componenti;
2. che ci sia una libreria comune sola in memoria: il contatore che i
   componenti incrementano è quello che legge l'ospite;
3. che, tolto il file di B, B sparisca e A resti;
4. che l'ospite statico dia gli stessi risultati;
5. su macOS, che ogni file abbia una firma valida (`codesign -v`).

Scrive `DIR/referto.json`, con le prove e il peso dei file, ed esce con 1 se
una prova non passa. La CI la fa girare sui tre sistemi nel job
`librerie-runtime` e carica il referto come artifact
`librerie-runtime-<sistema>-<sha>`.

## Che cosa non prova

- L'ospite trova le sue librerie con `LD_LIBRARY_PATH`, `DYLD_LIBRARY_PATH` o
  `PATH`. Una consegna vera userebbe `$ORIGIN` o `@loader_path` nel binario.
- Tutti i file escono dalla stessa compilazione. Un componente compilato con
  un'altra versione di Rust o di `comune` non ha un'ABI stabile: è la ragione
  per cui il simbolo porta la versione nel nome e la `Descrizione` la ripete.
- La firma vera di macOS e di Windows (notarizzazione, Authenticode) non c'è
  sui runner: si controlla soltanto la firma ad hoc del linker.

I numeri e la decisione stanno in
[`docs/misure/README.md`](../../docs/misure/README.md).
