package com.arjun.autocorrect.service

import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The single write path.
 *
 * Every engine - spelling, grammar, context, a personal rule - reaches the
 * user's text through [replaceRange] and nowhere else. That is what makes the
 * history invariant enforceable: the text is modified **if and only if**
 * exactly one record exists.
 *
 * ### Why this is harder than the browser version
 *
 * `ACTION_SET_TEXT` replaces the *entire* field. There is no ranged edit in the
 * accessibility API, so a one-word correction is expressed as "here is the
 * whole field again, slightly different". Three consequences drive the design:
 *
 *  1. **Verify, then keep or roll back.** We compute the exact text we expect,
 *     write it, re-read the node, and compare. Anything else - the app
 *     reformatted, the IME raced us, the field rejected the action - is a
 *     failure, and we put the original text back rather than leaving a mangled
 *     field behind.
 *  2. **Caret restoration is mandatory.** SET_TEXT commonly parks the cursor at
 *     the end, which would silently teleport the user mid-sentence.
 *  3. **Composing state belongs to the keyboard.** We only ever write after a
 *     commit character, when no IME composing region should be active. That is
 *     enforced by the caller, and it is the single most important reason this
 *     approach works with arbitrary keyboards at all.
 */
object NodeEditor {

    private const val TAG = "NodeEditor"

    sealed interface Outcome {
        /** The edit landed and was verified against the field's own text. */
        data class Applied(val finalText: String, val caret: Int) : Outcome

        /** Nothing was written; the field is untouched. */
        data class Declined(val reason: String) : Outcome

        /** The write produced unexpected text and the original was restored. */
        data class RolledBack(val reason: String) : Outcome

        /**
         * The write produced unexpected text and the rollback *also* failed.
         * The worst case, and the one that must never be silent.
         */
        data class Corrupted(val reason: String) : Outcome
    }

    fun currentText(node: AccessibilityNodeInfo?): String? {
        if (node == null) return null
        return node.text?.toString()
    }

    /**
     * Caret position, clamped into the text. Falls back to the end of the field
     * when the app reports no selection, which several editors do.
     */
    fun caretOf(node: AccessibilityNodeInfo, textLength: Int): Int {
        val end = node.textSelectionEnd
        if (end < 0 || end > textLength) return textLength
        return end
    }

    /**
     * Replaces `[start, end)` with [insert], verifying what the field actually
     * ended up containing.
     *
     * [expectedBefore] is the text the proposal was built from; if the field no
     * longer holds it, the user typed while we were deciding and the edit is
     * abandoned untouched.
     */
    fun replaceRange(
        node: AccessibilityNodeInfo,
        expectedBefore: String,
        start: Int,
        end: Int,
        insert: String,
        /** Where the caret was before the edit, so it can be mapped forward. */
        caretBefore: Int,
    ): Outcome {
        if (start < 0 || end < start || end > expectedBefore.length) {
            return Outcome.Declined("range out of bounds")
        }

        // 1. The field must still hold exactly what we analysed.
        val live = currentText(node)
            ?: return Outcome.Declined("node has no text")
        if (live != expectedBefore) return Outcome.Declined("field changed since analysis")

        val expectedAfter = buildString(live.length - (end - start) + insert.length) {
            append(live, 0, start)
            append(insert)
            append(live, end, live.length)
        }
        if (expectedAfter == live) return Outcome.Declined("no-op")

        // 2. Write. From here on the field may be in either state, so every
        //    path below must leave it in a known one.
        if (!setText(node, expectedAfter)) {
            return Outcome.Declined("editor refused ACTION_SET_TEXT")
        }

        // 3. Verify against what the host actually rendered. Some editors
        //    normalise whitespace, which is acceptance, not rejection.
        val observed = readBack(node)
            ?: return Outcome.Corrupted("could not read the field back after writing")

        if (!textsMatch(observed, expectedAfter)) {
            // 4. Put it back exactly as we found it.
            return if (setText(node, live) && textsMatch(readBack(node) ?: "", live)) {
                Outcome.RolledBack("host rewrote the field; original restored")
            } else {
                Log.e(TAG, "rollback failed; field left in an unexpected state")
                Outcome.Corrupted("host rewrote the field and rollback failed")
            }
        }

        // 5. Map the caret across the edit and restore it.
        val delta = insert.length - (end - start)
        val caretAfter = when {
            caretBefore <= start -> caretBefore
            caretBefore >= end -> caretBefore + delta
            // The caret was inside the replaced span: put it at the new end.
            else -> start + insert.length
        }.coerceIn(0, observed.length)
        setSelection(node, caretAfter)

        return Outcome.Applied(observed, caretAfter)
    }

    private fun setText(node: AccessibilityNodeInfo, text: String): Boolean {
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return runCatching {
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }.getOrElse {
            Log.w(TAG, "ACTION_SET_TEXT threw", it)
            false
        }
    }

    fun setSelection(node: AccessibilityNodeInfo, position: Int): Boolean {
        val args = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, position)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, position)
        }
        return runCatching {
            node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, args)
        }.getOrElse { false }
    }

    /** Re-reads the node's text after refreshing it from the owning app. */
    private fun readBack(node: AccessibilityNodeInfo): String? {
        runCatching { node.refresh() }
        return currentText(node)
    }

    /**
     * Whitespace-normalised comparison.
     *
     * A host that turns our space into a non-breaking space has accepted the
     * edit, not rejected it; treating that as corruption would roll back every
     * correction in several popular editors.
     */
    private fun textsMatch(a: String, b: String): Boolean {
        if (a == b) return true
        return normaliseWhitespace(a) == normaliseWhitespace(b)
    }

    /** No-break (U+00A0), figure, narrow no-break and thin spaces. */
    private val FOLDED_SPACES = charArrayOf('\u00A0', '\u2007', '\u202F', '\u2009')

    private fun normaliseWhitespace(value: String): String {
        var out = value
        for (space in FOLDED_SPACES) out = out.replace(space, ' ')
        return out
    }
}
