# XMP accanto alle foto

> **Ambito:** gli XMP che LightCraft scrive accanto a una foto, e ciò che Fub
> ne legge.
> **Fonti autorevoli:** `crates/fub-format-craft/src/xmp.rs`.

LightCraft tiene voto, etichetta di colore, scelta e parole chiave di una
foto in un file XMP accanto a lei (`IMG_0001.CR3.xmp` o `IMG_0001.xmp`).
Questa pagina dice quali di quei campi Fub legge, come diventano proprietà e
tag del vault, come si trova la foto a cui l'XMP appartiene e che cosa Fub
non tocca mai: l'id del formato e i limiti sono in
[Formati dei file Craft](craft-formats.md).

## Che cosa si legge

`xmp::read` legge quattro campi, e nient'altro:

| Campo | Dove, nell'XMP | Che cosa vale |
|---|---|---|
| voto | `xmp:Rating` | un intero da -1 (scartata) a 5; `"5.0"` vale 5, `"6"`, `"-2"` e `"2.5"` non sono un voto |
| etichetta | `xmp:Label` | il testo senza spazi ai bordi, se non è vuoto e ha al massimo 64 caratteri |
| scelta | `lc:flag` | `pick` o `reject`; `none`, o ogni altro valore, non è una scelta |
| parole chiave | i `rdf:li` dentro `dc:subject` (`rdf:Bag` o `rdf:Seq`) | al massimo 500, senza doppioni, nell'ordine del file; una parola di soli spazi si salta |

Voto, etichetta e scelta si leggono sia come attributi di `rdf:Description`
(`xmp:Rating="3"`) sia come elementi (`<xmp:Rating>3</xmp:Rating>`); vale il
primo valore valido del file. Un `rdf:li` fuori da `dc:subject` (un autore in
`dc:creator`, per esempio) non è una parola chiave.

Un nome si riconosce dal namespace quando è uno di quelli noti (RDF, `xmp`,
Dublin Core, Camera Raw), altrimenti dal prefisso con cui LightCraft lo
scrive: `lc:`, di cui il namespace non è documentato, si riconosce dal
prefisso. I nomi e i valori si confrontano così come sono scritti, senza
piegare il caso.

## Proprietà e tag

Il modello del documento di un XMP ha un frontmatter con le sole chiavi
presenti fra `rating` (numero), `label` (testo), `flag` (`"pick"` o
`"reject"`) e `tags`. Un tag è la parola chiave senza i `#` iniziali e con
ogni serie di spazi diventata un trattino: «New York» dà `#New-York`. Vale
come tag solo ciò che la regola dei tag del vault accetta
(`fub_abi::rules::tag::frontmatter_tags`): «R&D» o «1990» non sono tag e
restano soltanto nel testo. Due parole che danno lo stesso tag ne danno uno.

```yaml
rating: 4
label: Rosso
flag: pick
tags: [New-York, mare]
```

Il testo per la ricerca sono le parole chiave, così come sono scritte, e poi
l'etichetta, una per riga. Un XMP che non si legge dà il modello vuoto: il
file resta nel vault, senza proprietà né tag.

## La foto e la copia `-Edit.psd`

Il nome dell'XMP dice a quale foto appartiene (`xmp::photo_candidates`). Si
toglie l'ultima estensione così com'è scritta:

- `IMG_0001.CR3.xmp`: resta un nome con un'estensione, e la foto è
  esattamente `IMG_0001.CR3`;
- `IMG_0001.xmp`: resta un gambo, e la foto è un file accanto che si chiama
  `IMG_0001.<ext>`, con un'estensione diversa da `xmp`. Se nessun file
  accanto si chiama così (`IMG.xmp` da solo), l'XMP non ha una foto.

Un nome come `archivio.tar.xmp` indica `archivio.tar`, che non è una foto ma
si tratta allo stesso modo: chi guarda il vault la cerca, e non la trova
fra le foto.

«Modifica in PhotoCraft» crea accanto alla foto una copia di nome
`IMG_0001-Edit.psd` (`xmp::edit_copy_of`): il gambo della foto, `-Edit` e
l'estensione `.psd`.

## Che cosa Fub non tocca mai

- Le regolazioni di sviluppo: gli elementi e gli attributi `crs:*` e
  `lc:settings` si saltano interi, e niente di ciò che contengono entra nel
  modello, nemmeno nel testo.
- L'XMP stesso: Fub non lo scrive mai, né per cambiare un voto né per
  aggiungere un tag. Le proprietà che si vedono sono una lettura.
- Le entità: un `<!DOCTYPE>` si ignora, e un riferimento a un'entità che non è
  una delle cinque predefinite (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) né
  un riferimento numerico si salta, senza mai espanderlo.

Un XMP sopra 8 MiB, o annidato oltre 256 livelli, non si legge
(`XmpError::TooLarge`); un XML malformato, vuoto o in UTF-16 neppure
(`XmpError::NotXml`). Un BOM di UTF-8 in testa si salta.

## Quando l'XMP cambia

LightCraft scrive l'XMP solo quando si salva con ⌘S, o sempre se nelle sue
preferenze è acceso `autoWrite`, la scrittura automatica degli XMP. Finché
non lo scrive, un voto dato in LightCraft non arriva a Fub.
