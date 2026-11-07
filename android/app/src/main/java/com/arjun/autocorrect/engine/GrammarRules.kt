package com.arjun.autocorrect.engine

/**
 * A tiny set of local, deterministic grammar rules. Everything here must be
 * decidable from two adjacent words - no parsing, no model.
 */

/** Words starting with a consonant letter but a vowel sound. */
private val H_VOWEL = setOf(
    "hour", "hours", "honest", "honestly", "honor", "honour", "honorable", "heir", "heiress",
)

/** Words starting with a vowel letter but a consonant sound ("yu-", "wun-"). */
private val U_CONSONANT = Regex(
    "^(u(ni|se|su|til|tili|ropean|ranium|nion|nique|nit|niform|niversal|niversity|sual|tensil)|eu|one|once)",
)

fun indefiniteArticleFor(word: String): String? {
    val w = word.lowercase()
    if (w.isEmpty()) return null
    if (w in H_VOWEL) return "an"
    val first = w[0]
    if (first == 'h') return null // ambiguous ("historic"): leave alone
    if (first in "aeiou") {
        if (U_CONSONANT.containsMatchIn(w)) return "a"
        if (first == 'u') return null // other u-words are too risky to judge
        return "an"
    }
    if (first in "bcdfgjklmnpqrstvwxyz") return "a"
    return null
}

data class GrammarFix(
    val start: Int,
    val end: Int,
    val original: String,
    val replacement: String,
    val confidence: Double,
    val reason: String,
)

/**
 * Checks the article immediately before the word at `[start, end)`.
 * "a apple" -> "an apple"; "an car" -> "a car".
 */
fun checkArticle(text: String, start: Int, end: Int): GrammarFix? {
    val noun = text.substring(start, end)
    if (noun.isEmpty() || !noun[0].isLetter()) return null

    var i = start
    while (i > 0 && (text[i - 1] == ' ' || text[i - 1] == '\t')) i--
    if (i == start) return null // no whitespace gap: not "a apple"
    val prev = Tokenizer.wordEndingAt(text, i) ?: return null
    val prevLower = prev.text.lowercase()
    if (prevLower != "a" && prevLower != "an") return null

    val wanted = indefiniteArticleFor(noun) ?: return null
    if (wanted == prevLower) return null

    return GrammarFix(
        start = prev.start,
        end = prev.end,
        original = prev.text,
        replacement = matchCase(prev.text, wanted),
        confidence = 0.93,
        reason = "\"$wanted\" is used before \"${noun.lowercase()}\"",
    )
}
