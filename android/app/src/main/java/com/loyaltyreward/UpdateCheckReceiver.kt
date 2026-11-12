package com.loyaltyreward

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Background BroadcastReceiver that runs periodically (every 15 minutes) and on device boot
 * to check for pushed updates or new app versions even when the loyalty pass app is closed.
 */
class UpdateCheckReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // Ensure alarm is scheduled for the next interval
        schedulePeriodicCheck(context)

        // Perform lightweight network update check on a background thread
        Thread {
            try {
                performBackgroundCheck(context)
            } catch (_: Exception) {
                // Ignore transient network errors during background check
            }
        }.start()
    }

    companion object {
        const val CHANNEL_ID = "channel_loyalty_updates"
        const val CHANNEL_NAME = "Loyalty Pass Updates & Rewards"
        const val NOTIFICATION_ID_UPDATE = 1001
        const val NOTIFICATION_ID_ALERT = 1002
        const val ACTION_CHECK_UPDATE = "com.loyaltyreward.CHECK_UPDATE"

        fun createNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Notifications for new loyalty pass versions, stamps, and rewards."
                    enableLights(true)
                    enableVibration(true)
                }
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                manager?.createNotificationChannel(channel)
            }
        }

        fun schedulePeriodicCheck(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, UpdateCheckReceiver::class.java).apply {
                action = ACTION_CHECK_UPDATE
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                101,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val intervalMs = 15 * 60 * 1000L // 15 minutes
            val triggerAtMs = System.currentTimeMillis() + intervalMs

            try {
                alarmManager.setInexactRepeating(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMs,
                    intervalMs,
                    pendingIntent
                )
            } catch (_: Exception) {
                // Fallback if exact/inexact alarm cannot be set
            }
        }

        fun showSystemNotification(
            context: Context,
            title: String,
            message: String,
            notificationId: Int = NOTIFICATION_ID_UPDATE
        ) {
            createNotificationChannel(context)
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

            val launchIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val iconRes = try {
                if (BuildConfig.FLAVOR == "owner") R.mipmap.ic_launcher_owner else R.mipmap.ic_launcher_customer
            } catch (_: Exception) {
                android.R.drawable.ic_dialog_info
            }

            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(iconRes)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(defaultSoundUri)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)

            manager.notify(notificationId, builder.build())
        }

        fun performBackgroundCheck(context: Context) {
            val prefs = context.getSharedPreferences("loyalty_app_prefs", Context.MODE_PRIVATE)

            // 1. Check version.json from GitHub Pages cloud
            try {
                val url = URL("https://sughan21.github.io/New-loyal-cards/data/version.json?_t=${System.currentTimeMillis()}")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.requestMethod = "GET"
                if (conn.responseCode == 200) {
                    val jsonStr = conn.inputStream.bufferedReader().use { it.readText() }
                    val json = JSONObject(jsonStr)
                    val remoteVer = json.optString("customerVersion", json.optString("version", ""))
                    val remoteCode = json.optInt("customerVersionCode", json.optInt("versionCode", 0))

                    val currentCode = BuildConfig.VERSION_CODE
                    val currentVer = BuildConfig.VERSION_NAME

                    if (remoteCode > currentCode || (remoteVer.isNotEmpty() && remoteVer != currentVer && isSemverNewer(remoteVer, currentVer))) {
                        val lastNotified = prefs.getString("last_notified_ver", "")
                        if (lastNotified != remoteVer) {
                            showSystemNotification(
                                context,
                                "⚡ Sugar Cubes Loyalty Pass Update",
                                "Version $remoteVer is ready to install! Tap to update and sync your stamps.",
                                NOTIFICATION_ID_UPDATE
                            )
                            prefs.edit().putString("last_notified_ver", remoteVer).apply()
                        }
                    }
                }
            } catch (_: Exception) {
                // Cloud check failed
            }

            // 2. Check Supabase for customer update alert if logged in
            val savedPhone = prefs.getString("saved_customer_phone", "")
            if (!savedPhone.isNullOrEmpty()) {
                try {
                    val supaUrl = URL("https://rhqpiskqgfmotazjzbnm.supabase.co/rest/v1/customers?phone=eq.$savedPhone&select=history,app_version")
                    val conn = supaUrl.openConnection() as HttpURLConnection
                    conn.connectTimeout = 8000
                    conn.readTimeout = 8000
                    conn.requestMethod = "GET"
                    conn.setRequestProperty("apikey", "sb_publishable_Jf7gwY9zb3exmw8RD98ERQ_o66Pq2xY")
                    conn.setRequestProperty("Authorization", "Bearer sb_publishable_Jf7gwY9zb3exmw8RD98ERQ_o66Pq2xY")

                    if (conn.responseCode == 200) {
                        val resStr = conn.inputStream.bufferedReader().use { it.readText() }
                        val arr = JSONArray(resStr)
                        if (arr.length() > 0) {
                            val custObj = arr.getJSONObject(0)
                            val history = custObj.optJSONArray("history")
                            if (history != null && history.length() > 0) {
                                val latest = history.getJSONObject(0)
                                val type = latest.optString("type")
                                val note = latest.optString("note")
                                val dateStr = latest.optString("date")
                                if (type == "update_alert") {
                                    val lastAlertNotified = prefs.getString("last_notified_alert_date", "")
                                    if (lastAlertNotified != dateStr) {
                                        showSystemNotification(
                                            context,
                                            "⚡ App Update Notice from Store Owner",
                                            note.ifEmpty { "New version available! Tap to install the latest Loyalty Pass." },
                                            NOTIFICATION_ID_ALERT
                                        )
                                        prefs.edit().putString("last_notified_alert_date", dateStr).apply()
                                    }
                                }
                            }
                        }
                    }
                } catch (_: Exception) {
                    // Supabase check failed
                }
            }
        }

        private fun isSemverNewer(remote: String, local: String): Boolean {
            return try {
                val rParts = remote.split(".").map { it.toIntOrNull() ?: 0 }
                val lParts = local.split(".").map { it.toIntOrNull() ?: 0 }
                for (i in 0 until maxOf(rParts.size, lParts.size)) {
                    val r = rParts.getOrElse(i) { 0 }
                    val l = lParts.getOrElse(i) { 0 }
                    if (r > l) return true
                    if (r < l) return false
                }
                false
            } catch (_: Exception) {
                false
            }
        }
    }
}
