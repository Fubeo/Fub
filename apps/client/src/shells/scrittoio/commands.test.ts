// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allCommands, resetShellCommands } from "../../ui/commands";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountShellCommands } from "./commands";

const space = vi.fn(async (_step: number): Promise<void> => {});
let finishSwitch: (() => void) | null = null;
let failSwitch: ((error: unknown) => void) | null = null;
const light = vi.fn(
  (_origin: HTMLElement | null): Promise<void> =>
    new Promise((resolve, reject) => {
      finishSwitch = resolve;
      failSwitch = reject;
    }),
);
const notices: { text: string; tone: string }[] = [];

const moved = vi.fn((_direction: string): boolean => true);
let paneCount = 1;

vi.mock("./space", () => ({ spaceBy: (step: number) => space(step) }));
vi.mock("./pane-focus", () => ({ focusNeighbour: (direction: string) => moved(direction) }));
const zoned = vi.fn((_step: number): void => {});
vi.mock("./zones", () => ({ stepZone: (step: number) => zoned(step) }));
vi.mock("../../state/layout", () => ({ panes: () => Array.from({ length: paneCount }, (_, index) => `p${index}`) }));
/// Se la scena in corso si lascia ancora disfare.
let turnable = false;
const turn = vi.fn((): boolean => turnable);
vi.mock("./frame/light", () => ({
  switchLight: (origin: HTMLElement | null) => light(origin),
  turnLight: () => turn(),
}));
vi.mock("../../ui/notify", () => ({ notify: (text: string, tone = "info") => notices.push({ text, tone }) }));
vi.mock("../../host/query", () => ({ settings: async () => [] }));

const SPACE = ["shell.chrome.compact.more", "shell.chrome.compact.less", "shell.chrome.compact.reset"];
const LIGHT = "shell.light.toggle";
const FOCUS = ["shell.pane.focus.left", "shell.pane.focus.right", "shell.pane.focus.up", "shell.pane.focus.down"];
const ZONE = ["shell.zone.next", "shell.zone.prev"];

function run(id: string): void {
  void allCommands()
    .find((entry) => entry.id === id)!
    .run!();
}

let lifetime: Lifetime;

beforeEach(() => {
  resetShellCommands();
  document.body.innerHTML = '<button id="toggle-light"></button>';
  space.mockClear();
  light.mockClear();
  turn.mockClear();
  turnable = false;
  moved.mockClear();
  paneCount = 1;
  notices.length = 0;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  document.body.replaceChildren();
});

describe("i comandi che esistono solo nello Scrittoio", () => {
  it("dichiara lo spazio dell'interfaccia e la luce senza accordo, le zone con F6", () => {
    mountShellCommands(lifetime);
    const ids = allCommands().map((entry) => entry.id);
    expect(ids).toEqual([...SPACE, ...ZONE, LIGHT]);
    expect(allCommands().map((entry) => entry.binding)).toEqual([null, null, null, "F6", "Shift-F6", null]);
  });

  it("F6 va alla zona seguente, Maiusc+F6 a quella prima", () => {
    mountShellCommands(lifetime);
    for (const id of ZONE) run(id);
    expect(zoned.mock.calls.map(([step]) => step)).toEqual([1, -1]);
  });

  it("con più di un foglio offre anche il fuoco per direzione, senza accordo", () => {
    mountShellCommands(lifetime);
    expect(allCommands().map((entry) => entry.id)).not.toContain(FOCUS[0]);

    paneCount = 2;
    const entries = allCommands();
    expect(entries.map((entry) => entry.id)).toEqual([...SPACE, ...FOCUS, ...ZONE, LIGHT]);
    expect(entries.filter((entry) => FOCUS.includes(entry.id)).map((entry) => entry.binding)).toEqual([null, null, null, null]);

    for (const id of FOCUS) run(id);
    expect(moved.mock.calls.map(([direction]) => direction)).toEqual(["left", "right", "up", "down"]);
  });

  it("i tre gesti dello spazio sono un passo avanti, uno indietro e il ritorno", () => {
    mountShellCommands(lifetime);
    for (const id of SPACE) run(id);
    expect(space.mock.calls.map(([step]) => step)).toEqual([1, -1, 0]);
  });

  it("li ritira quando la cornice si smonta", () => {
    paneCount = 2;
    mountShellCommands(lifetime);
    lifetime.close();
    expect(allCommands()).toEqual([]);
  });

  /// Il cambio in corso finisce, e ciò che ne segue ha consegnato.
  async function finish(): Promise<void> {
    finishSwitch!();
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  }

  it("la luce parte dal suo bottone; dopo, un gesto è un cambio nuovo", async () => {
    mountShellCommands(lifetime);
    run(LIGHT);
    expect(light).toHaveBeenCalledTimes(1);
    expect(light.mock.calls[0]![0]).toBe(document.getElementById("toggle-light"));

    await finish();
    run(LIGHT);
    expect(light).toHaveBeenCalledTimes(2);
  });

  it("un secondo gesto mentre la scena si lascia disfare la disfa, e non chiede un altro cambio", async () => {
    mountShellCommands(lifetime);
    run(LIGHT);
    turnable = true;
    run(LIGHT);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(light).toHaveBeenCalledTimes(1);

    await finish();
    expect(light).toHaveBeenCalledTimes(1);
  });

  it("a luce già scritta il secondo gesto aspetta che la scena finisca, e poi chiede l'altra", async () => {
    mountShellCommands(lifetime);
    run(LIGHT);
    run(LIGHT);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(light).toHaveBeenCalledTimes(1);

    await finish();
    expect(light).toHaveBeenCalledTimes(2);
  });

  it("due gesti in attesa si annullano", async () => {
    mountShellCommands(lifetime);
    run(LIGHT);
    run(LIGHT);
    run(LIGHT);
    await finish();
    expect(light).toHaveBeenCalledTimes(1);
  });

  it("senza il bottone la luce cambia lo stesso", () => {
    document.body.replaceChildren();
    mountShellCommands(lifetime);
    run(LIGHT);
    expect(light.mock.calls[0]![0]).toBeNull();
  });

  it("un cambio di luce fallito si dice, e non blocca il prossimo", async () => {
    mountShellCommands(lifetime);
    run(LIGHT);
    failSwitch!(new Error("impostazione rifiutata"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.tone).toBe("guasto");
    run(LIGHT);
    expect(light).toHaveBeenCalledTimes(2);
  });
});
