package com.digitallibrary.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver
 *
 * Listens for ACTION_BOOT_COMPLETED and ACTION_MY_PACKAGE_REPLACED to restore
 * geofence registrations with Google Play Services across phone reboots and app updates.
 *
 * Preserves existing dwellStartTimestamp and student status without resetting.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "BootReceiver received action: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val prefs = context.getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
            val studentId = prefs.getString(AttendanceBackgroundProcessor.KEY_STUDENT_ID, null)
            val geofenceEnabled = prefs.getBoolean(AttendanceBackgroundProcessor.KEY_GEOFENCE_ENABLED, false)

            if (studentId.isNullOrEmpty() || !geofenceEnabled) {
                Log.i(TAG, "No active student session or geofence disabled. Skipping re-registration.")
                return
            }

            val lat = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LAT, 33.7782f).toDouble()
            val lon = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LON, 75.1495f).toDouble()
            val radius = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_RADIUS, 100f)
            val version = prefs.getString(AttendanceBackgroundProcessor.KEY_GEOFENCE_VERSION, "v1") ?: "v1"

            Log.i(TAG, "Restoring library geofence after reboot for student $studentId at ($lat, $lon, r=${radius}m)")

            val geofenceHelper = GeofenceManagerHelper(context)
            try {
                geofenceHelper.registerLibraryGeofence(
                    latitude = lat,
                    longitude = lon,
                    radiusMeters = radius,
                    version = version,
                    onSuccess = {
                        Log.i(TAG, "Geofence successfully re-registered after device reboot.")
                    },
                    onFailure = { e ->
                        Log.e(TAG, "Failed to re-register geofence after reboot: ${e.message}")
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error in BootReceiver: ${e.message}", e)
            }
        }
    }
}
