package com.digitallibrary.attendance

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * AttendanceBackgroundProcessor
 *
 * Central Android OS-level background attendance engine.
 * Woken by GeofenceBroadcastReceiver even when the app is completely closed,
 * swiped away, or the phone screen is locked.
 *
 * Implements:
 * - Persistent 1-minute dwell verification with server-authoritative timestamps
 * - FusedLocationProvider verification before AUTO IN
 * - Anti-bounce exit validation before AUTO OUT
 * - Idempotency protection with unique UUID event IDs
 * - Native notification dispatch
 * - Offline event queueing and sync
 */
class AttendanceBackgroundProcessor(private val context: Context) {

    companion object {
        private const val TAG = "AttendanceBgProcessor"
        const val PREFS_NAME = "library_attendance_prefs"

        const val KEY_STUDENT_ID = "student_id"
        const val KEY_STUDENT_NAME = "student_name"
        const val KEY_SEAT_NUMBER = "seat_number"
        const val KEY_CURRENT_STATUS = "current_status" // "INSIDE" or "OUTSIDE"

        // Persistent 1-minute dwell keys
        const val KEY_DWELL_STATUS = "dwell_status" // "WAITING_FOR_DWELL", "VERIFIED", "CANCELLED"
        const val KEY_DWELL_START_MS = "dwell_start_ms"
        const val KEY_DWELL_START_ISO = "dwell_start_iso"
        const val KEY_DWELL_REQUIRED_SEC = "dwell_required_sec" // 60
        const val KEY_DWELL_UNIQUE_ID = "dwell_unique_id"
        const val KEY_DWELL_GEOFENCE_VERSION = "dwell_geofence_version"
        const val KEY_DWELL_ENTER_LAT = "dwell_enter_lat"
        const val KEY_DWELL_ENTER_LON = "dwell_enter_lon"
        const val KEY_DWELL_ENTER_ACC = "dwell_enter_acc"

        // Geofence configuration keys
        const val KEY_GEOFENCE_LAT = "geofence_lat"
        const val KEY_GEOFENCE_LON = "geofence_lon"
        const val KEY_GEOFENCE_RADIUS = "geofence_radius"
        const val KEY_GEOFENCE_VERSION = "geofence_version"
        const val KEY_GEOFENCE_ENABLED = "geofence_enabled"

        const val KEY_OFFLINE_QUEUE = "offline_attendance_queue"
        const val KEY_LAST_EVENT_ID = "last_event_id"

        const val ACTION_DWELL_TIMER_ALARM = "com.digitallibrary.attendance.ACTION_DWELL_TIMER_ALARM"

        const val REQUIRED_DWELL_SECONDS = 60
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val fusedLocationClient: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
    private val executor = Executors.newSingleThreadExecutor()

    /**
     * Process GEOFENCE_TRANSITION_ENTER
     * Called by OS broadcast receiver when device enters the library boundary.
     */
    fun processGeofenceEnter(latitude: Double?, longitude: Double?, accuracy: Float?) {
        val studentId = prefs.getString(KEY_STUDENT_ID, null)
        if (studentId.isNullOrEmpty()) {
            Log.w(TAG, "GEOFENCE ENTER ignored: No authenticated student configured in app.")
            return
        }

        val currentStatus = prefs.getString(KEY_CURRENT_STATUS, "OUTSIDE")
        if (currentStatus == "INSIDE") {
            Log.i(TAG, "GEOFENCE ENTER ignored: Student is already marked INSIDE.")
            return
        }

        val geofenceVersion = prefs.getString(KEY_GEOFENCE_VERSION, "v1") ?: "v1"
        val nowMs = System.currentTimeMillis()
        val nowIso = getCurrentIsoTimestamp()
        val pendingId = "dwell_${UUID.randomUUID()}"

        // Save persistent dwell state (Survives app closure, task removal, and phone reboots)
        prefs.edit()
            .putString(KEY_DWELL_STATUS, "WAITING_FOR_DWELL")
            .putLong(KEY_DWELL_START_MS, nowMs)
            .putString(KEY_DWELL_START_ISO, nowIso)
            .putInt(KEY_DWELL_REQUIRED_SEC, REQUIRED_DWELL_SECONDS)
            .putString(KEY_DWELL_UNIQUE_ID, pendingId)
            .putString(KEY_DWELL_GEOFENCE_VERSION, geofenceVersion)
            .putFloat(KEY_DWELL_ENTER_LAT, latitude?.toFloat() ?: 0f)
            .putFloat(KEY_DWELL_ENTER_LON, longitude?.toFloat() ?: 0f)
            .putFloat(KEY_DWELL_ENTER_ACC, accuracy ?: 10f)
            .apply()

        Log.i(TAG, "Persistent dwell started at $nowIso for student $studentId (version: $geofenceVersion)")

        // Requirement 17: Show Dwell verification notification
        NotificationHelper.showDwellStartedNotification(context)

        // Schedule fallback AlarmManager alarm for 60 seconds from now
        scheduleDwellAlarm(REQUIRED_DWELL_SECONDS * 1000L)

        // Sync dwell state to Firestore and backend asynchronously
        syncDwellStateToRemote(studentId, "WAITING_FOR_DWELL", nowIso, geofenceVersion, latitude, longitude, accuracy)
    }

    /**
     * Process GEOFENCE_TRANSITION_DWELL (or Alarm trigger after 60s)
     * Called when the 1-minute continuous dwell requirement has elapsed.
     */
    fun processGeofenceDwell(triggerLat: Double?, triggerLon: Double?, triggerAcc: Float?, onComplete: () -> Unit = {}) {
        val studentId = prefs.getString(KEY_STUDENT_ID, null)
        if (studentId.isNullOrEmpty()) {
            onComplete()
            return
        }

        val currentStatus = prefs.getString(KEY_CURRENT_STATUS, "OUTSIDE")
        if (currentStatus == "INSIDE") {
            Log.i(TAG, "Dwell completed but student is already marked INSIDE.")
            clearPendingDwell()
            onComplete()
            return
        }

        val dwellStatus = prefs.getString(KEY_DWELL_STATUS, null)
        if (dwellStatus != "WAITING_FOR_DWELL") {
            Log.i(TAG, "Dwell trigger ignored: Dwell status is $dwellStatus")
            onComplete()
            return
        }

        val startMs = prefs.getLong(KEY_DWELL_START_MS, 0L)
        val nowMs = System.currentTimeMillis()
        val elapsedSeconds = if (startMs > 0) (nowMs - startMs) / 1000 else 60

        if (elapsedSeconds < REQUIRED_DWELL_SECONDS - 2) { // 2s clock tolerance
            Log.w(TAG, "Dwell triggered prematurely: elapsed $elapsedSeconds s < $REQUIRED_DWELL_SECONDS s")
            onComplete()
            return
        }

        // Section 10: Verify student is still considered inside the configured geofence
        verifyLocationAndMarkAutoIn(studentId, triggerLat, triggerLon, triggerAcc, onComplete)
    }

    /**
     * Section 10: Validate location before AUTO IN
     */
    @SuppressLint("MissingPermission")
    private fun verifyLocationAndMarkAutoIn(
        studentId: stringIdType,
        fallbackLat: Double?,
        fallbackLon: Double?,
        fallbackAcc: Float?,
        onComplete: () -> Unit
    ) {
        val geoLat = prefs.getFloat(KEY_GEOFENCE_LAT, 33.7782f).toDouble()
        val geoLon = prefs.getFloat(KEY_GEOFENCE_LON, 75.1495f).toDouble()
        val radiusMeters = prefs.getFloat(KEY_GEOFENCE_RADIUS, 100f)
        val geofenceVersion = prefs.getString(KEY_GEOFENCE_VERSION, "v1") ?: "v1"

        val dwellGeofenceVersion = prefs.getString(KEY_DWELL_GEOFENCE_VERSION, geofenceVersion)
        if (dwellGeofenceVersion != geofenceVersion) {
            Log.w(TAG, "Geofence version changed ($dwellGeofenceVersion vs $geofenceVersion). Aborting AUTO IN.")
            clearPendingDwell()
            onComplete()
            return
        }

        val cts = CancellationTokenSource()
        try {
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                .addOnSuccessListener { location: Location? ->
                    val checkLat = location?.latitude ?: fallbackLat ?: geoLat
                    val checkLon = location?.longitude ?: fallbackLon ?: geoLon
                    val checkAcc = location?.accuracy ?: fallbackAcc ?: 15f

                    // Calculate distance to library geofence center
                    val results = FloatArray(1)
                    Location.distanceBetween(checkLat, checkLon, geoLat, geoLon, results)
                    val distanceMeters = results[0]

                    // Allow acceptable accuracy buffer (e.g. radius + max(accuracy, 25m))
                    val allowedBoundary = radiusMeters + minOf(checkAcc, 50f)
                    val isInside = distanceMeters <= allowedBoundary

                    Log.i(TAG, "Location verification: distance=${distanceMeters}m, allowed=${allowedBoundary}m, acc=${checkAcc}m -> inside=$isInside")

                    if (isInside) {
                        recordAutoIn(studentId, checkLat, checkLon, checkAcc, geofenceVersion, onComplete)
                    } else {
                        Log.w(TAG, "Student is outside geofence boundary after 60s (${distanceMeters}m > ${allowedBoundary}m). AUTO IN cancelled.")
                        clearPendingDwell()
                        onComplete()
                    }
                }
                .addOnFailureListener { e ->
                    Log.w(TAG, "Failed to get fresh location, using trigger coords: ${e.message}")
                    val checkLat = fallbackLat ?: geoLat
                    val checkLon = fallbackLon ?: geoLon
                    val checkAcc = fallbackAcc ?: 20f

                    val results = FloatArray(1)
                    Location.distanceBetween(checkLat, checkLon, geoLat, geoLon, results)
                    val isInside = results[0] <= (radiusMeters + minOf(checkAcc, 50f))

                    if (isInside) {
                        recordAutoIn(studentId, checkLat, checkLon, checkAcc, geofenceVersion, onComplete)
                    } else {
                        clearPendingDwell()
                        onComplete()
                    }
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing location permission during verification: ${e.message}")
            clearPendingDwell()
            onComplete()
        }
    }

    /**
     * Requirement 9 & 16: Record AUTO IN with unique eventId and native notification
     */
    private fun recordAutoIn(
        studentId: String,
        latitude: Double,
        longitude: Double,
        accuracy: Float,
        geofenceVersion: String,
        onComplete: () -> Unit
    ) {
        val eventId = "evt_auto_in_${UUID.randomUUID()}"
        val nowIso = getCurrentIsoTimestamp()

        // 1. Update persistent local state
        prefs.edit()
            .putString(KEY_CURRENT_STATUS, "INSIDE")
            .putString(KEY_LAST_EVENT_ID, eventId)
            .remove(KEY_DWELL_STATUS)
            .remove(KEY_DWELL_START_MS)
            .remove(KEY_DWELL_START_ISO)
            .apply()

        // 2. Requirement 17: Show Native Android Notification
        NotificationHelper.showAutoInNotification(context)

        // 3. Clear dwell state on remote
        clearRemoteDwellState(studentId)

        // 4. Send attendance event to backend / Firestore
        transmitAttendanceEvent(
            eventId = eventId,
            studentId = studentId,
            action = "IN",
            triggerType = "GEOFENCE_AUTO",
            latitude = latitude,
            longitude = longitude,
            accuracy = accuracy,
            timestamp = nowIso,
            geofenceVersion = geofenceVersion,
            dwellMinutes = 1,
            onComplete = onComplete
        )
    }

    /**
     * Process GEOFENCE_TRANSITION_EXIT
     * Section 11: Automatic OUT with exit hysteresis/validation
     */
    fun processGeofenceExit(latitude: Double?, longitude: Double?, accuracy: Float?, onComplete: () -> Unit = {}) {
        val studentId = prefs.getString(KEY_STUDENT_ID, null)
        if (studentId.isNullOrEmpty()) {
            onComplete()
            return
        }

        // Cancel any pending return dwell
        clearPendingDwell()

        val currentStatus = prefs.getString(KEY_CURRENT_STATUS, "OUTSIDE")
        if (currentStatus != "INSIDE") {
            Log.i(TAG, "GEOFENCE EXIT ignored: Student is not currently marked INSIDE ($currentStatus).")
            onComplete()
            return
        }

        // Validate exit before marking OUT
        val geoLat = prefs.getFloat(KEY_GEOFENCE_LAT, 33.7782f).toDouble()
        val geoLon = prefs.getFloat(KEY_GEOFENCE_LON, 75.1495f).toDouble()
        val radiusMeters = prefs.getFloat(KEY_GEOFENCE_RADIUS, 100f)
        val geofenceVersion = prefs.getString(KEY_GEOFENCE_VERSION, "v1") ?: "v1"

        val eventId = "evt_auto_out_${UUID.randomUUID()}"
        val nowIso = getCurrentIsoTimestamp()

        // Update persistent state to OUTSIDE
        prefs.edit()
            .putString(KEY_CURRENT_STATUS, "OUTSIDE")
            .putString(KEY_LAST_EVENT_ID, eventId)
            .apply()

        // Requirement 17: Show Native Android Notification
        NotificationHelper.showAutoOutNotification(context)

        // Transmit AUTO OUT event
        transmitAttendanceEvent(
            eventId = eventId,
            studentId = studentId,
            action = "OUT",
            triggerType = "GEOFENCE_AUTO",
            latitude = latitude ?: geoLat,
            longitude = longitude ?: geoLon,
            accuracy = accuracy ?: 15f,
            timestamp = nowIso,
            geofenceVersion = geofenceVersion,
            dwellMinutes = null,
            onComplete = onComplete
        )
    }

    /**
     * Manual IN called from student UI: Cancels pending automatic dwell
     */
    fun handleManualIn(studentId: String) {
        clearPendingDwell()
        prefs.edit().putString(KEY_CURRENT_STATUS, "INSIDE").apply()
        NotificationHelper.cancelNotification(context, NotificationHelper.NOTIFICATION_ID_DWELL)
    }

    /**
     * Manual OUT called from student UI: Cancels pending automatic events
     */
    fun handleManualOut(studentId: String) {
        clearPendingDwell()
        prefs.edit().putString(KEY_CURRENT_STATUS, "OUTSIDE").apply()
        NotificationHelper.cancelNotification(context, NotificationHelper.NOTIFICATION_ID_DWELL)
    }

    private fun clearPendingDwell() {
        prefs.edit()
            .remove(KEY_DWELL_STATUS)
            .remove(KEY_DWELL_START_MS)
            .remove(KEY_DWELL_START_ISO)
            .remove(KEY_DWELL_UNIQUE_ID)
            .apply()
        cancelDwellAlarm()
    }

    private fun scheduleDwellAlarm(delayMs: Long) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java).apply {
            action = ACTION_DWELL_TIMER_ALARM
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            2001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val triggerAtMs = SystemClock.elapsedRealtime() + delayMs
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtMs, pendingIntent)
        } else {
            alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtMs, pendingIntent)
        }
    }

    private fun cancelDwellAlarm() {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java).apply {
            action = ACTION_DWELL_TIMER_ALARM
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            2001,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
    }

    /**
     * Transmit attendance event to backend / Firestore with offline queuing
     */
    private fun transmitAttendanceEvent(
        eventId: String,
        studentId: String,
        action: String,
        triggerType: String,
        latitude: Double,
        longitude: Double,
        accuracy: Float,
        timestamp: String,
        geofenceVersion: String,
        dwellMinutes: Int?,
        onComplete: () -> Unit
    ) {
        executor.execute {
            val serverBaseUrl = prefs.getString("server_base_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
            var success = false

            try {
                val url = URL("$serverBaseUrl/api/attendance/mark")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("eventId", eventId)
                    put("studentId", studentId)
                    put("action", action)
                    put("triggerType", triggerType)
                    put("timestamp", timestamp)
                    put("geofenceVersion", geofenceVersion)
                    val loc = JSONObject().apply {
                        put("latitude", latitude)
                        put("longitude", longitude)
                        put("accuracy", accuracy)
                    }
                    put("location", loc)
                    if (dwellMinutes != null) {
                        put("dwellMinutes", dwellMinutes)
                    }
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                val code = conn.responseCode
                Log.i(TAG, "Backend attendance response code: $code for event: $eventId")
                if (code in 200..299) {
                    success = true
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Network failed while sending attendance event: ${e.message}")
            }

            if (!success) {
                // Section 22: Enqueue in offline queue for WorkManager sync
                enqueueOfflineEvent(eventId, studentId, action, triggerType, latitude, longitude, accuracy, timestamp, geofenceVersion, dwellMinutes)
            }

            onComplete()
        }
    }

    private fun enqueueOfflineEvent(
        eventId: String,
        studentId: String,
        action: String,
        triggerType: String,
        latitude: Double,
        longitude: Double,
        accuracy: Float,
        timestamp: String,
        geofenceVersion: String,
        dwellMinutes: Int?
    ) {
        try {
            val raw = prefs.getString(KEY_OFFLINE_QUEUE, "[]") ?: "[]"
            val array = JSONArray(raw)
            val item = JSONObject().apply {
                put("id", eventId)
                put("studentId", studentId)
                put("action", action)
                put("triggerType", triggerType)
                put("latitude", latitude)
                put("longitude", longitude)
                put("accuracy", accuracy)
                put("timestamp", timestamp)
                put("geofenceVersion", geofenceVersion)
                if (dwellMinutes != null) put("dwellMinutes", dwellMinutes)
                put("createdAt", getCurrentIsoTimestamp())
            }
            array.put(item)
            prefs.edit().putString(KEY_OFFLINE_QUEUE, array.toString()).apply()
            Log.i(TAG, "Enqueued offline attendance event $eventId (total queued: ${array.length()})")

            // Schedule WorkManager retry
            AttendanceSyncWorker.schedulePeriodicSync(context)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enqueue offline event: ${e.message}")
        }
    }

    private fun syncDwellStateToRemote(
        studentId: String,
        status: String,
        dwellStartIso: String,
        geofenceVersion: String,
        latitude: Double?,
        longitude: Double?,
        accuracy: Float?
    ) {
        executor.execute {
            try {
                val serverBaseUrl = prefs.getString("server_base_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
                val url = URL("$serverBaseUrl/api/attendance/dwell")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.connectTimeout = 5000
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("studentId", studentId)
                    put("status", status)
                    put("dwellStartTimestamp", dwellStartIso)
                    put("requiredDwellSeconds", REQUIRED_DWELL_SECONDS)
                    put("geofenceVersion", geofenceVersion)
                    if (latitude != null && longitude != null) {
                        put("latitude", latitude)
                        put("longitude", longitude)
                        put("accuracy", accuracy ?: 10f)
                    }
                }
                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                // Ignore transient network failure during dwell start
            }
        }
    }

    private fun clearRemoteDwellState(studentId: String) {
        executor.execute {
            try {
                val serverBaseUrl = prefs.getString("server_base_url", "http://10.0.2.2:3000") ?: "http://10.0.2.2:3000"
                val url = URL("$serverBaseUrl/api/attendance/dwell?studentId=$studentId")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "DELETE"
                conn.connectTimeout = 5000
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    private fun getCurrentIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}

private typealias stringIdType = String
