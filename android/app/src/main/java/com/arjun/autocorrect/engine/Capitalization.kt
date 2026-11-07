package com.arjun.autocorrect.engine

/** Capitalisation is preserved by *style*, never by copying characters. */

enum class CaseStyle { LOWER, TITLE, UPPER, MIXED }

fun detectCaseStyle(word: String): CaseStyle {
    if (!word.any { it.isLetter() }) return CaseStyle.LOWER
    if (word == word.lowercase()) return CaseStyle.LOWER
    if (word == word.uppercase()) return CaseStyle.UPPER
    val head = word.first()
    if (head.uppercaseChar() == head && word.drop(1) == word.drop(1).lowercase()) {
        return CaseStyle.TITLE
    }
    return CaseStyle.MIXED
}

fun applyCaseStyle(target: String, style: CaseStyle): String = when (style) {
    CaseStyle.UPPER -> target.uppercase()
    CaseStyle.TITLE ->
        if (target.isEmpty()) target
        else target.first().uppercaseChar() + target.drop(1).lowercase()
    CaseStyle.LOWER -> target.lowercase()
    CaseStyle.MIXED -> target
}

/**
 * Rewrites [target] so it wears the same capitalisation as [observed].
 * "Waht" + "what" -> "What"; "WAHT" -> "WHAT"; "waht" -> "what".
 */
fun matchCase(observed: String, target: String): String {
    val style = detectCaseStyle(observed)
    return if (style == CaseStyle.MIXED) target else applyCaseStyle(target, style)
}

/** Forces a leading capital, used at sentence starts. */
fun capitalise(word: String): String =
    if (word.isEmpty()) word else word.first().uppercaseChar() + word.drop(1)
