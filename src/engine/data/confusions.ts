/**
 * Real-word confusion sets. These words are all valid English, so they can
 * never be handled by the spelling layer - only by local context evidence.
 *
 * Evidence is intentionally hand-written and tiny: a few hundred bigram cues
 * cost nothing to evaluate and are auditable, unlike a neural model.
 */

export interface ConfusionEntry {
  word: string;
  /** Words that, immediately before `word`, argue *for* it. */
  prev: string[];
  /** Words that, immediately after `word`, argue *for* it. */
  next: string[];
  /** Sentence-level regex cues (tested against the lower-cased sentence). */
  patterns?: RegExp[];
}

export interface ConfusionSet {
  id: string;
  members: ConfusionEntry[];
}

export const CONFUSION_SETS: ConfusionSet[] = [
  {
    id: 'from/form',
    members: [
      {
        word: 'from',
        prev: [
          'heard', 'received', 'came', 'come', 'comes', 'coming', 'apart', 'far', 'away',
          'differ', 'different', 'benefit', 'suffer', 'suffers', 'ranging', 'range', 'ranges',
          'aside', 'hear', 'hears', 'learn', 'learned', 'borrow', 'borrowed', 'stole',
          'protect', 'prevent', 'derived', 'made', 'built', 'starting', 'starts', 'back',
          'it', 'them', 'us', 'me', 'him', 'her', 'email', 'message', 'letter', 'call',
        ],
        next: [
          'me', 'him', 'her', 'them', 'us', 'you', 'the', 'a', 'an', 'my', 'his', 'their',
          'our', 'your', 'this', 'that', 'here', 'there', 'now', 'then', 'home', 'work',
          'scratch', 'time', 'what', 'where', 'which', 'whom', 'any', 'each', 'one',
        ],
      },
      {
        word: 'form',
        prev: [
          'the', 'a', 'an', 'this', 'that', 'application', 'order', 'registration', 'tax',
          'consent', 'web', 'online', 'complete', 'completed', 'fill', 'filled', 'submit',
          'submitted', 'sign', 'signed', 'contact', 'entry', 'request', 'claim', 'booking',
          'another', 'some', 'every', 'each', 'new', 'blank', 'short', 'long', 'in',
        ],
        next: [
          'of', 'and', 'is', 'was', 'has', 'below', 'above', 'here', 'field', 'fields',
          'submission', 'builder', 'data', 'validation', 'again', 'today', 'online',
        ],
        patterns: [/\b(fill|filling|filled|complete|completing|submit|submitting)\b/],
      },
    ],
  },
  {
    id: 'their/there/theyre',
    members: [
      {
        word: 'their',
        prev: ['of', 'in', 'on', 'with', 'for', 'to', 'and', 'at', 'from', 'about', 'is'],
        next: [
          'own', 'name', 'names', 'work', 'time', 'life', 'lives', 'home', 'house', 'car',
          'job', 'jobs', 'family', 'friends', 'money', 'team', 'company', 'business',
          'best', 'first', 'new', 'own', 'children', 'kids', 'parents', 'hands', 'heads',
        ],
      },
      {
        word: 'there',
        prev: ['over', 'up', 'down', 'out', 'in', 'and', 'but', 'so', 'get', 'got', 'go', 'went', 'was', 'is'],
        next: ['is', 'are', 'was', 'were', 'will', 'has', 'have', 'had', 'and', 'but', 'we', 'they', 'i', 'you', 'he', 'she', 'it'],
      },
      {
        word: "they're",
        prev: ['and', 'but', 'that', 'if', 'when', 'because', 'think', 'know', 'said'],
        next: ['going', 'not', 'here', 'there', 'the', 'a', 'all', 'still', 'just', 'already', 'very', 'really', 'so'],
      },
    ],
  },
  {
    id: 'your/youre',
    members: [
      {
        word: 'your',
        prev: ['of', 'to', 'for', 'with', 'in', 'on', 'and', 'at', 'is', 'about'],
        next: [
          'name', 'time', 'work', 'help', 'email', 'account', 'password', 'message',
          'own', 'life', 'team', 'company', 'family', 'friend', 'day', 'week', 'idea',
          'question', 'answer', 'reply', 'feedback', 'order', 'request',
        ],
      },
      {
        word: "you're",
        prev: ['if', 'when', 'that', 'and', 'but', 'because', 'think', 'know', 'said', 'unless'],
        next: [
          'going', 'not', 'right', 'wrong', 'welcome', 'sure', 'able', 'looking', 'doing',
          'making', 'the', 'a', 'an', 'still', 'just', 'already', 'very', 'really', 'so', 'in',
        ],
      },
    ],
  },
  {
    id: 'then/than',
    members: [
      {
        word: 'then',
        prev: ['and', 'but', 'since', 'back', 'right', 'until', 'by', 'from', 'if', 'ok', 'okay'],
        next: ['i', 'we', 'you', 'he', 'she', 'it', 'they', 'the', 'a', 'again', 'go', 'went', 'do', 'did'],
      },
      {
        word: 'than',
        prev: [
          'more', 'less', 'better', 'worse', 'rather', 'other', 'greater', 'smaller',
          'higher', 'lower', 'faster', 'slower', 'bigger', 'larger', 'longer', 'shorter',
          'easier', 'harder', 'cheaper', 'stronger', 'weaker', 'earlier', 'later', 'fewer',
        ],
        next: ['the', 'a', 'an', 'i', 'we', 'you', 'he', 'she', 'it', 'they', 'ever', 'that', 'this', 'any', 'most', 'usual', 'before'],
      },
    ],
  },
  {
    id: 'its/its-contraction',
    members: [
      {
        word: 'its',
        prev: ['of', 'in', 'on', 'with', 'for', 'to', 'and', 'at', 'from', 'about'],
        next: [
          'own', 'name', 'value', 'size', 'use', 'users', 'purpose', 'place', 'time',
          'first', 'best', 'new', 'main', 'core', 'origin', 'history', 'design', 'price',
        ],
      },
      {
        word: "it's",
        prev: ['and', 'but', 'that', 'if', 'when', 'because', 'think', 'know', 'said', 'so'],
        next: [
          'a', 'an', 'the', 'not', 'just', 'still', 'really', 'very', 'going', 'been',
          'time', 'good', 'bad', 'better', 'worth', 'clear', 'possible', 'important', 'my', 'your',
        ],
      },
    ],
  },
  {
    id: 'to/too',
    members: [
      {
        word: 'to',
        prev: ['go', 'going', 'want', 'wants', 'need', 'needs', 'try', 'tried', 'have', 'has', 'had', 'able', 'like', 'used', 'according', 'due'],
        next: ['be', 'do', 'go', 'get', 'have', 'make', 'take', 'see', 'the', 'a', 'my', 'your', 'his', 'her', 'me', 'you', 'us', 'them', 'work', 'school', 'home'],
      },
      {
        word: 'too',
        prev: ['is', 'was', 'are', 'were', 'me', 'you', 'him', 'her', 'them', 'us', 'and', 'but', 'far', 'way', 'not'],
        next: ['much', 'many', 'late', 'early', 'long', 'short', 'big', 'small', 'hard', 'easy', 'busy', 'bad', 'good', 'far', 'soon', 'slow', 'fast', 'expensive'],
      },
    ],
  },
  {
    id: 'lose/loose',
    members: [
      {
        word: 'lose',
        prev: ['to', 'will', 'would', 'could', 'might', 'may', "don't", 'not', 'never', 'dont'],
        next: ['the', 'my', 'your', 'his', 'her', 'their', 'it', 'them', 'weight', 'money', 'time', 'track', 'hope', 'control'],
      },
      {
        word: 'loose',
        prev: ['a', 'the', 'very', 'too', 'so', 'quite', 'is', 'was', 'are', 'were', 'feels', 'felt'],
        next: ['fit', 'ends', 'change', 'screw', 'connection', 'cable', 'wire', 'tooth', 'clothing'],
      },
    ],
  },
];

export interface ConfusionMatch {
  /** The other members of the set that could replace `word`. */
  alternatives: string[];
  setId: string;
}

const INDEX = new Map<string, ConfusionMatch>();
const ENTRIES = new Map<string, ConfusionEntry>();
for (const set of CONFUSION_SETS) {
  for (const member of set.members) {
    ENTRIES.set(member.word, member);
    INDEX.set(member.word, {
      setId: set.id,
      alternatives: set.members.filter((m) => m.word !== member.word).map((m) => m.word),
    });
  }
}

export function confusionFor(word: string): ConfusionMatch | undefined {
  return INDEX.get(word.toLowerCase());
}

export function confusionEntry(word: string): ConfusionEntry | undefined {
  return ENTRIES.get(word.toLowerCase());
}
