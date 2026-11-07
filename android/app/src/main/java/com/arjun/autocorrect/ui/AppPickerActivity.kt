package com.arjun.autocorrect.ui

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.arjun.autocorrect.R
import com.arjun.autocorrect.data.SettingsStore
import com.arjun.autocorrect.databinding.ActivityAppPickerBinding
import com.arjun.autocorrect.databinding.ItemAppBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The per-app allowlist: this app's equivalent of the extension's per-site
 * permission prompt.
 *
 * The service starts with access to nothing. Every app the user ticks here is
 * a deliberate grant, and unticking one takes effect on the next keystroke.
 */
class AppPickerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAppPickerBinding
    private lateinit var settingsStore: SettingsStore
    private val adapter = AppAdapter()

    data class AppRow(
        val packageName: String,
        val label: String,
        val icon: Drawable?,
        var allowed: Boolean,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAppPickerBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = getString(R.string.app_picker_title)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        settingsStore = SettingsStore.get(this)
        binding.appList.layoutManager = LinearLayoutManager(this)
        binding.appList.adapter = adapter

        lifecycleScope.launch {
            val rows = withContext(Dispatchers.IO) { loadApps() }
            adapter.submit(rows)
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    /**
     * Every launchable app, allowlisted ones first, then alphabetically.
     *
     * Launchable is the right filter: a package with no launcher entry has no
     * UI the user types into.
     */
    private fun loadApps(): List<AppRow> {
        val pm = packageManager
        val allowed = settingsStore.current.allowedApps
        val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)

        return installed
            .filter { info -> pm.getLaunchIntentForPackage(info.packageName) != null }
            .filter { info -> info.packageName != packageName }
            .map { info: ApplicationInfo ->
                AppRow(
                    packageName = info.packageName,
                    label = pm.getApplicationLabel(info).toString(),
                    icon = runCatching { pm.getApplicationIcon(info) }.getOrNull(),
                    allowed = info.packageName in allowed,
                )
            }
            .sortedWith(compareByDescending<AppRow> { it.allowed }.thenBy { it.label.lowercase() })
    }

    private inner class AppAdapter : RecyclerView.Adapter<AppAdapter.Holder>() {

        private val rows = ArrayList<AppRow>()

        fun submit(next: List<AppRow>) {
            rows.clear()
            rows.addAll(next)
            notifyDataSetChanged()
        }

        inner class Holder(val item: ItemAppBinding) : RecyclerView.ViewHolder(item.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(
            ItemAppBinding.inflate(LayoutInflater.from(parent.context), parent, false),
        )

        override fun getItemCount() = rows.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val row = rows[position]
            holder.item.appLabel.text = row.label
            holder.item.appPackage.text = row.packageName
            holder.item.appIcon.setImageDrawable(row.icon)

            // Detach the listener before setting state, or recycling a view
            // fires a change for the row that used to be here.
            holder.item.appSwitch.setOnCheckedChangeListener(null)
            holder.item.appSwitch.isChecked = row.allowed
            holder.item.appSwitch.setOnCheckedChangeListener { _, checked ->
                row.allowed = checked
                settingsStore.setAppAllowed(row.packageName, checked)
            }
            holder.item.root.setOnClickListener {
                holder.item.appSwitch.isChecked = !holder.item.appSwitch.isChecked
            }
        }
    }
}
