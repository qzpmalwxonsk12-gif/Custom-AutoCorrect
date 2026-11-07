package com.arjun.autocorrect.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardAndCaseTest {

    /**
     * The neighbour map is the source of truth for Process 3, so its shape is
     * an invariant rather than an implementation detail. Every relationship is
     * symmetrical except the four documented corner cases.
     */
    @Test
    fun `the neighbour map is symmetrical except where documented`() {
        val exceptions = KEY_NEIGHBOUR_SYMMETRY_EXCEPTIONS.toSet()
        for ((key, values) in KEY_NEIGHBOURS) {
            for (neighbour in values) {
                val reverse = KEY_NEIGHBOURS[neighbour].orEmpty()
                if (key in reverse) continue
                assertTrue(
                    "$neighbour -> $key is missing and is not a declared exception",
                    (neighbour to key) in exceptions,
                )
            }
        }
    }

    @Test
    fun `every declared exception is genuinely asymmetric`() {
        for ((corner, surrounding) in KEY_NEIGHBOUR_SYMMETRY_EXCEPTIONS) {
            assertTrue(
                "$surrounding should list $corner",
                corner in KEY_NEIGHBOURS[surrounding].orEmpty(),
            )
            assertFalse(
                "$corner should not list $surrounding",
                surrounding in KEY_NEIGHBOURS[corner].orEmpty(),
            )
        }
    }

    @Test
    fun `adjacency comes from the map, not from geometry`() {
        assertTrue(areAdjacent('q', 'w'))
        assertFalse(areAdjacent('q', 'p'))
        assertFalse("a key is not its own neighbour", areAdjacent('q', 'q'))
    }

    @Test
    fun `key distance is zero for identical keys and infinite for unknowns`() {
        assertEquals(0.0, keyDistance('a', 'a'), 1e-9)
        assertTrue(keyDistance('a', '1').isInfinite())
        assertTrue(keyDistance('q', 'w') < keyDistance('q', 'p'))
    }

    @Test
    fun `proximity scores one substitution above two`() {
        assertTrue(proximityScore("wprk", "work") > proximityScore("wprl", "work"))
        assertEquals(0.0, proximityScore("abc", "abcd"), 1e-9)
    }

    /* ------------------------------ case style ----------------------------- */

    @Test
    fun `case style is detected and reapplied`() {
        assertEquals(CaseStyle.LOWER, detectCaseStyle("waht"))
        assertEquals(CaseStyle.TITLE, detectCaseStyle("Waht"))
        assertEquals(CaseStyle.UPPER, detectCaseStyle("WAHT"))
        assertEquals(CaseStyle.MIXED, detectCaseStyle("wAhT"))
    }

    @Test
    fun `match case rewrites by style, never by copying characters`() {
        assertEquals("what", matchCase("waht", "what"))
        assertEquals("What", matchCase("Waht", "what"))
        assertEquals("WHAT", matchCase("WAHT", "what"))
        // A mixed-case original tells us nothing, so the target is untouched.
        assertEquals("what", matchCase("wAhT", "what"))
    }

    /* ---------------------------- edit distance ---------------------------- */

    @Test
    fun `edit shapes are classified`() {
        assertEquals(EditShape.TRANSPOSITION, classifyEdit("waht", "what"))
        assertEquals(EditShape.SUBSTITUTION, classifyEdit("wark", "work"))
        assertEquals(EditShape.INSERTION, classifyEdit("iprove", "improve"))
        assertEquals(EditShape.DELETION, classifyEdit("worlkd", "workd"))
        assertEquals(EditShape.DOUBLED, classifyEdit("lettter", "letter"))
        assertEquals(EditShape.IDENTICAL, classifyEdit("what", "what"))
    }

    @Test
    fun `damerau levenshtein counts a transposition as one edit`() {
        assertEquals(1, damerauLevenshtein("waht", "what"))
        assertEquals(0, damerauLevenshtein("what", "what"))
        // The bound short-circuits rather than computing the true distance.
        assertTrue(damerauLevenshtein("abcdefgh", "zyxwvuts", 2) > 2)
    }
}
