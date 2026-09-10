import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SecurityField from "./SecurityField.jsx";
import Container from "../../layout/Container/Container.jsx";
import Section, { SectionEyebrow } from "../../layout/Section/Section.jsx";
import Surface from "../../ui/Surface/Surface.jsx";
import TextLink from "../../ui/TextLink/TextLink.jsx";
import Icon from "../../ui/Icon/Icon.jsx";
import { setReducedMotion } from "../../../test/setup.js";
import { findAccessibilityViolations } from "../../../test/axe.js";

describe("SecurityField", () => {
  beforeEach(() => setReducedMotion(false));

  it("is decorative and hidden from assistive technology (Doc 08 s61)", () => {
    const { container } = render(<SecurityField data-testid="field" />);
    expect(screen.getByTestId("field").getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector("svg").getAttribute("role")).toBe(
      "presentation",
    );
  });

  it("contains no text, so it cannot present fake operational data (VIS-012)", () => {
    const { container } = render(<SecurityField />);
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(container.textContent.trim()).toBe("");
  });

  it("applies ambient motion classes when motion is allowed", () => {
    const { container } = render(<SecurityField />);
    const animated = container.querySelectorAll(
      '[class*="drift"], [class*="pulse"]',
    );
    expect(animated.length).toBeGreaterThan(0);
  });

  it("starts no ambient motion when reduced motion is requested (Doc 03 s77)", () => {
    setReducedMotion(true);
    const { container } = render(<SecurityField />);

    expect(
      container.querySelectorAll('[class*="drift"], [class*="pulse"]'),
    ).toHaveLength(0);

    // The composition itself is unchanged: the same structural layers remain.
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("has no axe violations", async () => {
    const { container } = render(<SecurityField />);
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe("Layout and surface primitives", () => {
  it("Container renders the requested semantic element", () => {
    render(
      <Container as="main" width="reading">
        Body
      </Container>,
    );
    expect(screen.getByRole("main").textContent).toBe("Body");
  });

  it("Section renders a section landmark and an eyebrow that is not a heading", () => {
    render(
      <Section aria-label="Capabilities">
        <SectionEyebrow>Capabilities</SectionEyebrow>
        <h2>Heading</h2>
      </Section>,
    );

    expect(screen.getByRole("region", { name: "Capabilities" })).toBeTruthy();

    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("Surface can render as a semantic element", () => {
    render(<Surface as="article">Job</Surface>);
    expect(screen.getByRole("article").textContent).toBe("Job");
  });

  it("Surface refuses to fake interaction on a non-operable element (UX-P04)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(<Surface interactive>Informational</Surface>);

    // No hover-lift treatment is applied, so the card never advertises an
    // affordance a keyboard user cannot reach.
    expect(container.firstChild.className).not.toMatch(/interactive/);

    warn.mockRestore();
  });

  it("Surface treats an anchor WITH an href as operable", () => {
    const { container } = render(
      <Surface as="a" href="/careers" interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).toMatch(/interactive/);
    expect(screen.getByRole("link", { name: "Open role" })).toBeTruthy();
  });

  it("Surface rejects an anchor WITHOUT an href (placeholder link, not operable)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <Surface as="a" interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).not.toMatch(/interactive/);

    // A placeholder link exposes no link role and is not in the tab order.
    expect(screen.queryByRole("link")).toBeNull();

    warn.mockRestore();
  });

  it("Surface rejects an anchor whose href is empty or whitespace", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <Surface as="a" href="   " interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).not.toMatch(/interactive/);

    warn.mockRestore();
  });

  it("Surface rejects a disabled button so an unavailable control is not shown as active", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <Surface as="button" type="button" disabled interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).not.toMatch(/interactive/);

    warn.mockRestore();
  });

  it("Surface rejects an aria-disabled control", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <Surface as="a" href="/careers" aria-disabled="true" interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).not.toMatch(/interactive/);

    warn.mockRestore();
  });

  it("Surface applies the interactive treatment when it renders a real button", () => {
    const { container } = render(
      <Surface as="button" type="button" interactive>
        Open role
      </Surface>,
    );

    expect(container.firstChild.className).toMatch(/interactive/);

    expect(screen.getByRole("button", { name: "Open role" })).toBeTruthy();
  });

  it("an interactive Surface is keyboard reachable and operable", async () => {
    const onClick = vi.fn();

    render(
      <Surface as="button" type="button" interactive onClick={onClick}>
        Open role
      </Surface>,
    );

    await userEvent.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open role" }),
    );

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('Surface as="button" safely defaults to type="button" and does not submit a form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <Surface as="button" interactive>
          Preview action
        </Surface>
      </form>,
    );

    const button = screen.getByRole("button", {
      name: "Preview action",
    });

    expect(button.getAttribute("type")).toBe("button");

    await user.click(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Surface preserves an explicitly requested type="submit"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <Surface as="button" type="submit" interactive>
          Submit deliberately
        </Surface>
      </form>,
    );

    const button = screen.getByRole("button", {
      name: "Submit deliberately",
    });

    expect(button.getAttribute("type")).toBe("submit");

    await user.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a native disabled Surface button cannot execute its action", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Surface as="button" disabled interactive onClick={onClick}>
        Disabled action
      </Surface>,
    );

    const button = screen.getByRole("button", {
      name: "Disabled action",
    });

    expect(button.disabled).toBe(true);

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("an aria-disabled Surface button cannot activate by pointer, Enter, or Space", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Surface as="button" aria-disabled="true" interactive onClick={onClick}>
        Unavailable action
      </Surface>,
    );

    const button = screen.getByRole("button", {
      name: "Unavailable action",
    });

    expect(button.getAttribute("aria-disabled")).toBe("true");

    await user.click(button);

    button.focus();
    expect(document.activeElement).toBe(button);

    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).not.toHaveBeenCalled();
  });

  it("an aria-disabled Surface anchor loses href and cannot execute its action", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Surface
        as="a"
        href="/careers"
        aria-disabled="true"
        interactive
        onClick={onClick}
      >
        Unavailable link
      </Surface>,
    );

    const anchor = screen.getByText("Unavailable link");

    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(screen.queryByRole("link")).toBeNull();

    await user.click(anchor);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("a disabled Surface anchor is normalized to aria-disabled and cannot activate", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Surface as="a" href="/careers" disabled interactive onClick={onClick}>
        Disabled link
      </Surface>,
    );

    const anchor = screen.getByText("Disabled link");

    expect(anchor.tagName).toBe("A");
    expect(anchor.hasAttribute("disabled")).toBe(false);
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
    expect(anchor.hasAttribute("href")).toBe(false);

    await user.click(anchor);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("an enabled Surface anchor preserves its href and action", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn((event) => event.preventDefault());

    render(
      <Surface as="a" href="#preview-target" interactive onClick={onClick}>
        Enabled link
      </Surface>,
    );

    const link = screen.getByRole("link", {
      name: "Enabled link",
    });

    expect(link.getAttribute("href")).toBe("#preview-target");

    await user.click(link);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("an interactive Surface has no axe violations", async () => {
    const { container } = render(
      <Surface as="button" type="button" interactive>
        Open role
      </Surface>,
    );

    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it("TextLink marks external links safely and announces the new tab", () => {
    render(
      <TextLink href="https://example.com" external>
        Docs
      </TextLink>,
    );

    const link = screen.getByRole("link");

    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
  });

  it("Icon is decorative unless given a title", () => {
    const { container, rerender } = render(<Icon name="check" />);

    expect(container.querySelector("svg").getAttribute("aria-hidden")).toBe(
      "true",
    );

    rerender(<Icon name="check" title="Verified" />);

    expect(screen.getByRole("img", { name: "Verified" })).toBeTruthy();
  });

  it("Icon renders nothing for an unknown name rather than crashing", () => {
    const { container } = render(<Icon name="does-not-exist" />);

    expect(container.querySelector("svg")).toBeNull();
  });
});
