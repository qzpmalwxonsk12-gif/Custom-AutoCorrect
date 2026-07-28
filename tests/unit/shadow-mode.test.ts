import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHADOW_LOG,
  MAX_SHADOW_OBSERVATIONS,
  createObservation,
  recordObservation,
  summariseShadowLog,
  type ShadowLog,
} from '../../src/shared/shadow-mode.js';

const NOW = 1_700_000_000_000;

function observation(overrides: Partial<Parameters<typeof createObservation>[0]> = {}) {
  return createObservation({
    provider: 'spelling',
    ruleId: 'spelling:duplicate-letter',
    originalText: 'punctuatioon',
    replacementText: 'punctuation',
    confidence: 0.95,
    wouldHave: 'autocorrect',
    origin: 'https://example.com',
    now: NOW,
    ...overrides,
  });
}

describe('createObservation', () => {
  it('records what would have happened, with a bounded snippet', () => {
    const entry = observation();
    expect(entry.wouldHave).toBe('autocorrect');
    expect(entry.ruleId).toBe('spelling:duplicate-letter');
    expect(entry.id).toMatch(/^sh_/);
  });

  it('truncates long text, because an observation is evidence not an archive', () => {
    const entry = observation({ originalText: 'x'.repeat(500) });
    expect(entry.originalText.length).toBe(120);
  });

  it('gives consecutive observations distinct ids', () => {
    expect(observation().id).not.toBe(observation().id);
  });
});

describe('recordObservation', () => {
  it('appends to the log', () => {
    const log = recordObservation(structuredClone(EMPTY_SHADOW_LOG), observation());
    expect(log.observations).toHaveLength(1);
  });

  it('marks agreement when two providers propose the same replacement', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(log, observation({ provider: 'spelling' }));
    log = recordObservation(log, observation({ provider: 'ai', now: NOW + 500 }));

    const [first, second] = log.observations;
    expect(second!.agreedWith).toEqual(['spelling']);
    // The earlier record is updated too, so the relationship reads both ways.
    expect(first!.agreedWith).toEqual(['ai']);
    expect(second!.disagreedWith).toBeUndefined();
  });

  it('marks disagreement when providers differ on the same text', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(log, observation({ provider: 'spelling', replacementText: 'punctuation' }));
    log = recordObservation(
      log,
      observation({ provider: 'ai', replacementText: 'punctuations', now: NOW + 500 }),
    );

    const [first, second] = log.observations;
    expect(second!.disagreedWith).toEqual([
      { provider: 'spelling', replacementText: 'punctuation' },
    ]);
    expect(first!.disagreedWith).toEqual([{ provider: 'ai', replacementText: 'punctuations' }]);
  });

  it('does not pair a provider with itself', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(log, observation({ provider: 'spelling' }));
    log = recordObservation(log, observation({ provider: 'spelling', now: NOW + 100 }));
    expect(log.observations[1]!.agreedWith).toBeUndefined();
  });

  it('does not pair observations that are far apart in time', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(log, observation({ provider: 'spelling' }));
    log = recordObservation(log, observation({ provider: 'ai', now: NOW + 120_000 }));
    expect(log.observations[1]!.agreedWith).toBeUndefined();
  });

  it('does not infer agreement between unrelated origins', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(
      log,
      observation({ provider: 'spelling', origin: 'https://one.example' }),
    );
    log = recordObservation(
      log,
      observation({ provider: 'ai', origin: 'https://two.example', now: NOW + 100 }),
    );

    expect(log.observations[0]!.agreedWith).toBeUndefined();
    expect(log.observations[1]!.agreedWith).toBeUndefined();
  });

  it('stays bounded', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    for (let i = 0; i < MAX_SHADOW_OBSERVATIONS + 40; i++) {
      log = recordObservation(log, observation({ originalText: `word${i}`, now: NOW + i }));
    }
    expect(log.observations.length).toBe(MAX_SHADOW_OBSERVATIONS);
    // The newest are kept; the oldest fall off the front.
    expect(log.observations.at(-1)!.originalText).toBe(`word${MAX_SHADOW_OBSERVATIONS + 39}`);
  });
});

describe('summariseShadowLog', () => {
  it('counts what would have happened, by provider and by rule', () => {
    let log: ShadowLog = structuredClone(EMPTY_SHADOW_LOG);
    log = recordObservation(log, observation({ wouldHave: 'autocorrect' }));
    log = recordObservation(
      log,
      observation({ wouldHave: 'suggest', provider: 'spacing', ruleId: 'spacing:split',
        originalText: 'improvementability', now: NOW + 1 }),
    );

    const summary = summariseShadowLog(log);
    expect(summary.total).toBe(2);
    expect(summary.wouldHaveAutocorrected).toBe(1);
    expect(summary.wouldHaveSuggested).toBe(1);
    expect(summary.byProvider.spelling).toBe(1);
    expect(summary.byProvider.spacing).toBe(1);
    expect(summary.byRule['spacing:split']).toBe(1);
  });

  it('reports zero for an empty log', () => {
    const summary = summariseShadowLog(structuredClone(EMPTY_SHADOW_LOG));
    expect(summary).toMatchObject({ total: 0, agreements: 0, disagreements: 0 });
  });
});
