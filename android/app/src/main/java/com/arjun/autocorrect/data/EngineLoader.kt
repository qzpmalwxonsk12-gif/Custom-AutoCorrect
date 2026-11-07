package com.arjun.autocorrect.data

import android.content.Context
import android.util.Log
import com.arjun.autocorrect.engine.Confusions
import com.arjun.autocorrect.engine.Dictionary
import com.arjun.autocorrect.engine.Frequency
import com.arjun.autocorrect.engine.Typos
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Streams the bundled language assets into the engine singletons.
 *
 * Cold start is the one place this app is allowed to be slow, and it is paid
 * exactly once per service lifetime: 107,901 words into a HashSet plus a
 * length/first-letter index. Correction passes afterwards are hash lookups.
 *
 * The service calls [ensureLoaded] before it accepts its first event, so a
 * correction can never run against a half-built dictionary - [Dictionary]
 * publishes `isReady` only after the whole index is swapped in.
 */
object EngineLoader {

    private const val TAG = "EngineLoader"

    private val mutex = Mutex()

    @Volatile
    var loaded: Boolean = false
        private set

    @Volatile
    var lastLoadMillis: Long = 0
        private set

    data class Stats(
        val dictionaryWords: Int,
        val dictionaryBuckets: Int,
        val frequencyWords: Int,
        val typoPairs: Int,
        val confusionMembers: Int,
        val loadMillis: Long,
    )

    fun stats(): Stats = Stats(
        dictionaryWords = Dictionary.size,
        dictionaryBuckets = Dictionary.bucketCount,
        frequencyWords = Frequency.size,
        typoPairs = Typos.size,
        confusionMembers = Confusions.size,
        loadMillis = lastLoadMillis,
    )

    /**
     * Loads every asset if it has not been loaded already. Safe to call from
     * any coroutine; concurrent callers wait rather than loading twice.
     */
    suspend fun ensureLoaded(context: Context) {
        if (loaded) return
        mutex.withLock {
            if (loaded) return
            withContext(Dispatchers.IO) { load(context.applicationContext) }
        }
    }

    private fun load(context: Context) {
        val started = System.currentTimeMillis()
        val assets = context.assets

        // Frequency first: Contractions (Process 7) consults it to decide
        // whether a possessive stem is common enough to earn an apostrophe.
        assets.open("frequency.dict").bufferedReader().useLines(Frequency::install)
        assets.open("dictionary.dict").bufferedReader().useLines(Dictionary::install)
        assets.open("typos.dict").bufferedReader().useLines(Typos::install)
        assets.open("confusions.dict").bufferedReader().useLines(Confusions::install)

        lastLoadMillis = System.currentTimeMillis() - started
        loaded = true
        Log.i(
            TAG,
            "engine ready in ${lastLoadMillis}ms: ${Dictionary.size} words, " +
                "${Dictionary.bucketCount} buckets, ${Frequency.size} ranked, " +
                "${Typos.size} typos, ${Confusions.size} confusables",
        )
    }
}
