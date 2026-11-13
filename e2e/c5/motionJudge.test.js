import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectProblems, judgeReducedMotion } from './motionJudge.js';

/** The site's rule as motionObserve reads it, and an observation with nothing in it. */
const RULE = { transitionMs: 0.01, animationMs: 0.01, iterationCount: '1' };
const effect = (over = {}) => ({ key: 'footer li:nth-of-type(1)|CSSTransition|visibility', where: 'footer > … > li:nth-of-type(1)', kind: 'CSSTransition', name: 'visibility', duration: 0.01, delay: 0, endDelay: 0, iterations: 1, activeDuration: 0.01, fill: 'backwards', playState: 'running', framesSeen: 1, firstFrame: 12, lastFrame: 12, ...over });
const observation = (over = {}) => ({ scrollBehavior: 'auto', rule: RULE, truncated: false, effects: [], final: [], declaredBeyondRule: [], quiet: true, framesObserved: 6, unavailable: [], ...over });

describe('judgeReducedMotion', () => {
  it('a quiet page passes', () => {
    assert.deepEqual(judgeReducedMotion(observation()), { pass: true, failures: [], permitted: [] });
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
});
