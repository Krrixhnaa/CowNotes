package com.cownotes.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.app.AlertDialog
import android.content.DialogInterface
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.JsResult
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.content.Context
import android.print.PrintManager
import android.print.PrintAttributes
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import org.json.JSONArray
import android.content.ContentValues
import android.os.Environment
import android.widget.Toast
import java.io.File

class MainActivity : ComponentActivity() {

    @Volatile
    private var lastImportedFileJson: String? = null


    private lateinit var webView: WebView
    private val localAssetUrl = "file:///android_asset/index.html"

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var isSpeechListening = false
    private var shouldKeepListening = false
    private var speechLanguage: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private var safeAreaTopDp = 0
    private var safeAreaBottomDp = 0
    private var safeAreaLeftDp = 0
    private var safeAreaRightDp = 0

    // Permission launcher for media, camera, and microphone
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val audioGranted = grants[Manifest.permission.RECORD_AUDIO] ?: false
        if (audioGranted && shouldKeepListening) {
            startSpeechRecognizerSession()
        }
    }

    // File chooser result launcher
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val intentData = result.data
            val uris = when {
                intentData?.data != null -> arrayOf(intentData.data!!)
                intentData?.clipData != null -> {
                    val clip = intentData.clipData!!
                    Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                }
                else -> WebChromeClient.FileChooserParams.parseResult(result.resultCode, intentData)
            }
            filePathCallback?.onReceiveValue(uris)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    // Native File Picker Result Launcher for Direct Markdown & Backup Import (Single & Multiple Files)
    private val nativeFilePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val uris = mutableListOf<Uri>()
            val data = result.data
            if (data?.clipData != null) {
                val clip = data.clipData!!
                for (i in 0 until clip.itemCount) {
                    uris.add(clip.getItemAt(i).uri)
                }
            } else if (data?.data != null) {
                uris.add(data.data!!)
            }

            val jsonArray = JSONArray()

            for (uri in uris) {
                try {
                    var displayName = "Imported Note.md"
                    var lastModified: Long = 0L

                    try {
                        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                            val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                            if (nameIdx != -1 && cursor.moveToFirst()) {
                                val n = cursor.getString(nameIdx)
                                if (!n.isNullOrBlank()) displayName = n
                            }
                            val modIdx = cursor.getColumnIndex(android.provider.DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                            if (modIdx != -1 && cursor.moveToFirst()) {
                                lastModified = cursor.getLong(modIdx)
                            }
                        }
                    } catch (_: Exception) {}

                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes != null && bytes.isNotEmpty()) {
                        val text = String(bytes, Charsets.UTF_8)
                        val obj = JSONObject().apply {
                            put("name", displayName)
                            put("content", text)
                            put("lastModified", lastModified)
                        }
                        jsonArray.put(obj)
                    }
                } catch (e: Exception) {
                    Log.e("CowNotesWeb", "Failed to read picked file", e)
                }
            }

            if (jsonArray.length() > 0) {
                lastImportedFileJson = jsonArray.toString()
                webView.post {
                    webView.evaluateJavascript("window.onNativeFileImport && window.onNativeFileImport();", null)
                }
            }
        }
    }

    // Native Speech Recognizer Intent Launcher
    private val speechIntentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val text = matches?.firstOrNull() ?: ""
            if (text.isNotEmpty()) {
                val safeText = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                webView.evaluateJavascript("window.onSpeechResult && window.onSpeechResult('$safeText', true);", null)
            }
        }
        shouldKeepListening = false
        webView.evaluateJavascript("window.onSpeechEnded && window.onSpeechEnded();", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enable edge-to-edge rendering so the app draws seamlessly under status and nav bars
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Request audio, camera, and media permissions early
        requestAllNeededPermissions()

                webView = WebView(this).apply {
            id = View.generateViewId()
            overScrollMode = View.OVER_SCROLL_NEVER
            setBackgroundColor(android.graphics.Color.BLACK)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            // default layer type
        }
        setContentView(webView)

        // Setup Window Insets handling to accurately pass status bar & navigation bar heights to CSS
        setupInsetsListener()

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.databaseEnabled = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false

        // Clear cache to avoid any stale/un-styled resources from previous runs
        // Cache preserved for high performance

        // Add JavaScript bridge for Speech Recognition, Safe Area insets & native functions
        webView.addJavascriptInterface(AndroidNativeBridge(), "AndroidSpeechBridge")

        webView.webChromeClient = object : WebChromeClient() {
            // Automatically grant web media permissions (audio/camera)
            override fun onPermissionRequest(request: PermissionRequest) {
                request.grant(request.resources)
            }

            override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("CowNotes")
                    .setMessage(message ?: "")
                    .setPositiveButton("OK") { _: DialogInterface, _: Int -> result?.confirm() }
                    .setNegativeButton("Cancel") { _: DialogInterface, _: Int -> result?.cancel() }
                    .setOnCancelListener { _: DialogInterface -> result?.cancel() }
                    .show()
                return true
            }

            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("CowNotes")
                    .setMessage(message ?: "")
                    .setPositiveButton("OK") { _: DialogInterface, _: Int -> result?.confirm() }
                    .setOnCancelListener { result?.confirm() }
                    .show()
                return true
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d("CowNotesWeb", "${consoleMessage?.message()} -- line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                return true
            }

            // Handle file input (<input type="file">) including photo picker & camera
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                try {
                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    filePickerLauncher.launch(intent)
                    return true
                } catch (e: Exception) {
                    Log.e("CowNotesWeb", "Failed to launch file chooser", e)
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    return false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectSafeAreaInsets()
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                Log.e("CowNotesWeb", "Error loading ${request?.url}: ${error?.description}")
                if (request?.isForMainFrame == true && view?.url?.startsWith("http") == true) {
                    view.loadUrl(localAssetUrl)
                }
            }
        }

        // Handle native back button with full single-page app navigation
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.handleBackNavigation ? window.handleBackNavigation() : false") { result ->
                    val handled = result?.trim()?.equals("true", ignoreCase = true) ?: false
                    if (!handled) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                            isEnabled = true
                        }
                    }
                }
            }
        })

        // Always load the fast, fully offline, standalone asset first so it runs on ANY Android device
        webView.loadUrl(localAssetUrl)
    }

    private var keyboardHeightDp = 0
    private var lastTopDp = -1
    private var lastBottomDp = -1
    private var lastLeftDp = -1
    private var lastRightDp = -1
    private var lastKeyboardDp = -1

    private fun setupInsetsListener() {
        val insetsController = WindowInsetsControllerCompat(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = false

        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
            val systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
            val density = resources.displayMetrics.density

            safeAreaTopDp = (systemBars.top / density).toInt()
            safeAreaLeftDp = (systemBars.left / density).toInt()
            safeAreaRightDp = (systemBars.right / density).toInt()
            val navBottomDp = (systemBars.bottom / density).toInt()
            val rawImeDp = (imeInsets.bottom / density).toInt()

            keyboardHeightDp = if (rawImeDp > navBottomDp) rawImeDp else 0
            safeAreaBottomDp = navBottomDp

            val hasChanged = safeAreaTopDp != lastTopDp || safeAreaBottomDp != lastBottomDp ||
                    safeAreaLeftDp != lastLeftDp || safeAreaRightDp != lastRightDp ||
                    keyboardHeightDp != lastKeyboardDp

            if (hasChanged) {
                lastTopDp = safeAreaTopDp
                lastBottomDp = safeAreaBottomDp
                lastLeftDp = safeAreaLeftDp
                lastRightDp = safeAreaRightDp
                lastKeyboardDp = keyboardHeightDp
                injectSafeAreaInsets()
            }
            windowInsets
        }
    }

    private fun injectSafeAreaInsets() {
        runOnUiThread {
            val js = """
                (function() {
                    document.documentElement.style.setProperty('--safe-area-top', '${safeAreaTopDp}px');
                    document.documentElement.style.setProperty('--safe-area-bottom', '${safeAreaBottomDp}px');
                    document.documentElement.style.setProperty('--safe-area-left', '${safeAreaLeftDp}px');
                    document.documentElement.style.setProperty('--safe-area-right', '${safeAreaRightDp}px');
                    document.documentElement.style.setProperty('--keyboard-height', '${keyboardHeightDp}px');
                    document.documentElement.setAttribute('data-keyboard-open', ${keyboardHeightDp > 60});
                    if (window.onKeyboardUpdated) {
                        window.onKeyboardUpdated(${keyboardHeightDp});
                    }
                    if (window.onSafeAreaUpdated) {
                        window.onSafeAreaUpdated(${safeAreaTopDp}, ${safeAreaBottomDp}, ${safeAreaLeftDp}, ${safeAreaRightDp});
                    }
                })();
            """.trimIndent()
            webView.evaluateJavascript(js, null)
        }
    }

    private fun requestAllNeededPermissions() {
        val needed = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_IMAGES)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_AUDIO)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun requestMediaAndCameraPermissions() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.CAMERA)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_IMAGES)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    // Native Bridge exposed to JavaScript
    inner class AndroidNativeBridge {

        @JavascriptInterface
        fun getLastImportedFile(): String? {
            val res = lastImportedFileJson
            lastImportedFileJson = null
            return res
        }

        @JavascriptInterface
        fun openNativeFilePicker() {
            runOnUiThread {
                try {
                    val docIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    nativeFilePickerLauncher.launch(docIntent)
                } catch (e: Exception) {
                    Log.e("CowNotesWeb", "Native OPEN_DOCUMENT picker error, trying GET_CONTENT", e)
                    try {
                        val getContentIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                        nativeFilePickerLauncher.launch(Intent.createChooser(getContentIntent, "Select Notes or Backup File"))
                    } catch (e2: Exception) {
                        Log.e("CowNotesWeb", "Chooser fallback error", e2)
                    }
                }
            }
        }


        @JavascriptInterface
        fun hideKeyboard() {
            runOnUiThread {
                try {
                    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager
                    val view = currentFocus ?: webView
                    imm?.hideSoftInputFromWindow(view.windowToken, 0)
                    webView.clearFocus()
                } catch (e: Exception) {
                    Log.e("CowNotesWeb", "Error hiding keyboard", e)
                }
            }
        }

        @JavascriptInterface
        fun isAvailable(): Boolean {
            val pm = packageManager
            val activities = pm.queryIntentActivities(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH),
                0
            )
            return activities.isNotEmpty() || SpeechRecognizer.isRecognitionAvailable(this@MainActivity)
        }

        @JavascriptInterface
        fun getSafeArea(): String {
            val json = JSONObject()
            json.put("top", safeAreaTopDp)
            json.put("bottom", safeAreaBottomDp)
            json.put("left", safeAreaLeftDp)
            json.put("right", safeAreaRightDp)
            return json.toString()
        }

        @JavascriptInterface
        fun startListening(language: String?) {
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                    val errorMsg = "Microphone permission required. Please allow microphone access."
                    webView.evaluateJavascript("window.onSpeechError && window.onSpeechError('$errorMsg');", null)
                    return@runOnUiThread
                }

                shouldKeepListening = true
                speechLanguage = language

                if (SpeechRecognizer.isRecognitionAvailable(this@MainActivity)) {
                    try {
                        startSpeechRecognizerSession()
                        return@runOnUiThread
                    } catch (e: Exception) {
                        Log.w("CowNotesSpeech", "SpeechRecognizer error, using dialog", e)
                    }
                }

                launchSystemSpeechDialog()
            }
        }

        @JavascriptInterface
        fun stopListening() {
            runOnUiThread {
                shouldKeepListening = false
                stopListeningInternal()
                webView.evaluateJavascript("window.onSpeechEnded && window.onSpeechEnded();", null)
            }
        }

        @JavascriptInterface
        fun setStatusBarTheme(isDark: Boolean) {
            runOnUiThread {
                val insetsController = WindowInsetsControllerCompat(window, window.decorView)
                insetsController.isAppearanceLightStatusBars = !isDark
                insetsController.isAppearanceLightNavigationBars = !isDark
            }
        }

        @JavascriptInterface
        fun printNote(title: String?) {
            runOnUiThread {
                try {
                    val printManager = getSystemService(Context.PRINT_SERVICE) as? PrintManager
                    if (printManager != null) {
                        val jobName = if (!title.isNullOrBlank()) "CowNotes - $title" else "CowNotes Document"
                        val printAdapter = webView.createPrintDocumentAdapter(jobName)
                        val printAttributes = PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build()
                        printManager.print(jobName, printAdapter, printAttributes)
                    }
                } catch (e: Exception) {
                    Log.e("CowNotesPrint", "Print error", e)
                }
            }
        }

        @JavascriptInterface
        fun exportMarkdown(filename: String?, content: String?) {
            runOnUiThread {
                try {
                    val rawName = if (!filename.isNullOrBlank()) filename else "CowNotes_Note.md"
                    val safeName = if (rawName.endsWith(".md", ignoreCase = true)) rawName else "$rawName.md"
                    val text = content ?: ""

                    var savedUri: Uri? = null

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                            put(MediaStore.Downloads.MIME_TYPE, "text/markdown")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val resolver = contentResolver
                        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        val itemUri = resolver.insert(collection, values)
                        if (itemUri != null) {
                            resolver.openOutputStream(itemUri)?.use { out ->
                                out.write(text.toByteArray(Charsets.UTF_8))
                            }
                            values.clear()
                            values.put(MediaStore.Downloads.IS_PENDING, 0)
                            resolver.update(itemUri, values, null, null)
                            savedUri = itemUri
                        }
                    } else {
                        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        downloadsDir.mkdirs()
                        val file = File(downloadsDir, safeName)
                        file.writeText(text, Charsets.UTF_8)
                        savedUri = Uri.fromFile(file)
                    }

                    Toast.makeText(this@MainActivity, "Saved to Downloads: $safeName", Toast.LENGTH_LONG).show()

                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_SUBJECT, safeName)
                        if (savedUri != null) {
                            putExtra(Intent.EXTRA_STREAM, savedUri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    val chooser = Intent.createChooser(shareIntent, "Export Markdown")
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(chooser)
                } catch (e: Exception) {
                    Log.e("CowNotesExport", "Export error", e)
                    try {
                        val sendIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_SUBJECT, filename ?: "CowNotes.md")
                            putExtra(Intent.EXTRA_TEXT, content ?: "")
                        }
                        startActivity(Intent.createChooser(sendIntent, "Export Markdown"))
                    } catch (_: Exception) {}
                }
            }
        }

        @JavascriptInterface
        fun exportDatabase(filename: String?, content: String?) {
            runOnUiThread {
                try {
                    val rawName = if (!filename.isNullOrBlank()) filename else "cownotes_backup.db"
                    val safeName = if (rawName.endsWith(".db", ignoreCase = true)) rawName else "$rawName.db"
                    val text = content ?: ""

                    var savedUri: Uri? = null

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                            put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val resolver = contentResolver
                        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        val itemUri = resolver.insert(collection, values)
                        if (itemUri != null) {
                            resolver.openOutputStream(itemUri)?.use { out ->
                                out.write(text.toByteArray(Charsets.UTF_8))
                            }
                            values.clear()
                            values.put(MediaStore.Downloads.IS_PENDING, 0)
                            resolver.update(itemUri, values, null, null)
                            savedUri = itemUri
                        }
                    } else {
                        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        downloadsDir.mkdirs()
                        val file = File(downloadsDir, safeName)
                        file.writeText(text, Charsets.UTF_8)
                        savedUri = Uri.fromFile(file)
                    }

                    Toast.makeText(this@MainActivity, "Backup saved to Downloads: $safeName", Toast.LENGTH_LONG).show()

                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/octet-stream"
                        putExtra(Intent.EXTRA_SUBJECT, safeName)
                        if (savedUri != null) {
                            putExtra(Intent.EXTRA_STREAM, savedUri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    val chooser = Intent.createChooser(shareIntent, "Share or Save Backup (.db)")
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(chooser)
                } catch (e: Exception) {
                    Log.e("CowNotesExportDB", "Export DB error", e)
                }
            }
        }
    }

        private fun launchSystemSpeechDialog() {
        runOnUiThread {
            try {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to dictate into note...")
                    if (!speechLanguage.isNullOrEmpty()) {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLanguage)
                    }
                }
                speechIntentLauncher.launch(intent)
            } catch (e: Exception) {
                Log.e("CowNotesSpeech", "Failed to launch speech dialog", e)
                val err = "Voice input unavailable on device."
                webView.evaluateJavascript("window.onSpeechError && window.onSpeechError('$err');", null)
            }
        }
    }

    private fun startSpeechRecognizerSession() {
        stopListeningInternal()
        if (!shouldKeepListening) return

        try {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        isSpeechListening = true
                        webView.evaluateJavascript("window.onSpeechReady && window.onSpeechReady();", null)
                    }

                    override fun onBeginningOfSpeech() {
                        webView.evaluateJavascript("window.onSpeechStarted && window.onSpeechStarted();", null)
                    }

                    override fun onRmsChanged(rmsdB: Float) {
                        val normalized = ((rmsdB + 2) / 12f).coerceIn(0f, 1f)
                        webView.evaluateJavascript("window.onSpeechRmsChanged && window.onSpeechRmsChanged($normalized);", null)
                    }

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        webView.evaluateJavascript("window.onSpeechProcessing && window.onSpeechProcessing();", null)
                    }

                    override fun onError(error: Int) {
                        isSpeechListening = false
                        // Non-fatal pause errors: silence or timeout -> restart listening seamlessly if user hasn't tapped Done
                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            if (shouldKeepListening) {
                                mainHandler.postDelayed({
                                    if (shouldKeepListening) startSpeechRecognizerSession()
                                }, 150)
                            }
                            return
                        }

                        // Client cancellation is normal when restarting or stopping
                        if (error == SpeechRecognizer.ERROR_CLIENT) {
                            return
                        }

                        // If background recognizer has network/server issues, launch system speech dialog!
                        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || error == SpeechRecognizer.ERROR_SERVER) {
                            shouldKeepListening = false
                            stopListeningInternal()
                            launchSystemSpeechDialog()
                            return
                        }

                        val message = when (error) {
                            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission needed"
                            SpeechRecognizer.ERROR_NETWORK -> "Network connection required for speech"
                            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech network timeout"
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> ""
                            SpeechRecognizer.ERROR_SERVER -> "Speech server error"
                            else -> "Speech recognition error ($error)"
                        }

                        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && shouldKeepListening) {
                            mainHandler.postDelayed({
                                if (shouldKeepListening) startSpeechRecognizerSession()
                            }, 250)
                            return
                        }

                        shouldKeepListening = false
                        stopListeningInternal()
                        if (message.isNotEmpty()) {
                            val safeMsg = message.replace("'", "\\'")
                            webView.evaluateJavascript("window.onSpeechError && window.onSpeechError('$safeMsg');", null)
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        isSpeechListening = false
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull() ?: ""
                        if (text.isNotEmpty()) {
                            val safeText = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                            webView.evaluateJavascript("window.onSpeechResult && window.onSpeechResult('$safeText', true);", null)
                        }

                        // Seamless continuous listening until user taps Done
                        if (shouldKeepListening) {
                            mainHandler.postDelayed({
                                if (shouldKeepListening) startSpeechRecognizerSession()
                            }, 100)
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull() ?: ""
                        if (text.isNotEmpty()) {
                            val safeText = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                            webView.evaluateJavascript("window.onSpeechResult && window.onSpeechResult('$safeText', false);", null)
                        }
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                if (!speechLanguage.isNullOrEmpty()) {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLanguage)
                }
            }

            speechRecognizer?.startListening(intent)
        } catch (e: Exception) {
            isSpeechListening = false
            if (shouldKeepListening) {
                val err = (e.message ?: "Failed to start speech recognition").replace("'", "\\'")
                webView.evaluateJavascript("window.onSpeechError && window.onSpeechError('$err');", null)
            }
        }
    }

    private fun stopListeningInternal() {
        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.destroy()
        } catch (_: Exception) {}
        speechRecognizer = null
        isSpeechListening = false
    }

    override fun onDestroy() {
        shouldKeepListening = false
        stopListeningInternal()
        webView.destroy()
        super.onDestroy()
    }
}
