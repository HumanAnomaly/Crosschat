import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PLATFORMS, platformOrFallback, findPlatform } from "@crosschat/core";
import PlatformRail from "../PlatformRail";
import PlatformIcon from "../PlatformIcon";
import PlatformTipsDialog from "../PlatformTipsDialog";

describe("PlatformRail", () => {
  it("renders one button per registered platform", () => {
    render(<PlatformRail connectedId={null} onSelect={() => {}} />);
    for (const p of PLATFORMS) {
      expect(screen.getByRole("button", { name: new RegExp(p.label, "i") })).toBeInTheDocument();
    }
  });

  it("reports which platform was picked", async () => {
    const onSelect = vi.fn();
    render(<PlatformRail connectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /telegram/i }));
    expect(onSelect).toHaveBeenCalledWith("telegram");
  });

  it("marks the linked platform as already connected", () => {
    render(<PlatformRail connectedId="telegram" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /telegram is linked/i })).toBeInTheDocument();
  });

  it("does not mark anything when nothing is linked", () => {
    render(<PlatformRail connectedId={null} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /is linked/i })).toBeNull();
  });
});

describe("PlatformIcon", () => {
  it("renders the brand tile for a known platform", () => {
    const { container } = render(<PlatformIcon platform={platformOrFallback("telegram")} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("falls back to a neutral glyph for an unknown platform", () => {
    const { container } = render(
      <PlatformIcon platform={platformOrFallback("brand-new-app")} size={16} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("never throws on an empty registry entry", () => {
    const stub = { id: "", label: "", brandColor: "#000", icon: "nope", entryUrl: "", entryLabel: "", steps: [], note: "" };
    expect(() => render(<PlatformIcon platform={stub} />)).not.toThrow();
  });
});

describe("PlatformTipsDialog", () => {
  const telegram = platformOrFallback("telegram");

  it("stays closed without a platform", () => {
    const { container } = render(
      <PlatformTipsDialog platform={null} onClose={() => {}} onClaim={() => {}} />,
    );
    expect(container.querySelector("dialog")?.open).toBe(false);
  });

  it("opens with the platform name and steps", () => {
    render(<PlatformTipsDialog platform={telegram} onClose={() => {}} onClaim={() => {}} />);
    expect(screen.getByRole("heading", { name: /link telegram/i })).toBeInTheDocument();
    for (const step of telegram.steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("links to the bot and opens it in a new tab", () => {
    render(<PlatformTipsDialog platform={telegram} onClose={() => {}} onClaim={() => {}} />);
    const link = screen.getByRole("link", { name: /trycrosschat_bot/i });
    expect(link).toHaveAttribute("href", "https://t.me/trycrosschat_bot");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("numbers the steps in order", () => {
    render(<PlatformTipsDialog platform={telegram} onClose={() => {}} onClaim={() => {}} />);
    const badges = screen.getAllByText(/^[1-9]$/);
    expect(badges.map((b) => b.textContent)).toEqual(telegram.steps.map((_, i) => String(i + 1)));
  });

  it("hands off to code entry", async () => {
    const onClose = vi.fn();
    const onClaim = vi.fn();
    render(<PlatformTipsDialog platform={telegram} onClose={onClose} onClaim={onClaim} />);
    await userEvent.click(screen.getByRole("button", { name: /i have a code/i }));
    expect(onClaim).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes without entering a code", async () => {
    const onClaim = vi.fn();
    render(<PlatformTipsDialog platform={telegram} onClose={() => {}} onClaim={onClaim} />);
    // The backdrop button is also named "close"; target the header button.
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClaim).not.toHaveBeenCalled();
  });

  it("renders any platform from the registry the same way", () => {
    for (const p of PLATFORMS) {
      const { unmount } = render(
        <PlatformTipsDialog platform={findPlatform(p.id)} onClose={() => {}} onClaim={() => {}} />,
      );
      expect(screen.getByRole("heading", { name: new RegExp(`link ${p.label}`, "i") })).toBeInTheDocument();
      unmount();
    }
  });
});
