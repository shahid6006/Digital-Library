package com.digitallibrary.attendance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Native Android Notification Helper for Library Attendance
 *
 * Manages notification channels, builds, and dispatches native OS notifications
 * when the application is open, closed, killed, backgrounded, or phone is locked.
 */
object NotificationHelper {

    const val CHANNEL_ID = "library_attendance_channel"
    const val CHANNEL_NAME = "Library Attendance"
    const val CHANNEL_DESC = "Notifications for automatic geofence entry, dwell verification, and attendance events"

    const val NOTIFICATION_ID_DWELL = 1001
    const val NOTIFICATION_ID_AUTO_IN = 1002
    const val NOTIFICATION_ID_AUTO_OUT = 1003
    const val NOTIFICATION_ID_ENTRY_PROMPT = 1004

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val existing = manager.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = CHANNEL_DESC
                    enableVibration(true)
                    setShowBadge(true)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    private fun getLaunchPendingIntent(context: Context): PendingIntent {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(context, MainActivity::class.java)
        launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        return PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * Requirement 17: When dwell verification begins
     * Title: Library Attendance
     * Message: You are inside the attendance area. Stay for 1 minute or press IN NOW.
     */
    fun showDwellStartedNotification(context: Context) {
        createNotificationChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Library Attendance")
            .setContentText("You are inside the attendance area. Stay for 1 minute or press IN NOW.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("You are inside the attendance area. Stay for 1 minute or press IN NOW.")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(getLaunchPendingIntent(context))
            .build()

        manager.notify(NOTIFICATION_ID_DWELL, notification)
    }

    /**
     * Requirement 17: When automatic IN occurs after 1 minute dwell
     * Title: Library Attendance
     * Message: You have been automatically marked IN after staying inside the attendance area for 1 minute.
     */
    fun showAutoInNotification(context: Context) {
        createNotificationChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Cancel pending dwell notification
        manager.cancel(NOTIFICATION_ID_DWELL)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Library Attendance")
            .setContentText("You have been automatically marked IN after staying inside the attendance area for 1 minute.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("You have been automatically marked IN after staying inside the attendance area for 1 minute.")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(getLaunchPendingIntent(context))
            .build()

        manager.notify(NOTIFICATION_ID_AUTO_IN, notification)
    }

    /**
     * Requirement 17: When automatic OUT occurs after leaving geofence
     * Title: Library Attendance
     * Message: You have been automatically marked OUT after leaving the attendance area.
     */
    fun showAutoOutNotification(context: Context) {
        createNotificationChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Cancel dwell notification if still pending
        manager.cancel(NOTIFICATION_ID_DWELL)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Library Attendance")
            .setContentText("You have been automatically marked OUT after leaving the attendance area.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("You have been automatically marked OUT after leaving the attendance area.")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(getLaunchPendingIntent(context))
            .build()

        manager.notify(NOTIFICATION_ID_AUTO_OUT, notification)
    }

    /**
     * Entry prompt notification
     */
    fun showEntryPromptNotification(context: Context, title: String, message: String) {
        createNotificationChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(getLaunchPendingIntent(context))
            .build()

        manager.notify(NOTIFICATION_ID_ENTRY_PROMPT, notification)
    }

    fun cancelNotification(context: Context, notificationId: Int) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(notificationId)
    }
}
