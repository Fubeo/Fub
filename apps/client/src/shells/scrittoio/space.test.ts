import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import { spaceBy } from "./space";

const KEY = "chrome.compactness";

let stored: unknown = 0;
const read = vi.fn(async (): Promise<SettingEntry[]> => [entry(stored)]);
const write = vi.fn(async (_key: string, value: unknown): Promise<void> => {
  stored = value;
});
const notices: { text: string; tone: string }[] = [];

vi.mock("../../host/query", () => ({ settings: () => read() }));
vi.mock("../../host/ipc", () => ({ api: { setSetting: (key: string, value: unknown) => write(key, value) } }));
vi.mock("../../ui/notify", () => ({ notify: (text: string, tone = "info") => notices.push({ text, tone }) }));
vi.mock("../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) => `${key} ${JSON.stringify(args ?? {})}`,
}));

function entry(value: unknown): SettingEntry {
  return {
    spec: {
      key: KEY,
      label: KEY,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "number", default: 0, min: 0, max: 4 },
    },
    value,
  } as SettingEntry;
}

beforeEach(() => {
  stored = 0;
  read.mockClear();
  write.mockClear();
  notices.length = 0;
});

describe("lo spazio dell'interfaccia come gesto", () => {
  it("un passo verso il foglio scrive il passo successivo e lo dice", async () => {
    await spaceBy(1);
    expect(write).toHaveBeenCalledWith(KEY, 1);
    expect(notices).toEqual([{ text: 'shell.space_now {"step":2,"steps":5}', tone: "info" }]);
  });

  it("un passo verso la cornice scrive il passo precedente", async () => {
    stored = 3;
    await spaceBy(-1);
    expect(write).toHaveBeenCalledWith(KEY, 2);
  });

  it("agli estremi non scrive, e dice comunque a che passo si è", async () => {
    stored = 4;
    await spaceBy(1);
    expect(write).not.toHaveBeenCalled();
    expect(notices[notices.length - 1]?.text).toBe('shell.space_now {"step":5,"steps":5}');

    stored = 0;
    await spaceBy(-1);
    expect(write).not.toHaveBeenCalled();
    expect(notices[notices.length - 1]?.text).toBe('shell.space_now {"step":1,"steps":5}');
  });

  it("il ripristino torna al predefinito, e non riscrive ciò che c'è già", async () => {
    stored = 3;
    await spaceBy(0);
    expect(write).toHaveBeenCalledWith(KEY, 0);
    write.mockClear();
    await spaceBy(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("un valore che non è un passo conta come il passo più vicino", async () => {
    stored = 2.4;
    await spaceBy(1);
    expect(write).toHaveBeenCalledWith(KEY, 3);

    stored = "tanto";
    write.mockClear();
    await spaceBy(1);
    expect(write).toHaveBeenCalledWith(KEY, 1);
  });

  it("un guasto dell'host si dice, e non lascia una promessa rifiutata", async () => {
    write.mockRejectedValueOnce(new Error("disco pieno"));
    await expect(spaceBy(1)).resolves.toBeUndefined();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.tone).toBe("guasto");
    expect(notices[0]!.text).toContain("shell.space_failed");
    expect(notices[0]!.text).toContain("disco pieno");
  });
});
