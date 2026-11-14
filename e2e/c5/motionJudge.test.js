import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectProblems, judgeReducedMotion } from './motionJudge.js';

/** The site's rule as motionObserve reads it, and an observation with nothing in it. */
const RULE = { transitionMs: 0.01, animationMs: 0.01, iterationCount: '1' };
const timing = (over = {}) => ({ kind: 'CSSTransition', duration: 0.01, delay: 0, endDelay: 0, iterations: 1, activeDuration: 0.01, fill: 'backwards', firstFrame: 12, lastFrame: 12, frames: 1, ...over });
/** An effect seen with one timing: the timing fields given in `over` are also its single recorded timing. */
const effect = (over = {}) => { const e = base(over); return { ...e, timings: over.timings ?? [timing({ kind: e.kind, duration: e.duration, delay: e.delay, endDelay: e.endDelay, iterations: e.iterations, activeDuration: e.activeDuration, fill: e.fill })] }; };
const base = (over = {}) => ({ key: 'footer li:nth-of-type(1)|CSSTransition|visibility', where: 'footer > … > li:nth-of-type(1)', kind: 'CSSTransition', name: 'visibility', duration: 0.01, delay: 0, endDelay: 0, iterations: 1, activeDuration: 0.01, fill: 'backwards', playState: 'running', framesSeen: 1, firstFrame: 12, lastFrame: 12, ...over });
const READABLE = { frames: [], count: 0, recorderTotal: 0, initialSnapshotReadable: true, finalSnapshotReadable: true };
const observation = (over = {}) => ({ scrollBehavior: 'auto', rule: RULE, truncated: false, effects: [], final: [], unreadable: READABLE, declaredBeyondRule: [], quiet: true, framesObserved: 6, unavailable: [], ...over });

describe('judgeReducedMotion', () => {
  it('a quiet page passes', () => {
    assert.deepEqual(judgeReducedMotion(observation()), { pass: true, failures: [], permitted: [], offenders: [] });
  });

  it('the saved r3 failure - four 0.01 ms visibility transitions that finish - is the rule\'s instantaneous completion', () => {
    const effects = [1, 2, 3, 4].map((n) => effect({ key: `li${n}|CSSTransition|visibility` }));
    const verdict = judgeReducedMotion(observation({ effects }));
    assert.equal(verdict.pass, true);
    assert.equal(verdict.permitted.length, 4);
  });

  it('the same four, still present when the observation ends, fail', () => {
    const effects = [1, 2, 3, 4].map((n) => effect({ key: `li${n}|CSSTransition|visibility` }));
    const verdict = judgeReducedMotion(observation({ effects, final: effects, quiet: false }));
    assert.equal(verdict.pass, false);
    assert.equal(verdict.failures.filter((f) => f.includes('still present')).length, 4);
    assert.ok(verdict.failures.some((f) => f.includes('not quiet')));
  });

  it('there is no duration threshold: 5 ms, 10 ms and 0.02 ms all fail; only the rule\'s own value passes', () => {
    for (const duration of [0.02, 1, 5, 10, 180, 3000]) {
      const verdict = judgeReducedMotion(observation({ effects: [effect({ duration, activeDuration: duration })] }));
      assert.equal(verdict.pass, false, String(duration));
      assert.match(verdict.failures[0], /not the reduced-motion rule's 0\.01 ms/);
    }
    // A page whose rule declared another value is judged by that value.
    const other = { transitionMs: 0.001, animationMs: 0.001, iterationCount: '1' };
    assert.equal(judgeReducedMotion(observation({ rule: other, effects: [effect()] })).pass, false);
    assert.equal(judgeReducedMotion(observation({ rule: other, effects: [effect({ duration: 0.001, activeDuration: 0.001 })] })).pass, true);
  });

  it('a short effect repeated - indefinitely, or for a meaningful total - fails', () => {
    assert.match(judgeReducedMotion(observation({ effects: [effect({ kind: 'CSSAnimation', name: 'blink', iterations: Infinity, activeDuration: Infinity })] })).failures[0], /Infinity iterations/);
    const total = judgeReducedMotion(observation({ effects: [effect({ kind: 'CSSAnimation', name: 'blink', iterations: 200000, activeDuration: 2000 })] }));
    assert.equal(total.pass, false);
    assert.match(total.failures[0], /200000 iterations.*active duration is 2000 ms/);
  });

  it('a delayed effect, an end delay and a filling effect fail', () => {
    assert.match(judgeReducedMotion(observation({ effects: [effect({ delay: 2000 })] })).failures[0], /delay of 2000 ms/);
    assert.match(judgeReducedMotion(observation({ effects: [effect({ endDelay: 500 })] })).failures[0], /end delay of 500 ms/);
    assert.match(judgeReducedMotion(observation({ effects: [effect({ kind: 'CSSAnimation', name: 'stay', fill: 'forwards' })] })).failures[0], /keeps filling \(forwards\)/);
  });

  it('a script animation, an unknown kind and unreadable timing fail', () => {
    assert.match(judgeReducedMotion(observation({ effects: [effect({ kind: 'Animation', name: null, duration: 2000, activeDuration: Infinity, iterations: Infinity })] })).failures[0], /is a Animation, not a CSS transition or animation/);
    assert.equal(judgeReducedMotion(observation({ effects: [effect({ kind: null })] })).pass, false);
    assert.match(judgeReducedMotion(observation({ effects: [effect({ duration: null, activeDuration: null })] })).failures[0], /duration cannot be read/);
    assert.deepEqual(effectProblems(effect(), RULE), []);
  });

  it('declared motion beyond the rule fails for transitions as well as animations (the old assertion read animations only)', () => {
    const transition = judgeReducedMotion(observation({ declaredBeyondRule: [{ where: 'a.button', what: 'transition transform 180 ms' }] }));
    const animation = judgeReducedMotion(observation({ declaredBeyondRule: [{ where: 'g.drift', what: 'animation drift 46000 ms x infinite' }] }));
    assert.equal(transition.pass, false);
    assert.equal(animation.pass, false);
  });

  it('smooth scrolling, a missing rule, unavailable content and an unrecorded final effect fail', () => {
    assert.match(judgeReducedMotion(observation({ scrollBehavior: 'smooth' })).failures[0], /not instant/);
    assert.match(judgeReducedMotion(observation({ rule: null })).failures[0], /no reduced-motion rule/);
    assert.match(judgeReducedMotion(observation({ unavailable: ['the footer is not visible'] })).failures[0], /not available/);
    assert.match(judgeReducedMotion(observation({ final: [effect({ key: 'x' })], quiet: false })).failures[0], /never recorded/);
  });

  it('unknown is never a pass: no observation, a truncated one, an incomplete one', () => {
    assert.equal(judgeReducedMotion(null).pass, false);
    assert.equal(judgeReducedMotion(observation({ truncated: true })).pass, false);
    assert.equal(judgeReducedMotion(observation({ effects: undefined })).pass, false);
    assert.equal(judgeReducedMotion(observation({ quiet: undefined })).pass, false);
  });

  it('every distinct timing on one key is judged: valid, then invalid, then valid again fails and names the invalid one', () => {
    const changed = effect({ key: 'div#x|CSSTransition|opacity', where: 'div#x', name: 'opacity', timings: [
      timing({ firstFrame: 20, lastFrame: 20 }),
      timing({ duration: 300, activeDuration: 300, firstFrame: 22, lastFrame: 25, frames: 4 }),
      timing({ firstFrame: 27, lastFrame: 27 }),
    ] });
    // The effect's own (first) description is the valid one, and it is gone at the end: judging the first timing alone would pass.
    assert.deepEqual(effectProblems(changed, RULE), []);
    const verdict = judgeReducedMotion(observation({ effects: [changed] }));
    assert.equal(verdict.pass, false);
    assert.equal(verdict.failures.length, 1);
    assert.match(verdict.failures[0], /on div#x: in frames 22-25: its duration is 300 ms, not the reduced-motion rule's 0\.01 ms/);
    assert.deepEqual(verdict.offenders, [{ where: 'div#x', key: 'div#x|CSSTransition|opacity', kind: 'CSSTransition', name: 'opacity', timingsSeen: 3, offending: [{ firstFrame: 22, lastFrame: 25, frames: 4, kind: 'CSSTransition', duration: 300, delay: 0, endDelay: 0, iterations: 1, activeDuration: 300, fill: 'backwards', problems: ["its duration is 300 ms, not the reduced-motion rule's 0.01 ms"] }] }]);
    assert.equal(verdict.permitted.length, 0);
  });

  it('an invalid timing anywhere fails: first, in between or last; delay and iterations as well as duration', () => {
    const ok = timing({ firstFrame: 5, lastFrame: 5 });
    for (const [label, timings] of [
      ['first', [timing({ delay: 2000, firstFrame: 3, lastFrame: 4 }), ok]],
      ['last', [ok, timing({ kind: 'CSSTransition', iterations: 3, activeDuration: 0.03, firstFrame: 9, lastFrame: 9 })]],
      ['between', [ok, timing({ fill: 'forwards', firstFrame: 7, lastFrame: 7 }), timing({ firstFrame: 9, lastFrame: 9 })]],
    ]) {
      const verdict = judgeReducedMotion(observation({ effects: [effect({ timings })] }));
      assert.equal(verdict.pass, false, label);
      assert.equal(verdict.offenders[0].offending.length, 1, label);
    }
  });

  it('starting again with the same permitted timing is not a failure (the reviewed footer brand paragraph)', () => {
    const twice = effect({ runs: 2, runFrames: [4, 7], timings: [timing({ firstFrame: 4, lastFrame: 4 }), timing({ firstFrame: 7, lastFrame: 7 })] });
    const verdict = judgeReducedMotion(observation({ effects: [twice] }));
    assert.equal(verdict.pass, true);
    assert.equal(verdict.permitted[0].timingsSeen, 2);
  });

  it('an effect with no recorded timing is incomplete, not permitted', () => {
    assert.match(judgeReducedMotion(observation({ effects: [effect({ timings: [] })] })).failures[0], /no timing was recorded/);
    const { timings: _dropped, ...withoutTimings } = effect();
    assert.equal(judgeReducedMotion(observation({ effects: [withoutTimings] })).pass, false);
  });

  it('an unreadable frame makes the observation incomplete: never quiet, never a pass', () => {
    const between = judgeReducedMotion(observation({ unreadable: { ...READABLE, frames: [31], count: 1, recorderTotal: 1 } }));
    assert.equal(between.pass, false);
    assert.match(between.failures[0], /incomplete observation: the effects of 1 frame\(s\) could not be read \(frames 31\)/);
    // Even with permitted effects that all finished and a page reported quiet.
    assert.equal(judgeReducedMotion(observation({ effects: [effect()], unreadable: { ...READABLE, frames: [8, 9], count: 2, recorderTotal: 2 } })).pass, false);
    assert.match(judgeReducedMotion(observation({ unreadable: { ...READABLE, initialSnapshotReadable: false } })).failures[0], /initial snapshot could not be read/);
    assert.match(judgeReducedMotion(observation({ unreadable: { ...READABLE, finalSnapshotReadable: false } })).failures[0], /final snapshot could not be read/);
    // An observation that does not say is not assumed readable (records made before this field existed).
    assert.match(judgeReducedMotion(observation({ unreadable: undefined })).failures[0], /does not say whether every frame could be read/);
  });
});
