/**
 * C5-14 — how an observation of a page under `prefers-reduced-motion: reduce`
 * is judged (Doc 16 sections 58-59: "remove decorative continuous motion ...
 * minimize large transitions; preserve all functionality/content"; Doc 17
 * section 255; Doc 18 section 170).
 *
 * The requirement is about motion a person would perceive and about content
 * staying available. It is not "document.getAnimations() is empty at one
 * instant": the site's own reduced-motion rule (frontend/src/styles/base.css)
 * does not remove transitions, it gives every one of them the duration
 * 0.01 ms with one iteration, so a style change still creates a transition
 * object that ends at once. A probe that lands in the frame where one was
 * created sees it.
 *
 * So ONE kind of effect is permitted, and only when every part holds:
 *
 *   - it is a CSS transition or CSS animation (not a script animation or
 *     anything unrecognised);
 *   - its duration is EXACTLY the duration the page's reduced-motion rule
 *     declares, read from that rule in the page's own stylesheet - no
 *     threshold of this file's choosing is involved;
 *   - no delay, no end delay, exactly one iteration, so its whole active
 *     duration is that same value;
 *   - it is not left filling (fill "forwards"/"both" keeps an effect applied);
 *   - it is GONE by the end of a bounded, frame-by-frame observation, and the
 *     page is then quiet (no effect at all for the closing frames).
 *
 * Everything else fails: a longer effect, any delay, more than one iteration
 * (a short effect repeated is motion for its total duration), an effect still
 * present when the observation ends, an effect whose timing cannot be read, a
 * declared animation or transition beyond the rule, scrolling that is not
 * instant, content that is not available afterwards. A truncated or missing
 * observation fails too, and so does one in which any frame's effects could
 * not be read: such a frame is not a quiet frame. Unknown is never a pass.
 *
 * Pure functions: no browser, no clock. The observation is made by
 * c5Support.js (motionObserve).
 */

const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

/** Why one observed effect is not the permitted instantaneous completion; [] when it is. */
export function effectProblems(effect, rule) {
  const problems = [];
  const expected = effect.kind === 'CSSTransition' ? rule?.transitionMs : effect.kind === 'CSSAnimation' ? rule?.animationMs : null;
  if (effect.kind !== 'CSSTransition' && effect.kind !== 'CSSAnimation') problems.push(`it is a ${effect.kind ?? 'unknown kind of effect'}, not a CSS transition or animation`);
  if (typeof expected !== 'number') problems.push('the page declares no reduced-motion duration for this kind of effect');
  if (typeof effect.duration !== 'number') problems.push('its duration cannot be read');
  else if (typeof expected === 'number' && !same(effect.duration, expected)) problems.push(`its duration is ${effect.duration} ms, not the reduced-motion rule's ${expected} ms`);
  if (effect.delay !== 0) problems.push(`it has a delay of ${effect.delay} ms`);
  if (effect.endDelay !== 0) problems.push(`it has an end delay of ${effect.endDelay} ms`);
  if (effect.iterations !== 1) problems.push(`it runs ${effect.iterations} iterations, not one`);
  if (typeof effect.activeDuration !== 'number' || typeof effect.duration !== 'number' || !same(effect.activeDuration, effect.duration)) problems.push(`its active duration is ${effect.activeDuration} ms`);
  if (effect.fill === 'forwards' || effect.fill === 'both') problems.push(`it keeps filling (${effect.fill}) after it ends`);
  return problems;
}

/**
 * Judges one observation (motionObserve). Returns { pass, failures[], permitted[], offenders[] }:
 * `permitted` lists the effects accepted as the rule's instantaneous completion;
 * `offenders` lists, per target, each observed timing that was not, with its frames.
 *
 * An effect is identified by target, kind and name, and may be seen with more
 * than one timing over its life. EVERY distinct timing recorded for it is held
 * to the criterion above. Starting again with the same permitted timing is not
 * a failure of its own (reviewed: the footer's brand paragraph does).
 */
export function judgeReducedMotion(observation) {
  const failures = [];
  const permitted = [];
  const offenders = [];
  const o = observation ?? {};
  if (!observation) return { pass: false, failures: ['there is no observation'], permitted, offenders };
  if (o.scrollBehavior !== 'auto') failures.push(`scrolling is "${o.scrollBehavior}", not instant`);
  if (!o.rule) failures.push('no reduced-motion rule was found in the page\'s stylesheets');
  if (o.truncated) failures.push('the observation was truncated: more effects than were recorded');
  if (!Array.isArray(o.effects) || !Array.isArray(o.final) || !Array.isArray(o.declaredBeyondRule)) failures.push('the observation is incomplete');
  for (const d of o.declaredBeyondRule ?? []) failures.push(`declared motion beyond the rule on ${d.where}: ${d.what}`);
  // A frame that could not be read is not a quiet frame and not a pass: the observation is incomplete.
  const u = o.unreadable;
  if (!u || typeof u.count !== 'number' || !Array.isArray(u.frames)) failures.push('the observation does not say whether every frame could be read');
  else {
    if (u.count > 0) failures.push(`incomplete observation: the effects of ${u.count} frame(s) could not be read (frames ${u.frames.join(', ')})`);
    if (u.initialSnapshotReadable !== true) failures.push('incomplete observation: the initial snapshot could not be read');
    if (u.finalSnapshotReadable !== true) failures.push('incomplete observation: the final snapshot could not be read');
  }
  const stillThere = new Set((o.final ?? []).map((e) => e.key));
  const frames = (t) => (t.firstFrame === t.lastFrame ? `frame ${t.firstFrame}` : `frames ${t.firstFrame}-${t.lastFrame}`);
  for (const effect of o.effects ?? []) {
    const problems = [];
    // EVERY distinct timing seen on this target/kind/name is judged - the first, any in between and the last - so a
    // valid observation before or after an invalid one cannot stand in for it.
    const timings = effect.timings;
    const offending = [];
    if (!Array.isArray(timings) || timings.length === 0) problems.push('no timing was recorded for it');
    else {
      for (const t of timings) {
        const why = effectProblems({ ...t, kind: t.kind ?? effect.kind }, o.rule);
        if (why.length) { problems.push(`in ${frames(t)}: ${why.join('; ')}`); offending.push({ firstFrame: t.firstFrame, lastFrame: t.lastFrame, frames: t.frames, kind: t.kind ?? effect.kind, duration: t.duration, delay: t.delay, endDelay: t.endDelay, iterations: t.iterations, activeDuration: t.activeDuration, fill: t.fill, problems: why }); }
      }
    }
    if (stillThere.has(effect.key)) problems.push(`it is still present when the observation ends (${effect.playState ?? 'state unknown'})`);
    if (problems.length) {
      failures.push(`${effect.kind ?? 'effect'} "${effect.name}" on ${effect.where}: ${problems.join('; ')}`);
      if (offending.length) offenders.push({ where: effect.where, key: effect.key, kind: effect.kind, name: effect.name, timingsSeen: timings.length, offending });
    } else permitted.push({ where: effect.where, kind: effect.kind, name: effect.name, duration: effect.duration, timingsSeen: timings.length, framesSeen: effect.framesSeen, firstFrame: effect.firstFrame, lastFrame: effect.lastFrame });
  }
  // An effect present at the end that the frame recorder never listed is still a failure.
  const recorded = new Set((o.effects ?? []).map((e) => e.key));
  for (const e of o.final ?? []) if (!recorded.has(e.key)) failures.push(`${e.kind ?? 'effect'} "${e.name}" on ${e.where}: present when the observation ends and never recorded`);
  if (o.quiet !== true) failures.push(`the page was not quiet after ${o.framesObserved} observed frames`);
  for (const a of o.unavailable ?? []) failures.push(`not available after the observation: ${a}`);
  return { pass: failures.length === 0, failures, permitted, offenders };
}
