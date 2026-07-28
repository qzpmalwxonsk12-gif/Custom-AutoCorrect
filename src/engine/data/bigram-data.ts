/**
 * GENERATED FILE - DO NOT EDIT.
 * Run `npm run generate:bigrams` to rebuild from
 * vendor/character-ngrams/en_bigrams.txt.
 *
 * A 26x26 table of log-scaled letter-pair plausibility, base64-encoded so it
 * costs one small string rather than 676 object properties. Index is
 * `first * 26 + second` over 'a'..'z'. Zero means the pair is unattested in
 * the source, which is weak evidence of strangeness - never a veto.
 */

export const BIGRAM_TABLE_BASE64 =
  'rMza157EzLHVn8Lp2PWczIvr6e7By7yZ0pzMmot73G9jfb6JW8iBdct3O8Cokct4ezDCQ9yKt43ciIDcy2PIxImB4o99w6jSv3OHO6Rq2sW8veK9s7/enZW3urbUuInE0NjEpsFbsXTszuHt29TLydims9/a7tXVqffx5rvQ1sTJk8ufqpzMxZmq0oiFtqaV26Vmy7DVuIaiVJ1d0aWnn9apqc7IgH60pbPLpWrIvMm8gapPoVzooqme/J6Rp+OBg6WnqNyhdbyzy7aCqEKpYc+03tTTxM6YmIS02tD53bmJ0unpl82gn3SurFRZV6lMS1aNUE5LV061XxRwYlW3RVAUPC+2kpCI0JWDmcRveJ6Trq2OTpS5qZRumzqWSd+zss/ltaCm34Sl4LGc17RvqszHv6atUNVp3r2jk+KbiZvTenaTu5bUylaZvLe7eqBOr1Pgu9ft4sHpvNqnt7u8wtu3hLPe77uxvm++iMbFycm05b65wpm61d3xz9B47dXc5cnWma6F0o6QiNeQg7bDZnHOoHrSwVPUs7y8ZpVAj0duW0hEPUUsS24gKEZLNEY9LD1WUb42YBU4AeO5yM3yusC345W/wMnI5Lt9xN7ewrW5Ysx35MPQvOXFsNnhm7LBw73g0J262/DPn8xnsXDivMKy67mq/+uWmMO8re24fdjb3MuazFvKib+3xLrBm8CMunKUz7/XmcJY2tjXa4ONfJV9vVxqceRbWl3NSkpmYF+xayJ0gmtxV2UxhS3Zj5KR1Ix70td0fJmUu82LUaavp4BsmjiWaKBzmmqZd2J+okhNanlgg607cn2qfF14YHMoyLW4sMayorK/jo+vtKnNtHKvyceakLlRjHCgZ2NerFxadplBWXBlWZFdPF5zaXdObSx1hA==';

export const BIGRAM_METADATA = Object.freeze({
  sourceFile: 'vendor/character-ngrams/en_bigrams.txt',
  sourceEntries: 676,
  invalidEntries: 0,
  distinctPairs: 676,
  attestedPairs: 676,
  tableSize: 676,
  scale: 'log',
  sourceSha256: '2aaff9199b00f76af26614d8362ae309def18326e4e329b41cf1f35539880624',
});
