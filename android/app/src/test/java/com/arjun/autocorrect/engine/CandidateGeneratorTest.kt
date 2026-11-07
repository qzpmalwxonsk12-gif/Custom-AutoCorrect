package com.arjun.autocorrect.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * One test per process, plus the ranking properties the seven-way merge is
 * supposed to guarantee.
 */
class CandidateGeneratorTest {

    @Before
    fun setUp() = TestEngineData.ensureLoaded()

    /* ----------------------------- process 1 ----------------------------- */

    @Test
    fun `process 1 scores only the same-length same-first-letter bucket`() {
        val candidates = CandidateGenerator.sameLength("wark")
        assertTrue("expected some bucket candidates", candidates.isNotEmpty())
        assertTrue(
            "every candidate must share length and first letter",
            candidates.all { it.word.length == 4 && it.word.startsWith("w") },
        )
        assertTrue(candidates.all { it.process == 1 })
    }

    @Test
    fun `process 1 examines only one bucket, never the whole dictionary`() {
        val diagnostics = CandidateDiagnostics()
        CandidateGenerator.sameLength("wark", diagnostics)
        val bucketSize = Dictionary.bucket(4, 'w').size
        assertEquals(bucketSize, diagnostics.process1Examined)
        assertTrue(
            "bucket must be a small fraction of the ${Dictionary.size}-word list",
            bucketSize < Dictionary.size / 100,
        )
    }

    /* ----------------------------- process 2 ----------------------------- */

    @Test
    fun `process 2 finds the adjacent swap`() {
        val candidates = CandidateGenerator.adjacentSwaps("waht")
        assertTrue("what" in candidates.map { it.word })
        assertTrue(candidates.all { it.process == 2 })
    }

    @Test
    fun `process 2 generates exactly n minus 1 swaps`() {
        val diagnostics = CandidateDiagnostics()
        CandidateGenerator.adjacentSwaps("waht", diagnostics)
        assertEquals(3, diagnostics.adjacentSwapsGenerated)
    }

    /* ----------------------------- process 3 ----------------------------- */

    @Test
    fun `process 3 substitutes one qwerty neighbour and records the evidence`() {
        // 'r' and 't' are neighbours, so "wprk" -> "work" via o/p adjacency.
        val candidates = CandidateGenerator.keyboardSubstitutions("wprk")
        val work = candidates.firstOrNull { it.word == "work" }
        assertNotNull("expected 'work' from an o/p substitution", work)
        val evidence = work!!.keyboardSubstitution
        assertNotNull(evidence)
        assertEquals('p', evidence!!.typedCharacter)
        assertEquals('o', evidence.replacementCharacter)
        assertTrue(evidence.neighbourMapMatched)
    }

    @Test
    fun `process 3 only ever changes one character`() {
        for (candidate in CandidateGenerator.keyboardSubstitutions("wprk")) {
            assertEquals(4, candidate.word.length)
            val differences = candidate.word.indices.count { candidate.word[it] != "wprk"[it] }
            assertEquals(1, differences)
        }
    }

    /* ----------------------------- process 4 ----------------------------- */

    @Test
    fun `process 4 removes an accidental duplicate letter`() {
        val candidates = CandidateGenerator.duplicateLetters("punctuatioon")
        val match = candidates.firstOrNull { it.word == "punctuation" }
        assertNotNull(match)
        assertEquals(4, match!!.process)
        assertEquals('o', match.duplicateLetter!!.removedCharacter)
    }

    /* ----------------------------- process 5 ----------------------------- */

    @Test
    fun `process 5 inserts one missing letter`() {
        val candidates = CandidateGenerator.insertions("iprove")
        val match = candidates.firstOrNull { it.word == "improve" }
        assertNotNull(match)
        assertEquals(5, match!!.process)
        assertEquals('m', match.missingLetter!!.insertedCharacter)
    }

    /* ----------------------------- process 6 ----------------------------- */

    @Test
    fun `process 6 deletes one extra letter but never an apostrophe`() {
        val candidates = CandidateGenerator.deletions("worlkd")
        assertTrue("world" in candidates.map { it.word })

        // Deleting a *present* apostrophe is never the fix - that would turn
        // every contraction into a correction candidate.
        val fromContraction = CandidateGenerator.deletions("can't")
        assertTrue("cant" !in fromContraction.map { it.word })
    }

    /* ----------------------------- process 7 ----------------------------- */

    @Test
    fun `process 7 restores a dropped apostrophe`() {
        val candidates = CandidateGenerator.apostrophes("didnt")
        val match = candidates.firstOrNull { it.word == "didn't" }
        assertNotNull("expected didn't", match)
        assertEquals(7, match!!.process)
    }

    @Test
    fun `process 7 refuses an unsupported possessive`() {
        // "mi's" is in a broad dictionary but is never what a writer typing
        // "mis" meant. This is the false positive the lexical-support gate
        // exists to close.
        val candidates = CandidateGenerator.apostrophes("mis")
        assertTrue("mi's" !in candidates.map { it.word })
    }

    @Test
    fun `process 7 declines a word that already has an apostrophe`() {
        assertTrue(CandidateGenerator.apostrophes("don't").isEmpty())
    }

    /* ------------------------------ merging ------------------------------ */

    @Test
    fun `all seven processes contribute to one merged ranked set`() {
        val seen = HashSet<Int>()
        for (word in listOf("wark", "waht", "wprk", "punctuatioon", "iprove", "worlkd", "didnt")) {
            CandidateGenerator.generate(word).forEach { seen.add(it.process) }
        }
        assertEquals(
            "every process should win at least once across these inputs",
            setOf(1, 2, 3, 4, 5, 6, 7),
            seen,
        )
    }

    @Test
    fun `the result is capped at ten candidates`() {
        val candidates = CandidateGenerator.generate("thre")
        assertTrue(candidates.size <= CandidateGenerator.MAX_CANDIDATES)
    }

    @Test
    fun `generation is deterministic`() {
        val first = CandidateGenerator.generate("becuase").map { it.word }
        val second = CandidateGenerator.generate("becuase").map { it.word }
        assertEquals(first, second)
    }

    @Test
    fun `a single-operation explanation outranks a multi-substitution bucket match`() {
        // The regression that operation cost exists to prevent: "iprove" must
        // resolve to "improve" (one insertion) and never to "iphone" (several
        // substitutions inside the same-length bucket).
        val winner = CandidateGenerator.generate("iprove").first()
        assertEquals("improve", winner.word)
    }

    @Test
    fun `words outside the length bounds produce nothing`() {
        assertTrue(CandidateGenerator.generate("ab").isEmpty())
        assertTrue(CandidateGenerator.generate("a".repeat(30)).isEmpty())
        assertTrue(CandidateGenerator.generate("wa2t").isEmpty())
    }
}
