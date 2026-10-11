import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { LangProvider, LangToggle, useLang } from "../../i18n";

function Label() {
  const { t } = useLang();
  return <span>{t("chat.emptyTitle")}</span>;
}

describe("i18n", () => {
  beforeEach(() => localStorage.clear());

  it("falls back to English without a provider", () => {
    render(<Label />);
    expect(screen.getByText("Link a platform to start chatting")).toBeInTheDocument();
  });

  it("uses saved Indonesian and toggles back", () => {
    localStorage.setItem("crosschat:lang", "id");
    render(
      <LangProvider>
        <Label />
        <LangToggle />
      </LangProvider>,
    );
    expect(screen.getByText("Tautkan platform untuk mulai ngobrol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ganti bahasa" }));
    expect(screen.getByText("Link a platform to start chatting")).toBeInTheDocument();
    expect(localStorage.getItem("crosschat:lang")).toBe("en");
  });
});
