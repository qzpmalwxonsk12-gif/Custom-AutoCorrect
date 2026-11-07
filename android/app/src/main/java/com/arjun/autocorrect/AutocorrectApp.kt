package com.arjun.autocorrect

import android.app.Application
import com.arjun.autocorrect.data.EngineLoader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Warms the engine when the app process starts.
 *
 * The service loads the dictionary itself, but a user who opens the app first
 * should not wait for a cold load when they tap into the demo field.
 */
class AutocorrectApp : Application() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        scope.launch { EngineLoader.ensureLoaded(this@AutocorrectApp) }
    }
}
