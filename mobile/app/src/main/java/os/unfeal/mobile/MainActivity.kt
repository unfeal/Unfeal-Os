package os.unfeal.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Drawable
import android.widget.FrameLayout
import android.widget.ImageView
import android.content.res.ColorStateList
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking

class MainActivity : Activity() {
    private val updateWorker = Executors.newSingleThreadExecutor()
    private val worker = Executors.newSingleThreadExecutor()
    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private lateinit var status: TextView
    private lateinit var transcript: TextView
    private lateinit var scroll: ScrollView
    private lateinit var prompt: EditText
    private lateinit var choose: Button
    private lateinit var send: Button
    private val modelFile by lazy { File(filesDir, "model.litertlm") }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun surface(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        setStroke(dp(1), 0x55b184e3)
    }

    private fun panel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = surface(0xe6160f20.toInt(), 16)
        setPadding(dp(16), dp(16), dp(16), dp(16))
    }

    private fun heading(title: String) = TextView(this).apply {
        text = title
        textSize = 27f
        setTextColor(0xffeeeaf8.toInt())
        typeface = Typeface.DEFAULT_BOLD
    }

    private fun styleButton(button: Button, primary: Boolean = false) {
        button.isAllCaps = false
        button.minimumHeight = dp(44)
        button.background = surface(if (primary) 0xffbb8ff3.toInt() else 0xff302044.toInt(), 9)
        button.setTextColor(ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(0xffa89bb6.toInt(), if (primary) 0xff1c0d2b.toInt() else 0xffeeeaf8.toInt())
        ))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        val wallpaper = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            assets.open("cherry-wallpaper.png").use { setImageDrawable(Drawable.createFromStream(it, null)) }
        }
        root.addView(wallpaper, FrameLayout.LayoutParams(-1, -1))
        root.addView(View(this).apply { setBackgroundColor(0x99170a26.toInt()) }, FrameLayout.LayoutParams(-1, -1))
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        root.addView(layout, FrameLayout.LayoutParams(-1, -1))
        root.setOnApplyWindowInsetsListener { view, insets ->
            val bars = if (android.os.Build.VERSION.SDK_INT >= 30) insets.getInsets(
                android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime()
            ) else null
            view.setPadding(bars?.left ?: insets.systemWindowInsetLeft, bars?.top ?: insets.systemWindowInsetTop,
                bars?.right ?: insets.systemWindowInsetRight, bars?.bottom ?: insets.systemWindowInsetBottom)
            insets
        }
        val overview = panel()
        val models = panel()
        val chat = panel()
        val brand = LinearLayout(this).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
            background = surface(0xe6160f20.toInt(), 12)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            val icon = ImageView(this@MainActivity).apply {
                assets.open("unfeal-icon.jpg").use { setImageDrawable(Drawable.createFromStream(it, null)) }
                scaleType = ImageView.ScaleType.CENTER_CROP
            }
            addView(icon, LinearLayout.LayoutParams(dp(36), dp(36)))
            addView(TextView(this@MainActivity).apply {
                text = "UNFEAL OS"
                textSize = 19f
                typeface = Typeface.DEFAULT_BOLD
                letterSpacing = .08f
                setPadding(dp(10), 0, 0, 0)
            })
        }
        layout.addView(brand)
        val navigation = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(8))
        }
        layout.addView(navigation)
        val pages = listOf("Overview" to overview, "AI Chat" to chat, "Models" to models)
        val content = FrameLayout(this)
        layout.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        val buttons = pages.map { (name, page) ->
            content.addView(page, FrameLayout.LayoutParams(-1, -1))
            Button(this).apply {
                text = name
                navigation.addView(this, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(4) })
            }
        }
        fun selectPage(index: Int) {
            pages.forEachIndexed { position, (_, page) -> page.visibility = if (position == index) View.VISIBLE else View.GONE }
            buttons.forEachIndexed { position, button ->
                button.isSelected = position == index
                styleButton(button, position == index)
            }
        }
        buttons.forEachIndexed { index, button -> button.setOnClickListener { selectPage(index) } }
        selectPage(0)
        status = TextView(this).apply { text = "Wähle eine .litertlm-Datei aus." }
        choose = Button(this).apply {
            text = "Modell auswählen"
            setOnClickListener {
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }, 1)
            }
        }
        transcript = TextView(this).apply { textSize = 16f; setTextIsSelectable(true) }
        scroll = ScrollView(this).apply { addView(transcript) }
        prompt = EditText(this).apply { hint = "Nachricht"; maxLines = 4 }
        send = Button(this).apply {
            text = "Senden"
            isEnabled = false
            setOnClickListener { sendMessage() }
        }
        overview.addView(heading("Overview"))
        overview.addView(TextView(this).apply {
            text = "Was möchtest du tun?"
            textSize = 19f
            setPadding(0, dp(16), 0, dp(12))
        })
        overview.addView(Button(this).apply {
            text = "AI Chat öffnen"
            styleButton(this, true)
            setOnClickListener { selectPage(1) }
        })
        val installed = packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0"
        val version = TextView(this).apply { text = "Installiert: $installed" }
        val updates = Button(this).apply { text = "Nach Updates suchen" }
        fun checkUpdates() {
            updates.isEnabled = false
            version.text = "Installiert: $installed · Suche läuft …"
            updateWorker.execute {
                val result = runCatching { MobileUpdates.check(installed) }
                runOnUiThread {
                    if (isDestroyed) return@runOnUiThread
                    val release = result.getOrNull()
                    version.text = when {
                        result.isFailure -> "Installiert: $installed · Updatesuche fehlgeschlagen"
                        release != null -> "Installiert: $installed · Verfügbar: ${release.version}"
                        else -> "Installiert: $installed · Auf dem neuesten Stand"
                    }
                    updates.text = if (release != null) "Update öffnen" else "Nach Updates suchen"
                    updates.setOnClickListener {
                        if (release != null) {
                            try { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(release.url))) }
                            catch (_: android.content.ActivityNotFoundException) { version.text = release.url }
                        } else checkUpdates()
                    }
                    updates.isEnabled = true
                }
            }
        }
        updates.setOnClickListener { checkUpdates() }
        version.setPadding(0, dp(16), 0, dp(8))
        styleButton(updates)
        overview.addView(version)
        overview.addView(updates)
        checkUpdates()
        models.addView(heading("Local Models"))
        status.setPadding(0, dp(12), 0, dp(12))
        models.addView(status)
        styleButton(choose, true)
        models.addView(choose)
        models.addView(Button(this).apply {
            styleButton(this)
            text = "Passendes Modell finden"
            setOnClickListener {
                val memory = android.app.ActivityManager.MemoryInfo()
                getSystemService(android.app.ActivityManager::class.java).getMemoryInfo(memory)
                val gib = memory.availMem / (1024.0 * 1024 * 1024)
                val free = java.text.NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }.format(gib)
                val recommendation = if (gib >= 2.0) "Qwen3-0.6B als Einstieg. Der Speicherbedarf hängt vom Modell und vom Gesprächsverlauf ab."
                    else "Momentan ist wenig RAM frei. Schließe andere Apps, bevor du Qwen3-0.6B ausprobierst."
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setTitle("Lokaler Modellberater")
                    .setMessage("$free GiB RAM frei. $recommendation")
                    .setPositiveButton("Modell ansehen") { _, _ ->
                        val url = android.net.Uri.parse("https://huggingface.co/litert-community/Qwen3-0.6B/blob/main/Qwen3-0.6B.litertlm")
                        try { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                        catch (_: android.content.ActivityNotFoundException) { status.text = url.toString() }
                    }
                    .setNegativeButton("Schließen", null)
                    .show()
            }
        })
        chat.addView(heading("AI Chat"))
        chat.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val composer = LinearLayout(this).apply {
            gravity = android.view.Gravity.BOTTOM
            background = surface(0xff20152d.toInt(), 12)
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        prompt.background = null
        prompt.setPadding(dp(8), dp(10), dp(8), dp(10))
        composer.addView(prompt, LinearLayout.LayoutParams(0, -2, 1f))
        send.text = "↑"
        send.contentDescription = "Nachricht senden"
        styleButton(send, true)
        composer.addView(send, LinearLayout.LayoutParams(dp(48), dp(44)))
        chat.addView(composer)
        setContentView(root)
        if (modelFile.isFile) loadModel(null)
    }

    @Deprecated("Uses the Android document picker")
    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        if (request == 1 && result == RESULT_OK) data?.data?.let { uri ->
            loadModel {
                val staging = File(filesDir, "model-import.tmp")
                try {
                    val source = checkNotNull(contentResolver.openInputStream(uri))
                    source.use { input -> staging.outputStream().use { output -> input.copyTo(output) } }
                    val name = queryName(uri)
                    require(name?.endsWith(".litertlm", ignoreCase = true) == true) { "Wähle eine .litertlm-Datei." }
                    openModel(staging) {
                        check(staging.renameTo(modelFile)) { "Modell konnte nicht gespeichert werden." }
                    }
                } finally { staging.delete() }
            }
        }
    }

    private fun queryName(uri: android.net.Uri): String? =
        contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }

    private fun openModel(file: File, onReady: () -> Unit = {}) {
        val next = Engine(EngineConfig(modelPath = file.absolutePath, backend = Backend.CPU(), cacheDir = cacheDir.path))
        next.initialize()
        try {
            val chat = next.createConversation()
            try { onReady() } catch (error: Exception) { chat.close(); throw error }
            closeModel()
            engine = next
            conversation = chat
        } catch (error: Exception) { next.close(); throw error }
    }

    private fun loadModel(importModel: (() -> Unit)?) {
        status.text = "Modell wird geladen …"
        choose.isEnabled = false
        send.isEnabled = false
        worker.execute {
            val result = runCatching { if (importModel != null) importModel() else openModel(modelFile) }
            val ready = conversation != null
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                status.text = if (result.isSuccess) "Lokales Modell bereit · CPU" else "Modell konnte nicht geladen werden. Prüfe Format, Speicherplatz und RAM."
                if (result.isSuccess) transcript.text = ""
                choose.isEnabled = true
                send.isEnabled = ready
            }
        }
    }

    private fun sendMessage() {
        val message = prompt.text.toString().trim()
        if (message.isEmpty()) return
        prompt.text.clear()
        send.isEnabled = false
        choose.isEnabled = false
        transcript.append("\n\nDu\n$message\n\nUNFEAL\n")
        worker.execute {
            val result = runCatching {
                runBlocking {
                    checkNotNull(conversation).sendMessageAsync(message).collect { chunk ->
                        runOnUiThread {
                            if (!isDestroyed) {
                                transcript.append(chunk.toString())
                                scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
                            }
                        }
                    }
                }
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                if (result.isFailure) transcript.append("\nDie Antwort konnte nicht abgeschlossen werden.")
                send.isEnabled = true
                choose.isEnabled = true
            }
        }
    }

    private fun closeModel() {
        conversation?.close()
        conversation = null
        engine?.close()
        engine = null
    }

    override fun onDestroy() {
        worker.execute { closeModel() }
        worker.shutdown()
        updateWorker.shutdownNow()
        super.onDestroy()
    }
}
