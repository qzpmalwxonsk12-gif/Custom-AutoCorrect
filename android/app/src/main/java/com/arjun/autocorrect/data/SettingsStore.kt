package com.arjun.autocorrect.data

import android.content.Context
import android.content.SharedPreferences
import com.arjun.autocorrect.engine.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Durable settings, published as a [StateFlow].
 *
 * ### Why this is a singleton
 *
 * It used to be constructed per component: once by the service, once by
 * [com.arjun.autocorrect.ui.MainActivity], once by the app picker. Each copy
 * cached its own snapshot at construction and only refreshed on its *own*
 * writes, so ticking an app in the picker updated the picker's copy and nothing
 * else. The settings screen kept reporting "no apps chosen", and - far worse -
 * the accessibility service kept the empty allowlist it had read at
 * `onServiceConnected` and silently declined every field in every app.
 *
 * The service and the UI share one process, so one instance is both correct and
 * sufficient. The change listener below is the second line of defence: it keeps
 * the snapshot honest even if something writes to the file behind our back.
 */
class SettingsStore private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(read())
    val settings: StateFlow<Settings> = _settings.asStateFlow()

    val current: Settings get() = _settings.value

    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        _settings.value = read()
    }

    init {
        prefs.registerOnSharedPreferenceChangeListener(listener)
    }

    private fun read(): Settings = Settings(
        enabled = prefs.getBoolean(KEY_ENABLED, true),
        contextualEnabled = prefs.getBoolean(KEY_CONTEXTUAL, true),
        contextualAutocorrect = prefs.getBoolean(KEY_CONTEXTUAL_AUTO, false),
        grammarEnabled = prefs.getBoolean(KEY_GRAMMAR, true),
        capitalisationEnabled = prefs.getBoolean(KEY_CAPITALISATION, true),
        autocorrectThreshold = prefs.getFloat(KEY_AUTO_THRESHOLD, 0.85f).toDouble(),
        suggestionThreshold = prefs.getFloat(KEY_SUGGEST_THRESHOLD, 0.60f).toDouble(),
        learnFromDecisions = prefs.getBoolean(KEY_LEARN_DECISIONS, true),
        learnFromManualEdits = prefs.getBoolean(KEY_LEARN_MANUAL, true),
        manualEditEvidence = prefs.getInt(KEY_MANUAL_EVIDENCE, 3),
        contextRadius = prefs.getInt(KEY_CONTEXT_RADIUS, 32),
        historyRetentionDays = prefs.getInt(KEY_RETENTION, 30),
        allowedApps = prefs.getStringSet(KEY_ALLOWED_APPS, emptySet())?.toSet() ?: emptySet(),
        appOverrides = readOverrides(),
        vibrateOnCorrection = prefs.getBoolean(KEY_VIBRATE, false),
        showCorrectionToast = prefs.getBoolean(KEY_TOAST, false),
    )

    private fun readOverrides(): Map<String, String> {
        val raw = prefs.getStringSet(KEY_APP_OVERRIDES, emptySet()) ?: emptySet()
        return raw.mapNotNull { entry ->
            val i = entry.indexOf('=')
            if (i <= 0) null else entry.substring(0, i) to entry.substring(i + 1)
        }.toMap()
    }

    /**
     * Applies [transform] and persists the result.
     *
     * `commit()` rather than `apply()`: the accessibility service reads this on
     * the very next keystroke, and an asynchronous write is a race we would
     * lose in exactly the case that matters.
     */
    @Suppress("ApplySharedPref")
    fun update(transform: (Settings) -> Settings) {
        val next = transform(_settings.value)
        prefs.edit().apply {
            putBoolean(KEY_ENABLED, next.enabled)
            putBoolean(KEY_CONTEXTUAL, next.contextualEnabled)
            putBoolean(KEY_CONTEXTUAL_AUTO, next.contextualAutocorrect)
            putBoolean(KEY_GRAMMAR, next.grammarEnabled)
            putBoolean(KEY_CAPITALISATION, next.capitalisationEnabled)
            putFloat(KEY_AUTO_THRESHOLD, next.autocorrectThreshold.toFloat())
            putFloat(KEY_SUGGEST_THRESHOLD, next.suggestionThreshold.toFloat())
            putBoolean(KEY_LEARN_DECISIONS, next.learnFromDecisions)
            putBoolean(KEY_LEARN_MANUAL, next.learnFromManualEdits)
            putInt(KEY_MANUAL_EVIDENCE, next.manualEditEvidence)
            putInt(KEY_CONTEXT_RADIUS, next.contextRadius)
            putInt(KEY_RETENTION, next.historyRetentionDays)
            putStringSet(KEY_ALLOWED_APPS, next.allowedApps)
            putStringSet(
                KEY_APP_OVERRIDES,
                next.appOverrides.map { "${it.key}=${it.value}" }.toSet(),
            )
            putBoolean(KEY_VIBRATE, next.vibrateOnCorrection)
            putBoolean(KEY_TOAST, next.showCorrectionToast)
        }.commit()
        _settings.value = next
    }

    fun setAppAllowed(packageName: String, allowed: Boolean) = update { settings ->
        val apps = settings.allowedApps.toMutableSet()
        if (allowed) apps.add(packageName) else apps.remove(packageName)
        settings.copy(allowedApps = apps)
    }

    companion object {
        private const val FILE = "autocorrect_settings"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_CONTEXTUAL = "contextual"
        private const val KEY_CONTEXTUAL_AUTO = "contextual_auto"
        private const val KEY_GRAMMAR = "grammar"
        private const val KEY_CAPITALISATION = "capitalisation"
        private const val KEY_AUTO_THRESHOLD = "auto_threshold"
        private const val KEY_SUGGEST_THRESHOLD = "suggest_threshold"
        private const val KEY_LEARN_DECISIONS = "learn_decisions"
        private const val KEY_LEARN_MANUAL = "learn_manual"
        private const val KEY_MANUAL_EVIDENCE = "manual_evidence"
        private const val KEY_CONTEXT_RADIUS = "context_radius"
        private const val KEY_RETENTION = "retention_days"
        private const val KEY_ALLOWED_APPS = "allowed_apps"
        private const val KEY_APP_OVERRIDES = "app_overrides"
        private const val KEY_VIBRATE = "vibrate"
        private const val KEY_TOAST = "toast"

        @Volatile
        private var instance: SettingsStore? = null

        fun get(context: Context): SettingsStore =
            instance ?: synchronized(this) {
                instance ?: SettingsStore(context).also { instance = it }
            }
    }
}
