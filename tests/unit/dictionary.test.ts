import { describe, expect, it } from 'vitest';
import {
  generateDictionary,
  normaliseDictionaryEntry,
  parseWordList,
  renderDictionaryData,
  renderDictionaryMetadata,
} from '../../scripts/generate-dictionary.mjs';
import {
  DICTIONARY_METADATA,
  dictionary,
  frequencyScore,
  getDictionaryBucket,
  isKnownWord,
  normaliseDictionaryWord,
} from '../../src/engine/data/dictionary.js';

describe('ESDB dictionary generation', () => {
  it('normalises line endings, case, Unicode form, and apostrophe variants', () => {
    const parsed = parseWordList(
      "\ufeff Can't\r\nCAN\u2019T\r\n CAFÉ \n cafe\u0301\n\n",
    );

    expect(parsed.words).toEqual(['café', "can't"]);
    expect(parsed.inputEntryCount).toBe(4);
    expect(parsed.duplicateCount).toBe(2);
    expect(normaliseDictionaryEntry('  DON\u02bcT  ')).toBe("don't");
  });

  it('preserves contractions and rejects malformed entries instead of silently weakening data', () => {
    expect(parseWordList("can't\nwon't\nwe'll\n").words).toEqual(["can't", "we'll", "won't"]);
    expect(() => parseWordList('valid\ntwo words\n')).toThrow(/Invalid dictionary entry/);
    expect(() => parseWordList('\0bad\n')).toThrow(/NUL byte/);
  });

  it('renders byte-identical output regardless of input order and duplicates', () => {
    const first = parseWordList("Beta\r\nalpha\nALPHA\ncan't\n").words;
    const second = parseWordList("CAN'T\nbeta\nalpha\r\n").words;
    const details = {
      inputEntryCount: 4,
      duplicateCount: 1,
      sourceSha256: 'b'.repeat(64),
      contentSha256: 'a'.repeat(64),
    };

    expect(renderDictionaryData(first)).toBe(renderDictionaryData(second));
    expect(renderDictionaryMetadata(first, details)).toBe(
      renderDictionaryMetadata(second, details),
    );
    expect(renderDictionaryData(first)).not.toMatch(/generatedAt|Date\(/u);
  });

  it('fails hard when source content is empty', () => {
    expect(() => parseWordList('\r\n \n')).toThrow(/contains no words/);
  });

  it('fails hard when the required source file is missing', async () => {
    await expect(
      generateDictionary({
        sourcePath: 'tests/fixtures/__missing_esdb_source__.txt',
        validateProvenance: false,
      }),
    ).rejects.toThrow(/missing or unreadable/);
  });
});

describe('bundled ESDB dictionary runtime', () => {
  it('loads the expected size-60 en_US artifact', () => {
    expect(DICTIONARY_METADATA.sourceVersion).toBe('2026.02.25');
    expect(DICTIONARY_METADATA.sourceVariant).toBe('en_US');
    expect(DICTIONARY_METADATA.sourceSize).toBe(60);
    expect(DICTIONARY_METADATA.wordCount).toBe(107_901);
    expect(DICTIONARY_METADATA.duplicateCount).toBe(2_001);
    expect(DICTIONARY_METADATA.sourceSha256).toBe(
      'fe44d9ed8804beb4dfb78c10e1625e9a1f670f0b3074094c92e70bde6e6b0ac9',
    );
    expect(DICTIONARY_METADATA.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(dictionary.words.size).toBe(DICTIONARY_METADATA.wordCount);
  });

  it('provides case-insensitive Set lookup with canonical apostrophes', () => {
    expect(dictionary.words).toBeInstanceOf(Set);
    expect(dictionary.words.has('WORKS')).toBe(true);
    expect(dictionary.words.has('surrounding')).toBe(true);
    expect(dictionary.words.has('CAN\u2019T')).toBe(true);
    expect(isKnownWord("can't")).toBe(true);
    expect(isKnownWord('definitely-not-an-esdb-word')).toBe(false);
    expect(normaliseDictionaryWord('  CAN\u2019T ')).toBe("can't");
  });

  it('builds deterministic length-and-first-letter buckets once', () => {
    const direct = dictionary.byLengthAndFirstLetter.get(5)?.get('w');
    const viaHelper = getDictionaryBucket(5, 'W');

    expect(viaHelper).toBe(direct);
    expect(viaHelper).toContain('works');
    expect(viaHelper.length).toBeGreaterThan(10);
    expect(viaHelper.every((word) => word.length === 5 && word.startsWith('w'))).toBe(true);
  });

  it('uses an explicit commonness prior rather than ESDB alphabetical order', () => {
    expect(isKnownWord('works')).toBe(true);
    expect(isKnownWord('dorks')).toBe(true);
    expect(frequencyScore('works')).toBeGreaterThan(frequencyScore('dorks'));
    expect(frequencyScore('not-a-word')).toBe(0);
  });
});
