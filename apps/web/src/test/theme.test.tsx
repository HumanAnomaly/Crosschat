import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, ThemeToggle, useTheme } from "../theme";

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

describe("theme", () => {
  beforeEach(() => {
    // The provider reads localStorage on mount, so each test starts clean.
    localStorage.clear();
    document.documentElement.dataset.theme = "crosschat";
  });

  it("defaults to light and applies it to the document", () => {
    render(
      <ThemeProvider>
        <Probe />
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("crosschat");
    expect(document.documentElement.dataset.theme).toBe("crosschat");
  });

  it("toggles to dark and persists the choice", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(document.documentElement.dataset.theme).toBe("crosschat-dark");
    expect(localStorage.getItem("cc-theme")).toBe("crosschat-dark");
  });

  it("toggles back to light on a second click", async () => {
    render(
      <ThemeProvider>
        <Probe />
        <ThemeToggle />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(screen.getByTestId("theme")).toHaveTextContent("crosschat-dark");

    await userEvent.click(screen.getByRole("button", { name: /switch to light mode/i }));
    expect(screen.getByTestId("theme")).toHaveTextContent("crosschat");
    expect(document.documentElement.dataset.theme).toBe("crosschat");
  });

  it("restores a stored preference", () => {
    localStorage.setItem("cc-theme", "crosschat-dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("crosschat-dark");
  });

  it("ignores an unrecognized stored value", () => {
    localStorage.setItem("cc-theme", "solarized");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("crosschat");
  });

  it("every toggle shares one state, so sibling toggles stay in sync", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeToggle />
      </ThemeProvider>,
    );
    const [first] = screen.getAllByRole("button", { name: /switch to dark mode/i });
    await userEvent.click(first);
    // Both labels flip together because there is a single provider now.
    expect(screen.getAllByRole("button", { name: /switch to light mode/i })).toHaveLength(2);
  });
});
