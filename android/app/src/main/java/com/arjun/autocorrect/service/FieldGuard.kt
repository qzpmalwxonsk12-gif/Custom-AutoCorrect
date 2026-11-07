package com.arjun.autocorrect.service

import android.text.InputType
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Decides whether a field may be read and corrected at all.
 *
 * This is the most safety-critical file in the Android build. The browser
 * extension could not see a page until the user granted that specific site; an
 * accessibility service sees *every* field in *every* app the moment it is
 * enabled. The per-app allowlist is the equivalent boundary, and these checks
 * are the backstop behind it.
 *
 * Everything here is decided from node metadata, before the field's text is
 * ever read. That ordering matters: a password box must be rejected without its
 * contents entering this process at all.
 */
object FieldGuard {

    enum class Verdict {
        ALLOWED,
        NOT_EDITABLE,
        PASSWORD,
        SENSITIVE_INPUT_TYPE,
        SENSITIVE_IDENTIFIER,
        NO_TEXT,
        TOO_LONG,
    }

    /**
     * Fields longer than this are not worth the whole-field read that
     * `ACTION_SET_TEXT` forces on us. A long-form editor is exactly where a
     * mangled rewrite would cost the most.
     */
    const val MAX_FIELD_LENGTH = 20_000

    /**
     * Substrings in a view id or hint that mean "do not touch".
     *
     * Heuristic by nature and deliberately broad: a false positive costs one
     * uncorrected field, a false negative can rewrite a one-time code or leak a
     * card number into the correction history.
     */
    private val SENSITIVE_MARKERS = listOf(
        "password", "passwd", "pwd", "passcode",
        "pin", "otp", "one_time", "onetime", "verification", "2fa", "mfa", "totp",
        "card", "cvv", "cvc", "ccv", "creditcard", "cardnumber", "expiry",
        "iban", "account_number", "accountnumber", "routing", "ssn", "sin_number",
        "secret", "token", "apikey", "api_key", "seed", "mnemonic", "recovery",
    )

    /**
     * Input types whose content is never prose.
     *
     * Note this list is checked *in addition* to [AccessibilityNodeInfo.isPassword],
     * because a number-password field reports the variation but not always the
     * password flag.
     */
    private val BLOCKED_VARIATIONS = setOf(
        InputType.TYPE_TEXT_VARIATION_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
        InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
        InputType.TYPE_TEXT_VARIATION_URI,
        InputType.TYPE_NUMBER_VARIATION_PASSWORD,
    )

    /**
     * Classifies a node without reading its text.
     *
     * [textLength] is passed separately so the caller can supply the length
     * from an event it already holds, rather than pulling the contents of a
     * field this function may be about to reject.
     */
    fun inspect(node: AccessibilityNodeInfo?, textLength: Int): Verdict {
        if (node == null) return Verdict.NOT_EDITABLE
        if (!node.isEditable) return Verdict.NOT_EDITABLE
        if (node.isPassword) return Verdict.PASSWORD

        val inputType = node.inputType
        val classMask = inputType and InputType.TYPE_MASK_CLASS
        // Phone and datetime fields are structured input, never prose.
        if (classMask == InputType.TYPE_CLASS_PHONE || classMask == InputType.TYPE_CLASS_DATETIME) {
            return Verdict.SENSITIVE_INPUT_TYPE
        }
        // A pure number field cannot contain a misspelled word.
        if (classMask == InputType.TYPE_CLASS_NUMBER) return Verdict.SENSITIVE_INPUT_TYPE
        if ((inputType and InputType.TYPE_MASK_VARIATION) in BLOCKED_VARIATIONS) {
            return Verdict.SENSITIVE_INPUT_TYPE
        }

        if (looksSensitive(node.viewIdResourceName) ||
            looksSensitive(node.hintText?.toString()) ||
            looksSensitive(node.contentDescription?.toString())
        ) {
            return Verdict.SENSITIVE_IDENTIFIER
        }

        if (textLength <= 0) return Verdict.NO_TEXT
        if (textLength > MAX_FIELD_LENGTH) return Verdict.TOO_LONG
        return Verdict.ALLOWED
    }

    fun isAllowed(node: AccessibilityNodeInfo?, textLength: Int): Boolean =
        inspect(node, textLength) == Verdict.ALLOWED

    private fun looksSensitive(value: String?): Boolean {
        if (value.isNullOrEmpty()) return false
        val normalised = value.lowercase().replace(Regex("[^a-z0-9]"), "")
        return SENSITIVE_MARKERS.any { marker ->
            normalised.contains(marker.replace("_", ""))
        }
    }

    /**
     * Stable-ish identity for a field, used to scope per-field session state.
     *
     * A view id is the best signal available; where an app supplies none, the
     * class name plus the node's window keeps distinct fields apart well enough
     * for a session that ends at focus change anyway.
     */
    fun fieldKey(node: AccessibilityNodeInfo?, packageName: String): String {
        if (node == null) return "$packageName#unknown"
        val id = node.viewIdResourceName
        if (!id.isNullOrEmpty()) return "$packageName#$id"
        return "$packageName#${node.className}#${node.windowId}"
    }
}
