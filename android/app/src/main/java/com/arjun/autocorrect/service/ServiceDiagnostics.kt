package com.arjun.autocorrect.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A rolling window of what the service most recently did, and why.
 *
 * Accessibility failures are invisible by nature: an app that exposes no
 * editable node, a field that rejects `ACTION_SET_TEXT`, or a package that was
 * never allowlisted all look identical from the outside - nothing happens. This
 * records the reason at each decision point so the settings screen can show it
 * rather than leaving the user guessing.
 *
 * Deliberately keeps no field *contents*: only package names, verdicts and the
 * word pair of an applied correction, which the history already stores.
 */
object ServiceDiagnostics {

    private const val MAX_ENTRIES = 30

    enum class Stage {
        /** An event arrived from a package. */
        EVENT,

        /** The package is not on the allowlist, or is switched off. */
        APP_NOT_ALLOWED,

        /** The field was rejected by [FieldGuard]. */
        FIELD_REJECTED,

        /** No editable node could be obtained from the event. */
        NO_NODE,

        /** Text changed, but the last character was not a commit character. */
        WAITING_FOR_COMMIT,

        /** A word committed and the engine was asked for a proposal. */
        ANALYSED,

        /** The engine declined to propose anything. */
        NO_PROPOSAL,

        /** A proposal existed but was below the automatic threshold. */
        SUGGESTION_ONLY,

        /** A correction was written and verified. */
        APPLIED,

        /** The write failed or was rolled back. */
        WRITE_FAILED,
    }

    data class Entry(
        val stage: Stage,
        val appPackage: String,
        val detail: String,
        val atMillis: Long = System.currentTimeMillis(),
    )

    private val _entries = MutableStateFlow<List<Entry>>(emptyList())
    val entries: StateFlow<List<Entry>> = _entries.asStateFlow()

    @Volatile
    var totalEvents: Long = 0
        private set

    @Volatile
    var totalCorrections: Long = 0
        private set

    /** Packages that have sent at least one text-changed event this session. */
    private val seenPackages = LinkedHashSet<String>()

    fun packagesSeen(): List<String> = synchronized(seenPackages) { seenPackages.toList() }

    fun record(stage: Stage, appPackage: String, detail: String = "") {
        if (stage == Stage.EVENT) {
            totalEvents++
            synchronized(seenPackages) {
                seenPackages.add(appPackage)
                while (seenPackages.size > 20) {
                    seenPackages.remove(seenPackages.first())
                }
            }
            // Raw events are counted but not listed: at one entry per keystroke
            // they would push every meaningful verdict out of the window.
            return
        }
        if (stage == Stage.APPLIED) totalCorrections++

        // Collapse consecutive identical verdicts so a long typing run does not
        // bury the earlier stages under thirty copies of the same line.
        val current = _entries.value
        val head = current.firstOrNull()
        if (head != null && head.stage == stage && head.appPackage == appPackage &&
            head.detail == detail && stage != Stage.APPLIED
        ) {
            return
        }
        _entries.value = (listOf(Entry(stage, appPackage, detail)) + current).take(MAX_ENTRIES)
    }

    fun clear() {
        _entries.value = emptyList()
        totalEvents = 0
        totalCorrections = 0
        synchronized(seenPackages) { seenPackages.clear() }
    }
}
