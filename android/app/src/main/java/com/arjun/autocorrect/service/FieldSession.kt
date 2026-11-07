package com.arjun.autocorrect.service

/**
 * Per-field state for loop prevention.
 *
 * On Android a session is scoped to one input connection and ends at focus
 * change, so this is deliberately small. Its whole job is to stop the service
 * from fighting the user or itself.
 */
class FieldSession(val key: String, val appPackage: String) {

    /** Last text we observed, used to tell our own writes from the user's. */
    var lastSeenText: String = ""

    /** Corrections applied in this field, newest first. */
    private val applied = ArrayDeque<AppliedCorrection>()

    /** Words the user put back by hand, with when and where. */
    private val reverts = ArrayDeque<RevertGuard>()

    data class AppliedCorrection(
        val original: String,
        val replacement: String,
        val start: Int,
        val recordId: String,
        val atMillis: Long,
    )

    data class RevertGuard(val word: String, val start: Int, val atMillis: Long)

    fun rememberApplied(correction: AppliedCorrection) {
        applied.addFirst(correction)
        while (applied.size > MAX_REMEMBERED) applied.removeLast()
    }

    fun mostRecentApplied(): AppliedCorrection? = applied.firstOrNull()

    /**
     * True when this proposal is the exact inverse of something we just did at
     * the same place.
     *
     * Without this, a correction the user immediately typed back by hand gets
     * re-applied on the next space, and the field oscillates.
     */
    fun isInverseOfRecent(original: String, replacement: String, start: Int): Boolean {
        val now = System.currentTimeMillis()
        return applied.any { previous ->
            now - previous.atMillis < INVERSE_WINDOW_MILLIS &&
                previous.start == start &&
                previous.original.equals(replacement, ignoreCase = true) &&
                previous.replacement.equals(original, ignoreCase = true)
        }
    }

    /** The user manually restored this word here; do not correct it again yet. */
    fun rememberRevert(word: String, start: Int) {
        reverts.addFirst(RevertGuard(word.lowercase(), start, System.currentTimeMillis()))
        while (reverts.size > MAX_REMEMBERED) reverts.removeLast()
    }

    /**
     * True while a manual revert of this word at this position is still recent.
     *
     * This covers the window before the learning update has been persisted and
     * republished - without it the engine would "helpfully" undo the user's
     * correction of its own correction.
     */
    fun isRecentlyReverted(word: String, start: Int): Boolean {
        val now = System.currentTimeMillis()
        val lower = word.lowercase()
        return reverts.any { guard ->
            now - guard.atMillis < REVERT_WINDOW_MILLIS &&
                guard.word == lower &&
                kotlin.math.abs(guard.start - start) <= POSITION_TOLERANCE
        }
    }

    companion object {
        private const val MAX_REMEMBERED = 12
        private const val INVERSE_WINDOW_MILLIS = 10_000L

        /** Five minutes, matching the browser build's revert guard. */
        private const val REVERT_WINDOW_MILLIS = 5 * 60 * 1000L

        /** Offsets drift as the user edits; an exact match is too strict. */
        private const val POSITION_TOLERANCE = 3
    }
}
