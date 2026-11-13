import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { FIXTURES_DIR, BACKEND_DIR, FRONTEND_DIR } from '../support/paths.js';
import { runNode } from '../support/processes.js';
import { C5_BACKEND_ORIGIN, C5_JOB_STEPS, C5_SITE_ORIGIN, C5_SLUGS, c5BackendEnvironment, readC5Run } from '../support/c5Stack.js';

/**
 * Shared helpers of the C5 cases: evidence records and screenshots in the run
 * directory (never in the repository), the synthetic Job provisioning, and the
 * in-page probes (layout, targets, focus, motion) the cases run.
 *
 * Observation labels used in the records:
 *   REAL        an actual response or browser state of this stack;
 *   HOLD        a real request delayed by the test, then sent unchanged (loading states);
 *   FAULT       a request made to fail on purpose (error states), then recovered for real;
 *   EMULATED    a browser emulation (viewport, text size, zoom, reduced motion,
 *               forced colours, CPU and network throttling) — not a real device,
 *               assistive technology or user setting;
 *   LAB         a local lab measurement, not field data.
 */
export const run = () => readC5Run();

/** Doc 18 section 170 / Doc 05 section 212: the required review widths (CSS px). */
export const WIDTHS = Object.freeze([360, 390, 430, 768, 1024, 1440, 1920]);
/** The frontend's layout breakpoints (min-width media queries in src/**.css), each checked at -1 / 0. */
export const BREAKPOINTS = Object.freeze([600, 700, 720, 768, 820, 900, 1000]);
export const HEIGHT = 900;

export const NOT_FOUND_PATH = '/qa-c5-no-such-page';
export const MISSING_JOB_SLUG = 'qa-c5-no-such-role';

/** Doc 16 section 269 key routes, plus the hybrid Job and the closed Apply route. */
export const ROUTES = Object.freeze([
  ['home', '/'],
  ['about', '/about'],
  ['careers', '/careers'],
  ['job-open', `/careers/${C5_SLUGS.open}`],
  ['job-hybrid', `/careers/${C5_SLUGS.hybrid}`],
  ['job-closed', `/careers/${C5_SLUGS.closed}`],
  ['job-missing', `/careers/${MISSING_JOB_SLUG}`],
  ['apply-open', `/careers/${C5_SLUGS.open}/apply`],
  ['apply-closed', `/careers/${C5_SLUGS.closed}/apply`],
  ['privacy', '/privacy'],
  ['legal', '/legal'],
  ['not-found', NOT_FOUND_PATH],
]);

/** Loads a route and waits until its content (not a loading state) is shown. */
export async function openRoute(page, pathname) {
  const response = await page.goto(pathname, { waitUntil: 'load' });
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByText(/^Loading (open roles|role details)…$/)).toHaveCount(0);
  await settle(page);
  return response?.status() ?? null;
}


// --------------------------------------------------------------- evidence --
export function outputDir(sub) {
  const dir = path.join(run().dirs.output, sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function record(caseId, data) {
  writeFileSync(path.join(outputDir('cases'), `${caseId}.json`), JSON.stringify({ caseId, recordedAt: new Date().toISOString(), ...data }, null, 2));
}
export function writeText(sub, name, text) {
  const file = path.join(outputDir(sub), name);
  writeFileSync(file, text);
  return `${sub}/${name}`;
}
export async function shot(page, name, { fullPage = true } = {}) {
  if (fullPage) {
    await page.evaluate(() => new Promise((resolve) => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }
  await page.screenshot({ path: path.join(outputDir('screenshots'), `${name}.png`), fullPage, animations: 'disabled', caret: 'initial' });
  return `screenshots/${name}.png`;
}

const AXE = path.join(FRONTEND_DIR, 'node_modules', 'axe-core', 'axe.min.js');
/** axe-core WCAG 2.0/2.1/2.2 A and AA on the current state, with the failing selectors (synthetic pages only). */
export async function axe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], resultTypes: ['violations', 'incomplete'] });
    const view = (v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 8).map((n) => n.target.join(' ')) });
    return { version: window.axe.version, violations: result.violations.map(view), incomplete: result.incomplete.map(view), passes: result.passes?.length ?? null };
  });
}

// ------------------------------------------------------ synthetic Jobs --
/** Provisions the synthetic C5 Jobs through the backend's own CLI (fixtures/c5-jobs). */
export async function provisionJobs() {
  const env = c5BackendEnvironment({ storageRoot: run().dirs.storage });
  const steps = [];
  for (const [name, confirm] of C5_JOB_STEPS) {
    const result = await runNode(
      ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'c5-jobs', name), ...(confirm ? ['--confirm-lifecycle'] : [])],
      { cwd: BACKEND_DIR, env, logFile: path.join(run().dirs.logs, 'cli.log'), label: `jobs:provision:apply ${name}` },
    );
    steps.push({ file: name, exitCode: result.code });
    if (result.code !== 0) throw new Error(`C5 provisioning failed: ${name} (exit ${result.code}); see logs/cli.log`);
  }
  return steps;
}
export async function publishedJobs() {
  const response = await fetch(`${C5_BACKEND_ORIGIN}/api/v1/jobs`, { headers: { Origin: C5_SITE_ORIGIN } });
  const body = await response.json();
  return { status: response.status, jobs: body?.data?.items ?? [] };
}
/** For a file run on its own: provisions the Jobs only when none is published yet. */
export async function ensureJobs() {
  const { jobs } = await publishedJobs();
  if (Array.isArray(jobs) && jobs.length) return { provisioned: false };
  return { provisioned: true, steps: await provisionJobs() };
}

// --------------------------------------------------------------- probes --
/**
 * Waits until the page has settled: fonts loaded, lazy images below the fold
 * loaded (the page is stepped through as a reader scrolls it), back at the top,
 * two frames. Scrolling is instant: html has scroll-behavior:smooth, and a
 * smooth scroll still running when a full-page screenshot starts leaves the
 * sticky header drawn over the content (a capture artefact, not the site).
 */
export async function settle(page) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await frame();
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 5000); })));
    await frame();
    await frame();
  });
}

/**
 * Layout probe at the current viewport (Doc 03 section 84; A11Y reflow):
 * document-level horizontal overflow, elements whose box leaves the viewport
 * horizontally (unless an ancestor clips or scrolls them on purpose), and
 * text clipped inside its own box.
 */
export function layoutProbe(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const visible = (el, rect) => {
      if (rect.width === 0 && rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    };
    const clippedByAncestor = (el) => {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const visuallyHidden = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.position === 'absolute' && (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') ) return true;
        if (node.classList?.contains('visually-hidden')) return true;
      }
      return false;
    };
    const outside = [];
    const clipped = [];
    for (const el of document.body.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (!visible(el, rect) || visuallyHidden(el)) continue;
      if ((rect.right > vw + 0.5 || rect.left < -0.5) && !clippedByAncestor(el)) {
        outside.push({ el: describe(el), left: Math.round(rect.left), right: Math.round(rect.right), text: (el.textContent || '').trim().slice(0, 60) });
      }
      const style = getComputedStyle(el);
      if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && (el.textContent || '').trim()) {
        clipped.push({ el: describe(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, textOverflow: style.textOverflow, text: (el.textContent || '').trim().slice(0, 60) });
      }
    }
    return {
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalScroll: document.documentElement.scrollWidth > vw,
      outside: outside.slice(0, 20),
      outsideCount: outside.length,
      clipped: clipped.slice(0, 20),
      clippedCount: clipped.length,
    };
  });
}

/**
 * Interactive elements: their size against WCAG 2.2 SC 2.5.8 (Doc 16 A11Y-041:
 * 24x24 CSS px, or the applicable spacing/exception rule), the Valida 44x44
 * preference (A11Y-042, a design-quality target "where layout permits"), and
 * whether something else covers their centre once scrolled into the middle of
 * the viewport (obscured controls).
 *
 * For an undersized target the probe applies the SC's own exceptions:
 *   spacing   a 24 px circle centred on its box intersects no other target
 *             and no other undersized target's circle;
 *   inline    a link inside a run of text (display:inline in a text block);
 *   uaControl a native radio or checkbox whose size the author did not change.
 * `fails2_5_8` is true only when none applies.
 */
export function controlsProbe(page) {
  return page.evaluate(async () => {
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), summary';
    const items = [];
    for (const el of document.querySelectorAll(sel)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      let target = el;
      let rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // A native file input may be visually replaced by its label: measure what the user hits.
      if (el.type === 'file' && (rect.width < 2 || Number(style.opacity) === 0)) {
        const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (label) { target = label; rect = label.getBoundingClientRect(); }
      }
      const box = { left: rect.left + scrollX, top: rect.top + scrollY, right: rect.right + scrollX, bottom: rect.bottom + scrollY, width: rect.width, height: rect.height };
      items.push({ el, target, style, box });
    }
    const undersized = (i) => i.box.width < 24 || i.box.height < 24;
    const centre = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
    const distToBox = (p, b) => Math.hypot(Math.max(b.left - p.x, 0, p.x - b.right), Math.max(b.top - p.y, 0, p.y - b.bottom));
    const out = [];
    for (const item of items) {
      const { el, target, style, box } = item;
      const small = undersized(item);
      let spacing = null;
      if (small) {
        const c = centre(box);
        spacing = items.every((other) => other === item || other.target.contains(target) || target.contains(other.target) ||
          (distToBox(c, other.box) >= 12 && (!undersized(other) || Math.hypot(c.x - centre(other.box).x, c.y - centre(other.box).y) >= 24)));
      }
      const inline = el.tagName === 'A' && style.display === 'inline' && /^(P|LI|SPAN|DD|TD|LABEL|LEGEND)$/.test(el.parentElement?.tagName ?? '');
      const uaControl = (el.type === 'radio' || el.type === 'checkbox') && style.appearance !== 'none' && style.width === '13px' && style.height === '13px';
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const r = target.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const covered = Boolean(hit) && hit !== target && !target.contains(hit) && !hit.contains(target) && !(el.labels && [...el.labels].some((l) => l.contains(hit)));
      const label = el.labels?.[0];
      out.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: (el.getAttribute('aria-label') || label?.textContent || el.textContent || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        labelBox: label ? `${Math.round(label.getBoundingClientRect().width)}x${Math.round(label.getBoundingClientRect().height)}` : null,
        below24: small,
        exception: small ? (spacing ? 'spacing' : inline ? 'inline' : uaControl ? 'uaControl' : null) : null,
        fails2_5_8: small && !spacing && !inline && !uaControl,
        below44: box.width < 44 || box.height < 44,
        covered,
        coveredBy: covered ? `${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? `.${hit.className.split(' ')[0]}` : ''}` : null,
      });
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return out;
  });
}

/**
 * Waits until the page is still after a keyboard step: the focus scroll (smooth,
 * html { scroll-behavior: smooth }) has finished — scroll position unchanged
 * for 5 frames — and at least 300 ms have passed, longer than the 180 ms
 * standard transition (the skip link slides in). A probe taken earlier reads
 * an element still on its way into view.
 */
export function waitForStill(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const started = performance.now();
    let last = `${scrollX},${scrollY}`;
    let still = 0;
    const tick = () => {
      const now = `${scrollX},${scrollY}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if ((still >= 5 && performance.now() - started >= 300) || performance.now() - started > 3000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

/** The focused element: what it is, where it is, and whether a focus indicator is drawn. */
export function focusProbe(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'body' };
    // The resume control: the real file input is visually hidden and its adjacent label draws the ring (ResumeField).
    const proxy = el.type === 'file' && el.nextElementSibling?.tagName === 'LABEL' ? el.nextElementSibling : null;
    const shown = proxy ?? el;
    const style = getComputedStyle(shown);
    const rect = shown.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerRect = header ? header.getBoundingClientRect() : null;
    const headerSticky = header ? ['sticky', 'fixed'].includes(getComputedStyle(header).position) : false;
    const insideHeader = header?.contains(shown) ?? false;
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    // Entirely inside the sticky header's band AND drawn underneath it (the skip link is drawn above it).
    const hiddenUnderHeader = Boolean(headerSticky && !insideHeader && headerRect && rect.bottom <= headerRect.bottom + 1 && rect.top < headerRect.bottom && hit && header.contains(hit));
    const label = el.labels?.[0];
    return {
      focusShownOn: proxy ? 'label (proxy)' : 'element',
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      type: el.getAttribute('type'),
      role: el.getAttribute('role'),
      name: (el.getAttribute('aria-label') || label?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow === 'none' ? null : style.boxShadow,
      indicator: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none',
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      inViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      hiddenUnderHeader,
      obscured: Boolean(hit) && hit !== shown && !shown.contains(hit) && !hit.contains(shown) && !(label && label.contains(hit)),
    };
  });
}

/** Animations and transitions that would actually run (duration > 0.01 s), page-wide. */
export function motionProbe(page) {
  return page.evaluate(() => {
    const seconds = (value) => Math.max(...value.split(',').map((part) => {
      const v = part.trim();
      return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v) || 0;
    }));
    const moving = [];
    for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pseudo);
        const animation = s.animationName !== 'none' && seconds(s.animationDuration) > 0.01 ? `${s.animationName} ${s.animationDuration} x${s.animationIterationCount}` : null;
        const transition = s.transitionProperty !== 'none' && seconds(s.transitionDuration) > 0.01 ? `${s.transitionProperty} ${s.transitionDuration}` : null;
        if (animation || transition) moving.push({ el: `${el.tagName.toLowerCase()}${pseudo ?? ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}`, animation, transition });
      }
    }
    // What is running, so a non-zero count can be read: the element, the animation or transitioned property, its state and timing.
    const runningDetail = document.getAnimations().map((a) => {
      const target = a.effect?.target;
      const timing = a.effect?.getComputedTiming?.() ?? {};
      const within = target?.closest?.('header, footer, main, nav');
      return { el: target ? `${target.tagName.toLowerCase()}${typeof target.className === 'string' && target.className ? `.${target.className.split(' ')[0]}` : ''}` : null, within: within ? within.tagName.toLowerCase() : null, text: target ? (target.textContent || '').trim().slice(0, 40) : null, pseudo: a.effect?.pseudoElement ?? null, kind: a.constructor.name, name: a.animationName ?? a.transitionProperty ?? null, playState: a.playState, pending: a.pending, duration: timing.duration ?? null, delay: timing.delay ?? null, iterations: timing.iterations ?? null, fill: timing.fill ?? null, currentTime: a.currentTime };
    });
    return { scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior, running: runningDetail.length, runningDetail, moving };
  });
}

/** Document structure: language, title, landmarks, headings in order. */
// ----------------------------------------------------- motion observation --
/**
 * C5-14. Installed before any page script (context.addInitScript): on every
 * animation frame it lists document.getAnimations() and keeps, per effect, the
 * first and the last description and the frames it was seen in. It never
 * cancels, finishes or alters an effect, and it waits for nothing.
 *
 * Each effect is identified by a stable path to its target (tag and position
 * from the nearest landmark or id), its kind and its animation name or
 * transitioned property - not by an index into a list.
 *
 * Note: getAnimations() brings the document's style up to date, so the
 * recorder makes a pending style change take effect in the frame it is seen
 * rather than a later one. It can move WHEN a transition starts by a frame; it
 * cannot create, remove or shorten one.
 */
export const MOTION_RECORDER = () => {
  const MAX_EFFECTS = 400;
  const rec = { frame: 0, effects: new Map(), lastCount: 0, quietFrames: 0, truncated: false, marks: [] };
  const where = (el, pseudo) => {
    if (!el || !el.tagName) return 'unknown target';
    const parts = [];
    let node = el;
    while (node && node.tagName && parts.length < 12) {
      const tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`${tag}#${node.id}`); break; }
      const landmark = ['header', 'footer', 'main', 'nav', 'body'].includes(tag);
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      if (landmark && tag !== 'nav') break;
      node = node.parentElement;
    }
    return `${parts.join(' > ')}${pseudo ?? ''}`;
  };
  const describe = (a) => {
    const target = a.effect?.target ?? null;
    const pseudo = a.effect?.pseudoElement ?? null;
    let timing = {};
    try { timing = a.effect?.getComputedTiming?.() ?? {}; } catch { timing = {}; }
    const num = (v) => (typeof v === 'number' ? v : null);
    let cs = null;
    try { cs = target ? getComputedStyle(target, pseudo) : null; } catch { cs = null; }
    const kind = a.constructor?.name ?? null;
    const name = a.animationName ?? a.transitionProperty ?? null;
    const place = where(target, pseudo);
    return {
      key: `${place}|${kind}|${name}`,
      where: place,
      landmark: target?.closest?.('header, footer, main, nav')?.tagName.toLowerCase() ?? null,
      depth: (() => { let n = 0; for (let node = target; node && node.parentElement; node = node.parentElement) n += 1; return target ? n : null; })(),
      text: target ? (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : null,
      kind,
      name,
      playState: a.playState,
      pending: a.pending,
      currentTime: num(a.currentTime),
      startTime: num(a.startTime),
      duration: num(timing.duration),
      delay: num(timing.delay),
      endDelay: num(timing.endDelay),
      iterations: num(timing.iterations),
      activeDuration: num(timing.activeDuration),
      endTime: num(timing.endTime),
      fill: timing.fill ?? null,
      progress: num(timing.progress),
      computed: cs ? { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, transitionDelay: cs.transitionDelay, animationName: cs.animationName, animationDuration: cs.animationDuration, animationDelay: cs.animationDelay, animationIterationCount: cs.animationIterationCount, visibility: cs.visibility, opacity: cs.opacity, transform: cs.transform, display: cs.display } : null,
    };
  };
  rec.describe = describe;
  rec.snapshot = () => { try { return document.getAnimations().map(describe); } catch { return null; } };
  const tick = () => {
    rec.frame += 1;
    const now = rec.snapshot() ?? [];
    const seen = new Set();
    for (const d of now) {
      seen.add(d.key);
      const known = rec.effects.get(d.key);
      if (known) {
        known.framesSeen += 1;
        if (known.lastFrame !== rec.frame - 1) { known.runs += 1; if (known.runFrames.length < 12) known.runFrames.push(rec.frame); }
        known.lastFrame = rec.frame;
        known.last = d;
      } else if (rec.effects.size < MAX_EFFECTS) {
        rec.effects.set(d.key, { ...d, firstFrame: rec.frame, lastFrame: rec.frame, framesSeen: 1, runs: 1, runFrames: [rec.frame], firstAt: Math.round(performance.now() * 10) / 10, last: d });
      } else {
        rec.truncated = true;
      }
    }
    rec.lastCount = now.length;
    rec.quietFrames = now.length === 0 ? rec.quietFrames + 1 : 0;
    requestAnimationFrame(tick);
  };
  window.__c5motion = rec;
  requestAnimationFrame(tick);
};

/**
 * Observes the page's motion from its current state (C5-14; judged by
 * motionJudge.js):
 *   initial   what document.getAnimations() lists at this instant - the moment
 *             the old criterion read, kept so the two can be compared;
 *   effects   every effect the frame recorder has seen since `sinceFrame`
 *             (default: since the document started), each with its first and
 *             last description and the frames it was seen in;
 *   then it WATCHES, frame by frame, until `quietFrames` consecutive frames
 *   list no effect, or `maxFrames` frames have passed - a bound on the
 *   observation, counted in frames, not a sleep: nothing is retried and no
 *   effect is cancelled or finished;
 *   final     what is listed when the watching ends;
 *   rule      the durations the page's own reduced-motion rule declares;
 *   declaredBeyondRule  every element (and ::before / ::after) whose computed
 *             style declares an animation, or a transition, longer than the
 *             rule's, delayed, or repeated;
 *   unavailable  what a visitor would be missing afterwards.
 * The watch always covers at least `quietFrames` frames.
 */
export function motionObserve(page, { maxFrames = 90, quietFrames = 3, sinceFrame = 0 } = {}) {
  return page.evaluate(async ({ maxFrames, quietFrames, sinceFrame }) => {
    const rec = window.__c5motion;
    if (!rec) return null;
    const ms = (value) => value.split(',').map((part) => { const v = part.trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; });
    // The reduced-motion rule, read from the page's own stylesheets.
    let rule = null;
    const walk = (rules, inReduce) => {
      for (const r of rules) {
        if (r.cssRules && r.conditionText !== undefined) walk(r.cssRules, inReduce || /prefers-reduced-motion:\s*reduce/.test(r.conditionText));
        else if (inReduce && r.style && /(^|,)\s*\*\s*(,|$)/.test(r.selectorText ?? '') && r.style.transitionDuration) {
          rule = { selector: r.selectorText, transitionMs: ms(r.style.transitionDuration)[0], animationMs: r.style.animationDuration ? ms(r.style.animationDuration)[0] : null, iterationCount: r.style.animationIterationCount || null, declared: { transitionDuration: r.style.transitionDuration, animationDuration: r.style.animationDuration, animationIterationCount: r.style.animationIterationCount, scrollBehavior: r.style.scrollBehavior } };
        }
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, false); } catch { /* a sheet that cannot be read declares nothing we can rely on */ } }
    const applies = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const limit = { transition: applies && rule ? rule.transitionMs : 0, animation: applies && rule && rule.animationMs !== null ? rule.animationMs : 0 };

    const startFrame = rec.frame;
    const initial = rec.snapshot();
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // The closing quiet frames are counted within THIS watch: frames before it started do not count.
    let framesObserved = 0;
    let quietRun = 0;
    while (framesObserved < maxFrames && quietRun < quietFrames) { await frame(); framesObserved += 1; quietRun = rec.lastCount === 0 ? quietRun + 1 : 0; }
    const final = rec.snapshot();
    const quiet = quietRun >= quietFrames && Array.isArray(final) && final.length === 0;

    const place = (el, pseudo) => rec.describe({ effect: { target: el, pseudoElement: pseudo, getComputedTiming: () => ({}) }, constructor: {} }).where;
    const declaredBeyondRule = [];
    for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pseudo);
        if (s.animationName !== 'none') {
          const durations = ms(s.animationDuration); const delays = ms(s.animationDelay); const counts = s.animationIterationCount.split(',').map((c) => c.trim());
          if (durations.some((d) => d > limit.animation + 1e-9) || delays.some((d) => d !== 0) || counts.some((c) => c !== '1')) declaredBeyondRule.push({ where: place(el, pseudo), what: `animation ${s.animationName} ${s.animationDuration} delay ${s.animationDelay} x${s.animationIterationCount}` });
        }
        if (s.transitionProperty !== 'none') {
          const durations = ms(s.transitionDuration); const delays = ms(s.transitionDelay);
          const moves = durations.some((d) => d > 0) || delays.some((d) => d > 0);
          if (moves && (durations.some((d) => d > limit.transition + 1e-9) || delays.some((d) => d !== 0))) declaredBeyondRule.push({ where: place(el, pseudo), what: `transition ${s.transitionProperty} ${s.transitionDuration} delay ${s.transitionDelay}` });
        }
      }
    }

    // What a visitor needs afterwards: the heading, and - unless the route's content is still pending - the footer and its links.
    const shown = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility === 'visible' && s.display !== 'none' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0; };
    const unavailable = [];
    const pending = Boolean(document.querySelector('[data-content-pending]'));
    // While the route's content is pending there is no heading yet: the loading indication stands in for it.
    if (!pending && !shown(document.querySelector('h1'))) unavailable.push('the page heading (h1) is not visible');
    if (pending && !shown(document.querySelector('[data-content-pending]'))) unavailable.push('the loading indication is not visible while the content is pending');
    const footer = document.querySelector('footer');
    const footerLinks = footer ? [...footer.querySelectorAll('a[href]')] : [];
    if (!pending) {
      if (!shown(footer)) unavailable.push('the footer is not visible');
      if (footerLinks.length === 0 || !footerLinks.every(shown)) unavailable.push(`footer links visible: ${footerLinks.filter(shown).length} of ${footerLinks.length}`);
    }
    const effects = [...rec.effects.values()].filter((e) => e.lastFrame >= sinceFrame);
    for (const e of effects) {
      // The end state of a permitted transient: its target must not be left hidden.
      const selector = e.where.replace(/::(before|after)$/, '');
      let target = null;
      try { target = document.querySelector(selector); } catch { target = null; }
      e.targetShownAfter = target ? shown(target) : null;
      if (!pending && target && e.name === 'visibility' && !shown(target)) unavailable.push(`${e.where} is not visible after its visibility transition`);
    }
    return {
      reducedMotionApplies: applies, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior, rule, pending,
      startFrame, endFrame: rec.frame, framesObserved, quiet, quietFramesAtEnd: quietRun, truncated: rec.truncated,
      initial, effects, final, declaredBeyondRule, unavailable,
      availability: { h1: shown(document.querySelector('h1')), footer: shown(footer), footerLinks: footerLinks.length, footerLinksShown: footerLinks.filter(shown).length },
    };
  }, { maxFrames, quietFrames, sinceFrame });
}

export function structureProbe(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    landmarks: [...document.querySelectorAll('header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="search"], form[aria-label], section[aria-label], section[aria-labelledby]')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`),
    headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => ({ level: Number(el.tagName[1]), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) })),
  }));
}

/** Heading levels never skip downwards (h2 -> h4), and there is exactly one h1. */
export function headingProblems(headings) {
  const problems = [];
  if (headings.filter((h) => h.level === 1).length !== 1) problems.push(`h1 count ${headings.filter((h) => h.level === 1).length}`);
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i].level > headings[i - 1].level + 1) problems.push(`h${headings[i - 1].level} -> h${headings[i].level} at "${headings[i].text}"`);
  }
  return problems;
}
