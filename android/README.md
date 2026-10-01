# Digital Library Attendance — Native Android Background Geofencing System

## 1. Executive Summary & Android Hardware Reality

Modern Android OS versions (Android 10 through Android 14+) enforce strict restrictions on background execution, background location polling, and memory management. Standard web browsers (Chrome, Safari, Firefox), PWAs, and WebViews have their JavaScript execution contexts frozen or terminated by the operating system when the user:
- Closes the application
- Swipes the application away from the recent apps / task switcher
- Locks the phone (screen off / Doze mode)
- Leaves the app in the background

**The Solution:** This project implements native Android OS-level hardware geofencing (`GeofencingClient`, `GeofenceBroadcastReceiver`, `PendingIntent`, and `FusedLocationProviderClient`).

Unlike JavaScript timers (`setInterval`, `setTimeout`), the Android operating system kernel and Google Play Services wake the `GeofenceBroadcastReceiver` directly via a system broadcast when the physical geofence boundary is crossed—**even when the application process is completely killed or swiped away**.

---

## 2. Architecture & Component Diagram

```text
       [ Android OS / Google Play Services Fused Location ]
                                |
                 Hardware Geofence Transition
              (ENTER / DWELL 60s / EXIT Events)
                                |
                                v
               [ GeofenceBroadcastReceiver.kt ]
                     (woken via PendingIntent)
                                |
                                v
             [ AttendanceBackgroundProcessor.kt ]
      /                         |                         \
     v                          v                          v
[ NotificationHelper ]  [ Location Validation ]   [ Persistent State ]
 Native Notification:    FusedLocationProvider:    - SharedPreferences
 "You are marked IN      Validate distance <= r    - Firestore REST
  after 1 min dwell"     & accuracy <= 100m        - /api/attendance/mark
                                |
                                v
                   [ AttendanceSyncWorker.kt ]
                    WorkManager (if offline)
```

---

## 3. Persistent 1-Minute Dwell Architecture

To satisfy **Section 6 & 7 (Persistent 1-Minute Dwell)**:
1. **GEOFENCE ENTER:**
   - Android OS detects entry.
   - `AttendanceBackgroundProcessor` writes a persistent dwell entry with:
     * `studentId`: Authenticated student ID
     * `dwellStartTimestamp`: ISO 8601 UTC server/hardware timestamp
     * `requiredDwellSeconds`: 60
     * `status`: `WAITING_FOR_DWELL`
     * `enterLatitude`, `enterLongitude`, `enterAccuracy`
     * `uniquePendingId`: UUID
   - Saved in persistent Android `SharedPreferences` and mirrored to Firestore (`attendanceDwellStates/{studentId}`).
   - Dispatches native notification:
     * **Title:** *Library Attendance*
     * **Message:** *You are inside the attendance area. Stay for 1 minute or press IN NOW.*
   - Schedules fallback AlarmManager alarm for $t = +60\text{s}$.
2. **App Swiped Away / Phone Locked:**
   - Dwell timestamp remains preserved in non-volatile flash storage.
   - Closing or killing the app **NEVER** resets the dwell timestamp.
   - If the student opens the app at $t = +25\text{s}$, the remaining time is calculated directly:
     $$\text{remaining} = \max(0, 60 - (\text{currentTime} - \text{dwellStartTimestamp})) = 35\text{s}$$
3. **60 Seconds Dwell Elapses:**
   - Triggered either by Google Play Services `GEOFENCE_TRANSITION_DWELL` (configured with `setLoiteringDelay(60000)`) or the AlarmManager wake-up alarm.
   - **Verification:** `AttendanceBackgroundProcessor` calls `FusedLocationProviderClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY)`.
   - Validates that:
     * Student is still within the configured geofence radius (plus accuracy tolerance).
     * Accuracy reading is reliable ($\le 100\text{m}$).
     * Student status is still `OUTSIDE` and no manual attendance was logged in the interim (idempotency).
4. **AUTO IN:**
   - Generates unique UUID `eventId`.
   - Updates persistent status to `INSIDE`.
   - Clears pending dwell state.
   - Dispatches native notification:
     * **Title:** *Library Attendance*
     * **Message:** *You have been automatically marked IN after staying inside the attendance area for 1 minute.*
   - Posts attendance record to backend `/api/attendance/mark` and Firestore.

---

## 4. Automatic OUT & Exit Hysteresis

When a student who is currently `INSIDE` leaves the library:
1. **GEOFENCE EXIT:**
   - Android OS wakes `GeofenceBroadcastReceiver` with `GEOFENCE_TRANSITION_EXIT`.
2. **Debounce & Validation:**
   - Verifies student is currently marked `INSIDE`.
   - Cancels any pending dwell state.
   - Confirms distance is outside the boundary to avoid GPS jitter/multipath errors.
3. **AUTO OUT:**
   - Updates status to `OUTSIDE`.
   - Generates unique UUID `eventId`.
   - Dispatches native notification:
     * **Title:** *Library Attendance*
     * **Message:** *You have been automatically marked OUT after leaving the attendance area.*
   - Transmits OUT record with `triggerType = "GEOFENCE_AUTO"` to `/api/attendance/mark`.

---

## 5. Return After AUTO OUT (Multiple Cycles Per Day)

When the student returns to the library later:
- The system recognizes student is `OUTSIDE`.
- Detection of `GEOFENCE_TRANSITION_ENTER` starts a **brand new** dwell state with a fresh `dwellStartTimestamp`.
- Previous timestamps are never reused.
- Multiple cycles ($IN \to OUT \to IN \to OUT$) are fully supported throughout the day.

---

## 6. Coexistence of Manual and Automatic IN/OUT

No separate modes exist. Both work concurrently:
- While `WAITING_FOR_DWELL`: UI displays `[ IN NOW ]` and countdown `Automatic IN in 00:43`.
  If student taps `IN NOW`, the system marks `triggerType = "MANUAL"` and immediately cancels the pending automatic dwell.
- While `INSIDE`: UI displays `[ OUT NOW ]`.
  If student taps `OUT NOW`, it records `triggerType = "MANUAL"` and cancels any pending automatic exit checks.

---

## 7. Android Permissions & Sequence

1. `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`: Requested foreground first.
2. `POST_NOTIFICATIONS` (Android 13+): Requested for background notification delivery.
3. `ACCESS_BACKGROUND_LOCATION` (Android 10+): Prompted with user explanation:
   > *"Background location is required so library attendance can automatically detect entry and exit even when the app is closed."*
4. `RECEIVE_BOOT_COMPLETED`: Restores geofence registration after phone reboots via `BootReceiver.kt`.
5. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`: Whitelists application from aggressive OS battery killing.

---

## 8. Battery Optimization & Device Manufacturer Guidelines

Some Android vendors (Xiaomi/MIUI, Huawei, Samsung, OnePlus) aggressively restrict background apps. For 100% reliability:
1. Open Android **App Info** $\to$ **Battery** $\to$ select **Unrestricted**.
2. Enable **Autostart** / **Allow background activity** in manufacturer power management settings.
3. In `MainActivity`, call `AndroidBridge.openBatteryOptimizationSettings()` to guide the student directly to device settings.
