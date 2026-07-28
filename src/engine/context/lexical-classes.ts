/**
 * Closed-class word lists: determiners, pronouns, auxiliaries, prepositions,
 * conjunctions, adverbs and the small irregular-verb sets.
 *
 * These are facts about English, not facts about punctuation. They live here so
 * the spelling lane and the punctuation lane share exactly one copy - see
 * `docs/CONTEXT-ENGINE.md` for why that mattered.
 */
/* ------------------------------------------------------------------ *
 * Closed classes
 * ------------------------------------------------------------------ */

/** Subordinators that can introduce a dependent clause. */
export const SUBORDINATORS = new Set([
  'after', 'although', 'as', 'because', 'before', 'even', 'if', 'once',
  'since', 'so', 'than', 'that', 'though', 'unless', 'until', 'when',
  'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'whilst',
]);

/**
 * Subordinators safe to use as an *introductory* trigger for P001. Excludes
 * highly ambiguous ones ("as", "so", "that", "than", "since" as preposition)
 * to keep precision high.
 */
export const INTRODUCTORY_SUBORDINATORS = new Set([
  'after', 'although', 'because', 'before', 'if', 'once', 'though',
  'unless', 'until', 'when', 'whenever', 'whereas', 'while', 'whilst',
]);

/** Multi-word introductory subordinators, matched before single words. */
export const MULTIWORD_SUBORDINATORS: readonly string[][] = [
  ['even', 'though'],
  ['even', 'if'],
  ['as', 'soon', 'as'],
  ['as', 'long', 'as'],
  ['in', 'order', 'that'],
  ['so', 'that'],
  ['provided', 'that'],
];

export const COORDINATORS = new Set(['for', 'and', 'nor', 'but', 'or', 'yet', 'so']);

/** Correlative pairs whose second half must never take a comma. */
export const CORRELATIVE_FIRST = new Set(['either', 'neither', 'both', 'whether', 'not']);

export const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
  'her', 'its', 'our', 'their', 'some', 'any', 'no', 'every', 'each',
  'another', 'both', 'either', 'neither', 'much', 'many', 'few', 'several',
  'all', 'most', 'such', 'what', 'which', 'whose',
]);

export const SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'who']);
export const OBJECT_PRONOUNS = new Set(['me', 'him', 'her', 'us', 'them', 'whom']);
/**
 * Demonstratives are deliberately absent: "This function returns X" is far
 * more common than standalone "This is X", and reading them as determiners
 * still yields a valid subject for clause detection either way.
 */
export const OTHER_PRONOUNS = new Set([
  'someone', 'somebody', 'something',
  'anyone', 'anybody', 'anything', 'everyone', 'everybody', 'everything',
  'nobody', 'nothing', 'none', 'one', 'mine', 'yours', 'hers', 'ours',
  'theirs', 'himself', 'herself', 'myself', 'yourself', 'ourselves',
  'themselves', 'itself',
]);

/** Finite auxiliary and modal forms - the backbone of clause detection. */
export const AUXILIARIES = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must',
  "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't",
  "haven't", "hasn't", "hadn't", "can't", "couldn't", "shouldn't", "won't",
  "wouldn't", "mustn't", "mightn't", "shan't",
  "i'm", "you're", "he's", "she's", "it's", "we're", "they're",
  "i've", "you've", "we've", "they've", "i'd", "you'd", "he'd", "she'd",
  "we'd", "they'd", "i'll", "you'll", "he'll", "she'll", "we'll", "they'll",
  // Hortative "let's": behaves like an auxiliary before a bare verb.
  "let's", 'lets',
]);

/**
 * Common verbs that can head an imperative. Without these, a sentence-initial
 * "Come here John." classifies "Come" as a noun and no rule can see the
 * imperative. Membership means "this word is a verb", which is safe for these
 * because none of them are common nouns in the same form.
 */
export const IMPERATIVE_VERBS = new Set([
  'come', 'go', 'look', 'listen', 'wait', 'stop', 'eat', 'drink', 'sit',
  'stand', 'open', 'close', 'read', 'write', 'watch', 'check', 'try', 'keep',
  'hold', 'move', 'turn', 'pass', 'send', 'bring', 'take', 'give', 'put',
  'tell', 'ask', 'find', 'follow', 'start', 'finish', 'pick', 'push', 'pull',
  'join', 'meet', 'leave', 'run', 'walk', 'hurry', 'relax', 'focus', 'smile',
  'sing', 'dance', 'click', 'press', 'type', 'enter', 'select', 'choose',
  'save', 'load', 'install', 'update', 'restart', 'delete', 'remove', 'clean',
  'wash', 'cook', 'drive', 'ride', 'call', 'help', 'buy', 'sell', 'explain',
]);

/** Non-finite forms: cannot head a clause on their own. */
export const NONFINITE_AUXILIARIES = new Set(['be', 'been', 'being', 'have']);

/**
 * Copular forms. A known word after one of these is usually a complement
 * ("was red", "is tall"), not a verb - unlike after a modal ("can run").
 */
export const COPULAS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

export const PREPOSITIONS = new Set([
  'about', 'above', 'across', 'against', 'along', 'among', 'around', 'at',
  'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down',
  'during', 'except', 'for', 'from', 'in', 'inside', 'into', 'near', 'of',
  'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'through',
  'throughout', 'to', 'toward', 'towards', 'under', 'underneath', 'until',
  'up', 'upon', 'with', 'within', 'without', 'per', 'via',
]);

export const ADVERBS = new Set([
  'very', 'quite', 'rather', 'really', 'just', 'only', 'also', 'even',
  'still', 'already', 'always', 'never', 'often', 'sometimes', 'usually',
  'rarely', 'seldom', 'again', 'soon', 'now', 'then', 'here', 'there',
  'today', 'tomorrow', 'yesterday', 'later', 'earlier', 'finally', 'quickly',
  'slowly', 'carefully', 'suddenly', 'immediately', 'well', 'too', 'almost',
  'nearly', 'together', 'apart', 'away', 'back', 'ever', 'yet', 'far',
]);

/** Conjunctive adverbs that begin a sentence and take a following comma. */
export const CONJUNCTIVE_ADVERBS = new Set([
  'however', 'therefore', 'moreover', 'furthermore', 'nevertheless',
  'nonetheless', 'consequently', 'meanwhile', 'instead', 'otherwise',
  'accordingly', 'besides', 'hence', 'thus', 'additionally',
]);

/** Kinship terms, titles and vocatives usable as direct address. */
export const ADDRESS_TERMS = new Set([
  'mom', 'mum', 'dad', 'mommy', 'mummy', 'daddy', 'mother', 'father',
  'grandma', 'grandmother', 'grandpa', 'grandfather', 'granny', 'nana',
  'sir', "ma'am", 'madam', 'doctor', 'officer', 'teacher', 'professor',
  'everyone', 'everybody', 'guys', 'team', 'folks', 'people', 'friends',
  'son', 'buddy', 'mate', 'dude', 'boss', 'captain', 'coach', 'nurse',
]);

/** Greeting/thanks words that reliably precede a vocative. */
export const GREETING_TERMS = new Set([
  'thanks', 'thank', 'hello', 'hi', 'hey', 'goodbye', 'bye', 'welcome',
  'congratulations', 'congrats', 'sorry', 'please', 'yes', 'no', 'okay',
]);

/**
 * Common irregular past-tense/participle forms. Needed because "-ed" is not a
 * reliable finite-verb signal on its own.
 */
export const IRREGULAR_PAST = new Set([
  'was', 'were', 'had', 'did', 'said', 'went', 'got', 'made', 'knew',
  'thought', 'took', 'came', 'saw', 'gave', 'found', 'told', 'became',
  'left', 'felt', 'put', 'brought', 'began', 'kept', 'held', 'wrote',
  'stood', 'heard', 'let', 'meant', 'set', 'met', 'ran', 'paid', 'sat',
  'spoke', 'lay', 'led', 'grew', 'lost', 'fell', 'sent', 'built', 'understood',
  'drew', 'broke', 'spent', 'cut', 'rose', 'drove', 'bought', 'wore', 'chose',
  'ate', 'flew', 'read', 'sold', 'taught', 'caught', 'threw', 'slept', 'won',
  'forgot', 'hid', 'sang', 'drank', 'swam', 'rode', 'woke', 'shut', 'hit',
]);

/** Irregular past participles that are NOT finite (need an auxiliary). */
export const IRREGULAR_PARTICIPLE = new Set([
  'been', 'done', 'gone', 'seen', 'taken', 'given', 'written', 'known',
  'spoken', 'broken', 'chosen', 'driven', 'eaten', 'fallen', 'forgotten',
  'hidden', 'ridden', 'risen', 'shown', 'sung', 'drunk', 'swum', 'woken',
  'worn', 'thrown', 'grown', 'flown', 'begun', 'become', 'brought', 'built',
]);

/** Participles that commonly open an introductory phrase (P002). */
export const INTRODUCTORY_PARTICIPLE_STARTERS = new Set([
  'having', 'being', 'exhausted', 'tired', 'frustrated', 'excited',
  'determined', 'worried', 'confused', 'surprised', 'satisfied', 'pleased',
  'armed', 'faced', 'based', 'given', 'seen', 'known', 'told', 'asked',
  'born', 'raised', 'trained', 'inspired', 'motivated', 'encouraged',
]);

/** Prepositions that commonly open a participial phrase: "After finishing…". */
export const PARTICIPLE_PREPOSITIONS = new Set([
  'after', 'before', 'while', 'when', 'upon', 'on', 'by', 'without', 'since',
  'despite', 'besides', 'through',
]);

