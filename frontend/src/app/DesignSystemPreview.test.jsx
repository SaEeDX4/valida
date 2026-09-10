import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DesignSystemPreview from "./DesignSystemPreview.jsx";
import { findAccessibilityViolations } from "../test/axe.js";

/**
 * Guards on the Design System Preview itself.
 *
 * The preview is an engineering surface, not a public page, but it is rendered
 * in a browser during A2 review. It must therefore remain valid, accessible
 * and genuinely operable.
 *
 * These tests pin defects found during A2 review:
 * - valid button content model;
 * - no nested interactive controls;
 * - no fake interactive Surface;
 * - no enabled preview button whose activation produces no observable result.
 */

/** Flow-content elements that are invalid inside a <button>. */
const FLOW_ONLY =
  "p, div, ul, ol, li, section, article, h1, h2, h3, h4, h5, h6, table, form";

describe("DesignSystemPreview", () => {
  it("renders the interactive card as a real, operable button", () => {
    render(<DesignSystemPreview />);

    expect(screen.getByRole("button", { name: /Interactive/ })).toBeTruthy();
  });

  it("keeps the button content model valid — phrasing content only", () => {
    /*
     * The HTML button content model permits phrasing content. <p> and other
     * flow content inside a <button> is invalid markup and was a real defect
     * in an earlier correction cycle, so it is pinned here.
     */
    render(<DesignSystemPreview />);

    const button = screen.getByRole("button", {
      name: /Interactive/,
    });

    expect(button.querySelectorAll(FLOW_ONLY)).toHaveLength(0);
  });

  it("nests no interactive content inside the button-backed surface", () => {
    /*
     * A control inside another control creates invalid and confusing
     * interaction semantics.
     */
    render(<DesignSystemPreview />);

    const button = screen.getByRole("button", {
      name: /Interactive/,
    });

    expect(
      button.querySelectorAll("button, a, input, select, textarea"),
    ).toHaveLength(0);
  });

  it("operates the interactive card by keyboard and updates its own state", async () => {
    const user = userEvent.setup();

    render(<DesignSystemPreview />);

    const button = screen.getByRole("button", {
      name: /Interactive/,
    });

    expect(button.textContent).toContain("Activated 0 times");

    button.focus();

    await user.keyboard("{Enter}");

    expect(button.textContent).toContain("Activated 1 times");

    await user.keyboard(" ");

    expect(button.textContent).toContain("Activated 2 times");
  });

  it("provides a live status region for neutral preview-only actions", () => {
    render(<DesignSystemPreview />);

    const statuses = screen.getAllByRole("status");

    const previewStatus = statuses.find((status) =>
      status.textContent.includes("Preview action status:"),
    );

    expect(previewStatus).toBeTruthy();
    expect(previewStatus.getAttribute("aria-live")).toBe("polite");
    expect(previewStatus.getAttribute("aria-atomic")).toBe("true");
  });

  it("every enabled preview button produces an observable result", async () => {
    /*
     * UX-P04 — no fake interaction.
     *
     * Every enabled button in this engineering preview must do something
     * observable when activated:
     *
     * - ordinary component demos update the shared preview-status message;
     * - Toggle error state changes visible field state;
     * - the interactive Surface increments its own counter.
     *
     * Disabled/loading controls are deliberately excluded because their
     * purpose is to demonstrate an unavailable state.
     *
     * This test is intentionally broad so that adding a new enabled
     * onClick-less demonstration button later causes a regression failure.
     */
    const user = userEvent.setup();

    const { container } = render(<DesignSystemPreview />);

    const enabledButtons = screen
      .getAllByRole("button")
      .filter(
        (button) =>
          !button.disabled && button.getAttribute("aria-disabled") !== "true",
      );

    expect(enabledButtons.length).toBeGreaterThan(0);

    for (const button of enabledButtons) {
      const before = container.textContent;

      await user.click(button);

      const after = container.textContent;

      expect(
        after,
        `Enabled preview button "${button.getAttribute("aria-label") || button.textContent.trim()}" produced no observable result`,
      ).not.toBe(before);
    }
  });

  it("every enabled navigation control has a real non-empty href", () => {
    /*
     * Navigation demos are allowed to navigate rather than mutate preview
     * state, but they must be real links — never placeholder anchors.
     */
    render(<DesignSystemPreview />);

    const links = screen.getAllByRole("link");

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const href = link.getAttribute("href");

      expect(href).not.toBeNull();
      expect(href.trim().length).toBeGreaterThan(0);
    }
  });

  it("representative preview actions update the shared status message", async () => {
    const user = userEvent.setup();

    render(<DesignSystemPreview />);

    const getPreviewStatus = () =>
      screen
        .getAllByRole("status")
        .find((status) =>
          status.textContent.includes("Preview action status:"),
        );

    await user.click(
      screen.getByRole("button", {
        name: /^Primary action/,
      }),
    );

    expect(getPreviewStatus().textContent).toContain(
      "Hero primary button activated.",
    );

    await user.click(
      screen.getByRole("button", {
        name: /^Primary$/,
      }),
    );

    expect(getPreviewStatus().textContent).toContain(
      "Primary button activated.",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Try Again",
      }),
    );

    expect(getPreviewStatus().textContent).toContain(
      "Error-state retry activated.",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Example action",
      }),
    );

    expect(getPreviewStatus().textContent).toContain(
      "Empty-state example action activated.",
    );
  });

  it("has no axe violations across the whole preview", async () => {
    const { container } = render(<DesignSystemPreview />);

    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
