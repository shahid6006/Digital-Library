package com.digitallibrary.attendance

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * GeofenceManagerHelper
 *
 * Registers circular geofence boundaries with Google Play Services
 * with 60-second (1-minute) dwell loitering delay.
 */
class GeofenceManagerHelper(private val context: Context) {

    companion object {
        private const val TAG = "GeofenceManager"
        const val GEOFENCE_REQUEST_ID = "library_campus_geofence"
        const val DWELL_DELAY_MS = 60 * 1000 // Exactly 60 seconds (1 minute) dwell requirement
    }

    private val geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(context)
    private val prefs = context.getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java).apply {
            action = GeofenceBroadcastReceiver.ACTION_GEOFENCE_EVENT
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    /**
     * Builds and registers circular geofence with 60s loitering delay
     */
    @SuppressLint("MissingPermission")
    fun registerLibraryGeofence(
        latitude: Double,
        longitude: Double,
        radiusMeters: Float,
        version: String = "v1",
        onSuccess: () -> Unit = {},
        onFailure: (Exception) -> Unit = {}
    ) {
        // Save active geofence configuration to persistent SharedPreferences
        prefs.edit()
            .putFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LAT, latitude.toFloat())
            .putFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LON, longitude.toFloat())
            .putFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_RADIUS, radiusMeters)
            .putString(AttendanceBackgroundProcessor.KEY_GEOFENCE_VERSION, version)
            .putBoolean(AttendanceBackgroundProcessor.KEY_GEOFENCE_ENABLED, true)
            .apply()

        val geofence = Geofence.Builder()
            .setRequestId(GEOFENCE_REQUEST_ID)
            .setCircularRegion(latitude, longitude, radiusMeters)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(
                Geofence.GEOFENCE_TRANSITION_ENTER or
                Geofence.GEOFENCE_TRANSITION_DWELL or
                Geofence.GEOFENCE_TRANSITION_EXIT
            )
            .setLoiteringDelay(DWELL_DELAY_MS) // Exactly 1-minute continuous stay before triggering DWELL
            .setNotificationResponsiveness(3000) // 3 seconds responsiveness
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofence(geofence)
            .build()

        // Unregister existing before re-registering
        geofencingClient.removeGeofences(geofencePendingIntent)
            .addOnCompleteListener {
                geofencingClient.addGeofences(request, geofencePendingIntent)
                    .addOnSuccessListener {
                        Log.i(TAG, "Library geofence successfully registered at ($latitude, $longitude) radius: ${radiusMeters}m, version: $version")
                        onSuccess()
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "Failed to register library geofence: ${e.message}", e)
                        onFailure(e)
                    }
            }
    }

    fun removeLibraryGeofence(onComplete: () -> Unit = {}) {
        prefs.edit().putBoolean(AttendanceBackgroundProcessor.KEY_GEOFENCE_ENABLED, false).apply()
        geofencingClient.removeGeofences(geofencePendingIntent)
            .addOnCompleteListener { onComplete() }
    }
}
