// @vitest-environment happy-dom
//
// Solo il sinistro fa clic (IMP-002, IMP-012): WebKitGTK manda un `click` col
// `button` del sinistro anche dopo il centrale, Chromium un `auxclick`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { primaryClicksOnly } from "./primary-clicks";

const mouse = (target: Element, type: string, button: number, detail = 1): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, detail });
  target.dispatchEvent(event);
  return event;
};

describe("primaryClicksOnly", () => {
  let dispose: () => void = () => {};
  afterEach(() => {
    dispose();
    document.body.replaceChildren();
  });

  function mount() {
    const list = document.createElement("div");
    const item = document.createElement("button");
    list.append(item);
    document.body.append(list);
    const clicks = vi.fn();
    const middles = vi.fn();
    item.addEventListener("click", clicks);
    item.addEventListener("auxclick", clicks);
    dispose = primaryClicksOnly(list, { onMiddle: middles });
    return { item, clicks, middles };
  }

  it("il sinistro e Invio arrivano", () => {
    const { item, clicks, middles } = mount();
    mouse(item, "mousedown", 0);
    mouse(item, "click", 0);
    item.click();
    expect(clicks).toHaveBeenCalledTimes(2);
    expect(middles).not.toHaveBeenCalled();
  });

  it("il centrale in WebKitGTK: niente clic, una chiamata sola, e niente incolla", () => {
    const { item, clicks, middles } = mount();
    expect(mouse(item, "mousedown", 1).defaultPrevented).toBe(true);
    mouse(item, "click", 0);
    expect(clicks).not.toHaveBeenCalled();
    expect(middles).toHaveBeenCalledTimes(1);
    expect(middles).toHaveBeenCalledWith(item);
  });

  it("il centrale in Chromium, e i due eventi insieme: una chiamata sola", () => {
    const { item, clicks, middles } = mount();
    mouse(item, "mousedown", 1);
    mouse(item, "auxclick", 1);
    mouse(item, "click", 0);
    expect(clicks).not.toHaveBeenCalled();
    expect(middles).toHaveBeenCalledTimes(1);
  });

  it("il destro non fa clic e non chiama il centrale", () => {
    const { item, clicks, middles } = mount();
    mouse(item, "mousedown", 2);
    mouse(item, "click", 0);
    mouse(item, "auxclick", 2);
    expect(clicks).not.toHaveBeenCalled();
    expect(middles).not.toHaveBeenCalled();
  });
});
