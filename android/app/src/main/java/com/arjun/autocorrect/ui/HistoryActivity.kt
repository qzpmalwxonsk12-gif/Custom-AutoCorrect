package com.arjun.autocorrect.ui

import android.os.Bundle
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.arjun.autocorrect.R
import com.arjun.autocorrect.data.LearningStore
import com.arjun.autocorrect.data.RejectionReason
import com.arjun.autocorrect.databinding.ActivityHistoryBinding
import com.arjun.autocorrect.databinding.ItemCorrectionBinding
import com.arjun.autocorrect.history.CorrectionHistory
import com.arjun.autocorrect.history.CorrectionRecord
import com.arjun.autocorrect.history.RecordStatus
import com.arjun.autocorrect.service.AutocorrectAccessibilityService
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Every automatic change, newest first, with what it did and why.
 *
 * Reverting is only offered when it can actually be honoured: the field must
 * still be focused and must still contain what we wrote. When it cannot, the
 * record is marked unresolved with a reason rather than pretending the undo
 * succeeded.
 */
class HistoryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHistoryBinding
    private val adapter = HistoryAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHistoryBinding.inflate(layoutInflater)
        setContentView(binding.root)
        title = getString(R.string.history_title)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        binding.historyList.layoutManager = LinearLayoutManager(this)
        binding.historyList.adapter = adapter

        // Read the shared store directly: the history survives the service
        // being stopped and restarted, so the list must not depend on it.
        val history = CorrectionHistory.get(this)
        binding.clearButton.setOnClickListener { history.clear() }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                history.records.collect { records ->
                    adapter.submit(records)
                    binding.emptyLabel.visibility =
                        if (records.isEmpty()) View.VISIBLE else View.GONE
                }
            }
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    private inner class HistoryAdapter : RecyclerView.Adapter<HistoryAdapter.Holder>() {

        private val rows = ArrayList<CorrectionRecord>()

        fun submit(next: List<CorrectionRecord>) {
            rows.clear()
            rows.addAll(next)
            notifyDataSetChanged()
        }

        inner class Holder(val item: ItemCorrectionBinding) : RecyclerView.ViewHolder(item.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(
            ItemCorrectionBinding.inflate(LayoutInflater.from(parent.context), parent, false),
        )

        override fun getItemCount() = rows.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val record = rows[position]
            holder.item.changeLabel.text = "${record.original} → ${record.replacement}"
            holder.item.reasonLabel.text = record.reason

            val context = buildString {
                if (record.textBefore.isNotEmpty()) append("…${record.textBefore}")
                append("[${record.replacement}]")
                if (record.textAfter.isNotEmpty()) append("${record.textAfter}…")
            }
            holder.item.contextLabel.text = context
            holder.item.contextLabel.visibility =
                if (record.textBefore.isEmpty() && record.textAfter.isEmpty()) View.GONE
                else View.VISIBLE

            val confidence = (record.confidence * 100).roundToInt()
            val when_ = DateUtils.getRelativeTimeSpanString(record.createdAt)
            val process = record.process?.let { " · process $it" } ?: ""
            val status = when (record.status) {
                RecordStatus.PENDING -> ""
                RecordStatus.ACCEPTED -> " · kept"
                RecordStatus.REVERTED -> " · reverted"
                RecordStatus.AUTO_ACCEPTED -> " · auto-accepted"
                RecordStatus.UNRESOLVED -> " · ${record.failureReason ?: "cannot be located"}"
            }
            holder.item.metaLabel.text =
                "$confidence%$process · ${record.appPackage} · $when_$status"

            val canRevert = record.status == RecordStatus.PENDING
            holder.item.revertButton.visibility = if (canRevert) View.VISIBLE else View.GONE
            holder.item.revertButton.setOnClickListener { revert(record) }
        }
    }

    private fun revert(record: CorrectionRecord) {
        // Reverting is the one action that genuinely needs the service: it has
        // to reach back into the field that received the correction.
        val service = AutocorrectAccessibilityService.instance
        if (service == null) {
            Toast.makeText(
                this,
                "The accessibility service is not running, so the text cannot be changed back",
                Toast.LENGTH_LONG,
            ).show()
            return
        }
        val reverted = service.revertLast(record.appPackage)
        if (reverted) {
            // Reverting is the strongest "no" the user can give, so it teaches
            // the rule as well as restoring the text.
            LearningStore.get(this).recordRejected(
                original = record.original,
                replacement = record.replacement,
                reason = RejectionReason.REVERT_ONLY,
            )
            Toast.makeText(this, "Reverted", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(
                this,
                "That field is no longer focused, or its text has changed",
                Toast.LENGTH_LONG,
            ).show()
        }
    }
}
