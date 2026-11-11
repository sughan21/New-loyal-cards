package com.loyaltyreward

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var pendingPermissionRequest: PermissionRequest? = null

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            pendingPermissionRequest?.grant(pendingPermissionRequest?.resources)
        } else {
            pendingPermissionRequest?.deny()
            Toast.makeText(this, "Camera permission is needed to scan QR codes", Toast.LENGTH_SHORT).show()
        }
        pendingPermissionRequest = null
    }

    private fun getLaunchUrl(intent: Intent?): String {
        val startFile = if (BuildConfig.FLAVOR == "owner") "owner.html" else "index.html"
        val baseUrl = "https://appassets.androidplatform.net/assets/$startFile"
        val data = intent?.data
        if (data != null) {
            val storeScan = data.getQueryParameter("store_scan")
                ?: data.getQueryParameter("token")
                ?: data.getQueryParameter("code")
            if (!storeScan.isNullOrEmpty()) {
                return "$baseUrl?store_scan=${Uri.encode(storeScan)}"
            }
        }
        return baseUrl
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = getLaunchUrl(intent)
        webView.loadUrl(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Sleek immersive status bar
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = android.graphics.Color.parseColor("#ffffff")
        window.navigationBarColor = android.graphics.Color.parseColor("#ffffff")

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or 
                android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }

        val rootLayout = android.widget.FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#ffffff"))
        }

        webView = WebView(this).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.parseColor("#ffffff"))
        }

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                8
            )
            max = 100
            val accentColor = if (BuildConfig.FLAVOR == "owner") "#f59e0b" else "#10b981"
            progressTintList = android.content.res.ColorStateList.valueOf(
                android.graphics.Color.parseColor(accentColor)
            )
        }

        rootLayout.addView(webView)
        rootLayout.addView(progressBar)
        setContentView(rootLayout)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.clearCache(true)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.addJavascriptInterface(WebAppInterface(this), "AndroidBridge")

        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            } catch (e: Exception) {
                // Ignore
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                val scheme = uri.scheme?.lowercase() ?: ""
                val urlStr = uri.toString()

                if (scheme == "loyaltypass" || scheme == "storeterminal") {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {
                        return false
                    }
                }

                if (urlStr.endsWith(".apk", ignoreCase = true) || urlStr.contains(".apk?")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {
                        return false
                    }
                }

                if (scheme == "tel" || scheme == "mailto" || scheme == "whatsapp") {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        return true
                    } catch (e: Exception) {
                        return true
                    }
                }

                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.resources)
                    } else {
                        pendingPermissionRequest = request
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                    }
                } else {
                    request.grant(request.resources)
                }
            }
        }

        // Hardware back button navigation
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Determine starting URL
        val targetUrl = getLaunchUrl(intent)
        webView.loadUrl(targetUrl)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    fun clearAllCaches() {
        runOnUiThread {
            try {
                webView.clearCache(true)
                android.webkit.WebStorage.getInstance().deleteAllData()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    class WebAppInterface(private val context: android.content.Context) {
        @JavascriptInterface
        fun clearAppCache() {
            (context as? MainActivity)?.clearAllCaches()
        }

        @JavascriptInterface
        fun downloadApk(url: String) {
            (context as? MainActivity)?.runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                } catch (e: Exception) {
                    // Ignore
                }
            }
        }

        @JavascriptInterface
        fun getUserDeviceName(): String {
            try {
                // 1. Android Settings.Global.DEVICE_NAME (user custom device name in Settings > About Phone, e.g. "Sughan's Phone")
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N_MR1) {
                    val name = android.provider.Settings.Global.getString(context.contentResolver, android.provider.Settings.Global.DEVICE_NAME)
                    if (!name.isNullOrBlank()) return name
                }
                // 2. Bluetooth device name (custom name assigned by user)
                val btName = android.provider.Settings.Secure.getString(context.contentResolver, "bluetooth_name")
                if (!btName.isNullOrBlank()) return btName

                // 3. System device_name
                val sysName = android.provider.Settings.System.getString(context.contentResolver, "device_name")
                if (!sysName.isNullOrBlank()) return sysName
            } catch (e: Exception) {
                // Ignore
            }
            return ""
        }

        @JavascriptInterface
        fun getDeviceId(): String {
            try {
                val androidId = android.provider.Settings.Secure.getString(
                    context.contentResolver, 
                    android.provider.Settings.Secure.ANDROID_ID
                )
                if (!androidId.isNullOrBlank()) return androidId
            } catch (e: Exception) {
                // Ignore
            }
            return ""
        }

        @JavascriptInterface
        fun getDeviceName(): String {
            // First check user custom-configured name
            val userCustomName = getUserDeviceName()
            if (userCustomName.isNotBlank()) return userCustomName

            val manufacturer = android.os.Build.MANUFACTURER.replaceFirstChar {
                if (it.isLowerCase()) it.titlecase(java.util.Locale.getDefault()) else it.toString()
            }
            val model = android.os.Build.MODEL
            return if (model.startsWith(manufacturer, ignoreCase = true)) {
                model
            } else {
                "$manufacturer $model"
            }
        }

        @JavascriptInterface
        fun getAndroidVersion(): String {
            return "Android ${android.os.Build.VERSION.RELEASE}"
        }
    }
}
