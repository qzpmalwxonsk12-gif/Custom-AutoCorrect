/**
 * CoNLL-U reading and synthetic corruption.
 *
 * Fast and corpus-free: these run in the main suite. The measurement run over
 * the real UD English EWT corpus lives in `tests/evaluation/` and is invoked by
 * `npm run evaluate`, so a 14 MB parse never slows `npm run check`.
 */
import { describe, expect, it } from 'vitest';
import { parseConllu, reconstruct } from '../evaluation/conllu.js';
import { corruptSentence, seededRandom } from '../evaluation/evaluator.js';

/* ------------------------------ the reader ------------------------------ */

describe('CoNLL-U reader', () => {
  const SAMPLE = [
    '# sent_id = test-1',
    '# text = From the AP comes this story :',
    '1\tFrom\tfrom\tADP\tIN\t_\t3\tcase\t3:case\t_',
    '2\tthe\tthe\tDET\tDT\t_\t3\tdet\t3:det\t_',
    '3\tAP\tAP\tPROPN\tNNP\t_\t4\tobl\t4:obl\t_',
    '',
    '# sent_id = test-2',
    '# text = I don\'t know.',
    "1\tI\tI\tPRON\tPRP\t_\t3\tnsubj\t3:nsubj\t_",
    "2-3\tdon't\t_\t_\t_\t_\t_\t_\t_\t_",
    '2\tdo\tdo\tAUX\tVBP\t_\t4\taux\t4:aux\t_',
    "3\tn't\tnot\tPART\tRB\t_\t4\tadvmod\t4:advmod\t_",
    '4\tknow\tknow\tVERB\tVB\t_\t0\troot\t0:root\tSpaceAfter=No',
    '5\t.\t.\tPUNCT\t.\t_\t4\tpunct\t4:punct\t_',
    '',
  ].join('\n');

  it('reads sentence ids and text', () => {
    const sentences = parseConllu(SAMPLE);
    expect(sentences).toHaveLength(2);
    expect(sentences[0]!.sentId).toBe('test-1');
    expect(sentences[0]!.text).toBe('From the AP comes this story :');
    expect(sentences[0]!.textFromFile).toBe(true);
  });

  /**
   * "don't" is a multiword token spanning "do" + "n't". Emitting the parts as
   * well would produce "I don't do n't know." — nonsense the engine would then
   * be measured against.
   */
  it('keeps a multiword token and drops its parts', () => {
    const [, second] = parseConllu(SAMPLE);
    expect(second!.tokens.map((t) => t.form)).toEqual(['I', "don't", 'know', '.']);
  });

  it('honours SpaceAfter when reconstructing', () => {
    const [, second] = parseConllu(SAMPLE);
    expect(reconstruct(second!.tokens)).toBe("I don't know.");
  });

  it('skips empty nodes', () => {
    const withEmpty = [
      '# sent_id = e',
      '1\tone\tone\tNUM\tCD\t_\t0\troot\t0:root\t_',
      '1.1\tghost\tghost\tNOUN\tNN\t_\t_\t_\t_\t_',
      '',
    ].join('\n');
    expect(parseConllu(withEmpty)[0]!.tokens.map((t) => t.form)).toEqual(['one']);
  });

  it('skips malformed rows rather than throwing', () => {
    const broken = ['# sent_id = b', '1\ttoo\tfew\tcolumns', '', ''].join('\n');
    expect(() => parseConllu(broken)).not.toThrow();
    expect(parseConllu(broken)).toHaveLength(0);
  });

  it('reconstructs when no text comment is present', () => {
    const noText = [
      '1\tHello\thello\tINTJ\tUH\t_\t0\troot\t0:root\tSpaceAfter=No',
      '2\t!\t!\tPUNCT\t.\t_\t1\tpunct\t1:punct\t_',
      '',
    ].join('\n');
    const [sentence] = parseConllu(noText);
    expect(sentence!.text).toBe('Hello!');
    expect(sentence!.textFromFile).toBe(false);
  });
});

/* ------------------------------ corruption ------------------------------ */

describe('synthetic corruption', () => {
  it('is deterministic for a given seed', () => {
    const text = 'The committee reviewed the proposal carefully before making a decision.';
    const a = corruptSentence(text, seededRandom(7));
    const b = corruptSentence(text, seededRandom(7));
    expect(a?.corrupted).toBe(b?.corrupted);
  });

  it('never produces another real word', () => {
    const text = 'The committee reviewed the proposal carefully before making a decision.';
    for (let seed = 0; seed < 40; seed++) {
      const corruption = corruptSentence(text, seededRandom(seed));
      if (!corruption) continue;
      // The whole point: if the corruption is a real word there is no single
      // correct answer to measure against.
      expect(corruption.corrupted).not.toBe(corruption.original.toLowerCase());
    }
  });

  it('leaves the rest of the sentence untouched', () => {
    const text = 'The committee reviewed the proposal carefully before making a decision.';
    const corruption = corruptSentence(text, seededRandom(3));
    if (!corruption) return;
    expect(corruption.sentence.length).toBeGreaterThan(0);
    expect(corruption.sentence).not.toBe(text);
    // Everything outside the corrupted span is identical.
    expect(corruption.sentence.slice(0, corruption.start)).toBe(text.slice(0, corruption.start));
  });
});

