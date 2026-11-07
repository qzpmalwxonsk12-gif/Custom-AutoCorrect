package com.arjun.autocorrect.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The guards decide what the engine is allowed to look at. */
class TokenizerTest {

    private fun guard(text: String, word: String): TokenAnalysis {
        val start = text.indexOf(word)
        require(start >= 0) { "\"$word\" not in \"$text\"" }
        return Tokenizer.analyzeToken(text, start, start + word.length)
    }

    @Test
    fun `plain prose is not protected`() {
        assertFalse(guard("I think waht happened", "waht").protectedToken)
    }

    @Test
    fun `digits anywhere in the run protect the token`() {
        assertEquals(ProtectionReason.HAS_DIGIT, guard("build waht2 now", "waht").reason)
    }

    @Test
    fun `all caps is treated as an abbreviation`() {
        assertEquals(ProtectionReason.ALL_CAPS, guard("the WAHT thing", "WAHT").reason)
    }

    @Test
    fun `internal capitals mean an identifier`() {
        assertEquals(ProtectionReason.INTERNAL_CAPS, guard("call getWaht now", "getWaht").reason)
    }

    @Test
    fun `urls and paths are protected`() {
        assertEquals(ProtectionReason.URL_LIKE, guard("see http://a.com/waht x", "waht").reason)
        assertEquals(ProtectionReason.PATH_LIKE, guard("open src/waht here", "waht").reason)
    }

    @Test
    fun `email addresses are protected`() {
        assertEquals(ProtectionReason.EMAIL_LIKE, guard("mail waht@x.com now", "waht").reason)
    }

    @Test
    fun `fenced and inline code are protected`() {
        assertEquals(ProtectionReason.CODE_FENCE, guard("```\nwaht\n```", "waht").reason)
        assertEquals(ProtectionReason.INLINE_CODE, guard("run `waht` now", "waht").reason)
    }

    @Test
    fun `a short hyphen fragment is protected but a long one is not`() {
        assertEquals(ProtectionReason.HYPHEN_FRAGMENT, guard("mis-matched x", "mis").reason)
        assertFalse(guard("well-knwon fact", "knwon").protectedToken)
    }

    @Test
    fun `sql and json context are protected`() {
        assertEquals(
            ProtectionReason.STRUCTURED_CODE,
            guard("SELECT waht FROM t", "waht").reason,
        )
        assertEquals(
            ProtectionReason.STRUCTURED_CODE,
            guard("{\"key\": \"waht\"}", "waht").reason,
        )
    }

    /* ---------------------------- word extraction --------------------------- */

    @Test
    fun `extracts the word ending at an offset`() {
        val token = Tokenizer.wordEndingAt("I think waht", 12)
        assertEquals("waht", token?.text)
        assertEquals(8, token?.start)
    }

    @Test
    fun `trims surrounding apostrophes but keeps internal ones`() {
        assertEquals("don't", Tokenizer.wordEndingAt("say don't", 9)?.text)
        assertEquals("hello", Tokenizer.wordEndingAt("'hello'", 7)?.text)
    }

    @Test
    fun `refuses an unbounded run`() {
        assertNull(Tokenizer.wordEndingAt("a".repeat(400), 400))
    }

    /* ---------------------------- sentence logic ---------------------------- */

    @Test
    fun `detects a sentence start`() {
        assertTrue(Tokenizer.isSentenceStart("Hello. World", 7))
        assertFalse(Tokenizer.isSentenceStart("hello world", 6))
    }

    @Test
    fun `an abbreviation does not end a sentence`() {
        // "Call Dr. Smith" is one sentence, not two.
        assertFalse(Tokenizer.isSentenceStart("Call Dr. Smith", 9))
        assertTrue(Tokenizer.isSentenceStart("he sat. Then", 8))
    }

    @Test
    fun `reads neighbouring words`() {
        assertEquals("think", Tokenizer.previousWord("I think waht", 8))
        assertEquals("happened", Tokenizer.nextWord("waht happened", 4))
    }
}
