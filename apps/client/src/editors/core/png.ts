// Un'immagine mostrata come PNG, per gli appunti: la usano il menu delle
// immagini nella nota e il visualizzatore delle immagini.

/// L'immagine come PNG: i byte stessi se lo sono già, altrimenti ridisegnati
/// su una tela alla misura naturale. Una sorgente che non si legge rifiuta.
export async function pngOf(picture: HTMLImageElement): Promise<Blob> {
  const source = await (await fetch(picture.currentSrc || picture.src)).blob();
  if (source.type === "image/png") return source;
  const drawable: CanvasImageSource = await createImageBitmap(source).catch(() => picture);
  const width = "naturalWidth" in drawable ? drawable.naturalWidth : drawable.width;
  const height = "naturalHeight" in drawable ? drawable.naturalHeight : drawable.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || width === 0 || height === 0) throw new Error("immagine senza misura");
  context.drawImage(drawable, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG non prodotto"))), "image/png");
  });
}
