package com.arjun.autocorrect.ui

import android.text.Editable
import android.text.TextWatcher
import android.widget.EditText
import com.arjun.autocorrect.data.LearningStore
import com.arjun.autocorrect.data.SettingsStore
import com.arjun.autocorrect.engine.AnalyzeInput
import com.arjun.autocorrect.engine.COMMIT_CHARS
import com.arjun.autocorrect.engine.CorrectionEngine
import com.arjun.autocorrect.engine.Dictionary
import com.arjun.autocorrect.engine.ProposalAction

/**
 * Runs the correction engine directly on an [EditText], with no accessibility
 * service involved.
 *
 * This backs the "Try it" field, and it exists to make failures diagnosable. If
 * this field corrects text but a real app does not, the engine is fine and the
 * problem is in the service, the allowlist or that app's node tree. If this
 * field does not correct either, the problem is the engine or its assets. One
 * screen tells you which half to look at.
 *
 * It uses exactly the same commit-character rule as the service, so it
 * exercises the real decision path rather than a simplified one.
 */
class InAppCorrector(
    private val field: EditText,
    private val onCorrection: (original: String, replacement: String, reason: String) -> Unit,
) : TextWatcher {

    /** Set while we rewrite the field, so our own edit is not re-analysed. */
    private var applying = false

    private val settingsStore = SettingsStore.get(field.context)
    private val learningStore = LearningStore.get(field.context)

    /** Our own package, used as the engine's origin. */
    private val origin: String = field.context.packageName

    fun attach() = field.addTextChangedListener(this)

    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit

    override fun afterTextChanged(editable: Editable?) {
        if (applying || editable == null) return
        if (!Dictionary.isReady) return

        val settings = settingsStore.current
        if (!settings.enabled) return

        val text = editable.toString()
        val caret = field.selectionEnd
        if (caret <= 1 || caret > text.length) return

        // Same rule as the service: act only once the word has been committed.
        if (text[caret - 1] !in COMMIT_CHARS) return
        val wordEnd = caret - 1

        val result = CorrectionEngine.analyze(
            AnalyzeInput(text = text, wordEnd = wordEnd, origin = origin),
            learningStore.current,
            settings,
        ) ?: return

        val proposal = result.proposal
        if (proposal.action != ProposalAction.AUTOCORRECT) return
        // The field must still hold exactly what was analysed.
        if (editable.length < proposal.end) return
        if (editable.subSequence(proposal.start, proposal.end).toString() != proposal.original) {
            return
        }

        applying = true
        try {
            editable.replace(proposal.start, proposal.end, proposal.replacement)
            val delta = proposal.replacement.length - (proposal.end - proposal.start)
            field.setSelection((caret + delta).coerceIn(0, editable.length))
        } finally {
            applying = false
        }

        onCorrection(proposal.original, proposal.replacement, proposal.reason)
    }
}
