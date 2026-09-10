import styles from "./Surface.module.css";

/**
 * Returns true when aria-disabled represents the disabled state.
 * React callers may provide either the boolean true or the string "true".
 */
function isAriaDisabled(props) {
  return props["aria-disabled"] === true || props["aria-disabled"] === "true";
}

/**
 * Decides whether a surface actually renders an operable, keyboard-reachable
 * control, and explains itself when it does not.
 *
 * Element type alone is not sufficient. An <a> is a link — focusable and
 * activatable — only when it carries an href (HTML living standard: without
 * href it is a "placeholder link", which is not interactive and not in the tab
 * order). A control that is disabled is not operable either, so it must not be
 * presented as actively interactive.
 *
 * Custom components are never assumed operable: this component cannot inspect
 * what they render, and guessing is exactly how a dead hover card ships.
 */
function assessOperability(elementName, props) {
  const ariaDisabled = isAriaDisabled(props);

  if (elementName === "button") {
    const disabled = props.disabled === true || ariaDisabled;

    return disabled
      ? {
          operable: false,
          reason: "the button is disabled, so it is not operable",
        }
      : { operable: true };
  }

  if (elementName === "a") {
    const href = typeof props.href === "string" ? props.href.trim() : "";

    if (href === "") {
      return {
        operable: false,
        reason:
          "an <a> without a non-empty href is a placeholder link: it is not " +
          "focusable and cannot be activated",
      };
    }

    const disabled = props.disabled === true || ariaDisabled;

    return disabled
      ? {
          operable: false,
          reason:
            "the link is marked disabled or aria-disabled, so it is not operable",
        }
      : { operable: true };
  }

  return {
    operable: false,
    reason: `<${
      elementName || "a custom component"
    }> is not a known operable element`,
  };
}

/**
 * Builds safe DOM props for the known operable element types.
 *
 * Important:
 * - <button> defaults to type="button" so a reusable interactive Surface does
 *   not accidentally submit a future form.
 * - An explicit button type supplied by the caller is preserved.
 * - aria-disabled buttons remain focusable for accessibility, but their native
 *   activation is suppressed.
 * - Disabled / aria-disabled anchors have their href removed so navigation
 *   cannot occur.
 * - Activation handlers are suppressed for unavailable controls.
 */
function buildElementProps(elementName, props) {
  const safeProps = { ...props };

  const ariaDisabled = isAriaDisabled(props);
  const nativeDisabled = props.disabled === true;

  if (elementName === "button") {
    if (safeProps.type == null) {
      safeProps.type = "button";
    }

    /*
     * Native disabled already prevents activation.
     *
     * aria-disabled does not, so an aria-disabled button needs an explicit
     * activation guard while remaining focusable.
     */
    if (ariaDisabled && !nativeDisabled) {
      safeProps.onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const originalOnKeyDown = props.onKeyDown;

      safeProps.onKeyDown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        originalOnKeyDown?.(event);
      };
    }

    return safeProps;
  }

  if (elementName === "a") {
    const unavailable = nativeDisabled || ariaDisabled;

    if (unavailable) {
      /*
       * `disabled` is not a valid native <a> attribute. If a caller supplies it
       * anyway, normalize the state to aria-disabled rather than leaking an
       * invalid disabled attribute into the anchor.
       */
      if (nativeDisabled) {
        delete safeProps.disabled;
        safeProps["aria-disabled"] = "true";
      }

      /*
       * Removing href prevents mouse, keyboard, context-menu and other native
       * link navigation paths from reaching the unavailable destination.
       */
      delete safeProps.href;

      safeProps.onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const originalOnKeyDown = props.onKeyDown;

      safeProps.onKeyDown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        originalOnKeyDown?.(event);
      };
    }

    return safeProps;
  }

  return safeProps;
}

/**
 * Surface — contained panel/card.
 *
 * Doc 03 section 51: cards are used when containment has meaning. This
 * primitive exists so that job rows, metadata panels and structured content
 * share one surface treatment instead of each inventing a border and radius.
 *
 * NO FAKE INTERACTION (05_UX_UI_SPECIFICATION.md UX-P04, section 48)
 * "Anything that appears interactive must operate." A hover lift on something
 * that cannot be activated is a dead hover card: it advertises an affordance
 * that does not exist, is invisible to keyboard users, and is prohibited.
 *
 * So `interactive` is not a styling flag that can be applied to anything. The
 * treatment is applied only when the surface genuinely renders an operable
 * control, as judged by assessOperability above. Everything else keeps the
 * static treatment and, in development, logs the specific reason.
 *
 * This is a structural guard rather than a convention, so A5's job rows cannot
 * accidentally ship as unreachable hover cards.
 *
 * CONTENT MODEL
 * When rendering as="button", children must be phrasing content — the HTML
 * button content model forbids <p>, <div> and other flow content. Use <span>
 * and style it as a block if a stacked layout is needed.
 */
export default function Surface({
  as: Element = "div",
  level = "default",
  padding = "default",
  interactive = false,
  className = "",
  children,
  ...rest
}) {
  const elementName = typeof Element === "string" ? Element : "";

  const { operable, reason } = assessOperability(elementName, rest);

  const applyInteractive = interactive && operable;

  if (interactive && !operable && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Surface] \`interactive\` was ignored because ${reason}. ` +
        'Render an operable control — as="button", or as="a" with an href — ' +
        "so it is keyboard reachable (UX-P04 — no fake interaction).",
    );
  }

  const classes = [
    styles.surface,
    level === "raised" ? styles.raised : "",
    padding === "none" ? styles.flush : "",
    padding === "roomy" ? styles.roomy : "",
    applyInteractive ? styles.interactive : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const elementProps = buildElementProps(elementName, rest);

  return (
    <Element className={classes} {...elementProps}>
      {children}
    </Element>
  );
}
