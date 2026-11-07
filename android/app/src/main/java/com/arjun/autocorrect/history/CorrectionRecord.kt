package com.arjun.autocorrect.history

import com.arjun.autocorrect.engine.CorrectionType
import com.arjun.autocorrect.engine.RuleSource
import org.json.JSONObject

/** What has happened to a recorded correction since it was applied. */
enum class RecordStatus {
    /** Applied, not yet reviewed. */
    PENDING,

    /** The user kept it. */
    ACCEPTED,

    /** The user put the original text back. */
    REVERTED,

    /** Aged out of the review window without a decision. */
    AUTO_ACCEPTED,

    /**
     * The text no longer matches what we wrote, so it can no longer be
     * reverted safely. Visible in the UI with an explanation rather than
     * silently dropped.
     */
    UNRESOLVED,
}

/**
 * One automatic change, with enough evidence to explain and undo it.
 *
 * The Android session is per input field and ends when focus moves, so this
 * carries a small text window rather than the extension's full multi-hint
 * anchor. That is the `contextRadius: 0` path the anchor model was already
 * designed to degrade into.
 */
data class CorrectionRecord(
    val id: String,
    val original: String,
    val replacement: String,
    val correctionType: CorrectionType,
    val source: RuleSource,
    val confidence: Double,
    val reason: String,
    /** Which of the seven processes produced it, when it came from the pipeline. */
    val process: Int?,
    /** Package name of the app the correction happened in. */
    val appPackage: String,
    /** Offset in the field at the moment of application. A hint, never trusted alone. */
    val offset: Int,
    /** Bounded text either side, subject to the user's context radius. */
    val textBefore: String,
    val textAfter: String,
    val createdAt: Long,
    val status: RecordStatus = RecordStatus.PENDING,
    /** Set when the record became [RecordStatus.UNRESOLVED]. */
    val failureReason: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("original", original)
        put("replacement", replacement)
        put("correctionType", correctionType.name)
        put("source", source.name)
        put("confidence", confidence)
        put("reason", reason)
        put("process", process ?: JSONObject.NULL)
        put("appPackage", appPackage)
        put("offset", offset)
        put("textBefore", textBefore)
        put("textAfter", textAfter)
        put("createdAt", createdAt)
        put("status", status.name)
        put("failureReason", failureReason ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(json: JSONObject): CorrectionRecord = CorrectionRecord(
            id = json.getString("id"),
            original = json.getString("original"),
            replacement = json.getString("replacement"),
            correctionType = runCatching {
                CorrectionType.valueOf(json.getString("correctionType"))
            }.getOrDefault(CorrectionType.SPELLING),
            source = runCatching {
                RuleSource.valueOf(json.getString("source"))
            }.getOrDefault(RuleSource.LEXICON),
            confidence = json.optDouble("confidence", 0.0),
            reason = json.optString("reason", ""),
            process = if (json.isNull("process")) null else json.optInt("process"),
            appPackage = json.optString("appPackage", ""),
            offset = json.optInt("offset", 0),
            textBefore = json.optString("textBefore", ""),
            textAfter = json.optString("textAfter", ""),
            createdAt = json.optLong("createdAt", 0L),
            status = runCatching {
                RecordStatus.valueOf(json.optString("status", "PENDING"))
            }.getOrDefault(RecordStatus.PENDING),
            failureReason = if (json.isNull("failureReason")) null
            else json.optString("failureReason"),
        )
    }
}
