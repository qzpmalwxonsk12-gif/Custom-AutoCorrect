package com.arjun.autocorrect.ui

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.text.format.DateUtils
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.arjun.autocorrect.R
import com.arjun.autocorrect.data.EngineLoader
import com.arjun.autocorrect.data.SettingsStore
import com.arjun.autocorrect.databinding.ActivityMainBinding
import com.arjun.autocorrect.service.AutocorrectAccessibilityService
import com.arjun.autocorrect.service.ServiceDiagnostics
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Setup, settings, a field to try it in, and a live diagnostics readout.
 *
 * This app does nothing until the accessibility service is enabled *and* at
 * least one app is ticked, so the screen has to make both states obvious rather
 * than looking broken.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var settingsStore: SettingsStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Shared instance: a private copy here is what previously made this
        // screen report "no apps chosen" after the picker had saved them.
        settingsStore = SettingsStore.get(this)

        binding.openSettingsButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        binding.chooseAppsButton.setOnClickListener {
            startActivity(Intent(this, AppPickerActivity::class.java))
        }
        binding.historyButton.setOnClickListener {
            startActivity(Intent(this, HistoryActivity::class.java))
        }
        binding.clearDiagnosticsButton.setOnClickListener {
            ServiceDiagnostics.clear()
            showDiagnostics()
        }

        bindSwitches()

        // The try-it field runs the engine in-process, so it works whether or
        // not the accessibility service is enabled.
        InAppCorrector(binding.tryField) { original, replacement, reason ->
            binding.tryResult.text = "$original → $replacement  ·  $reason"
        }.attach()

        lifecycleScope.launch {
            EngineLoader.ensureLoaded(this@MainActivity)
            showEngineStats()
        }

        // Redraw the diagnostics as the service records verdicts.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                ServiceDiagnostics.entries.collect { showDiagnostics() }
            }
        }

        // Keep the app summary honest if the picker is changed underneath us.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                settingsStore.settings.collect { refreshAppSummary() }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        refreshAppSummary()
        showEngineStats()
        showDiagnostics()
    }

    private fun bindSwitches() {
        val settings = settingsStore.current

        binding.enabledSwitch.isChecked = settings.enabled
        binding.enabledSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(enabled = checked) }
        }

        binding.grammarSwitch.isChecked = settings.grammarEnabled
        binding.grammarSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(grammarEnabled = checked) }
        }

        binding.contextualSwitch.isChecked = settings.contextualEnabled
        binding.contextualSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(contextualEnabled = checked) }
        }

        binding.vibrateSwitch.isChecked = settings.vibrateOnCorrection
        binding.vibrateSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(vibrateOnCorrection = checked) }
        }

        binding.toastSwitch.isChecked = settings.showCorrectionToast
        binding.toastSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(showCorrectionToast = checked) }
        }

        binding.learnSwitch.isChecked = settings.learnFromDecisions
        binding.learnSwitch.setOnCheckedChangeListener { _, checked ->
            settingsStore.update { it.copy(learnFromDecisions = checked) }
        }

        val percent = (settings.autocorrectThreshold * 100).roundToInt().coerceIn(50, 99)
        binding.thresholdSlider.value = percent.toFloat()
        binding.thresholdLabel.text = getString(R.string.pref_threshold, percent)
        binding.thresholdSlider.addOnChangeListener { _, value, fromUser ->
            val chosen = value.roundToInt()
            binding.thresholdLabel.text = getString(R.string.pref_threshold, chosen)
            if (fromUser) settingsStore.update { it.copy(autocorrectThreshold = chosen / 100.0) }
        }
    }

    private fun refreshStatus() {
        val enabled = isServiceEnabled(this)
        binding.statusTitle.text =
            getString(if (enabled) R.string.status_on else R.string.status_off)
        binding.statusDetail.text = if (enabled) "" else getString(R.string.status_off_detail)
        binding.statusDetail.visibility = if (enabled) View.GONE else View.VISIBLE
        binding.openSettingsButton.visibility = if (enabled) View.GONE else View.VISIBLE
    }

    private fun refreshAppSummary() {
        val apps = settingsStore.current.allowedApps
        binding.appsSummary.text = if (apps.isEmpty()) {
            getString(R.string.no_apps_chosen)
        } else {
            getString(R.string.apps_chosen, apps.size) + "\n" + apps.sorted().joinToString("\n")
        }
    }

    private fun showEngineStats() {
        if (!EngineLoader.loaded) {
            binding.engineStats.text = getString(R.string.engine_loading)
            return
        }
        val stats = EngineLoader.stats()
        binding.engineStats.text = buildString {
            appendLine("dictionary   ${stats.dictionaryWords} words")
            appendLine("buckets      ${stats.dictionaryBuckets}")
            appendLine("frequency    ${stats.frequencyWords} ranked")
            appendLine("typo table   ${stats.typoPairs} pairs")
            appendLine("confusables  ${stats.confusionMembers} words")
            appendLine("processes    7 (bucket, swap, keyboard,")
            appendLine("             duplicate, insert, delete, apostrophe)")
            append("loaded in    ${stats.loadMillis} ms")
        }
    }

    /**
     * The readout that makes an accessibility failure diagnosable: which
     * packages have sent events, and the verdict at each decision point.
     */
    private fun showDiagnostics() {
        val entries = ServiceDiagnostics.entries.value
        val seen = ServiceDiagnostics.packagesSeen()

        binding.diagnosticsText.text = buildString {
            appendLine("service      ${if (isServiceEnabled(this@MainActivity)) "enabled" else "NOT ENABLED"}")
            appendLine("events seen  ${ServiceDiagnostics.totalEvents}")
            appendLine("corrections  ${ServiceDiagnostics.totalCorrections}")
            appendLine("apps sending events:")
            if (seen.isEmpty()) {
                appendLine("  (none)")
            } else {
                val allowed = settingsStore.current.allowedApps
                for (pkg in seen) {
                    appendLine("  ${if (pkg in allowed) "[on] " else "[off]"} $pkg")
                }
            }
            appendLine()
            if (entries.isEmpty()) {
                append(getString(R.string.diagnostics_empty))
            } else {
                for (entry in entries.take(15)) {
                    val ago = DateUtils.getRelativeTimeSpanString(
                        entry.atMillis, System.currentTimeMillis(), 0,
                    )
                    appendLine("${entry.stage} · ${entry.appPackage.substringAfterLast('.')}")
                    if (entry.detail.isNotEmpty()) appendLine("   ${entry.detail}  ($ago)")
                }
            }
        }
    }

    companion object {
        /**
         * Reads the platform's own list of enabled services rather than
         * trusting our in-process singleton, which is null for a moment after
         * the system starts the service.
         */
        fun isServiceEnabled(context: Context): Boolean {
            if (AutocorrectAccessibilityService.isRunning) return true
            val expected = ComponentName(
                context, AutocorrectAccessibilityService::class.java,
            ).flattenToString()
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val splitter = TextUtils.SimpleStringSplitter(':')
            splitter.setString(enabled)
            return splitter.any { it.equals(expected, ignoreCase = true) }
        }
    }
}
