package com.arjun.autocorrect.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import com.arjun.autocorrect.data.EngineLoader
import com.arjun.autocorrect.data.LearningStore
import com.arjun.autocorrect.data.SettingsStore
import com.arjun.autocorrect.engine.AnalyzeInput
import com.arjun.autocorrect.engine.COMMIT_CHARS
import com.arjun.autocorrect.engine.CorrectionEngine
import com.arjun.autocorrect.engine.ProposalAction
import com.arjun.autocorrect.engine.Settings
import com.arjun.autocorrect.history.CorrectionHistory
import com.arjun.autocorrect.history.CorrectionRecord
import com.arjun.autocorrect.service.ServiceDiagnostics.Stage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/**
 * The accessibility service: the Android replacement for the extension's
 * content script.
 *
 * ### The timing rule that makes this work with any keyboard
 *
 * A soft keyboard owns a *composing region* while the user is mid-word. If we
 * rewrite the field during that window, the IME's internal buffer desynchronises
 * from the field and the next keystroke produces duplicated or mangled text.
 * There is no way to see that region from outside the IME.
 *
 * So the service never corrects mid-word. It acts only on the keystroke that
 * *commits* a word - space, newline, tab or terminal punctuation - at which
 * point every mainstream keyboard has finished composing and released its
 * region. That is the same commit-character rule the browser build uses, and
 * here it is load-bearing rather than merely tidy.
 *
 * ### Loop prevention
 *
 * Our own `ACTION_SET_TEXT` produces a text-changed event indistinguishable
 * from typing. Three guards keep the service from reacting to itself:
 * an [applying] flag, a short post-write ignore window (the event is delivered
 * asynchronously, after the flag has cleared), and the per-field inverse and
 * revert guards in [FieldSession].
 */
class AutocorrectAccessibilityService : AccessibilityService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var settingsStore: SettingsStore
    private lateinit var learningStore: LearningStore
    private lateinit var history: CorrectionHistory

    /** Set for the duration of our own write. */
    @Volatile
    private var applying = false

    /** Our write's event arrives after [applying] clears, so also ignore by time. */
    @Volatile
    private var ignoreEventsUntil = 0L

    private var session: FieldSession? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this

        // Shared process-wide instances. Constructing these per component is
        // what previously left the service holding an empty allowlist for its
        // whole lifetime, no matter what the user ticked afterwards.
        settingsStore = SettingsStore.get(this)
        learningStore = LearningStore.get(this)
        history = CorrectionHistory.get(this)

        // Belt and braces over the XML config: a few OEM builds drop parts of
        // it, and a service with the wrong event mask simply never fires.
        serviceInfo = (serviceInfo ?: AccessibilityServiceInfo()).apply {
            eventTypes = AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED or
                AccessibilityEvent.TYPE_VIEW_FOCUSED or
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            // Deliberately no FLAG_RETRIEVE_INTERACTIVE_WINDOWS: we only ever
            // need the node that fired the event, never the whole window tree.
            flags = flags or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            notificationTimeout = 0
        }

        scope.launch {
            EngineLoader.ensureLoaded(this@AutocorrectAccessibilityService)
            history.sweep(settingsStore.current.historyRetentionDays)
            Log.i(TAG, "service connected; ${EngineLoader.stats()}")
        }
    }

    override fun onDestroy() {
        instance = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onInterrupt() = Unit

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> onTextChanged(event)
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            -> session = null
        }
    }

    /* --------------------------- the hot path --------------------------- */

    private fun onTextChanged(event: AccessibilityEvent) {
        // Guard 1: our own write, still in progress.
        if (applying) return
        // Guard 2: our own write's event, delivered just after the flag cleared.
        if (System.currentTimeMillis() < ignoreEventsUntil) return

        val appPackage = event.packageName?.toString() ?: return

        // Our own UI is corrected in-process by the "Try it" field, so the
        // service stays out of it - otherwise both paths would fire on the same
        // keystroke and each would see the other's edit as user input. Checked
        // before the counter so our own typing does not pollute the readout.
        if (appPackage == packageName) return

        ServiceDiagnostics.record(Stage.EVENT, appPackage)

        if (!EngineLoader.loaded) {
            ServiceDiagnostics.record(Stage.NO_NODE, appPackage, "dictionary still loading")
            return
        }
        val settings = settingsStore.current
        if (!settings.enabled) {
            ServiceDiagnostics.record(Stage.APP_NOT_ALLOWED, appPackage, "autocorrect switched off")
            return
        }
        if (!isAppAllowed(settings, appPackage)) {
            ServiceDiagnostics.record(
                Stage.APP_NOT_ALLOWED, appPackage, "not in the allowlist",
            )
            return
        }

        // Some apps deliver a text-changed event whose source is null; the
        // focused input is the right node in that case.
        val node = event.source
            ?: findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: run {
                ServiceDiagnostics.record(
                    Stage.NO_NODE, appPackage, "event carried no editable node",
                )
                return
            }

        try {
            val text = NodeEditor.currentText(node)
            if (text == null) {
                ServiceDiagnostics.record(Stage.NO_NODE, appPackage, "node exposes no text")
                return
            }

            val verdict = FieldGuard.inspect(node, text.length)
            if (verdict != FieldGuard.Verdict.ALLOWED) {
                ServiceDiagnostics.record(Stage.FIELD_REJECTED, appPackage, verdict.name)
                return
            }

            val caret = NodeEditor.caretOf(node, text.length)
            val active = sessionFor(node, appPackage)

            // Only a commit character triggers a pass, and only when it is the
            // character immediately behind the caret - that is what tells us
            // the keyboard has released its composing region.
            if (caret <= 0 || caret > text.length) {
                active.lastSeenText = text
                return
            }
            val committed = text[caret - 1]
            if (committed !in COMMIT_CHARS) {
                active.lastSeenText = text
                ServiceDiagnostics.record(
                    Stage.WAITING_FOR_COMMIT, appPackage, "typing; no commit character yet",
                )
                return
            }

            // The word ends where the commit character begins.
            val wordEnd = caret - 1
            active.lastSeenText = text
            if (wordEnd <= 0) return

            correctAt(node, text, wordEnd, caret, appPackage, active, settings)
        } finally {
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                runCatching { node.recycle() }
            }
        }
    }

    private fun correctAt(
        node: AccessibilityNodeInfo,
        text: String,
        wordEnd: Int,
        caret: Int,
        appPackage: String,
        active: FieldSession,
        settings: Settings,
    ) {
        val word = text.substring(0, wordEnd).takeLastWhile { !it.isWhitespace() }
        ServiceDiagnostics.record(Stage.ANALYSED, appPackage, "\"$word\"")

        val result = CorrectionEngine.analyze(
            AnalyzeInput(text = text, wordEnd = wordEnd, origin = appPackage),
            learningStore.current,
            settings,
        )
        if (result == null) {
            ServiceDiagnostics.record(Stage.NO_PROPOSAL, appPackage, "\"$word\" needs no change")
            return
        }

        val proposal = result.proposal
        // A suggestion has nowhere to render without drawing over another app,
        // so this build acts on automatic corrections only.
        if (proposal.action != ProposalAction.AUTOCORRECT) {
            ServiceDiagnostics.record(
                Stage.SUGGESTION_ONLY,
                appPackage,
                "${proposal.original} → ${proposal.replacement} " +
                    "(${(proposal.confidence * 100).toInt()}%, below threshold)",
            )
            return
        }

        // Per-field guards: never fight the user's own correction.
        if (active.isInverseOfRecent(proposal.original, proposal.replacement, proposal.start)) return
        if (active.isRecentlyReverted(proposal.original, proposal.start)) return

        applying = true
        val outcome = try {
            NodeEditor.replaceRange(
                node = node,
                expectedBefore = text,
                start = proposal.start,
                end = proposal.end,
                insert = proposal.replacement,
                caretBefore = caret,
            )
        } finally {
            applying = false
            ignoreEventsUntil = System.currentTimeMillis() + SELF_EVENT_WINDOW_MILLIS
        }

        when (outcome) {
            is NodeEditor.Outcome.Applied -> {
                active.lastSeenText = outcome.finalText
                ServiceDiagnostics.record(
                    Stage.APPLIED,
                    appPackage,
                    "${proposal.original} → ${proposal.replacement}",
                )

                // The record is created here and only here, inside the same
                // block that performed the edit: text changed if and only if
                // exactly one record exists.
                val record = CorrectionRecord(
                    id = UUID.randomUUID().toString(),
                    original = proposal.original,
                    replacement = proposal.replacement,
                    correctionType = proposal.correctionType,
                    source = proposal.source,
                    confidence = proposal.confidence,
                    reason = proposal.reason,
                    process = proposal.process,
                    appPackage = appPackage,
                    offset = proposal.start,
                    textBefore = windowBefore(text, proposal.start, settings.contextRadius),
                    textAfter = windowAfter(text, proposal.end, settings.contextRadius),
                    createdAt = System.currentTimeMillis(),
                )
                history.add(record)
                active.rememberApplied(
                    FieldSession.AppliedCorrection(
                        original = proposal.original,
                        replacement = proposal.replacement,
                        start = proposal.start,
                        recordId = record.id,
                        atMillis = System.currentTimeMillis(),
                    ),
                )
                if (settings.learnFromDecisions) {
                    learningStore.recordAccepted(
                        proposal.original.lowercase(),
                        proposal.replacement,
                        result.context.previousWord,
                    )
                }
                announce(settings, proposal.original, proposal.replacement)
            }

            is NodeEditor.Outcome.Declined ->
                ServiceDiagnostics.record(Stage.WRITE_FAILED, appPackage, outcome.reason)

            is NodeEditor.Outcome.RolledBack -> {
                ServiceDiagnostics.record(Stage.WRITE_FAILED, appPackage, outcome.reason)
                Log.w(TAG, "correction rolled back: ${outcome.reason}")
            }

            is NodeEditor.Outcome.Corrupted -> {
                ServiceDiagnostics.record(Stage.WRITE_FAILED, appPackage, outcome.reason)
                // Loud on purpose: this is the case where the user's text is
                // not what either of us intended.
                Log.e(TAG, "FIELD LEFT INCONSISTENT: ${outcome.reason}")
            }
        }
    }

    /* ------------------------------ helpers ------------------------------ */

    private fun sessionFor(node: AccessibilityNodeInfo, appPackage: String): FieldSession {
        val key = FieldGuard.fieldKey(node, appPackage)
        val existing = session
        if (existing != null && existing.key == key) return existing
        return FieldSession(key, appPackage).also { session = it }
    }

    /**
     * An app is eligible when the user allowlisted it and has not since
     * switched it off. Absence from the allowlist is a "no": this service
     * starts with access to nothing.
     */
    private fun isAppAllowed(settings: Settings, appPackage: String): Boolean {
        if (settings.appOverrides[appPackage] == "off") return false
        return appPackage in settings.allowedApps
    }

    private fun windowBefore(text: String, start: Int, radius: Int): String {
        if (radius <= 0) return ""
        return text.substring(max(0, start - radius), start)
    }

    private fun windowAfter(text: String, end: Int, radius: Int): String {
        if (radius <= 0) return ""
        return text.substring(end, min(text.length, end + radius))
    }

    private fun announce(settings: Settings, original: String, replacement: String) {
        if (settings.vibrateOnCorrection) vibrate()
        if (settings.showCorrectionToast) {
            Toast.makeText(this, "$original → $replacement", Toast.LENGTH_SHORT).show()
        }
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VibratorManager::class.java))?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        } ?: return
        runCatching {
            vibrator.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    /* --------------------------- app-facing API --------------------------- */

    /**
     * Reverts the most recent correction in [appPackage], if the field that
     * received it is still focused and still contains what we wrote.
     *
     * Nothing is ever reverted from a stale offset: the text at the recorded
     * position must still be the replacement, or the record is marked
     * unresolved and the user is told why.
     */
    fun revertLast(appPackage: String): Boolean {
        val record = history.mostRecentPending(appPackage) ?: return false
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        try {
            val text = NodeEditor.currentText(node) ?: return false
            if (!FieldGuard.isAllowed(node, text.length)) return false

            val start = record.offset
            val end = start + record.replacement.length
            if (end > text.length || !text.regionMatches(
                    start, record.replacement, 0, record.replacement.length, ignoreCase = true,
                )
            ) {
                history.updateStatus(
                    record.id,
                    com.arjun.autocorrect.history.RecordStatus.UNRESOLVED,
                    "the text at this position is no longer what was written",
                )
                return false
            }

            applying = true
            val outcome = try {
                NodeEditor.replaceRange(
                    node = node,
                    expectedBefore = text,
                    start = start,
                    end = end,
                    insert = record.original,
                    caretBefore = NodeEditor.caretOf(node, text.length),
                )
            } finally {
                applying = false
                ignoreEventsUntil = System.currentTimeMillis() + SELF_EVENT_WINDOW_MILLIS
            }

            if (outcome is NodeEditor.Outcome.Applied) {
                history.updateStatus(record.id, com.arjun.autocorrect.history.RecordStatus.REVERTED)
                session?.rememberRevert(record.original, start)
                return true
            }
            return false
        } finally {
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                runCatching { node.recycle() }
            }
        }
    }

    companion object {
        private const val TAG = "AutocorrectService"

        /**
         * How long to ignore text-changed events after our own write.
         *
         * The event is dispatched asynchronously by the owning app, so it can
         * arrive several milliseconds after `performAction` returns and the
         * `applying` flag has already cleared.
         */
        private const val SELF_EVENT_WINDOW_MILLIS = 250L

        @Volatile
        var instance: AutocorrectAccessibilityService? = null
            private set

        val isRunning: Boolean get() = instance != null
    }
}
