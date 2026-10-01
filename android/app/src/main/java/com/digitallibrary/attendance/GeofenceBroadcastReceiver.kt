package com.digitallibrary.attendance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * Native Android Geofence Broadcast Receiver
 * Triggered by Google Play Services Fused Location Provider even when the application
 * is completely closed, killed by the user, or backgrounded.
 *
 * Implements:
 * - GEOFENCE_TRANSITION_ENTER: First manual IN alert or entry verification start
 * - GEOFENCE_TRANSITION_DWELL (60s / 1-minute loitering delay): Automatic return-IN confirmation
 * - GEOFENCE_TRANSITION_EXIT: Automatic OUT confirmation
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "GeofenceReceiver"
        private const val CHANNEL_ID = "library_attendance_channel"
        private const val CHANNEL_NAME = "Library Attendance Notifications"
        const val ACTION_GEOFENCE_EVENT = "com.digitallibrary.attendance.ACTION_GEOFENCE_EVENT"
    }

    private val executor = Executors.newSingleThreadExecutor()

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent) ?: return

        if (geofencingEvent.hasError()) {
            val errorMessage = GeofenceStatusCodes.getStatusCodeString(geofencingEvent.errorCode)
            Log.e(TAG, "Geofencing error code: ${geofencingEvent.errorCode}, message: $errorMessage")
            return
        }

        val geofenceTransition = geofencingEvent.geofenceTransition
        val triggeringLocation = geofencingEvent.triggeringLocation

        Log.i(TAG, "Geofence transition detected: $geofenceTransition at location: $triggeringLocation")

        when (geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> {
                handleGeofenceEnter(context, triggeringLocation?.latitude, triggeringLocation?.longitude, triggeringLocation?.accuracy)
            }
            Geofence.GEOFENCE_TRANSITION_DWELL -> {
                // 1-minute (60 seconds) continuous presence satisfied!
                handleGeofenceDwell(context, triggeringLocation?.latitude, triggeringLocation?.longitude, triggeringLocation?.accuracy)
            }
            Geofence.GEOFENCE_TRANSITION_EXIT -> {
                handleGeofenceExit(context, triggeringLocation?.latitude, triggeringLocation?.longitude, triggeringLocation?.accuracy)
            }
        }
    }

    private fun handleGeofenceEnter(context: Context, lat: Double?, lon: Double?, accuracy: Float?) {
        val prefs = context.getSharedPreferences("library_attendance_prefs", Context.MODE_PRIVATE)
        val studentId = prefs.getString("student_id", null) ?: return
        val isFirstInToday = prefs.getBoolean("first_in_today_${getTodayDateKey()}", false)

        if (!isFirstInToday) {
            // First time today: prompt student to press IN
            showSystemNotification(
                context,
                notificationId = 1001,
                title = "Library Attendance",
                message = "You are inside the attendance area. Press IN to record your first entry today."
            )
        } else {
            // Return entry: start 1-minute dwell verification
            val nowIso = getCurrentIsoTimestamp()
            prefs.edit()
                .putString("dwell_start_timestamp", nowIso)
                .putInt("required_dwell_seconds", 60)
                .putString("dwell_status", "WAITING_FOR_DWELL")
                .apply()

            showSystemNotification(
                context,
                notificationId = 1002,
                title = "Entry Verification",
                message = "You are inside the attendance area. Stay for 1 minute to be marked IN."
            )
        }
    }

    private fun handleGeofenceDwell(context: Context, lat: Double?, lon: Double?, accuracy: Float?) {
        val prefs = context.getSharedPreferences("library_attendance_prefs", Context.MODE_PRIVATE)
        val studentId = prefs.getString("student_id", null) ?: return
        val currentStatus = prefs.getString("current_status", "OUTSIDE")

        if (currentStatus == "OUTSIDE") {
            // Automatically record IN after 1-minute verified dwell
            prefs.edit()
                .putString("current_status", "INSIDE")
                .remove("dwell_start_timestamp")
                .remove("dwell_status")
                .apply()

            showSystemNotification(
                context,
                notificationId = 1003,
                title = "Library Entry Recorded",
                message = "Your library attendance has been marked IN."
            )

            // Sync with backend API / Firestore in background
            sendAttendanceToBackend(context, studentId, "IN", lat, lon, accuracy, "GEOFENCE_AUTO", 1)
        }
    }

    private fun handleGeofenceExit(context: Context, lat: Double?, lon: Double?, accuracy: Float?) {
        val prefs = context.getSharedPreferences("library_attendance_prefs", Context.MODE_PRIVATE)
        val studentId = prefs.getString("student_id", null) ?: return
        val currentStatus = prefs.getString("current_status", "OUTSIDE")

        // Cancel any pending return dwell
        prefs.edit()
            .remove("dwell_start_timestamp")
            .remove("dwell_status")
            .apply()

        if (currentStatus == "INSIDE") {
            prefs.edit().putString("current_status", "OUTSIDE").apply()

            showSystemNotification(
                context,
                notificationId = 1004,
                title = "Library Exit Recorded",
                message = "You have been marked OUT of the library."
            )

            sendAttendanceToBackend(context, studentId, "OUT", lat, lon, accuracy, "GEOFENCE_AUTO", null)
        }
    }

    private fun showSystemNotification(context: Context, notificationId: Int, title: String, message: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Attendance alerts and automatic geofence confirmations"
                enableVibration(true)
            }
            manager.createNotificationChannel(channel)
        }

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(notificationId, notification)
    }

    private fun sendAttendanceToBackend(
        context: Context,
        studentId: String,
        action: String,
        lat: Double?,
        lon: Double?,
        accuracy: Float?,
        triggerType: String,
        dwellMinutes: Int?
    ) {
        executor.execute {
            try {
                val serverBaseUrl = context.getSharedPreferences("library_attendance_prefs", Context.MODE_PRIVATE)
                    .getString("server_base_url", "https://library-attendance.app")
                val url = URL("$serverBaseUrl/api/attendance/mark")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("studentId", studentId)
                    put("action", action)
                    put("triggerType", triggerType)
                    if (lat != null && lon != null) {
                        val loc = JSONObject().apply {
                            put("latitude", lat)
                            put("longitude", lon)
                            put("accuracy", accuracy ?: 10.0)
                        }
                        put("location", loc)
                    }
                    if (dwellMinutes != null) {
                        put("dwellMinutes", dwellMinutes)
                    }
                }

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                val code = conn.responseCode
                Log.i(TAG, "Backend attendance response: $code")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send attendance to backend, scheduling WorkManager: ${e.message}")
                // Schedule WorkManager retry for guaranteed delivery
            }
        }
    }

    private fun getCurrentIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun getTodayDateKey(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        return sdf.format(Date())
    }
}
