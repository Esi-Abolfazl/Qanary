import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrayIcon, TRAY_MOODS } from "./trayIcons";

const LOOKS = [
  { icon: "rings", filled: false },
  { icon: "pulse", filled: false },
  { icon: "rings", filled: true },
  { icon: "pulse", filled: true },
] as const;

describe("TrayIcon", () => {
  it("draws every look in every state, each a different picture", () => {
    const seen = new Set<string>();
    for (const { icon, filled } of LOOKS) {
      for (const { mood } of TRAY_MOODS) {
        const { container, unmount } = render(<TrayIcon icon={icon} filled={filled} mood={mood} />);
        const svg = container.querySelector("svg.tray-icon")!;
        expect(svg).toHaveAttribute("data-icon", icon);
        expect(svg).toHaveAttribute("data-filled", String(filled));
        expect(svg).toHaveAttribute("data-mood", mood);
        expect(svg.children.length).toBeGreaterThan(0);
        seen.add(svg.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)/g, ""));
        unmount();
      }
    }
    // Busy shares its picture with ok (only the colour differs), so 4 looks × 4 pictures.
    expect(seen.size).toBe(16);
  });

  it("filled looks cut the glyph out of a plate with a mask; bare ones do not", () => {
    for (const { icon, filled } of LOOKS) {
      const { container, unmount } = render(<TrayIcon icon={icon} filled={filled} mood="ok" />);
      expect(container.querySelector("mask") !== null).toBe(filled);
      unmount();
    }
  });

  it("the filled Rings plate is a circle, the filled Pulse plate a rounded square", () => {
    const corner = (icon: "rings" | "pulse") => {
      const { container, unmount } = render(<TrayIcon icon={icon} filled mood="ok" />);
      const rx = container.querySelector("rect[rx]")!.getAttribute("rx");
      unmount();
      return Number(rx);
    };
    expect(corner("rings")).toBe(11); // half the plate's side: a circle
    expect(corner("pulse")).toBeLessThan(11);
  });

  it("offline is a Wi-Fi with a \"!\" in every look: three solid arcs, a dot and a bar", () => {
    for (const { icon, filled } of LOOKS) {
      const { container, unmount } = render(<TrayIcon icon={icon} filled={filled} mood="offline" />);
      // The arcs are solid with round ends (no dashes), the dot is the Wi-Fi's, the bar is the "!".
      const arcs = Array.from(container.querySelectorAll("path")).filter((p) => p.getAttribute("d")!.includes("A"));
      expect(arcs, `${icon}/${filled}: arcs`).toHaveLength(3);
      arcs.forEach((a) => {
        expect(a.getAttribute("stroke-dasharray")).toBeNull();
        expect(a.getAttribute("stroke-linecap")).toBe("round");
      });
      expect(container.querySelectorAll("circle[r]").length, `${icon}/${filled}: dot`).toBeGreaterThanOrEqual(1);
      // No slash: the "!" is Offline's mark. Alarm has no Wi-Fi arcs.
      expect(container.querySelector("polyline"), `${icon}/${filled}: no slash`).toBeNull();
      unmount();
      const alarm = render(<TrayIcon icon={icon} filled={filled} mood="alarm" />);
      expect(
        Array.from(alarm.container.querySelectorAll("path")).some((p) => p.getAttribute("d")!.includes("A")),
      ).toBe(false);
      alarm.unmount();
    }
    // Pulse keeps its rounded-square frame (the only rounded rect; the mask's white rect has no
    // corners); Rings keeps a plain outer ring instead.
    const pulse = render(<TrayIcon icon="pulse" filled={false} mood="offline" />);
    expect(pulse.container.querySelector("rect[rx]")).not.toBeNull();
    pulse.unmount();
    const rings = render(<TrayIcon icon="rings" filled={false} mood="offline" />);
    expect(rings.container.querySelector("rect[rx]")).toBeNull();
    expect(rings.container.querySelector('circle[r="10.6"]')).not.toBeNull();
  });

  it("alarm and heads-up use dots: round-ended dashes shorter than the stroke is wide", () => {
    const dotted = (icon: "rings" | "pulse", filled: boolean, mood: "warn" | "alarm") => {
      const { container, unmount } = render(<TrayIcon icon={icon} filled={filled} mood={mood} />);
      const rings = Array.from(container.querySelectorAll("circle[stroke-dasharray]"));
      const out = rings.map((r) => ({
        round: r.getAttribute("stroke-linecap") === "round",
        dashShorterThanStroke:
          Number(r.getAttribute("stroke-dasharray")!.split(" ")[0]) < Number(r.getAttribute("stroke-width")),
      }));
      const dots = container.querySelectorAll("circle:not([stroke])").length;
      unmount();
      return { out, dots };
    };
    for (const filled of [false, true]) {
      for (const mood of ["warn", "alarm"] as const) {
        const { out } = dotted("rings", filled, mood);
        expect(out.length).toBeGreaterThan(0);
        out.forEach((o) => expect(o).toEqual({ round: true, dashShorterThanStroke: true }));
      }
      // Pulse alarm is a dead line drawn as four dots, two each side of the X.
      expect(dotted("pulse", filled, "alarm").dots).toBe(4);
    }
  });

  it("is decorative: hidden from assistive tech", () => {
    const { container } = render(<TrayIcon icon="rings" filled={false} mood="ok" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
