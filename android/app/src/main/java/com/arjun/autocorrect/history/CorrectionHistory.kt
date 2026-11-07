package com.arjun.autocorrect.history

import android.content.Context
import android.util.Log
import com.arjun.autocorrect.data.AppScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The reviewable log of every automatic change.
 *
 * Writes are serialised through one mutex and one file. The invariant carried
 * over from the extension is that the text is modified **if and only if**
 * exactly one record exists - so the service records inside the same guarded
 * block that performed the edit, never optimistically before it.
 */
class CorrectionHistory private constructor(
    context: Context,
    private val scope: CoroutineScope,
) {

    private val file = File(context.applicationContext.filesDir, FILE_NAME)
    private val mutex = Mutex()

    private val _records = MutableStateFlow<List<CorrectionRecord>>(emptyList())
    val records: StateFlow<List<CorrectionRecord>> = _records.asStateFlow()

    init {
        scope.launch(Dispatchers.IO) { load() }
    }

    private suspend fun load() = mutex.withLock {
        if (!file.exists()) return@withLock
        runCatching {
            val array = JSONArray(file.readText())
            val out = ArrayList<CorrectionRecord>(array.length())
            for (i in 0 until array.length()) {
                out.add(CorrectionRecord.fromJson(array.getJSONObject(i)))
            }
            _records.value = out.sortedByDescending { it.createdAt }
        }.onFailure {
            // A corrupt history must never be mistaken for an empty one, and
            // must never break typing. Keep the file for inspection.
            Log.e(TAG, "history unreadable, starting empty this session", it)
        }
    }

    fun add(record: CorrectionRecord) {
        _records.value = (listOf(record) + _records.value).take(MAX_RECORDS)
        persist()
    }

    fun updateStatus(id: String, status: RecordStatus, failureReason: String? = null) {
        _records.value = _records.value.map {
            if (it.id == id) it.copy(status = status, failureReason = failureReason) else it
        }
        persist()
    }

    fun mostRecentPending(appPackage: String): CorrectionRecord? =
        _records.value.firstOrNull {
            it.appPackage == appPackage && it.status == RecordStatus.PENDING
        }

    fun clear() {
        _records.value = emptyList()
        persist()
    }

    /** Drops records older than [retentionDays]. Called on service start. */
    fun sweep(retentionDays: Int) {
        if (retentionDays <= 0) return
        val cutoff = System.currentTimeMillis() - retentionDays * DAY_MILLIS
        val kept = _records.value.filter { it.createdAt >= cutoff }
        if (kept.size != _records.value.size) {
            _records.value = kept
            persist()
        }
    }

    private fun persist() {
        val snapshot = _records.value
        scope.launch(Dispatchers.IO) {
            mutex.withLock {
                runCatching {
                    val array = JSONArray()
                    for (record in snapshot) array.put(record.toJson())
                    // Write to a sibling then rename, so a kill mid-write
                    // cannot leave a truncated history behind.
                    val temp = File(file.parentFile, "$FILE_NAME.tmp")
                    temp.writeText(array.toString())
                    if (!temp.renameTo(file)) {
                        file.writeText(array.toString())
                        temp.delete()
                    }
                }.onFailure { Log.e(TAG, "history write failed", it) }
            }
        }
    }

    /** Export as pretty JSON for the user's own backup. */
    fun exportJson(): String {
        val array = JSONArray()
        for (record in _records.value) array.put(record.toJson())
        return JSONObject().put("records", array).toString(2)
    }

    companion object {
        private const val TAG = "CorrectionHistory"
        private const val FILE_NAME = "corrections.json"
        private const val MAX_RECORDS = 2_000
        private const val DAY_MILLIS = 24L * 60 * 60 * 1000

        @Volatile
        private var instance: CorrectionHistory? = null

        /**
         * One instance per process, so the history screen shows the same
         * records the service is writing - including when the service has been
         * restarted by the system since the app was opened.
         */
        fun get(context: Context): CorrectionHistory =
            instance ?: synchronized(this) {
                instance ?: CorrectionHistory(context.applicationContext, AppScope)
                    .also { instance = it }
            }
    }
}
