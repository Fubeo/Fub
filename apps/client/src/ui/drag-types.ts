// I tipi di dato che la shell mette in un trascinamento fra le sue superfici.
//
// Un tipo proprio e non `text/plain`: chi riceve deve poter distinguere «una
// nota dell'albero» da «del testo trascinato da un'altra app», che a parità di
// contenuto (un percorso) vogliono gesti diversi.

/// Una nota trascinata dall'albero dei file: il valore è il suo id nel vault.
export const NOTE_DRAG_TYPE = "application/x-fub-note";
