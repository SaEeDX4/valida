import axe from 'axe-core';

/**
 * Accessibility automation helper.
 *
 * 17_QA_TEST_PLAN.md section 16 makes axe-core the canonical accessibility
 * automation tool, integrated into component tests. axe-core is used directly
 * rather than through a matcher wrapper, so no extra dependency is introduced
 * (18_IMPLEMENTATION_ROADMAP.md section 23).
 *
 * Returns the violation list so a failing test can print exactly which rule
 * failed and on which element.
 */
export async function findAccessibilityViolations(container) {
  const results = await axe.run(container, {
    // Rules that require a full document (landmarks, page-level regions) are
    // meaningful at page level in A3/A6, not for an isolated component.
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
    rules: {
      region: { enabled: false },
    },
  });

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.html),
  }));
}
