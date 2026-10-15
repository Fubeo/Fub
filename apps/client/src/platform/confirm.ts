// La domanda sì/no della shell attiva: l'unica porta da cui la shell chiede
// una conferma.
//
// Di serie la disegna il sistema operativo (`host/dialog.ts`), come ha sempre
// fatto. Una shell che la disegna da sé dichiara qui il suo presentatore;
// nessun chiamante sa chi sta rispondendo.
//
// # «No» è la risposta di chi non ha risposto
//
// Chi domanda fa qualcosa col «sì» — cestina, scarta un buffer, azzera un
// profilo — e niente col «no». Quindi un presentatore che lancia, che rifiuta o
// che viene ritirato a domanda aperta vale «no», e la promessa non rigetta:
// chi domanda non deve prevedere il guasto di una superficie che non conosce.
// Non si ripiega nemmeno sul dialogo di sistema: chi ha già visto la domanda
// in-app se ne troverebbe davanti una seconda.
//
// Senza presentatore questo modulo è trasparente: il dialogo di sistema
// risponde com'è, rifiuti compresi.
//
// # Una domanda alla volta
//
// Due domande insieme non si sovrappongono: la seconda aspetta la risposta
// alla prima, nell'ordine in cui sono arrivate. Una domanda appartiene al
// presentatore che c'era quando è stata fatta, e se ne va con lui.
import { confirm as systemConfirm, type ConfirmOptions } from "../host/dialog";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";

export type { ConfirmOptions };

/// Disegna una domanda e ne rende la risposta: `true` = ha detto di sì.
///
/// `question` è la vita della domanda: si chiude quando la risposta c'è, anche
/// se a darla è stato il ritiro del presentatore, e la superficie se ne va con
/// lei. Ciò che il presentatore risponde dopo non conta più.
export type ConfirmPresenter = (
  message: string,
  opts: ConfirmOptions,
  question: Lifetime,
) => Promise<boolean>;

interface Question {
  message: string;
  opts: ConfirmOptions;
  /// `null` finché la domanda aspetta il suo turno.
  life: Lifetime | null;
  /// `null` da quando la risposta è partita: vale una volta.
  answer: ((yes: boolean) => void) | null;
}

interface Declaration {
  presenter: ConfirmPresenter;
  /// Le domande in fila: la prima è quella a schermo.
  questions: Question[];
}

/// I presentatori dichiarati, dal primo all'ultimo: risponde l'ultimo.
const declared: Declaration[] = [];

/// Dà la risposta, una volta, e fa posto alla domanda dopo.
function settle(declaration: Declaration, question: Question, yes: boolean): void {
  const answer = question.answer;
  if (!answer) return;
  question.answer = null;
  const at = declaration.questions.indexOf(question);
  if (at >= 0) declaration.questions.splice(at, 1);
  // La superficie se ne va prima che chi aspettava riparta.
  question.life?.close();
  answer(yes);
  present(declaration);
}

/// Porta a schermo la prima domanda in fila, se non c'è già.
function present(declaration: Declaration): void {
  const question = declaration.questions[0];
  // Un presentatore ritirato non disegna più niente: le sue domande hanno già
  // avuto «no».
  if (!question || question.life || !declared.includes(declaration)) return;
  const life = openLifetime();
  question.life = life;
  let pending: Promise<boolean>;
  try {
    pending = Promise.resolve(declaration.presenter(question.message, question.opts, life));
  } catch {
    settle(declaration, question, false);
    return;
  }
  // Solo un `true` è un sì: qualunque altra cosa arrivi è un «no».
  pending.then(
    (yes) => settle(declaration, question, yes === true),
    () => settle(declaration, question, false),
  );
}

/** Dichiara il presentatore della shell attiva; il teardown lo ritira. */
export function declareConfirm(presenter: ConfirmPresenter): Teardown {
  const declaration: Declaration = { presenter, questions: [] };
  declared.push(declaration);
  return () => {
    const at = declared.indexOf(declaration);
    if (at < 0) return;
    declared.splice(at, 1);
    // Una copia: `settle` accorcia la fila mentre la si scorre.
    for (const question of [...declaration.questions]) settle(declaration, question, false);
  };
}

/// Una domanda sì/no all'utente. `true` = ha detto di sì.
export function confirm(message: string, opts: ConfirmOptions): Promise<boolean> {
  const declaration = declared[declared.length - 1];
  if (!declaration) return systemConfirm(message, opts);
  return new Promise<boolean>((answer) => {
    declaration.questions.push({ message, opts, life: null, answer });
    present(declaration);
  });
}
