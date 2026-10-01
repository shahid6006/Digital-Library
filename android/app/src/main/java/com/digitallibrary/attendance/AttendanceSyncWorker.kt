package com.digitallibrary.attendance

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * AttendanceSyncWorker
 *
 * Android Jetpack WorkManager worker for reliable offline-to-online synchronization.
 * Woken when network connectivity is restored to process queued attendance events
 * with server-side idempotency.
 */
class AttendanceSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "AttendanceSyncWorker"
        const val WORK_NAME = "LibraryAttendanceSyncWork"

        fun schedulePeriodicSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = OneTimeWorkRequestBuilder<AttendanceSyncWorker>()
                .setConstraints(constraints)
                .setInitialDelay(2, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
        val rawQueue = prefs.getString(AttendanceBackgroundProcessor.KEY_OFFLINE_QUEUE, "[]") ?: "[]"
        val queue = JSONArray(rawQueue)

        if (queue.length() == 0) {
            return Result.success()
        }

        Log.i(TAG, "Starting sync for ${queue.length()} offline attendance events...")

        val serverBaseUrl = prefs.getString("server_base_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
        val remaining = JSONArray()

        for (i in 0 until queue.length()) {
            val item = queue.getJSONObject(i)
            val eventId = item.getString("id")
            val success = sendEventToServer(serverBaseUrl, item)

            if (!success) {
                remaining.put(item)
                Log.w(TAG, "Failed to sync event $eventId, keeping in queue.")
            } else {
                Log.i(TAG, "Successfully synced offline event $eventId to server.")
            }
        }

        prefs.edit().putString(AttendanceBackgroundProcessor.KEY_OFFLINE_QUEUE, remaining.toString()).apply()

        return if (remaining.length() > 0) Result.retry() else Result.success()
    }

    private fun sendEventToServer(baseUrl: String, item: JSONObject): Boolean {
        return try {
            val url = URL("$baseUrl/api/attendance/mark")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.doOutput = true

            val payload = JSONObject().apply {
                put("eventId", item.getString("id"))
                put("studentId", item.getString("studentId"))
                put("action", item.getString("action"))
                put("triggerType", item.optString("triggerType", "GEOFENCE_AUTO"))
                put("timestamp", item.getString("timestamp"))
                put("geofenceVersion", item.optString("geofenceVersion", "v1"))
                val loc = JSONObject().apply {
                    put("latitude", item.getDouble("latitude"))
                    put("longitude", item.getDouble("longitude"))
                    put("accuracy", item.optDouble("accuracy", 15.0))
                }
                put("location", loc)
                if (item.has("dwellMinutes")) {
                    put("dwellMinutes", item.getInt("dwellMinutes"))
                }
            }

            OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (e: Exception) {
            Log.e(TAG, "Sync request error: ${e.message}")
            false
        }
    }
}
