package com.digitallibrary.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * MainActivity
 *
 * Hosts the Digital Library interface and provides a native Android bridge
 * for hardware-level background geofencing, location permission requests,
 * and battery optimization whitelisting.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val DEFAULT_WEB_URL = "http://10.0.2.2:3000"
    }

    private lateinit var webView: WebView
    private lateinit var geofenceHelper: GeofenceManagerHelper
    private lateinit var processor: AttendanceBackgroundProcessor

    // Permission Launchers
    private val foregroundPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions[Manifest.permission.POST_NOTIFICATIONS] ?: false
        } else true

        Log.i(TAG, "Foreground permissions result: fineLocation=$fineGranted, notif=$notifGranted")

        if (fineGranted) {
            // Step 2: Request Background Location (Android 10+)
            checkAndRequestBackgroundLocation()
        } else {
            showPermissionExplanationDialog(
                title = "Location Permission Required",
                message = "Precise location is required for the library attendance system to verify your campus presence.",
                isMandatory = true
            )
        }
    }

    private val backgroundLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.i(TAG, "Background location permission result: $isGranted")
        if (isGranted) {
            Toast.makeText(this, "Background attendance monitoring active", Toast.LENGTH_SHORT).show()
            reRegisterActiveGeofenceIfConfigured()
        } else {
            showPermissionExplanationDialog(
                title = "Background Location Recommended",
                message = "Without 'Allow all the time' location access, automatic attendance cannot trigger when the app is closed. You will need to keep the app open to mark attendance.",
                isMandatory = false
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize notification channel
        NotificationHelper.createNotificationChannel(this)

        geofenceHelper = GeofenceManagerHelper(this)
        processor = AttendanceBackgroundProcessor(this)

        webView = WebView(this)
        setContentView(webView)

        configureWebView()

        // Request initial permissions in proper Android sequence
        requestForegroundLocationAndNotifications()

        // Load application URL
        val appUrl = intent?.getStringExtra("app_url") ?: DEFAULT_WEB_URL
        webView.loadUrl(appUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.setGeolocationEnabled(true)
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                // Grant geolocation to the library web interface
                callback?.invoke(origin, true, false)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Page loaded: $url")
            }
        }

        // Expose native Android bridge to web application
        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")
    }

    private fun requestForegroundLocationAndNotifications() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        foregroundPermissionsLauncher.launch(permissions.toTypedArray())
    }

    private fun checkAndRequestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val bgGranted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!bgGranted) {
                AlertDialog.Builder(this)
                    .setTitle("Automatic Attendance in Background")
                    .setMessage("Background location is required so library attendance can automatically detect entry and exit even when the app is closed, locked, or swiped away.\n\nPlease choose 'Allow all the time' in the next prompt.")
                    .setPositiveButton("Continue") { _, _ ->
                        backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    }
                    .setNegativeButton("Manual Only") { dialog, _ ->
                        dialog.dismiss()
                    }
                    .show()
            } else {
                reRegisterActiveGeofenceIfConfigured()
            }
        } else {
            reRegisterActiveGeofenceIfConfigured()
        }
    }

    private fun reRegisterActiveGeofenceIfConfigured() {
        val prefs = getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
        val lat = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LAT, 0f).toDouble()
        val lon = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_LON, 0f).toDouble()
        val radius = prefs.getFloat(AttendanceBackgroundProcessor.KEY_GEOFENCE_RADIUS, 0f)
        val version = prefs.getString(AttendanceBackgroundProcessor.KEY_GEOFENCE_VERSION, "v1") ?: "v1"

        if (lat != 0.0 && lon != 0.0 && radius > 0) {
            geofenceHelper.registerLibraryGeofence(lat, lon, radius, version)
        }
    }

    private fun showPermissionExplanationDialog(title: String, message: String, isMandatory: Boolean) {
        val builder = AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Open Settings") { _, _ ->
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                }
                startActivity(intent)
            }

        if (!isMandatory) {
            builder.setNegativeButton("Dismiss", null)
        }
        builder.show()
    }

    /**
     * JavaScript Bridge Interface exposed to React Web Application
     */
    inner class AndroidBridge {

        @JavascriptInterface
        fun isNativeAndroid(): Boolean = true

        @JavascriptInterface
        fun setStudentSession(studentId: String, fullName: String, seatNumber: Int, token: String) {
            val prefs = getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(AttendanceBackgroundProcessor.KEY_STUDENT_ID, studentId)
                .putString(AttendanceBackgroundProcessor.KEY_STUDENT_NAME, fullName)
                .putInt(AttendanceBackgroundProcessor.KEY_SEAT_NUMBER, seatNumber)
                .putString("auth_token", token)
                .apply()
            Log.i(TAG, "Student session saved to native storage: $studentId ($fullName, Seat #$seatNumber)")
        }

        @JavascriptInterface
        fun clearStudentSession() {
            val prefs = getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .remove(AttendanceBackgroundProcessor.KEY_STUDENT_ID)
                .remove(AttendanceBackgroundProcessor.KEY_STUDENT_NAME)
                .remove(AttendanceBackgroundProcessor.KEY_SEAT_NUMBER)
                .remove("auth_token")
                .apply()
            geofenceHelper.removeLibraryGeofence()
            Log.i(TAG, "Student session cleared from native storage.")
        }

        @JavascriptInterface
        fun registerGeofence(lat: Double, lon: Double, radiusMeters: Float, version: String) {
            runOnUiThread {
                geofenceHelper.registerLibraryGeofence(
                    latitude = lat,
                    longitude = lon,
                    radiusMeters = radiusMeters,
                    version = version,
                    onSuccess = {
                        Toast.makeText(this@MainActivity, "Library geofence active (${radiusMeters.toInt()}m)", Toast.LENGTH_SHORT).show()
                    },
                    onFailure = { e ->
                        Toast.makeText(this@MainActivity, "Geofence error: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                )
            }
        }

        @JavascriptInterface
        fun notifyManualAttendance(action: String) {
            val prefs = getSharedPreferences(AttendanceBackgroundProcessor.PREFS_NAME, Context.MODE_PRIVATE)
            val studentId = prefs.getString(AttendanceBackgroundProcessor.KEY_STUDENT_ID, "") ?: ""
            if (action == "IN") {
                processor.handleManualIn(studentId)
            } else if (action == "OUT") {
                processor.handleManualOut(studentId)
            }
        }

        @JavascriptInterface
        fun requestBackgroundLocation() {
            runOnUiThread {
                checkAndRequestBackgroundLocation()
            }
        }

        @JavascriptInterface
        fun openBatteryOptimizationSettings() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } else {
                    Toast.makeText(this@MainActivity, "Battery optimization already disabled for app", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun checkPermissionsStatus(): String {
            val fineGranted = ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            val bgGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
            } else true

            val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            } else true

            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            val batteryIgnored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                powerManager.isIgnoringBatteryOptimizations(packageName)
            } else true

            val json = JSONObject().apply {
                put("fineLocation", fineGranted)
                put("backgroundLocation", bgGranted)
                put("notifications", notifGranted)
                put("batteryOptimizationIgnored", batteryIgnored)
            }
            return json.toString()
        }
    }
}
