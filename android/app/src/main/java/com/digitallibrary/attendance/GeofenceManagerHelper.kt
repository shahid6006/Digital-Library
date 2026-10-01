package com.digitallibrary.attendance

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * Helper to register and manage Android Geofencing API boundaries
 * with 60-second (1-minute) dwell delay.
 */
class GeofenceManagerHelper(private val context: Context) {

    companion object {
        private const val TAG = "GeofenceManager"
        const val GEOFENCE_REQUEST_ID = "library_campus_geofence"
        const val DWELL_DELAY_MS = 60 * 1000 // Exactly 60 seconds (1 minute) dwell requirement
    }

    private val geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(context)

    private val geofencePendingIntent: PendingIntent by lazy {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java).apply {
            action = GeofenceBroadcastReceiver.ACTION_GEOFENCE_EVENT
        }
        PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    /**
     * Builds and registers a circular geofence with 1-minute dwell loitering
     */
    @SuppressLint("MissingPermission")
    fun registerLibraryGeofence(
        latitude: Double,
        longitude: Double,
        radiusMeters: Float,
        onSuccess: () -> Unit,
        onFailure: (Exception) -> Unit
    ) {
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
            .setNotificationResponsiveness(5000) // 5 seconds responsiveness
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofence(geofence)
            .build()

        geofencingClient.addGeofences(request, geofencePendingIntent)
            .addOnSuccessListener {
                Log.i(TAG, "Library geofence successfully registered at ($latitude, $longitude) radius: ${radiusMeters}m with 60s dwell")
                onSuccess()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to register library geofence: ${e.message}", e)
                onFailure(e)
            }
    }

    fun removeLibraryGeofence(onComplete: () -> Unit = {}) {
        geofencingClient.removeGeofences(listOf(GEOFENCE_REQUEST_ID))
            .addOnCompleteListener { onComplete() }
    }
}
