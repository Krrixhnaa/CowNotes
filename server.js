const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'notes.json');

// Enable CORS for mobile app requests from any device/origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Force download on markdown and APK files
app.use((req, res, next) => {
  if (req.path.endsWith('.md') || req.path.endsWith('.markdown') || req.path.endsWith('.apk') || req.path.endsWith('.db') || req.path.endsWith('.zip')) {
    const filename = path.basename(req.path);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  next();
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    res.status(404).send('File not found');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Detect active local IPv4 address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Ensure data file exists with default seed

// 30-Day Automatic Trash Purge
function purgeExpiredNotes(store) {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const initialCount = store.notes.length;
  store.notes = store.notes.filter(n => {
    if (!n.deleted) return true;
    const deletedTime = n.deletedAt ? new Date(n.deletedAt).getTime() : (n.updatedAt ? new Date(n.updatedAt).getTime() : now);
    return (now - deletedTime) < thirtyDaysMs;
  });
  if (store.notes.length !== initialCount) {
    saveData(store);
  }
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Clean up any legacy references in existing data
      let changed = false;
      parsed.folders = parsed.folders.map(f => {
        if (f.name === 'All iCloud') {
          changed = true;
          return { ...f, name: 'CowCloud' };
        }
        return f;
      });
      parsed.notes = parsed.notes.map(n => {
        if (n.title.includes('CowNotes') || (n.content && n.content.includes('CowNotes')) || n.title.includes('Welcome to')) {
          changed = true;
          return {
            ...n,
            title: 'Welcome to CowNotes',
            content: `<div>Welcome to <b>CowNotes</b>!</div><div><br></div><div>Your personal notes app with instant real-time sync between your PC and phone.</div><div><br></div><div><b>✨ Key Features:</b></div><ul><li><b>Instant 2-Way Sync:</b> Type on PC, instantly updates on your phone.</li><li><b>Install on Phone:</b> Seamlessly connects over your local network.</li><li><b>Offline First:</b> Works even without internet; syncs as soon as reconnected.</li><li><b>Checklists, Audio Memos &amp; Drawings:</b> Full multimedia support.</li><li><b>Math Solver:</b> Type equations like <code>25 * 4 =</code> and watch it evaluate!</li><li><b>PIN Lock:</b> Protect private notes with passcode encryption.</li></ul>`
          };
        }
        return n;
      });
      if (changed) saveData(parsed);
      return parsed;
    }
  } catch (err) {
    console.error('Error reading notes data:', err);
  }

  const defaultData = {
    folders: [
      { id: 'notes', name: 'Notes', icon: 'folder-yellow', system: true },
      { id: 'pinned', name: 'Pinned', icon: 'pin', system: true },
      { id: 'quick', name: 'Quick Notes', icon: 'square-pencil', system: true },
      { id: 'trash', name: 'Recently Deleted', icon: 'trash', system: true },
      { id: 'work', name: 'Work & Projects', icon: 'briefcase', system: false },
      { id: 'personal', name: 'Personal', icon: 'heart', system: false }
    ],
    notes: [
      {
        id: 'welcome-cownote',
        title: 'Welcome to CowNotes',
        content: `<div>Welcome to <b>CowNotes</b>!</div><div><br></div><div>Your private, fast, and 100% offline note-taking app designed with iOS styling and powerful media tools.</div><div><br></div><div><b>✨ Key Features:</b></div><ul><li><b>100% Offline &amp; Private:</b> All your notes, photos, and voice memos stay on your phone. No servers or accounts required.</li><li><b>Backup &amp; Restore (.db):</b> Tap the blue dot at the top to save or share your entire database anytime to Google Drive, WhatsApp, or local storage.</li><li><b>Checklists &amp; Formatting:</b> Tap formatting icons to create interactive to-do lists, bold/italic text, quotes, and bullet lists.</li><li><b>Voice Memos &amp; Dictation:</b> Record high-quality audio notes with waveform playback or dictate text with your voice.</li><li><b>Sketch &amp; Drawing Canvas:</b> Draw sketches and handwritten notes directly inside your notes.</li><li><b>Math Solver:</b> Type any calculation like <code>25 * 4 =</code> and watch it evaluate automatically!</li><li><b>PIN Lock &amp; Privacy:</b> Lock sensitive notes with a private 4-digit passcode.</li></ul>`,
        folderId: 'notes',
        pinned: true,
        locked: false,
        pinCode: '',
        color: '#0A84FF',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deleted: false,
        attachments: []
      },
      {
        id: 'grocery-checklist',
        title: 'Weekly Groceries & Errands',
        content: `<div>Weekly grocery list to check off:</div><div><br></div><div class="ios-checklist-block"><div class="ios-check-item checked" data-checked="true"><span class="ios-checkbox"></span><span class="ios-check-text">Organic oat milk &amp; Greek yogurt</span></div><div class="ios-check-item checked" data-checked="true"><span class="ios-checkbox"></span><span class="ios-check-text">Fresh avocados &amp; baby spinach</span></div><div class="ios-check-item" data-checked="false"><span class="ios-checkbox"></span><span class="ios-check-text">Artisan sourdough bread</span></div><div class="ios-check-item" data-checked="false"><span class="ios-checkbox"></span><span class="ios-check-text">Espresso beans (dark roast)</span></div><div class="ios-check-item" data-checked="false"><span class="ios-checkbox"></span><span class="ios-check-text">Dark chocolate 85%</span></div></div>`,
        folderId: 'personal',
        pinned: false,
        locked: false,
        pinCode: '',
        color: '#EAA800',
        createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        deleted: false,
        attachments: []
      },
      {
        id: 'math-budget-note',
        title: 'Project Budget & Math Calculations',
        content: `<div>Quick calculations using CowNotes Math feature:</div><div><br></div><div>Server cost: 45 * 12 = 540</div><div>Domain &amp; SSL: 14 + 18 = 32</div><div>Designer asset pack: 95 * 0.8 = 76</div><div><b>Total estimated = 648</b></div><div><br></div><div>Tip: Type any expression followed by <b>=</b> and hit Space!</div>`,
        folderId: 'work',
        pinned: false,
        locked: false,
        pinCode: '',
        color: '#EAA800',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        deleted: false,
        attachments: []
      }
    ]
  };

  saveData(defaultData);
  return defaultData;
}

function deduplicateFolders(folders) {
  if (!Array.isArray(folders)) return [];
  const seen = new Set();
  return folders.filter(f => {
    if (!f || !f.id || seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

function saveData(data) {
  if (data && Array.isArray(data.folders)) {
    data.folders = deduplicateFolders(data.folders);
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

let store = loadData();

// Broadcast WebSocket message to all connected clients except sender
function broadcast(message, senderWs = null) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(data);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Wait for CLIENT_HELLO before initial sync or send current state
  ws.send(JSON.stringify({
    type: 'SERVER_READY',
    connectedDevices: wss.clients.size
  }));

  broadcast({
    type: 'DEVICE_COUNT_UPDATE',
    connectedDevices: wss.clients.size
  });

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      handleClientMessage(parsed, ws);
    } catch (e) {
      console.error('Invalid WS payload:', e);
    }
  });

  ws.on('close', () => {
    broadcast({
      type: 'DEVICE_COUNT_UPDATE',
      connectedDevices: wss.clients.size
    });
  });
});

function handleClientMessage(msg, senderWs) {
  switch (msg.type) {
    case 'CLIENT_HELLO': {
      // Bidirectional smart-merge on connect: NEVER overwrite or wipe client notes!
      const clientNotes = Array.isArray(msg.notes) ? msg.notes : [];
      const clientFolders = Array.isArray(msg.folders) ? msg.folders : [];

      let stateChanged = false;

      // Merge client notes into server store
      clientNotes.forEach(clientNote => {
        if (!clientNote || !clientNote.id) return;
        const serverIndex = store.notes.findIndex(n => n.id === clientNote.id);
        if (serverIndex >= 0) {
          const serverNote = store.notes[serverIndex];
          const clientTime = new Date(clientNote.updatedAt || clientNote.createdAt || 0).getTime();
          const serverTime = new Date(serverNote.updatedAt || serverNote.createdAt || 0).getTime();
          if (clientTime > serverTime) {
            store.notes[serverIndex] = { ...serverNote, ...clientNote };
            stateChanged = true;
          }
        } else {
          // Note exists on client but not on server: add to server!
          store.notes.unshift(clientNote);
          stateChanged = true;
        }
      });

      // Merge client folders into server store
      const serverFolderIds = new Set(store.folders.map(f => f.id));
      clientFolders.forEach(clientFolder => {
        if (clientFolder && clientFolder.id && !serverFolderIds.has(clientFolder.id)) {
          store.folders.push(clientFolder);
          serverFolderIds.add(clientFolder.id);
          stateChanged = true;
        }
      });

      if (stateChanged) {
        store.folders = deduplicateFolders(store.folders);
        saveData(store);
      }

      // Send the merged, complete state to the newly connected device
      senderWs.send(JSON.stringify({
        type: 'INIT_STATE',
        data: store,
        connectedDevices: wss.clients.size
      }));

      // Broadcast updated note state to other connected devices
      if (stateChanged) {
        broadcast({
          type: 'INIT_STATE',
          data: store,
          connectedDevices: wss.clients.size
        }, senderWs);
      }
      break;
    }
    case 'NOTE_UPDATE':
    case 'NOTE_UPSERT': {
      const note = msg.note;
      const index = store.notes.findIndex(n => n.id === note.id);
      if (index >= 0) {
        store.notes[index] = { ...store.notes[index], ...note, updatedAt: new Date().toISOString() };
    if (note.deleted === false) {
      store.notes[index].deleted = false;
      delete store.notes[index].deletedAt;
    }
        if (note.deleted === false) {
          store.notes[index].deleted = false;
          delete store.notes[index].deletedAt;
        }
      } else {
        store.notes.unshift({
          ...note,
          createdAt: note.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      saveData(store);
      broadcast({ type: 'NOTE_UPDATED', note: index >= 0 ? store.notes[index] : store.notes[0] }, senderWs);
      break;
    }

    case 'NOTE_DELETE': {
      const { id, permanent } = msg;
      if (permanent) {
        store.notes = store.notes.filter(n => n.id !== id);
      } else {
        const note = store.notes.find(n => n.id === id);
        if (note) {
          note.deleted = true;
          note.deletedAt = new Date().toISOString();
          note.updatedAt = new Date().toISOString();
        }
      }
      saveData(store);
      broadcast({ type: 'NOTE_DELETED', id, permanent }, senderWs);
      break;
    }

    case 'NOTE_RESTORE': {
      const { id } = msg;
      const note = store.notes.find(n => n.id === id);
      if (note) {
        note.deleted = false;
        note.updatedAt = new Date().toISOString();
        saveData(store);
        broadcast({ type: 'NOTE_RESTORED', note }, senderWs);
      }
      break;
    }

    case 'FOLDER_UPDATE': {
      const folder = msg.folder;
      if (!folder || !folder.id) break;
      const idx = store.folders.findIndex(f => f.id === folder.id);
      if (idx >= 0) {
        store.folders[idx] = { ...store.folders[idx], ...folder };
      } else {
        store.folders.push(folder);
      }
      store.folders = deduplicateFolders(store.folders);
      saveData(store);
      broadcast({ type: 'FOLDER_UPDATED', folder: idx >= 0 ? store.folders[idx] : folder }, senderWs);
      break;
    }

    case 'FOLDER_CREATE': {
      const folder = msg.folder;
      if (!folder || !folder.id) break;
      const idx = store.folders.findIndex(f => f.id === folder.id);
      if (idx >= 0) {
        store.folders[idx] = { ...store.folders[idx], ...folder };
      } else {
        store.folders.push(folder);
      }
      store.folders = deduplicateFolders(store.folders);
      saveData(store);
      broadcast({ type: 'FOLDER_CREATED', folder: idx >= 0 ? store.folders[idx] : folder }, senderWs);
      break;
    }

    case 'FOLDERS_REORDER': {
      if (Array.isArray(msg.folders)) {
        store.folders = msg.folders;
        saveData(store);
        broadcast({ type: 'INIT_STATE', data: store, connectedDevices: wss.clients.size }, senderWs);
      }
      break;
    }

    case 'FOLDER_DELETE': {
      const { id } = msg;
      store.folders = store.folders.filter(f => f.id !== id);
      store.notes.forEach(n => {
        if (n.folderId === id) n.folderId = 'notes';
      });
      saveData(store);
      broadcast({ type: 'FOLDER_DELETED', id }, senderWs);
      break;
    }

    case 'STORE_RESTORE': {
      if (msg.data && Array.isArray(msg.data.notes)) {
        const mode = msg.mode || 'replace';
        if (mode === 'merge') {
          const existingIds = new Set(store.notes.map(n => n.id));
          msg.data.notes.forEach(note => {
            if (!existingIds.has(note.id)) {
              store.notes.push(note);
            }
          });
          const existingFolderIds = new Set(store.folders.map(f => f.id));
          if (Array.isArray(msg.data.folders)) {
            msg.data.folders.forEach(f => {
              if (!existingFolderIds.has(f.id)) {
                store.folders.push(f);
              }
            });
          }
        } else {
          store = {
            folders: Array.isArray(msg.data.folders) && msg.data.folders.length > 0 ? msg.data.folders : store.folders,
            notes: msg.data.notes
          };
        }
        saveData(store);
        broadcast({ type: 'INIT_STATE', data: store, connectedDevices: wss.clients.size }, senderWs);
      }
      break;
    }
  }
}

const cleanup = () => {
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// REST APIs
app.get('/api/info', async (req, res) => {
  const localIp = getLocalIp();
  const localPhoneUrl = `http://${localIp}:${PORT}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(localPhoneUrl, {
      margin: 2,
      width: 280,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.error('QR code generation failed:', err);
  }

  res.json({
    appName: 'CowNotes',
    localIp,
    port: PORT,
    phoneUrl: localPhoneUrl,
    localPhoneUrl,
    qrCodeDataUrl,
    connectedDevices: wss.clients.size,
    totalNotes: store.notes.filter(n => !n.deleted).length
  });
});

app.get('/api/notes', (req, res) => {
  res.json(store);
});

app.post('/api/notes', (req, res) => {
  const note = req.body;
  if (!note.id) note.id = 'note_' + Date.now();
  const index = store.notes.findIndex(n => n.id === note.id);
  if (index >= 0) {
    store.notes[index] = { ...store.notes[index], ...note, updatedAt: new Date().toISOString() };
    if (note.deleted === false) {
      store.notes[index].deleted = false;
      delete store.notes[index].deletedAt;
    }
  } else {
    store.notes.unshift({
      ...note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  saveData(store);
  broadcast({ type: 'NOTE_UPDATED', note: index >= 0 ? store.notes[index] : store.notes[0] });
  res.json({ success: true, note: index >= 0 ? store.notes[index] : store.notes[0] });
});

app.put('/api/notes/:id', (req, res) => {
  const note = req.body;
  if (!note.id) note.id = 'note_' + Date.now();
  const index = store.notes.findIndex(n => n.id === note.id);
  if (index >= 0) {
    store.notes[index] = { ...store.notes[index], ...note, updatedAt: new Date().toISOString() };
    if (note.deleted === false) {
      store.notes[index].deleted = false;
      delete store.notes[index].deletedAt;
    }
  } else {
    store.notes.unshift({
      ...note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  saveData(store);
  broadcast({ type: 'NOTE_UPDATED', note: index >= 0 ? store.notes[index] : store.notes[0] });
  res.json({ success: true, note: index >= 0 ? store.notes[index] : store.notes[0] });
});

app.delete('/api/notes/:id', (req, res) => {
  const { id } = req.params;
  const permanent = req.query.permanent === 'true';
  if (permanent) {
    store.notes = store.notes.filter(n => n.id !== id);
  } else {
    const note = store.notes.find(n => n.id === id);
    if (note) {
      note.deleted = true;
      note.updatedAt = new Date().toISOString();
    }
  }
  saveData(store);
  broadcast({ type: 'NOTE_DELETED', id, permanent });
  res.json({ success: true });
});

app.delete('/api/folders/:id', (req, res) => {
  const { id } = req.params;
  const folder = store.folders.find(f => f.id === id);
  store.folders = store.folders.filter(f => f.id !== id);
  store.notes.forEach(n => {
    if (n.folderId === id && !n.deleted) {
      n.deleted = true;
      n.deletedAt = new Date().toISOString();
      n.updatedAt = new Date().toISOString();
    }
  });
  saveData(store);
  broadcast({ type: 'FOLDER_DELETED', id });
  res.json({ success: true, folderName: folder ? folder.name : '' });
});

app.post('/api/folders', (req, res) => {
  const folder = req.body;
  if (!folder.id) folder.id = 'folder_' + Date.now();
  const idx = store.folders.findIndex(f => f.id === folder.id);
  if (idx >= 0) {
    store.folders[idx] = { ...store.folders[idx], ...folder };
  } else {
    store.folders.push(folder);
  }
  saveData(store);
  broadcast({ type: 'FOLDER_UPDATED', folder: idx >= 0 ? store.folders[idx] : folder });
  res.json({ success: true, folder: idx >= 0 ? store.folders[idx] : folder });
});

app.put('/api/folders/:id', (req, res) => {
  const folder = req.body;
  const { id } = req.params;
  const idx = store.folders.findIndex(f => f.id === id);
  if (idx >= 0) {
    store.folders[idx] = { ...store.folders[idx], ...folder };
  } else {
    store.folders.push({ ...folder, id });
  }
  saveData(store);
  broadcast({ type: 'FOLDER_CREATED', folder: idx >= 0 ? store.folders[idx] : folder });
  res.json({ success: true, folder: idx >= 0 ? store.folders[idx] : folder });
});

app.get('/api/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="cownotes-backup.json"');
  res.send(JSON.stringify(store, null, 2));
});

app.get('/api/backup/db', (req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const dbPayload = {
    format: 'COWNOTES_DB',
    version: 1,
    exportedAt: new Date().toISOString(),
    appName: 'CowNotes',
    folders: store.folders,
    notes: store.notes,
    stats: {
      totalNotes: store.notes.length,
      activeNotes: store.notes.filter(n => !n.deleted).length,
      totalFolders: store.folders.length
    }
  };
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="cownotes_backup_${dateStr}.db"`);
  res.send(JSON.stringify(dbPayload, null, 2));
});

app.post('/api/restore/db', (req, res) => {
  try {
    const backupData = req.body;
    if (!backupData || !Array.isArray(backupData.notes)) {
      return res.status(400).json({ error: 'Invalid database backup format' });
    }
    const mode = req.query.mode || 'replace';
    if (mode === 'merge') {
      const existingIds = new Set(store.notes.map(n => n.id));
      backupData.notes.forEach(note => {
        if (!existingIds.has(note.id)) {
          store.notes.push(note);
        }
      });
      const existingFolderIds = new Set(store.folders.map(f => f.id));
      if (Array.isArray(backupData.folders)) {
        backupData.folders.forEach(f => {
          if (!existingFolderIds.has(f.id)) {
            store.folders.push(f);
          }
        });
      }
    } else {
      store = {
        folders: Array.isArray(backupData.folders) && backupData.folders.length > 0 ? backupData.folders : store.folders,
        notes: backupData.notes
      };
    }
    saveData(store);
    broadcast({ type: 'INIT_STATE', data: store, connectedDevices: wss.clients.size });
    res.json({ success: true, count: store.notes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restore/db-file', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  let tempPath = null;
  try {
    const buffer = req.body;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'No file data received' });
    }
    tempPath = path.join(__dirname, 'temp_restore_' + Date.now() + '.db');
    fs.writeFileSync(tempPath, buffer);

    // Detect if this is an encrypted ZIP / backup archive (starts with PK)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      const { extractAndImportNnnotes } = require('./import-nnnotes');
      try {
        const password = req.query.password || '';
        const result = extractAndImportNnnotes(tempPath, password);
        try { fs.unlinkSync(tempPath); } catch (_) {}
        store = loadData();
        broadcast({ type: 'INIT_STATE', data: store, connectedDevices: wss.clients.size });
        return res.json({ success: true, count: store.notes.length, foldersCount: result.foldersCount, notesCount: result.notesCount });
      } catch (zipErr) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
        if (zipErr.message && zipErr.message.includes('INCORRECT_PASSWORD')) {
          return res.status(401).json({ error: 'PASSWORD_REQUIRED', message: 'This backup is encrypted with a password or PIN. Please enter it to restore.' });
        }
        return res.status(400).json({ error: zipErr.message });
      }
    }

    // Standard SQLite DB
    const { importDatabase } = require('./import-db');
    const result = await importDatabase(tempPath, { merge: req.query.mode === 'merge' });
    try { fs.unlinkSync(tempPath); } catch (_) {}
    if (!result) {
      return res.status(400).json({ error: 'Failed to parse database file' });
    }
    store = loadData();
    broadcast({ type: 'INIT_STATE', data: store, connectedDevices: wss.clients.size });
    res.json({ success: true, count: store.notes.length, foldersCount: result.foldersCount, notesCount: result.notesCount });
  } catch (err) {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    console.error('Error during database restore:', err);
    res.status(500).json({ error: err.message });
  }
});


// Speech-to-Text Local Windows Transcription Engine (100% private, zero network failures)
const crypto = require('crypto');
const { execFile } = require('child_process');

app.post('/api/transcribe', (req, res) => {
  const { audio } = req.body;
  if (!audio) {
    return res.status(400).json({ success: false, error: 'Missing audio payload' });
  }

  try {
    const base64Data = audio.replace(/^data:audio\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempWav = path.join(tempDir, `stt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.wav`);
    fs.writeFileSync(tempWav, buffer);

    const scriptPath = path.join(__dirname, 'scripts', 'transcribe.ps1');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-wavFile', tempWav], {
      timeout: 10000,
      encoding: 'utf8'
    }, (err, stdout) => {
      try {
        if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
      } catch (_) {}

      if (err) {
        console.error('Transcription error:', err);
        return res.json({ success: false, text: '' });
      }

      const text = stdout ? stdout.trim() : '';
      return res.json({ success: true, text });
    });
  } catch (e) {
    console.error('Transcription endpoint failed:', e);
    return res.status(500).json({ success: false, error: 'Transcription failed' });
  }
});

// Download endpoint for CowNotes.apk
app.get('/download/CowNotes.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'android-app', 'CowNotes.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'CowNotes.apk');
  } else {
    res.status(404).send('APK is building or not found. Please try again in a moment.');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log(`=================================================`);
  console.log(`🐮 CowNotes Local Wi-Fi Sync Server is running!`);
  console.log(`💻 PC / Local:    http://localhost:${PORT}`);
  console.log(`📱 Phone (Wi-Fi): http://${localIp}:${PORT}`);
  console.log(`=================================================`);
});
