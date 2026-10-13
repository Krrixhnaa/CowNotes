# 🐮 CowNotes

A modern, fast, private, and iOS-inspired notes app built with full multimedia support, drawing canvas, interactive checklists, voice memos, inline math solver, and 100% offline database portability.

Includes both the **Web/PWA client** and the **Android Native APK project**.

---

## ✨ Features

- **📱 iOS Design & Feel**: Authentic Apple Notes typography, glassmorphism headers, smooth view transitions, and clean folder organization.
- **🔒 100% Offline & Private**: Zero cloud tracking or mandatory accounts. All notes, drawings, photos, and voice recordings remain locally stored on your device.
- **💾 One-Tap Database Backup & Restore (.db)**:
  - Export and share your full notes database via Android's native share sheet (Save to Google Drive, WhatsApp, Telegram, or Local Storage).
  - Import backups with automatic conflict merging or clean replacements.
- **✅ Interactive Checklists**: Checkboxes with smooth strike-through animations and completion counters.
- **🎙️ Voice Memos & Audio Recording**: Inline audio recorder with animated audio wave bars and native speech dictation.
- **🎨 Sketch & Drawing Canvas**: Freehand drawing tools with color swatches, stroke rendering, undo, and direct note embedding.
- **🔢 Inline Math Notes Solver**: Type calculations like `25 * 4 =` and watch CowNotes solve them on the fly.
- **🔐 PIN Lock**: Lock sensitive notes behind a 4-digit numeric passcode.
- **🌙 Dark / Light Mode**: Instant theme switching matching system appearance.
- **📁 Custom & System Folders**: Organize with custom folders, Pinned Notes, and Recently Deleted safety bin.

---

## 📁 Project Structure

```text
CowNotes/
├── android-app/             # Native Android project (Kotlin, WebView, MediaStore, Audio Record)
│   ├── app/
│   │   ├── src/main/assets/ # Embedded web assets for 100% offline Android runtime
│   │   └── src/main/java/   # Native bridges (file picker, speech, permissions)
│   └── gradlew.bat
├── public/                  # Core Web App / PWA assets
│   ├── css/ios-theme.css    # Complete iOS stylesheet
│   ├── js/app.js            # App core logic (IndexedDB, editor, math engine)
│   ├── icons/               # App icons & vector assets
│   └── index.html           # Main application view
├── server.js                # Optional lightweight local Node.js server
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### 1. Web Version (Local)

Run the optional local server:

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### 2. Android App

Open the `android-app/` folder in Android Studio, or build the APK via Gradle:

```bash
cd android-app
./gradlew assembleDebug
```

The compiled APK will be generated at:
`android-app/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License

MIT License. Free to use, modify, and distribute.
