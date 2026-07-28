/**
 * Evaluation corpus for the essential-punctuation lane.
 *
 * POSITIVE entries assert the exact corrected text a rule must produce.
 * NEGATIVE entries assert that the engine leaves the text completely alone.
 *
 * The negatives outnumber the positives roughly 2:1 on purpose: this lane is
 * optimised for precision, so most of its value is in what it declines to do.
 * Every false positive found during development is added here permanently.
 */
import type { PunctuationRuleId } from '../../src/engine/punctuation/punctuation-types.js';

export interface PositiveCase {
  input: string;
  expected: string;
  rule: PunctuationRuleId;
}

/** Text the engine must not modify at all. */
export interface NegativeCase {
  input: string;
  why: string;
}

export const POSITIVE_CASES: PositiveCase[] = [
  // ---- P001 introductory dependent clause ----
  { input: 'After I finished the report I went home.', expected: 'After I finished the report, I went home.', rule: 'punctuation:introductory-clause' },
  { input: 'Although it was raining we continued.', expected: 'Although it was raining, we continued.', rule: 'punctuation:introductory-clause' },
  { input: 'When the test completed the page refreshed.', expected: 'When the test completed, the page refreshed.', rule: 'punctuation:introductory-clause' },
  { input: 'Because the server failed we lost the data.', expected: 'Because the server failed, we lost the data.', rule: 'punctuation:introductory-clause' },
  { input: 'If you finish early you can leave.', expected: 'If you finish early, you can leave.', rule: 'punctuation:introductory-clause' },
  { input: 'Unless he calls we should start.', expected: 'Unless he calls, we should start.', rule: 'punctuation:introductory-clause' },
  { input: 'Until the build passes we cannot ship.', expected: 'Until the build passes, we cannot ship.', rule: 'punctuation:introductory-clause' },
  { input: 'While she was cooking he cleaned the kitchen.', expected: 'While she was cooking, he cleaned the kitchen.', rule: 'punctuation:introductory-clause' },
  { input: 'Before the meeting started we reviewed the notes.', expected: 'Before the meeting started, we reviewed the notes.', rule: 'punctuation:introductory-clause' },
  { input: 'Once the update installed the machine restarted.', expected: 'Once the update installed, the machine restarted.', rule: 'punctuation:introductory-clause' },
  { input: 'Whenever the alarm rings the dog barks.', expected: 'Whenever the alarm rings, the dog barks.', rule: 'punctuation:introductory-clause' },
  { input: 'Although the team tried hard they lost the match.', expected: 'Although the team tried hard, they lost the match.', rule: 'punctuation:introductory-clause' },
  { input: 'If the file exists the script skips it.', expected: 'If the file exists, the script skips it.', rule: 'punctuation:introductory-clause' },
  { input: 'When I arrived she had already left.', expected: 'When I arrived, she had already left.', rule: 'punctuation:introductory-clause' },
  { input: 'After we ate dinner they watched a film.', expected: 'After we ate dinner, they watched a film.', rule: 'punctuation:introductory-clause' },
  { input: 'Because it rained heavily the match was delayed.', expected: 'Because it rained heavily, the match was delayed.', rule: 'punctuation:introductory-clause' },
  { input: 'While the code compiled I read the docs.', expected: 'While the code compiled, I read the docs.', rule: 'punctuation:introductory-clause' },
  { input: 'If she agrees we will proceed.', expected: 'If she agrees, we will proceed.', rule: 'punctuation:introductory-clause' },
  { input: 'When the alarm sounded everyone left the building.', expected: 'When the alarm sounded, everyone left the building.', rule: 'punctuation:introductory-clause' },
  { input: 'Although he apologised she remained angry.', expected: 'Although he apologised, she remained angry.', rule: 'punctuation:introductory-clause' },
  { input: 'Once we deployed the fix the errors stopped.', expected: 'Once we deployed the fix, the errors stopped.', rule: 'punctuation:introductory-clause' },
  { input: 'Unless the tests pass the build fails.', expected: 'Unless the tests pass, the build fails.', rule: 'punctuation:introductory-clause' },
  { input: 'Whereas the first draft was rough the second was clean.', expected: 'Whereas the first draft was rough, the second was clean.', rule: 'punctuation:introductory-clause' },
  { input: 'After the rain stopped the children played outside.', expected: 'After the rain stopped, the children played outside.', rule: 'punctuation:introductory-clause' },
  { input: 'When the download finished I opened the file.', expected: 'When the download finished, I opened the file.', rule: 'punctuation:introductory-clause' },
  { input: 'If the light turns green you may go.', expected: 'If the light turns green, you may go.', rule: 'punctuation:introductory-clause' },
  { input: 'Although the room was cold she stayed.', expected: 'Although the room was cold, she stayed.', rule: 'punctuation:introductory-clause' },
  { input: 'Because the road flooded we took another route.', expected: 'Because the road flooded, we took another route.', rule: 'punctuation:introductory-clause' },
  { input: 'While they argued the meeting ran late.', expected: 'While they argued, the meeting ran late.', rule: 'punctuation:introductory-clause' },
  { input: 'When the engine started the lights dimmed.', expected: 'When the engine started, the lights dimmed.', rule: 'punctuation:introductory-clause' },

  // ---- P002 introductory participial phrase ----
  { input: 'After finishing the report I went home.', expected: 'After finishing the report, I went home.', rule: 'punctuation:introductory-participle' },
  { input: 'Having completed the test she left.', expected: 'Having completed the test, she left.', rule: 'punctuation:introductory-participle' },
  { input: 'Having completed the build she tested it.', expected: 'Having completed the build, she tested it.', rule: 'punctuation:introductory-participle' },
  { input: 'Exhausted from work he went to bed.', expected: 'Exhausted from work, he went to bed.', rule: 'punctuation:introductory-participle' },
  { input: 'Before leaving the office she locked the door.', expected: 'Before leaving the office, she locked the door.', rule: 'punctuation:introductory-participle' },
  { input: 'After reading the manual he tried again.', expected: 'After reading the manual, he tried again.', rule: 'punctuation:introductory-participle' },
  { input: 'Having lost the keys they waited outside.', expected: 'Having lost the keys, they waited outside.', rule: 'punctuation:introductory-participle' },
  { input: 'While waiting for the bus I read a book.', expected: 'While waiting for the bus, I read a book.', rule: 'punctuation:introductory-participle' },
  { input: 'Frustrated by the delay she called support.', expected: 'Frustrated by the delay, she called support.', rule: 'punctuation:introductory-participle' },
  { input: 'Determined to finish he worked all night.', expected: 'Determined to finish, he worked all night.', rule: 'punctuation:introductory-participle' },
  { input: 'After testing the extension we shipped it.', expected: 'After testing the extension, we shipped it.', rule: 'punctuation:introductory-participle' },
  { input: 'Having reviewed the notes they agreed.', expected: 'Having reviewed the notes, they agreed.', rule: 'punctuation:introductory-participle' },
  { input: 'Worried about the results she called again.', expected: 'Worried about the results, she called again.', rule: 'punctuation:introductory-participle' },
  { input: 'Excited about the launch they celebrated.', expected: 'Excited about the launch, they celebrated.', rule: 'punctuation:introductory-participle' },
  { input: 'Before starting the engine he checked the oil.', expected: 'Before starting the engine, he checked the oil.', rule: 'punctuation:introductory-participle' },

  // ---- P003 direct address ----
  { input: "Let's eat Grandma.", expected: "Let's eat, Grandma.", rule: 'punctuation:direct-address' },
  { input: 'Thanks Arjun.', expected: 'Thanks, Arjun.', rule: 'punctuation:direct-address' },
  { input: 'Come here John.', expected: 'Come here, John.', rule: 'punctuation:direct-address' },
  { input: 'Mom look at this.', expected: 'Mom, look at this.', rule: 'punctuation:direct-address' },
  { input: 'Hello Sarah.', expected: 'Hello, Sarah.', rule: 'punctuation:direct-address' },
  { input: 'Hi Michael.', expected: 'Hi, Michael.', rule: 'punctuation:direct-address' },
  { input: 'Goodbye Emma.', expected: 'Goodbye, Emma.', rule: 'punctuation:direct-address' },
  { input: 'Dad come here quickly.', expected: 'Dad, come here quickly.', rule: 'punctuation:direct-address' },
  { input: 'Everyone listen carefully now.', expected: 'Everyone, listen carefully now.', rule: 'punctuation:direct-address' },
  { input: 'Thanks Michael.', expected: 'Thanks, Michael.', rule: 'punctuation:direct-address' },
  { input: 'Sorry Emma.', expected: 'Sorry, Emma.', rule: 'punctuation:direct-address' },

  // ---- P004 simple lists ----
  { input: 'I bought apples oranges bananas and grapes.', expected: 'I bought apples, oranges, bananas, and grapes.', rule: 'punctuation:simple-list' },
  { input: 'The flag was red white and blue.', expected: 'The flag was red, white, and blue.', rule: 'punctuation:simple-list' },
  { input: 'We need bread milk and eggs.', expected: 'We need bread, milk, and eggs.', rule: 'punctuation:simple-list' },
  { input: 'She packed shirts trousers socks and shoes.', expected: 'She packed shirts, trousers, socks, and shoes.', rule: 'punctuation:simple-list' },
  { input: 'The kit included pliers screwdrivers and wrenches.', expected: 'The kit included pliers, screwdrivers, and wrenches.', rule: 'punctuation:simple-list' },

  // ---- P005 independent clauses ----
  { input: 'I was tired but I kept working.', expected: 'I was tired, but I kept working.', rule: 'punctuation:independent-clause' },
  { input: 'She wanted to leave yet she stayed.', expected: 'She wanted to leave, yet she stayed.', rule: 'punctuation:independent-clause' },
  { input: 'The extension loaded and it began correcting text.', expected: 'The extension loaded, and it began correcting text.', rule: 'punctuation:independent-clause' },
  { input: 'He called twice but she never answered.', expected: 'He called twice, but she never answered.', rule: 'punctuation:independent-clause' },
  { input: 'The build finished and the tests passed.', expected: 'The build finished, and the tests passed.', rule: 'punctuation:independent-clause' },
  { input: 'I wanted to help but they refused.', expected: 'I wanted to help, but they refused.', rule: 'punctuation:independent-clause' },
  { input: 'We can wait or we can start now.', expected: 'We can wait, or we can start now.', rule: 'punctuation:independent-clause' },
  { input: 'The server crashed and the site went down.', expected: 'The server crashed, and the site went down.', rule: 'punctuation:independent-clause' },
  { input: 'She studied hard so she passed easily.', expected: 'She studied hard, so she passed easily.', rule: 'punctuation:independent-clause' },
  { input: 'They arrived late but they still won.', expected: 'They arrived late, but they still won.', rule: 'punctuation:independent-clause' },
  { input: 'He was hungry so he made lunch.', expected: 'He was hungry, so he made lunch.', rule: 'punctuation:independent-clause' },
  { input: 'The rain stopped and the sun appeared.', expected: 'The rain stopped, and the sun appeared.', rule: 'punctuation:independent-clause' },
  { input: 'I called her but she was busy.', expected: 'I called her, but she was busy.', rule: 'punctuation:independent-clause' },
];

export const NEGATIVE_CASES: NegativeCase[] = [
  // ---- P001 negatives: dependent clause follows the main clause ----
  { input: 'I went home after I finished the report.', why: 'dependent clause is second' },
  { input: 'I left because it was late.', why: 'dependent clause is second' },
  { input: 'She called when the meeting ended.', why: 'dependent clause is second' },
  { input: 'We waited until the rain stopped.', why: 'dependent clause is second' },
  { input: 'He stayed although he was tired.', why: 'dependent clause is second' },
  { input: 'They ate before the film started.', why: 'dependent clause is second' },
  { input: 'I will call if anything changes.', why: 'dependent clause is second' },
  { input: 'She reads while the baby sleeps.', why: 'dependent clause is second' },
  { input: 'The alarm rings whenever someone enters.', why: 'dependent clause is second' },
  { input: 'We continued although it was raining.', why: 'dependent clause is second' },
  // ---- P001 negatives: no second clause ----
  { input: 'After dinner was enjoyable.', why: 'single clause; "After dinner" is a phrase' },
  { input: 'After the long delay.', why: 'fragment' },
  { input: 'Although difficult.', why: 'fragment' },
  { input: 'When in doubt ask.', why: 'no subject in either part' },
  { input: 'Before noon.', why: 'fragment' },
  { input: 'Since Monday the office has been closed.', why: '"since" as preposition of time' },
  { input: 'While useful the tool is slow.', why: 'no verb in the introductory part' },
  { input: 'If possible send it today.', why: 'no subject in the introductory part' },
  { input: 'Until then we wait.', why: 'no clause in the introductory part' },

  // ---- P002 negatives: gerund subjects and participial adjectives ----
  { input: 'Running water is useful.', why: 'gerund subject' },
  { input: 'Working software matters.', why: 'gerund subject' },
  { input: 'Finished products were shipped.', why: 'participial adjective modifying subject' },
  { input: 'Reading books improves vocabulary.', why: 'gerund subject' },
  { input: 'Boiling water burns skin.', why: 'gerund subject' },
  { input: 'Broken glass covered the floor.', why: 'participial adjective' },
  { input: 'Melting ice raises sea levels.', why: 'gerund subject' },
  { input: 'Written instructions help beginners.', why: 'participial adjective' },
  { input: 'Flying planes can be dangerous.', why: 'gerund subject' },
  { input: 'Frozen food lasts longer.', why: 'participial adjective' },
  { input: 'Having fun is important.', why: 'gerund subject with "having"' },
  { input: 'Running fast is hard.', why: 'gerund subject' },

  // ---- P003 negatives: object rather than addressee ----
  { input: "Let's call Grandma.", why: 'Grandma is the object of call' },
  { input: 'Help Dad finish dinner.', why: 'Dad is the object of help' },
  { input: 'I thanked Arjun.', why: 'statement with a subject' },
  { input: 'I saw John.', why: 'statement with a subject' },
  { input: 'We visited Grandma yesterday.', why: 'object of visit' },
  { input: 'She called Michael twice.', why: 'object of call' },
  { input: 'Please tell Sarah about it.', why: 'object of tell' },
  { input: 'I met Doctor Smith today.', why: 'object with a title' },
  { input: 'They invited Emma and Michael.', why: 'objects of invite' },
  { input: 'He asked Mom for help.', why: 'object of ask' },
  { input: 'Thank you for everything.', why: '"you" is not a vocative here' },
  { input: 'We should text John later.', why: 'object of text' },
  { input: 'She helped Grandma with the garden.', why: 'object of help' },

  // ---- P004 negatives: two items, compounds, coordinated modifiers ----
  { input: 'I bought fish and chips.', why: 'two items' },
  { input: 'I like peanut butter and jelly.', why: 'compound item' },
  { input: 'I bought red and green apples.', why: 'coordinated modifiers' },
  { input: 'Either stay or leave.', why: 'correlative construction' },
  { input: 'We sell bread and butter.', why: 'two items' },
  { input: 'The flag was red and blue.', why: 'two items' },
  { input: 'Neither rain nor snow stopped them.', why: 'correlative construction' },
  { input: 'She studies maths and physics.', why: 'two items' },
  { input: 'Both cats and dogs are welcome.', why: 'correlative construction' },
  { input: 'It was cold and wet.', why: 'two adjectives' },
  { input: 'I bought apples, oranges and pears.', why: 'already punctuated' },

  // ---- P005 negatives: no second clause ----
  { input: 'I was tired but determined.', why: 'adjective complement, not a clause' },
  { input: 'I opened and tested the extension.', why: 'shared subject' },
  { input: 'Small but powerful.', why: 'fragment' },
  { input: 'Slowly and carefully.', why: 'adverb fragment' },
  { input: 'She sang and danced all night.', why: 'shared subject' },
  { input: 'He is tall and strong.', why: 'adjective complement' },
  { input: 'We bought bread and cheese.', why: 'shared subject and object list' },
  { input: 'The dog barked and ran away.', why: 'shared subject' },
  { input: 'It was cheap but effective.', why: 'adjective complement' },
  { input: 'They laughed and cried together.', why: 'shared subject' },
  { input: 'I can swim and cycle well.', why: 'shared subject' },
  { input: 'The plan was simple yet clever.', why: 'adjective complement' },
  { input: 'She writes and edits her own work.', why: 'shared subject' },
  { input: 'Stop and think carefully.', why: 'imperative fragment' },

  // ---- P101 must never auto-apply ----
  { input: 'The book that you lent me was great.', why: '"that" is restrictive' },
  { input: 'The man who called yesterday left a message.', why: 'restrictive by default' },

  // ---- protected content ----
  { input: 'Visit https://example.com/after and it works.', why: 'URL present' },
  { input: 'Email me at john@example.com when you can.', why: 'email address' },
  { input: 'Run C:/tools/build.exe if it exists.', why: 'file path' },
  { input: 'Set timeout to 3.5 and retry twice.', why: 'decimal number' },
  { input: 'Use version 1.2.3 when you deploy.', why: 'version number' },
  { input: 'The function getValue returns null if empty.', why: 'camelCase identifier' },
  { input: 'Call snake_case_helper when ready.', why: 'code identifier' },
  { input: 'Press Ctrl+C when it hangs.', why: 'key combination' },
  { input: 'The rate was 12-14 percent last year.', why: 'numeric range' },

  // ---- headings, fragments, informal writing ----
  { input: '# Getting Started', why: 'markdown heading' },
  { input: '- first item', why: 'list bullet' },
  { input: '1. Install the extension', why: 'numbered list' },
  { input: 'CHAPTER ONE', why: 'all-caps heading' },
  { input: 'ok', why: 'too short' },
  { input: 'yeah sure', why: 'fragment' },
  { input: 'lol what', why: 'informal fragment' },
  { input: 'Steps to reproduce:', why: 'stem introducing a list' },
  { input: 'See below.', why: 'short fragment' },
  { input: 'Note the following:', why: 'stem introducing a list' },

  // ---- already correctly punctuated ----
  { input: 'After I finished the report, I went home.', why: 'already correct' },
  { input: 'I was tired, but I kept working.', why: 'already correct' },
  { input: 'Thanks, Arjun.', why: 'already correct' },
  { input: 'I bought apples, oranges, bananas, and grapes.', why: 'already correct' },
  { input: 'Having completed the test, she left.', why: 'already correct' },
  { input: 'Although it was raining, we continued.', why: 'already correct' },
  { input: 'Mom, look at this.', why: 'already correct' },
  { input: 'The build finished, and the tests passed.', why: 'already correct' },

  // ---- technical prose that must not be touched ----
  { input: 'The parser reads tokens and emits an AST.', why: 'shared subject' },
  { input: 'Install the package and run the tests.', why: 'imperative, shared subject' },
  { input: 'This function returns true or false.', why: 'two items' },
  { input: 'The cache stores keys and values.', why: 'two items' },
  { input: 'Configure the timeout and retry count.', why: 'shared subject' },
  { input: 'The API accepts JSON and returns XML.', why: 'shared subject' },
  { input: 'Open the file and read its contents.', why: 'imperative, shared subject' },

  // ---- dialogue and quoted material ----
  { input: 'He said "thanks John" quietly.', why: 'quoted material' },
  { input: 'The sign read "stop and think".', why: 'quoted material' },

  // ---- questions ----
  { input: 'Did you finish the report or not?', why: 'question with no second clause' },
  { input: 'Are you coming or staying?', why: 'question, two verbs one subject' },

  // ---- misc prose that reads like a trigger but is not ----
  { input: 'As expected the build passed.', why: '"as" excluded from introductory triggers' },
  { input: 'So we went home.', why: '"so" opening is not a joined clause' },
  { input: 'And then everything stopped.', why: 'sentence-initial coordinator' },
  { input: 'But it never worked.', why: 'sentence-initial coordinator' },
  { input: 'The more you practise the better you get.', why: 'correlative comparative' },
  { input: 'He is taller than his brother.', why: 'comparison' },
  { input: 'She works harder than anyone else.', why: 'comparison' },
  { input: 'I think that it will rain.', why: 'complement clause' },
  { input: 'We know that you tried.', why: 'complement clause' },
];
