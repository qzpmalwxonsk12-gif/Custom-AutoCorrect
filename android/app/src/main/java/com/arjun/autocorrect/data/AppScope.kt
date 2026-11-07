package com.arjun.autocorrect.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Process-wide scope for the stores.
 *
 * The stores outlive any single activity or service lifetime - the
 * accessibility service can be torn down and restarted by the system while the
 * app's UI is still open - so their persistence coroutines cannot be tied to
 * either one.
 */
object AppScope : CoroutineScope by CoroutineScope(SupervisorJob() + Dispatchers.Default)
