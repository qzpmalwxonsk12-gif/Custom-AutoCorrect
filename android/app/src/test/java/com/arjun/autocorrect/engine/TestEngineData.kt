package com.arjun.autocorrect.engine

import java.io.File

/**
 * Loads the real shipped assets into the engine singletons for JVM tests.
 *
 * These tests run against the *production* dictionary, not a fixture. A port
 * that passes on a toy word list proves nothing about the ranking decisions
 * that matter - "iprove" only resolves to "improve" rather than "iphone"
 * because both words are actually present to compete.
 */
object TestEngineData {

    private var loaded = false

    /** Unit tests run with the module directory as the working directory. */
    private fun asset(name: String): File {
        val direct = File("src/main/assets/$name")
        if (direct.exists()) return direct
        val fromRoot = File("app/src/main/assets/$name")
        if (fromRoot.exists()) return fromRoot
        error("cannot find asset $name (cwd=${File(".").absolutePath})")
    }

    @Synchronized
    fun ensureLoaded() {
        if (loaded) return
        // Frequency first: Process 7 consults it for possessive stems.
        asset("frequency.dict").useLines { Frequency.install(it) }
        asset("dictionary.dict").useLines { Dictionary.install(it) }
        asset("typos.dict").useLines { Typos.install(it) }
        asset("confusions.dict").useLines { Confusions.install(it) }
        loaded = true
    }
}
