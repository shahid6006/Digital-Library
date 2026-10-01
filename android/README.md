# Digital Library Attendance — Platform Background Architecture Specification

## 1. Executive Summary & Platform Reality

Operating systems strictly manage application lifecycles and background resource consumption. Modern mobile operating systems (Android 10+, Android 14+ and iOS) enforce rigorous constraints on location tracking and background execution.

This document clearly specifies the operational boundaries and technical architecture across the five distinct platform execution states:

| Execution State | Web / PWA Capability | Native Android Capability | Attendance Behavior |
| :--- | :--- | :--- | :--- |
| **A. App / Browser Active (Foreground)** | Full GPS access via HTML5 Geolocation API (`navigator.geolocation.watchPosition`). High-accuracy coordinates, real-time route tracing. | Full GPS access via Google Play Services Fused Location Provider. | Immediate geofence transitions & continuous live waypoint logging. |
| **B. PWA Background / Suspended (Tab / App Minimized)** | Service Worker active, Web Notifications via `ServiceWorkerRegistration.showNotification`. Dwell countdown computed from persistent server timestamps. | Foreground Service (`FOREGROUND_SERVICE_TYPE_LOCATION`) with persistent notification continues GPS updates; hardware geofence triggers active. | Countdown ticks reliably via real timestamps. Re-entering immediately verifies elapsed dwell. |
| **C. Browser / PWA Completely Terminated (Killed by User / OS)** | **Web limitations:** Mobile OS halts the browser JavaScript runtime engine. Background GPS cannot run once the browser process is killed. | **Native Android advantage:** Android Geofencing API registered with Google Play Services wakes `GeofenceBroadcastReceiver` even when app is killed! | Native Android triggers automatic IN/OUT and posts system notification even while app is closed. |
| **D. Phone Locked (Screen Off)** | Browser sleeps unless held by Screen WakeLock or active media session. Persistent dwell timestamps remain stored in Firestore. | Doze mode / power-saving: Android Geofencing API batches location updates and triggers alarms on geofence transition. | Unlocking or reopening restores timestamp-computed state without resetting countdown. |
| **E. OS Background Restrictions (Battery Saver / Low Power)** | Browser restricts background network and timers. | Android `ACCESS_BACKGROUND_LOCATION` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` guarantee broadcast delivery. | WorkManager with exponential backoff guarantees sync once connectivity / power is restored. |

---

## 2. 1-Minute Dwell Timestamp Architecture

In accordance with strict system specifications:
- **Source of Truth:** Real ISO 8601 UTC timestamps stored in Firestore (`pendingGeofenceEntries/{studentId}`) and mirrored in `localStorage`.
- **Dwell Requirement:** Continuous 60 seconds (1 minute) inside the configured attendance geofence.
- **Formula:**
  $$\text{remainingSeconds} = \max(0, \text{requiredDwellSeconds} - (\text{currentServerTime} - \text{dwellStartTimestamp}))$$
- **App Termination Safe:** Closing the website or PWA at $t = +20\text{s}$ and reopening at $t = +45\text{s}$ displays approximately $15\text{s}$ remaining. The countdown NEVER restarts from 60 seconds.
- **Clock Manipulation Protection:** Local timestamps are adjusted by `clockOffsetMs = serverTime - clientLocalTime`.

---

## 3. Native Android Implementation Structure

For deployments requiring hardware-level background attendance when the app is completely terminated, this folder contains the native Android implementation:

- `AndroidManifest.xml`: Android 14+ permissions (`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`).
- `GeofenceBroadcastReceiver.kt`: Receives `GEOFENCE_TRANSITION_ENTER`, `GEOFENCE_TRANSITION_DWELL` (60s loitering delay), and `GEOFENCE_TRANSITION_EXIT`. Posts notifications and syncs with Firestore REST API.
- `LocationUpdatesForegroundService.kt`: Persistent foreground notification service for continuous tracking when active.
- `GeofenceManagerHelper.kt`: Utility to register circular geofences with Google Play Services GeofencingClient.
- `AttendanceSyncWorker.kt`: Jetpack WorkManager task for reliable offline-to-online synchronization.
