package com.arjun.autocorrect.data

import android.content.Context
import android.util.Log
import com.arjun.autocorrect.engine.CorrectionRule
import com.arjun.autocorrect.engine.LearningData
import com.arjun.autocorrect.engine.RuleMode
import com.arjun.autocorrect.engine.RuleSource
import com.arjun.autocorrect.engine.normaliseRuleText
import com.arjun.autocorrect.engine.ruleId
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
 * The single writer for learned data.
 *
 * The extension needed a background service worker to own this because content
 * scripts in different tabs would otherwise race on a read-modify-write. Here
 * the same guarantee comes from one store instance owned by the accessibility
 * service, with every mutation funnelled through [mutate].
 */
class LearningStore private constructor(
    context: Context,
    private val scope: CoroutineScope,
) {

    private val file = File(context.applicationContext.filesDir, FILE_NAME)
    private val mutex = Mutex()

    private val _data = MutableStateFlow(LearningData.EMPTY)
    val data: StateFlow<LearningData> = _data.asStateFlow()

    val current: LearningData get() = _data.value

    init {
        scope.launch(Dispatchers.IO) { load() }
    }

    private suspend fun load() = mutex.withLock {
        if (!file.exists()) return@withLock
        runCatching {
            val json = JSONObject(file.readText())

            val rules = HashMap<String, CorrectionRule>()
            val rulesJson = json.optJSONArray("rules") ?: JSONArray()
            for (i in 0 until rulesJson.length()) {
                val rule = ruleFromJson(rulesJson.getJSONObject(i))
                rules[rule.id] = rule
            }

            _data.value = LearningData(
                rules = rules,
                dictionary = json.optJSONArray("dictionary").toStringSet(),
                blockedPairs = json.optJSONArray("blockedPairs").toStringSet(),
            )
        }.onFailure {
            // A failed read must not be mistaken for a fresh profile: keep the
            // file, keep the empty in-memory state, and say so.
            Log.e(TAG, "learning data unreadable, running without it this session", it)
        }
    }

    /** Applies [transform] under the lock and persists the result. */
    private fun mutate(transform: (LearningData) -> LearningData) {
        _data.value = transform(_data.value)
        persist()
    }

    /* ----------------------------- decisions ----------------------------- */

    /** The user kept an automatic correction. Reinforces the rule. */
    fun recordAccepted(original: String, replacement: String, previousWord: String?) =
        mutate { data ->
            val id = ruleId(original, replacement)
            val existing = data.rules[id]
            val rule = (existing ?: newRule(original, replacement, RuleSource.PERSONAL_LEARNING))
                .let {
                    it.copy(
                        accepted = it.accepted + 1,
                        acceptedAfter = if (previousWord.isNullOrEmpty()) it.acceptedAfter
                        else it.acceptedAfter + previousWord,
                        updatedAt = System.currentTimeMillis(),
                    )
                }
            data.copy(rules = data.rules + (id to rule))
        }

    /**
     * The user reverted a correction. [reason] decides what is learned, which
     * is the whole point of asking: "wrong here" and "never do this" are very
     * different instructions.
     */
    fun recordRejected(
        original: String,
        replacement: String,
        reason: RejectionReason,
        previousWord: String? = null,
        nextWord: String? = null,
    ) = mutate { data ->
        val id = ruleId(original, replacement)
        val existing = data.rules[id] ?: newRule(original, replacement, RuleSource.PERSONAL_LEARNING)
        val now = System.currentTimeMillis()

        when (reason) {
            RejectionReason.REVERT_ONLY -> data.copy(
                rules = data.rules + (id to existing.copy(reverted = existing.reverted + 1, updatedAt = now)),
            )

            RejectionReason.LOWER_CONFIDENCE -> data.copy(
                rules = data.rules + (
                    id to existing.copy(
                        reverted = existing.reverted + 1,
                        mode = RuleMode.SUGGESTION,
                        updatedAt = now,
                    )
                    ),
            )

            RejectionReason.NEVER_THIS_PAIR -> data.copy(
                rules = data.rules + (
                    id to existing.copy(
                        blocked = existing.blocked + 1,
                        mode = RuleMode.BLOCKED,
                        enabled = false,
                        updatedAt = now,
                    )
                    ),
                blockedPairs = data.blockedPairs + id,
            )

            RejectionReason.ADD_TO_DICTIONARY -> data.copy(
                dictionary = data.dictionary + normaliseRuleText(original),
            )

            RejectionReason.NOT_IN_THIS_CONTEXT -> data.copy(
                rules = data.rules + (
                    id to existing.copy(
                        reverted = existing.reverted + 1,
                        blockedAfter = if (previousWord.isNullOrEmpty()) existing.blockedAfter
                        else existing.blockedAfter + previousWord,
                        blockedBefore = if (nextWord.isNullOrEmpty()) existing.blockedBefore
                        else existing.blockedBefore + nextWord,
                        updatedAt = now,
                    )
                    ),
            )
        }
    }

    /* ------------------------------ authoring ---------------------------- */

    /** "Always correct X to Y" - a permanent, user-authored rule. */
    fun addUserRule(original: String, replacement: String) = mutate { data ->
        val rule = newRule(original, replacement, RuleSource.USER_CREATED).copy(confidence = 0.99)
        data.copy(rules = data.rules + (rule.id to rule))
    }

    /** "Never correct X" - adds it to the personal dictionary. */
    fun addToDictionary(word: String) = mutate { data ->
        data.copy(dictionary = data.dictionary + normaliseRuleText(word))
    }

    fun removeFromDictionary(word: String) = mutate { data ->
        data.copy(dictionary = data.dictionary - normaliseRuleText(word))
    }

    fun deleteRule(id: String) = mutate { data ->
        data.copy(rules = data.rules - id, blockedPairs = data.blockedPairs - id)
    }

    fun setRuleMode(id: String, mode: RuleMode) = mutate { data ->
        val rule = data.rules[id] ?: return@mutate data
        data.copy(rules = data.rules + (id to rule.copy(mode = mode, updatedAt = System.currentTimeMillis())))
    }

    fun clearAll() = mutate { LearningData.EMPTY }

    /* ----------------------------- persistence --------------------------- */

    private fun newRule(original: String, replacement: String, source: RuleSource) =
        CorrectionRule(
            id = ruleId(original, replacement),
            original = normaliseRuleText(original),
            replacement = replacement,
            source = source,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
        )

    private fun persist() {
        val snapshot = _data.value
        scope.launch(Dispatchers.IO) {
            mutex.withLock {
                runCatching {
                    val rules = JSONArray()
                    for (rule in snapshot.rules.values) rules.put(ruleToJson(rule))
                    val json = JSONObject()
                        .put("rules", rules)
                        .put("dictionary", JSONArray(snapshot.dictionary.toList()))
                        .put("blockedPairs", JSONArray(snapshot.blockedPairs.toList()))

                    val temp = File(file.parentFile, "$FILE_NAME.tmp")
                    temp.writeText(json.toString())
                    if (!temp.renameTo(file)) {
                        file.writeText(json.toString())
                        temp.delete()
                    }
                }.onFailure { Log.e(TAG, "learning write failed", it) }
            }
        }
    }

    private fun ruleToJson(rule: CorrectionRule): JSONObject = JSONObject().apply {
        put("id", rule.id)
        put("original", rule.original)
        put("replacement", rule.replacement)
        put("source", rule.source.name)
        put("mode", rule.mode.name)
        put("enabled", rule.enabled)
        put("confidence", rule.confidence)
        put("accepted", rule.accepted)
        put("reverted", rule.reverted)
        put("blocked", rule.blocked)
        put("blockedAfter", JSONArray(rule.blockedAfter.toList()))
        put("blockedBefore", JSONArray(rule.blockedBefore.toList()))
        put("acceptedAfter", JSONArray(rule.acceptedAfter.toList()))
        put("createdAt", rule.createdAt)
        put("updatedAt", rule.updatedAt)
    }

    private fun ruleFromJson(json: JSONObject): CorrectionRule = CorrectionRule(
        id = json.getString("id"),
        original = json.getString("original"),
        replacement = json.getString("replacement"),
        source = runCatching { RuleSource.valueOf(json.getString("source")) }
            .getOrDefault(RuleSource.PERSONAL_LEARNING),
        mode = runCatching { RuleMode.valueOf(json.optString("mode", "DEFAULT")) }
            .getOrDefault(RuleMode.DEFAULT),
        enabled = json.optBoolean("enabled", true),
        confidence = json.optDouble("confidence", 0.5),
        accepted = json.optInt("accepted", 0),
        reverted = json.optInt("reverted", 0),
        blocked = json.optInt("blocked", 0),
        blockedAfter = json.optJSONArray("blockedAfter").toStringSet(),
        blockedBefore = json.optJSONArray("blockedBefore").toStringSet(),
        acceptedAfter = json.optJSONArray("acceptedAfter").toStringSet(),
        createdAt = json.optLong("createdAt", 0L),
        updatedAt = json.optLong("updatedAt", 0L),
    )

    private fun JSONArray?.toStringSet(): Set<String> {
        if (this == null) return emptySet()
        val out = HashSet<String>(length())
        for (i in 0 until length()) out.add(getString(i))
        return out
    }

    companion object {
        private const val TAG = "LearningStore"
        private const val FILE_NAME = "learning.json"

        @Volatile
        private var instance: LearningStore? = null

        /**
         * One instance per process. Two would each hold a snapshot and
         * overwrite the other's file on the next write.
         */
        fun get(context: Context): LearningStore =
            instance ?: synchronized(this) {
                instance ?: LearningStore(context.applicationContext, AppScope)
                    .also { instance = it }
            }
    }
}

/**
 * Why the user rejected a correction.
 *
 * Rejecting can mean five different things, and collapsing them into one
 * "undo" throws away most of the signal - "wrong word here" and "never do this
 * again" should not teach the same lesson.
 */
enum class RejectionReason {
    /** Put the original back; nudge confidence down slightly. */
    REVERT_ONLY,

    /** Put the original back; demote the rule to suggestion-only. */
    LOWER_CONFIDENCE,

    /** Block this exact pair for good. */
    NEVER_THIS_PAIR,

    /** The typed word is a real word: add it to the personal dictionary. */
    ADD_TO_DICTIONARY,

    /** Fine in general, wrong after/before these words. */
    NOT_IN_THIS_CONTEXT,
}
