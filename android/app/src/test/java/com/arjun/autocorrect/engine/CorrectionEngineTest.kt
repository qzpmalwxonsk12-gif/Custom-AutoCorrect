package com.arjun.autocorrect.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * End-to-end behaviour of the layered ladder: what the user actually sees.
 */
class CorrectionEngineTest {

    private val settings = Settings(allowedApps = setOf("com.example.app"))
    private val learning = LearningData.EMPTY

    @Before
    fun setUp() = TestEngineData.ensureLoaded()

    /** Analyses `text` as if the word ending before the trailing space committed. */
    private fun correct(text: String): CorrectionProposal? {
        val wordEnd = text.length - 1
        return CorrectionEngine.analyze(
            AnalyzeInput(text, wordEnd, "com.example.app"),
            learning,
            settings,
        )?.proposal
    }

    /* ---------------------------- corrections ---------------------------- */

    @Test
    fun `corrects a transposition`() {
        val proposal = correct("I think waht ")
        assertNotNull(proposal)
        assertEquals("what", proposal!!.replacement)
        assertEquals(ProposalAction.AUTOCORRECT, proposal.action)
    }

    @Test
    fun `corrects from the typo table`() {
        val proposal = correct("it happened becuase ")
        assertEquals("because", proposal?.replacement)
    }

    @Test
    fun `restores a dropped apostrophe rather than picking a shorter word`() {
        // The regression this guards: "didnt" is one deletion from "dint", and
        // without the apostrophe process winning, the engine confidently
        // produced that instead.
        assertEquals("didn't", correct("I didnt ")?.replacement)
    }

    @Test
    fun `inserts a missing letter`() {
        assertEquals("improve", correct("this will iprove ")?.replacement)
    }

    @Test
    fun `removes a duplicated letter`() {
        assertEquals("punctuation", correct("the punctuatioon ")?.replacement)
    }

    /* ------------------------- capitalisation fit ------------------------- */

    @Test
    fun `preserves the capitalisation style of the typed word`() {
        assertEquals("What", correct("Waht ")?.replacement)
    }

    @Test
    fun `capitalises at a sentence start`() {
        val proposal = correct("Hello. waht ")
        assertEquals("What", proposal?.replacement)
    }

    /* -------------------------------- guards ------------------------------ */

    @Test
    fun `never touches a word the dictionary knows`() {
        assertNull(correct("this is fine "))
    }

    @Test
    fun `never touches a url`() {
        assertNull(correct("see http://exmaple.com/waht "))
    }

    @Test
    fun `never touches an email address`() {
        assertNull(correct("mail waht@example.com "))
    }

    @Test
    fun `never touches a token containing a digit`() {
        assertNull(correct("build waht2 "))
    }

    @Test
    fun `never touches a short all-caps token`() {
        assertNull(correct("ticker WAHT "))
    }

    @Test
    fun `never touches text inside a code fence`() {
        assertNull(correct("```\nconst waht \n"))
    }

    @Test
    fun `never touches a camelCase identifier`() {
        assertNull(correct("call getWaht "))
    }

    @Test
    fun `respects the personal dictionary`() {
        val withWord = LearningData(dictionary = setOf("waht"))
        val proposal = CorrectionEngine.analyze(
            AnalyzeInput("I think waht ", 12, "com.example.app"),
            withWord,
            settings,
        )
        assertNull(proposal)
    }

    @Test
    fun `respects a blocked pair`() {
        val blocked = LearningData(blockedPairs = setOf("waht->what"))
        val proposal = CorrectionEngine.analyze(
            AnalyzeInput("I think waht ", 12, "com.example.app"),
            blocked,
            settings,
        )?.proposal
        // Either nothing, or something that is not the blocked replacement -
        // never the pair the user rejected.
        assertTrue(proposal == null || proposal.replacement != "what")
    }

    @Test
    fun `declines when the app is switched off`() {
        val off = settings.copy(appOverrides = mapOf("com.example.app" to "off"))
        assertNull(
            CorrectionEngine.analyze(
                AnalyzeInput("I think waht ", 12, "com.example.app"),
                learning,
                off,
            ),
        )
    }

    @Test
    fun `declines when disabled entirely`() {
        assertNull(
            CorrectionEngine.analyze(
                AnalyzeInput("I think waht ", 12, "com.example.app"),
                learning,
                settings.copy(enabled = false),
            ),
        )
    }

    /* ------------------------------- grammar ------------------------------ */

    @Test
    fun `fixes the indefinite article`() {
        val proposal = correct("I saw a apple ")
        assertNotNull(proposal)
        assertEquals("an", proposal!!.replacement)
        assertEquals(CorrectionType.GRAMMAR, proposal.correctionType)
    }

    @Test
    fun `leaves an ambiguous h-word alone`() {
        assertNull(correct("it was a historic "))
    }

    /* ------------------------------ learning ------------------------------ */

    @Test
    fun `a user-created rule wins over the generated pipeline`() {
        val rules = mapOf(
            "waht->however" to CorrectionRule(
                id = "waht->however",
                original = "waht",
                replacement = "however",
                source = RuleSource.USER_CREATED,
            ),
        )
        val proposal = CorrectionEngine.analyze(
            AnalyzeInput("I think waht ", 12, "com.example.app"),
            LearningData(rules = rules),
            settings,
        )?.proposal
        assertEquals("however", proposal?.replacement)
    }

    @Test
    fun `repeated rejections pull a rule below the autocorrect threshold`() {
        val rejected = CorrectionRule(
            id = "waht->what",
            original = "waht",
            replacement = "what",
            source = RuleSource.PERSONAL_LEARNING,
            accepted = 1,
            reverted = 8,
        )
        val proposal = CorrectionEngine.analyze(
            AnalyzeInput("I think waht ", 12, "com.example.app"),
            LearningData(rules = mapOf(rejected.id to rejected)),
            settings,
        )?.proposal
        assertTrue(
            "a heavily reverted rule must not auto-apply",
            proposal == null || proposal.action != ProposalAction.AUTOCORRECT,
        )
    }

    /* ------------------------------ proposal ------------------------------ */

    @Test
    fun `the proposal span covers exactly the typed word`() {
        val text = "I think waht "
        val proposal = correct(text)!!
        assertEquals("waht", text.substring(proposal.start, proposal.end))
        assertEquals("waht", proposal.original)
    }

    @Test
    fun `every proposal explains itself`() {
        val proposal = correct("I think waht ")!!
        assertTrue(proposal.reason.isNotBlank())
        assertTrue(proposal.confidence > 0.0)
    }
}
