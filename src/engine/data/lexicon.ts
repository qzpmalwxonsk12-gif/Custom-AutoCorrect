/**
 * Compatibility facade for existing callers.
 *
 * Membership and buckets come exclusively from the generated ESDB en_US
 * size-60 dictionary. The old hand-written membership list has been removed.
 */
import {
  DICTIONARY_METADATA,
  LEXICON_SIZE,
  dictionary,
  frequencyScore,
  getDictionaryBucket,
  isKnownWord,
  normaliseDictionaryWord,
} from './dictionary.js';

export {
  DICTIONARY_METADATA,
  LEXICON_SIZE,
  dictionary,
  frequencyScore,
  getDictionaryBucket,
  isKnownWord,
  normaliseDictionaryWord,
};

/** Read-only membership view retained for older engine code. */
export function lexicon(): ReadonlySet<string> {
  return dictionary.words;
}
