package com.arjun.autocorrect.engine

/** Bounded Damerau-Levenshtein plus the edit-shape classifiers used for scoring. */

/**
 * Optimal string alignment distance (adjacent transposition counts as 1).
 *
 * Returns `max + 1` as soon as the distance provably exceeds [max], so the
 * typing hot path never pays for a long comparison it is going to discard.
 */
fun damerauLevenshtein(a: String, b: String, max: Int = Int.MAX_VALUE): Int {
    if (a == b) return 0
    val al = a.length
    val bl = b.length
    if (kotlin.math.abs(al - bl) > max) return if (max == Int.MAX_VALUE) max else max + 1
    if (al == 0) return bl
    if (bl == 0) return al

    var prevPrev = IntArray(bl + 1)
    var prev = IntArray(bl + 1)
    var curr = IntArray(bl + 1)
    for (j in 0..bl) prev[j] = j

    for (i in 1..al) {
        curr[0] = i
        var rowMin = curr[0]
        val ca = a[i - 1]
        for (j in 1..bl) {
            val cost = if (ca == b[j - 1]) 0 else 1
            var v = minOf(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            if (i > 1 && j > 1 && ca == b[j - 2] && a[i - 2] == b[j - 1]) {
                v = minOf(v, prevPrev[j - 2] + 1)
            }
            curr[j] = v
            if (v < rowMin) rowMin = v
        }
        if (rowMin > max) return max + 1
        val spare = prevPrev
        prevPrev = prev
        prev = curr
        curr = spare
    }
    return prev[bl]
}

enum class EditShape {
    IDENTICAL,
    TRANSPOSITION,
    /** `typed` has an extra letter. */
    DELETION,
    /** `typed` is missing a letter. */
    INSERTION,
    SUBSTITUTION,
    /** "lettter" -> "letter". */
    DOUBLED,
    OTHER,
}

/** Classifies the single-edit relationship between [typed] and [candidate]. */
fun classifyEdit(typed: String, candidate: String): EditShape {
    if (typed == candidate) return EditShape.IDENTICAL
    val t = typed.lowercase()
    val c = candidate.lowercase()
    if (t == c) return EditShape.IDENTICAL

    if (t.length == c.length) {
        val diffs = ArrayList<Int>(2)
        for (i in t.indices) {
            if (t[i] != c[i]) {
                diffs.add(i)
                // Three differences already rules out every single-edit shape.
                if (diffs.size > 2) return EditShape.OTHER
            }
        }
        if (diffs.size == 1) return EditShape.SUBSTITUTION
        if (diffs.size == 2 && diffs[1] == diffs[0] + 1) {
            val i = diffs[0]
            if (t[i] == c[i + 1] && t[i + 1] == c[i]) return EditShape.TRANSPOSITION
        }
        return EditShape.OTHER
    }

    if (t.length == c.length + 1) {
        val idx = firstDiff(t, c)
        if (t.substring(0, idx) + t.substring(idx + 1) == c) {
            // Removing a duplicated letter is a distinct, very common shape.
            if (idx > 0 && t[idx] == t[idx - 1]) return EditShape.DOUBLED
            return EditShape.DELETION
        }
        return EditShape.OTHER
    }

    if (c.length == t.length + 1) {
        val idx = firstDiff(t, c)
        if (c.substring(0, idx) + c.substring(idx + 1) == t) return EditShape.INSERTION
        return EditShape.OTHER
    }
    return EditShape.OTHER
}

private fun firstDiff(a: String, b: String): Int {
    val n = minOf(a.length, b.length)
    var i = 0
    while (i < n && a[i] == b[i]) i++
    return i
}

/** True when the two words differ only by one adjacent swap ("waht"/"what"). */
fun isTransposition(a: String, b: String): Boolean =
    classifyEdit(a, b) == EditShape.TRANSPOSITION
