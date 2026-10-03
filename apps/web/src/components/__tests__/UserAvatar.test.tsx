import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UserAvatar from "../UserAvatar";

describe("UserAvatar", () => {
  it("shows the image when a valid https picture exists", () => {
    render(<UserAvatar user={{ name: "Alice", email: "a@b.c", picture: "https://cdn.example/a.png" }} />);
    expect(screen.getByAltText("Alice")).toBeInTheDocument();
  });

  it("upgrades a protocol-relative picture url", () => {
    render(<UserAvatar user={{ name: "A", email: "a@b.c", picture: "//cdn.example/a.png" }} />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "https://cdn.example/a.png");
  });

  it("refuses non-http sources so javascript: urls cannot render", () => {
    render(<UserAvatar user={{ name: "A", email: "a@b.c", picture: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("derives two initials from a full name", () => {
    render(<UserAvatar user={{ name: "Ada Lovelace", email: "a@b.c", picture: null }} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("derives one initial from a single name", () => {
    render(<UserAvatar user={{ name: "Prince", email: "a@b.c", picture: null }} />);
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("derives one initial from an email", () => {
    render(<UserAvatar user={{ name: null, email: "zoe@example.com", picture: null }} />);
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("falls back to the email when the name is blank", () => {
    render(<UserAvatar user={{ name: "   ", email: "a@b.c", picture: null }} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("lazy-loads and sets intrinsic size per variant", () => {
    render(<UserAvatar user={{ name: "A", email: "a@b.c", picture: "https://cdn.example/a.png" }} size="lg" />);
    const img = screen.getByAltText("A");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "96");
    expect(img).toHaveAttribute("height", "96");
  });

  it("applies the ring variant", () => {
    const { container } = render(
      <UserAvatar user={{ name: "A", email: "a@b.c", picture: "https://cdn.example/a.png" }} ring />,
    );
    expect(container.querySelector(".avatar > div")).toHaveClass("ring-2");
  });
});
