import { useState } from "react";
import Container from "../components/layout/Container/Container.jsx";
import Section, {
  SectionEyebrow,
  SectionHeader,
} from "../components/layout/Section/Section.jsx";
import Button from "../components/ui/Button/Button.jsx";
import TextLink from "../components/ui/TextLink/TextLink.jsx";
import Surface from "../components/ui/Surface/Surface.jsx";
import Icon, { ICON_NAMES } from "../components/ui/Icon/Icon.jsx";
import Field from "../components/ui/Field/Field.jsx";
import TextInput from "../components/ui/TextInput/TextInput.jsx";
import TextArea from "../components/ui/TextArea/TextArea.jsx";
import Alert from "../components/ui/Alert/Alert.jsx";
import StatusMessage from "../components/ui/StatusMessage/StatusMessage.jsx";
import LoadingSkeleton from "../components/ui/LoadingSkeleton/LoadingSkeleton.jsx";
import EmptyState from "../components/ui/EmptyState/EmptyState.jsx";
import ErrorState from "../components/ui/ErrorState/ErrorState.jsx";
import SecurityField from "../components/graphics/SecurityField/SecurityField.jsx";
import styles from "./DesignSystemPreview.module.css";

const COLOR_TOKENS = [
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-hover",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-silver",
  "--color-accent",
  "--color-accent-bright",
  "--color-accent-deep",
  "--color-focus",
  "--color-success",
  "--color-warning",
  "--color-error",
  "--color-info",
];

const TYPE_LEVELS = [
  ["t-display", "Display"],
  ["t-h1", "Heading 1"],
  ["t-h2", "Heading 2"],
  ["t-h3", "Heading 3"],
  ["t-h4", "Heading 4"],
  ["t-body-lg", "Body Large"],
  ["t-body", "Body"],
  ["t-body-sm", "Body Small"],
  ["t-caption", "Caption"],
  ["t-label", "Label"],
  ["t-nav", "Navigation"],
  ["t-button", "Button"],
  ["t-metadata", "Metadata 0123456789"],
];

/**
 * Design System Preview — an internal engineering surface, not a public page.
 *
 * Exists so every primitive and state required by
 * 18_IMPLEMENTATION_ROADMAP.md section 51 can be seen, keyboard-tested and
 * screenshotted during A2 review, before routing and real pages exist.
 *
 * It is removed when A3 replaces App with the Router.
 *
 * CLAIM CONTROL (02_BRAND_TRUTH_AND_CLAIMS.md)
 * Every string here is neutral placeholder wording describing a component
 * state. It must never imply that a role exists, that an application was
 * received, that a notification capability exists, or that any operational
 * data is real. Success wording in particular is reserved for A5/B5, where it
 * follows genuine server-confirmed persistence.
 *
 * NO FAKE INTERACTION (UX-P04)
 * Enabled controls on this preview must perform a real, observable engineering
 * demo action. They must not be focusable controls whose activation does
 * nothing. The shared preview status below provides a neutral result for
 * component demonstrations that do not otherwise have their own state.
 */
export default function DesignSystemPreview() {
  const [email, setEmail] = useState("");
  const [showFieldError, setShowFieldError] = useState(true);

  const [demoActionState, setDemoActionState] = useState({
    count: 0,
    message: "No preview action activated yet.",
  });

  // Counter for the operable Surface example below. The preview must never
  // present a non-operable element as interactive (UX-P04), so this example
  // performs a real, neutral, preview-only action instead of faking one.
  const [surfaceActivations, setSurfaceActivations] = useState(0);

  const recordDemoAction = (label) => {
    setDemoActionState((current) => {
      const nextCount = current.count + 1;

      return {
        count: nextCount,
        message: `${label} activated. Preview action ${nextCount}.`,
      };
    });
  };

  return (
    <main id="main-content" className={styles.page}>
      <Container width="wide">
        <Alert
          tone="info"
          title="Internal design-system preview"
          className={styles.notice}
        >
          Release A / Milestone A2. This screen exercises the Valida design
          system so its components and states can be reviewed. It is not a
          public page and is replaced by the application shell in Milestone A3.
          All text here is placeholder wording for component states only:
          nothing on this screen describes a real role, application,
          notification or any other Valida capability.
        </Alert>

        <StatusMessage>
          Preview action status: {demoActionState.message}
        </StatusMessage>
      </Container>

      {/* ---- Security Field ---- */}
      <Section spacing="sm">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Signature visual</SectionEyebrow>

            <h1 className="t-h2">Valida Security Field</h1>

            <p className="t-body-lg t-measure">
              Abstract, non-operational SVG built from implied V geometry,
              partial shield geometry, technical arcs and sparse nodes. Ambient
              motion stops entirely under reduced-motion, and detail layers are
              dropped below 768px.
            </p>
          </SectionHeader>

          <div className={styles.heroPreview}>
            <div className={styles.stack}>
              <p className="t-body t-measure">
                The graphic is decorative and hidden from assistive technology.
                Meaning is carried by text, never by the visual.
              </p>

              <div className={styles.row}>
                <Button
                  variant="primary"
                  size="large"
                  onClick={() => recordDemoAction("Hero primary button")}
                >
                  Primary action
                  <Icon name="arrowRight" size="sm" />
                </Button>

                <Button
                  variant="secondary"
                  size="large"
                  onClick={() => recordDemoAction("Hero secondary button")}
                >
                  Secondary action
                </Button>
              </div>
            </div>

            <SecurityField />
          </div>
        </Container>
      </Section>

      {/* ---- Colour ---- */}
      <Section spacing="sm" surface="secondary">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Tokens</SectionEyebrow>
            <h2 className="t-h3">Colour</h2>
          </SectionHeader>

          <div className={styles.grid}>
            {COLOR_TOKENS.map((token) => (
              <div key={token} className={styles.swatch}>
                <span
                  className={styles.chip}
                  style={{ backgroundColor: `var(${token})` }}
                />
                <code className="t-mono">{token}</code>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* ---- Typography ---- */}
      <Section spacing="sm">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Tokens</SectionEyebrow>
            <h2 className="t-h3">Typography</h2>
          </SectionHeader>

          <div className={styles.stack}>
            {TYPE_LEVELS.map(([className, label]) => (
              <div key={className}>
                <code className="t-mono t-caption">{className}</code>
                <p className={className}>{label}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* ---- Buttons ---- */}
      <Section spacing="sm" surface="secondary">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Components</SectionEyebrow>

            <h2 className="t-h3">Buttons</h2>

            <p className="t-body t-measure">
              Six variants, three sizes, and the disabled and loading states.
              Tab through them to check the focus ring.
            </p>
          </SectionHeader>

          <div className={styles.stack}>
            <div className={styles.row}>
              <Button
                variant="primary"
                onClick={() => recordDemoAction("Primary button")}
              >
                Primary
              </Button>

              <Button
                variant="secondary"
                onClick={() => recordDemoAction("Secondary button")}
              >
                Secondary
              </Button>

              <Button
                variant="ghost"
                onClick={() => recordDemoAction("Ghost button")}
              >
                Ghost
              </Button>

              <Button
                variant="destructive"
                onClick={() => recordDemoAction("Destructive button")}
              >
                Destructive
              </Button>

              <Button
                variant="text"
                onClick={() => recordDemoAction("Text CTA button")}
              >
                Text CTA
              </Button>

              <Button
                variant="icon"
                iconOnly
                aria-label="Run icon button demo action"
                onClick={() => recordDemoAction("Icon button")}
              >
                <Icon name="close" size="md" />
              </Button>
            </div>

            <div className={styles.row}>
              <Button
                size="compact"
                onClick={() => recordDemoAction("Compact button")}
              >
                Compact
              </Button>

              <Button
                size="standard"
                onClick={() => recordDemoAction("Standard button")}
              >
                Standard
              </Button>

              <Button
                size="large"
                onClick={() => recordDemoAction("Large button")}
              >
                Large
              </Button>
            </div>

            <div className={styles.row}>
              <Button disabled>Disabled</Button>

              <Button loading>Loading</Button>

              <Button variant="secondary" loading>
                Loading secondary
              </Button>

              <Button href="#main-content" variant="secondary">
                Link-styled button
              </Button>
            </div>

            <div className={styles.row}>
              <TextLink href="#main-content">Inline text link</TextLink>

              <TextLink href="#main-content" variant="quiet">
                Quiet link
              </TextLink>

              <TextLink href="https://example.com" external>
                External link
              </TextLink>
            </div>
          </div>
        </Container>
      </Section>

      {/* ---- Forms ---- */}
      <Section spacing="sm">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Components</SectionEyebrow>

            <h2 className="t-h3">Form primitives</h2>

            <p className="t-body t-measure">
              Every field has a real label bound by id. Errors use an icon plus
              text and set aria-invalid, so meaning never depends on colour.
              Every value shown is sample input.
            </p>
          </SectionHeader>

          <div className={styles.formGrid}>
            <Field label="Full name" required>
              {(props) => (
                <TextInput
                  {...props}
                  autoComplete="name"
                  placeholder="Jane Doe"
                />
              )}
            </Field>

            <Field
              label="Email address"
              required
              description="Example description text."
              error={
                showFieldError ? "Enter a valid email address." : undefined
              }
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
            </Field>

            <Field label="Phone" optionalText="Optional">
              {(props) => (
                <TextInput {...props} type="tel" autoComplete="tel" />
              )}
            </Field>

            <Field label="Disabled field">
              {(props) => (
                <TextInput {...props} disabled value="Not editable" readOnly />
              )}
            </Field>
          </div>

          <div
            className={styles.stack}
            style={{
              marginBlockStart: "var(--space-6)",
            }}
          >
            <Field label="Message" description="Plain text only.">
              {(props) => <TextArea {...props} />}
            </Field>

            <div className={styles.row}>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => setShowFieldError((value) => !value)}
              >
                Toggle error state
              </Button>

              <StatusMessage className={`t-body-sm ${styles.fieldNote}`}>
                {showFieldError ? "Error state shown." : "Error state cleared."}
              </StatusMessage>
            </div>
          </div>
        </Container>
      </Section>

      {/* ---- Feedback ---- */}
      <Section spacing="sm" surface="secondary">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Components</SectionEyebrow>

            <h2 className="t-h3">Feedback, loading and empty states</h2>
          </SectionHeader>

          <div className={styles.stack}>
            <Alert tone="info" title="Info tone">
              Used for neutral supporting information.
            </Alert>

            <Alert tone="success" title="Success tone">
              Used to confirm an outcome after the server has actually confirmed
              it.
            </Alert>

            <Alert tone="warning" title="Warning tone">
              Used for a time-sensitive or cautionary notice.
            </Alert>

            <ErrorState onRetry={() => recordDemoAction("Error-state retry")} />

            <Surface>
              <p
                className="t-label"
                style={{
                  marginBlockEnd: "var(--space-4)",
                }}
              >
                Loading skeleton
              </p>

              <LoadingSkeleton lines={4} />
            </Surface>

            <EmptyState
              title="Nothing to display"
              action={
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => recordDemoAction("Empty-state example action")}
                >
                  Example action
                </Button>
              }
            >
              Shape of the empty state a connected data source renders when it
              returns zero records. The wording and any action are supplied by
              the consuming page.
            </EmptyState>
          </div>
        </Container>
      </Section>

      {/* ---- Surfaces and icons ---- */}
      <Section spacing="sm">
        <Container width="wide">
          <SectionHeader>
            <SectionEyebrow>Components</SectionEyebrow>

            <h2 className="t-h3">Surfaces and icons</h2>
          </SectionHeader>

          <div className={styles.grid}>
            <Surface>
              <p className="t-label">Surface</p>

              <p className="t-body-sm">
                Level 2 panel. Informational, no hover affordance.
              </p>
            </Surface>

            <Surface level="raised">
              <p className="t-label">Raised</p>

              <p className="t-body-sm">
                Level 3 panel. Informational, no hover affordance.
              </p>
            </Surface>

            <Surface
              as="button"
              type="button"
              interactive
              onClick={() => setSurfaceActivations((count) => count + 1)}
            >
              {/* The HTML button content model allows phrasing content only,
                  so these are spans displayed as blocks rather than paragraphs. */}
              <span className={`t-label ${styles.cardRow}`}>Interactive</span>

              <span className={`t-body-sm ${styles.cardRow}`}>
                Renders as a real button. Activate it with the mouse, Enter or
                Space.
              </span>

              <span className={`t-metadata ${styles.cardRow}`}>
                Activated {surfaceActivations} times
              </span>
            </Surface>
          </div>

          <div
            className={styles.row}
            style={{
              marginBlockStart: "var(--space-6)",
            }}
          >
            {ICON_NAMES.map((name) => (
              <span
                key={name}
                className={styles.row}
                style={{
                  gap: "var(--space-2)",
                }}
              >
                <Icon name={name} size="lg" />

                <code className="t-mono t-caption">{name}</code>
              </span>
            ))}
          </div>
        </Container>
      </Section>
    </main>
  );
}
