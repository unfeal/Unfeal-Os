package os.unfeal.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(0xff130d1c.toInt())
        }
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
        layout.addView(TextView(this).apply { text = "UNFEAL Mobile"; textSize = 30f })
        layout.addView(status)
        layout.addView(choose)
        layout.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        layout.addView(prompt)
        layout.addView(send)
        setContentView(layout)
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
        super.onDestroy()
    }
}
