package com.digitallibrary.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * Native Android Geofence Broadcast Receiver
 *
 * Triggered by Google Play Services Fused Location Provider and AlarmManager
 * even when the application is completely closed, killed by the user,
 * removed from recent tasks, or phone is locked.
 *
 * Uses goAsync() to safely hold the wake lock while evaluating location and
 * transmitting attendance to Firestore / backend.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "GeofenceReceiver"
        const val ACTION_GEOFENCE_EVENT = "com.digitallibrary.attendance.ACTION_GEOFENCE_EVENT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "onReceive invoked with action: $action")

        val processor = AttendanceBackgroundProcessor(context)

        // Case 1: Dwell Alarm trigger (fallback 60s verification)
        if (action == AttendanceBackgroundProcessor.ACTION_DWELL_TIMER_ALARM) {
            val pendingResult = goAsync()
            processor.processGeofenceDwell(null, null, null) {
                pendingResult.finish()
            }
            return
        }

        // Case 2: Geofencing event from Google Play Services
        val geofencingEvent = GeofencingEvent.fromIntent(intent) ?: return

        if (geofencingEvent.hasError()) {
            val errorMessage = GeofenceStatusCodes.getStatusCodeString(geofencingEvent.errorCode)
            Log.e(TAG, "Geofencing error code: ${geofencingEvent.errorCode}, message: $errorMessage")
            return
        }

        val geofenceTransition = geofencingEvent.geofenceTransition
        val triggeringLocation = geofencingEvent.triggeringLocation
        val lat = triggeringLocation?.latitude
        val lon = triggeringLocation?.longitude
        val acc = triggeringLocation?.accuracy

        Log.i(TAG, "Geofence transition: $geofenceTransition at ($lat, $lon) acc: ${acc}m")

        val pendingResult = goAsync()

        when (geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> {
                processor.processGeofenceEnter(lat, lon, acc)
                pendingResult.finish()
            }
            Geofence.GEOFENCE_TRANSITION_DWELL -> {
                // OS-level 60-second loitering delay satisfied
                processor.processGeofenceDwell(lat, lon, acc) {
                    pendingResult.finish()
                }
            }
            Geofence.GEOFENCE_TRANSITION_EXIT -> {
                // Exit detected: initiate exit validation & mark OUT
                processor.processGeofenceExit(lat, lon, acc) {
                    pendingResult.finish()
                }
            }
            else -> {
                pendingResult.finish()
            }
        }
    }
}
