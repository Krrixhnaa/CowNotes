function autoResizeTitle() {
  if (!el.noteTitleInput) return;
  el.noteTitleInput.style.height = 'auto';
  const newHeight = Math.max(34, el.noteTitleInput.scrollHeight);
  el.noteTitleInput.style.height = newHeight + 'px';
}


function convertCheckItemToNormalLine(checkItem) {
  if (!checkItem) return;
  const block = checkItem.closest('.ios-checklist-block');
  const textSpan = checkItem.querySelector('.ios-check-text');
  let innerHtml = textSpan ? textSpan.innerHTML : '';
  if (innerHtml === '<br>' || !innerHtml.replace(/<[^>]*>/g, '').trim()) {
    innerHtml = '<br>';
  }

  const blankLine = document.createElement('div');
  blankLine.innerHTML = innerHtml;

  if (block && block.parentNode) {
    if (block.children.length <= 1) {
      block.parentNode.replaceChild(blankLine, block);
    } else {
      if (checkItem === block.firstElementChild) {
        block.parentNode.insertBefore(blankLine, block);
        checkItem.remove();
      } else if (checkItem === block.lastElementChild) {
        if (block.nextSibling) {
          block.parentNode.insertBefore(blankLine, block.nextSibling);
        } else {
          block.parentNode.appendChild(blankLine);
        }
        checkItem.remove();
      } else {
        const secondBlock = document.createElement('div');
        secondBlock.className = 'ios-checklist-block';
        let curr = checkItem.nextElementSibling;
        while (curr) {
          const next = curr.nextElementSibling;
          secondBlock.appendChild(curr);
          curr = next;
        }
        if (block.nextSibling) {
          block.parentNode.insertBefore(blankLine, block.nextSibling);
          block.parentNode.insertBefore(secondBlock, blankLine.nextSibling);
        } else {
          block.parentNode.appendChild(blankLine);
          block.parentNode.appendChild(secondBlock);
        }
        checkItem.remove();
      }
    }
  } else if (checkItem.parentNode) {
    checkItem.parentNode.replaceChild(blankLine, checkItem);
  } else {
    el.noteBodyEditor.appendChild(blankLine);
  }

  const sel = window.getSelection();
  const range = document.createRange();
  if (blankLine.firstChild && blankLine.firstChild.nodeType === Node.TEXT_NODE) {
    range.setStart(blankLine.firstChild, 0);
  } else {
    range.setStart(blankLine, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  setupInteractiveChecklistsInEditor();
  queueAutoSave();
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

// =============================================================================
// MULTI-NOTE SELECTION MODE CONTROLLER
// =============================================================================
let isSelectionMode = false;
let selectedNoteIds = new Set();
let pendingBatchDeleteIds = null;
let isPendingBatchTrash = false;

function enterSelectionMode() {
  isSelectionMode = true;
  selectedNoteIds.clear();
  
  const doneBtn = document.getElementById('btn-selection-done');
  const folderOptBtn = document.getElementById('btn-folder-options');
  const syncPill = document.getElementById('notes-sync-pill');
  const normalBottomBar = document.getElementById('notes-bottom-bar');
  const selBottomBar = document.getElementById('selection-bottom-bar');

  if (doneBtn) doneBtn.style.display = 'block';
  if (folderOptBtn) folderOptBtn.style.display = 'none';
  if (syncPill) syncPill.style.display = 'none';
  if (normalBottomBar) normalBottomBar.style.display = 'none';
  if (selBottomBar) selBottomBar.style.display = 'flex';

  updateSelectionUI();
  renderNotesList();
}

function exitSelectionMode() {
  isSelectionMode = false;
  selectedNoteIds.clear();
  pendingBatchDeleteIds = null;

  const doneBtn = document.getElementById('btn-selection-done');
  const folderOptBtn = document.getElementById('btn-folder-options');
  const syncPill = document.getElementById('notes-sync-pill');
  const normalBottomBar = document.getElementById('notes-bottom-bar');
  const selBottomBar = document.getElementById('selection-bottom-bar');

  if (doneBtn) doneBtn.style.display = 'none';
  if (folderOptBtn) folderOptBtn.style.display = 'flex';
  if (syncPill) syncPill.style.display = 'inline-flex';
  if (normalBottomBar) normalBottomBar.style.display = 'flex';
  if (selBottomBar) selBottomBar.style.display = 'none';

  renderNotesList();
}

function updateSelectionUI() {
  const countText = document.getElementById('selection-count-text');
  const moveBtn = document.getElementById('btn-selection-move');
  const deleteBtn = document.getElementById('btn-selection-delete');

  const count = selectedNoteIds.size;
  const isTrash = state.activeFolderId === 'trash';

  if (countText) {
    countText.textContent = count === 0 ? 'Select Notes' : `${count} ${count === 1 ? 'Note' : 'Notes'} Selected`;
  }

  if (moveBtn) {
    if (isTrash) {
      moveBtn.textContent = count === 0 ? 'Recover All' : (count === 1 ? 'Recover' : `Recover (${count})`);
    } else {
      moveBtn.textContent = count === 0 ? 'Move All' : (count === 1 ? 'Move' : `Move (${count})`);
    }
    moveBtn.disabled = false;
    moveBtn.style.opacity = '1';
    moveBtn.style.pointerEvents = 'auto';
  }

  if (deleteBtn) {
    deleteBtn.textContent = count === 0 ? 'Delete All' : (count === 1 ? 'Delete' : `Delete (${count})`);
    deleteBtn.disabled = false;
    deleteBtn.style.opacity = '1';
    deleteBtn.style.pointerEvents = 'auto';
  }
}

function toggleNoteSelection(noteId) {
  if (selectedNoteIds.has(noteId)) {
    selectedNoteIds.delete(noteId);
  } else {
    selectedNoteIds.add(noteId);
  }
  updateSelectionUI();
  renderNotesList();
}

function deleteSelectedNotes() {
  const count = selectedNoteIds.size;
  const isTrash = state.activeFolderId === 'trash';

  let idsToDelete = [];
  if (count === 0) {
    const currentNotes = getFilteredNotes();
    if (currentNotes.length === 0) return;
    idsToDelete = currentNotes.map(n => n.id);
  } else {
    idsToDelete = Array.from(selectedNoteIds);
  }

  pendingBatchDeleteIds = idsToDelete;
  isPendingBatchTrash = isTrash;
  noteIdPendingDelete = null;
  folderIdPendingDelete = null;

  const modal = document.getElementById('modal-delete-confirm');
  if (modal) {
    const title = document.getElementById('delete-confirm-title');
    const desc = document.getElementById('delete-confirm-desc');
    const btnConfirm = document.getElementById('btn-confirm-delete');

    const num = idsToDelete.length;
    if (isTrash) {
      if (title) title.textContent = `Delete ${num} ${num === 1 ? 'Note' : 'Notes'} Permanently?`;
      if (desc) desc.textContent = 'These notes will be permanently erased. This action cannot be undone.';
      if (btnConfirm) btnConfirm.textContent = `Delete ${num > 1 ? num + ' Notes' : 'Note'} Immediately`;
    } else {
      if (title) title.textContent = `Delete ${num} ${num === 1 ? 'Note' : 'Notes'}?`;
      if (desc) desc.textContent = 'These notes will be moved to Recently Deleted.';
      if (btnConfirm) btnConfirm.textContent = 'Move to Recently Deleted';
    }

    modal.classList.add('active');
  }
}

function handleSelectionMoveOrRecover() {
  const isTrash = state.activeFolderId === 'trash';
  if (isTrash) {
    let idsToRecover = [];
    if (selectedNoteIds.size === 0) {
      const currentNotes = getFilteredNotes();
      if (currentNotes.length === 0) return;
      idsToRecover = currentNotes.map(n => n.id);
    } else {
      idsToRecover = Array.from(selectedNoteIds);
    }

    const serverUrl = getEffectiveServerUrl();
    idsToRecover.forEach(id => {
      const n = state.notes.find(note => note.id === id);
      if (n) {
        n.deleted = false;
        delete n.deletedAt;
        n.updatedAt = new Date().toISOString();
        sendSocketMessage({ type: 'NOTE_UPSERT', note: n });
        sendSocketMessage({ type: 'NOTE_RESTORE', id: n.id });
        if (serverUrl) {
          fetch(`${serverUrl}/api/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n)
          }).catch(() => {});
        }
      }
    });

    persistState();
    renderFolders();
    renderNotesList();
    showToast(`Recovered ${idsToRecover.length} ${idsToRecover.length === 1 ? 'note' : 'notes'}`);
    exitSelectionMode();
  } else {
    if (selectedNoteIds.size === 0) {
      const currentNotes = getFilteredNotes();
      if (currentNotes.length === 0) return;
      currentNotes.forEach(n => selectedNoteIds.add(n.id));
      updateSelectionUI();
      renderNotesList();
    }
    openMoveFolderModal();
  }
}

function moveSelectedNotes(targetFolderId) {
  if (selectedNoteIds.size === 0) return;
  const count = selectedNoteIds.size;
  const targetFolder = state.folders.find(f => f.id === targetFolderId);
  const serverUrl = getEffectiveServerUrl();

  selectedNoteIds.forEach(id => {
    const n = state.notes.find(note => note.id === id);
    if (n) {
      n.folderId = targetFolderId;
      n.deleted = false;
      delete n.deletedAt;
      n.updatedAt = new Date().toISOString();
      sendSocketMessage({ type: 'NOTE_UPSERT', note: n });
      if (serverUrl) {
        fetch(`${serverUrl}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n)
        }).catch(() => {});
      }
    }
  });

  persistState();
  renderFolders();
  renderNotesList();
  showToast(`Moved ${count} ${count === 1 ? 'note' : 'notes'} to ${targetFolder ? targetFolder.name : 'Folder'}`);
  exitSelectionMode();
  closeMoveFolderModal();
}


function sortNotesList() {
  if (currentSortMode === 'title') {
    state.notes.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' }));
  } else if (currentSortMode === 'updated') {
    state.notes.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  } else {
    state.notes.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return timeB - timeA;
    });
  }
}


// =============================================================================
// FLOATING CONTEXT MENU CONTROLLER (IMAGES 1 & 2)
// =============================================================================
let currentSortMode = (typeof localStorage !== 'undefined' && localStorage.getItem('cownotes_sort_mode')) || 'created';

function showContextMenu(items, x, y, originRight = false) {
  const backdrop = document.getElementById('ios-context-menu-backdrop');
  const menu = document.getElementById('ios-context-menu');
  if (!backdrop || !menu) return;

  menu.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'ios-ctx-row' + (item.danger ? ' danger' : '');
    
    let leftHtml = `<div class="ios-ctx-left"><span class="ios-ctx-label">${escapeHtml(item.label)}</span>`;
    if (item.sub) {
      leftHtml += `<span class="ios-ctx-sub">${escapeHtml(item.sub)}</span>`;
    }
    leftHtml += '</div>';

    row.innerHTML = `
      ${leftHtml}
      <span class="ios-ctx-icon">${item.iconSvg}</span>
    `;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (item.onClick) item.onClick();
    });

    menu.appendChild(row);
  });

  // Calculate position safely inside viewport
  const padding = 16;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  if (originRight) {
    menu.style.transformOrigin = 'top right';
    menu.style.top = Math.max(padding, Math.min(y, viewportH - 320)) + 'px';
    menu.style.right = '16px';
    menu.style.left = 'auto';
  } else {
    menu.style.transformOrigin = 'top left';
    let posX = Math.max(padding, Math.min(x - 20, viewportW - 296));
    let posY = Math.max(padding, Math.min(y - 20, viewportH - 320));
    menu.style.top = posY + 'px';
    menu.style.left = posX + 'px';
    menu.style.right = 'auto';
  }

  backdrop.classList.add('active');
}

function closeContextMenu() {
  const backdrop = document.getElementById('ios-context-menu-backdrop');
  if (backdrop) backdrop.classList.remove('active');
}

// Setup Backdrop click to dismiss
document.addEventListener('DOMContentLoaded', () => {
  const backdrop = document.getElementById('ios-context-menu-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeContextMenu();
    });
  }
});


let trashNoteIdPending = null;

function promptTrashActions(noteId) {
  trashNoteIdPending = noteId;
  const modal = document.getElementById('modal-trash-actions');
  const title = document.getElementById('trash-action-title');
  const note = state.notes.find(n => n.id === noteId);
  if (title && note) {
    title.textContent = `"${note.title || 'Untitled Note'}"`;
  }
  if (modal) modal.classList.add('active');
}

function closeTrashActions() {
  const modal = document.getElementById('modal-trash-actions');
  if (modal) modal.classList.remove('active');
  trashNoteIdPending = null;
}

function recoverPendingTrashNote() {
  if (!trashNoteIdPending) return;
  const note = state.notes.find(n => n.id === trashNoteIdPending);
  if (note) {
    note.deleted = false;
    delete note.deletedAt;
    note.updatedAt = new Date().toISOString();
    sendSocketMessage({ type: 'NOTE_RESTORE', id: note.id });
    const serverUrl = getEffectiveServerUrl();
    if (serverUrl) {
      fetch(`${serverUrl}/api/notes/${encodeURIComponent(note.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
      }).catch(() => {});
    }
    persistState();
    renderNotesList();
    renderFolders();
    showToast('Note recovered ↩️');
  }
  closeTrashActions();
}

function deletePendingTrashNoteForever() {
  const id = trashNoteIdPending;
  closeTrashActions();
  if (id) {
    deleteNotePermanently(id);
  }
}


// Permanently Erase a Note (Both client and server storage)
function deleteNotePermanently(id) {
  if (!id) return;
  
  // 1. Remove from local array
  state.notes = state.notes.filter(n => n.id !== id);
  
  // 2. Send socket permanent delete
  sendSocketMessage({ type: 'NOTE_DELETE', id, permanent: true });
  
  // 3. Fallback REST DELETE
  const serverUrl = getEffectiveServerUrl();
  if (serverUrl) {
    fetch(`${serverUrl}/api/notes/${encodeURIComponent(id)}?permanent=true`, { method: 'DELETE' }).catch(() => {});
  }

  // 4. Persist and render
  persistState();
  renderFolders();
  renderNotesList();
  showToast('Permanently deleted note 🗑️');

  // 5. If editor was open for this note, navigate back
  if (state.activeNoteId === id) {
    state.activeNoteId = null;
    navigateBackToList();
  }
}

// Move Note to another folder
let pendingMoveTargetNoteId = null;

function moveNoteToFolder(noteId, targetFolderId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  const targetFolder = state.folders.find(f => f.id === targetFolderId);
  note.folderId = targetFolderId;
  note.deleted = false;
  delete note.deletedAt;
  note.updatedAt = new Date().toISOString();

  sendSocketMessage({ type: 'NOTE_UPSERT', note });
  sendSocketMessage({ type: 'NOTE_UPDATE', note });
  const serverUrl = getEffectiveServerUrl();
  if (serverUrl) {
    fetch(`${serverUrl}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note)
    }).catch(() => {});
  }

  // If this note was moved while active in the editor, update the editor back button destination
  if (state.activeNoteId === noteId && targetFolder) {
    state.activeFolderId = targetFolderId;
    if (el.editorBackFolderName) el.editorBackFolderName.textContent = targetFolder.name;
    if (el.currentFolderTitle) el.currentFolderTitle.textContent = targetFolder.name;
  }

  persistState();
  renderFolders();
  renderNotesList();
  showToast(`Moved to ${targetFolder ? targetFolder.name : 'Folder'}`);
  closeMoveFolderModal();
}

function openMoveFolderModal(targetNoteId = null) {
  pendingMoveTargetNoteId = targetNoteId;
  const modal = document.getElementById('modal-move-folder');
  const container = document.getElementById('move-folders-list');
  if (!modal || !container) return;

  container.innerHTML = '';

  // Determine current folder of the note being moved
  let currentFolderId = state.activeFolderId || 'notes';
  if (targetNoteId) {
    const n = state.notes.find(note => note.id === targetNoteId);
    if (n && n.folderId) currentFolderId = n.folderId;
  } else if (selectedNoteIds.size === 1) {
    const n = state.notes.find(note => note.id === Array.from(selectedNoteIds)[0]);
    if (n && n.folderId) currentFolderId = n.folderId;
  } else if (state.activeNoteId) {
    const n = state.notes.find(note => note.id === state.activeNoteId);
    if (n && n.folderId) currentFolderId = n.folderId;
  }

  // Destination folders can be ANY valid folder (excluding trash & pinned)
  const validFolders = state.folders.filter(f => f.id !== 'trash' && f.id !== 'pinned');

  validFolders.forEach(f => {
    const isCurrent = (f.id === currentFolderId) || (currentFolderId === 'all' && f.id === 'notes');
    const row = document.createElement('div');
    row.className = 'ios-action-item' + (isCurrent ? ' disabled' : '');
    if (isCurrent) {
      row.style.opacity = '0.4';
      row.style.pointerEvents = 'none';
    }
    row.innerHTML = `
      <div class="ios-action-left">
        <span class="ios-action-badge" style="background: rgba(234, 168, 0, 0.15); color: var(--ios-yellow);">
          ${getFolderIconSvg(f.icon || 'folder')}
        </span>
        <span class="ios-action-name">${escapeHtml(f.name)}${isCurrent ? ' (Current)' : ''}</span>
      </div>
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:var(--text-tertiary);"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
    `;
    row.addEventListener('click', () => {
      if (isCurrent) return;
      if (selectedNoteIds.size > 0) {
        moveSelectedNotes(f.id);
      } else {
        const idToMove = pendingMoveTargetNoteId || state.activeNoteId;
        if (idToMove) {
          moveNoteToFolder(idToMove, f.id);
        }
      }
    });
    container.appendChild(row);
  });

  if (el.modalNoteOptions) el.modalNoteOptions.classList.remove('active');
  modal.classList.add('active');
}

function closeMoveFolderModal() {
  const modal = document.getElementById('modal-move-folder');
  if (modal) modal.classList.remove('active');
  pendingMoveTargetNoteId = null;
}

/**
 * CowNotes Application Controller
 * Features: CowNotes UI, Real-time 2-Way Sync, CowSync Storage, Checklists,
 * Inline Voice Memos, Stylus Sketching, Smart Math Solver, PIN Lock.
 */

// Application State
const state = {
  folders: [],
  notes: [],
  activeFolderId: 'notes',
  currentView: 'view-folders',
  activeNoteId: null,
  activeFilter: 'all',
  searchQuery: '',
  deviceCount: 1,
  theme: localStorage.getItem('cownotes_theme') || 'auto',
  ws: null,
  wsConnected: false,
  saveTimer: null,
  pinBuffer: '',
  pinAction: null, // { type: 'unlock' | 'lock', noteId }
  mediaRecorder: null,
  audioChunks: [],
  recordingStartTime: null,
  recordingTimerInterval: null,
  drawingHistory: [],
  drawingColor: '#000000',
  drawingLineWidth: 3
};

// UI Elements
const el = {
  container: document.getElementById('app-container'),
  paneFolders: document.getElementById('pane-folders'),
  paneNotesList: document.getElementById('pane-notes-list'),
  paneEditor: document.getElementById('pane-editor'),
  
  systemFoldersGroup: document.getElementById('system-folders-group'),
  customFoldersGroup: document.getElementById('custom-folders-group'),
  notesCardsContainer: document.getElementById('notes-cards-container'),
  
  currentFolderTitle: document.getElementById('current-folder-title'),
  navFoldersLabel: document.getElementById('nav-folders-label'),
  notesCountBadge: document.getElementById('notes-count-badge'),
  
  btnNavToFolders: document.getElementById('btn-nav-to-folders'),
  btnEditorBack: document.getElementById('btn-editor-back'),
  editorBackFolderName: document.getElementById('editor-back-folder-name'),
  
  btnCreateNote: document.getElementById('btn-create-note'),
  btnSidebarNewNote: document.getElementById('btn-sidebar-new-note'),
  btnNewFolder: document.getElementById('btn-new-folder'),
  btnEditorDone: document.getElementById('btn-editor-done'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),
  btnPhoneConnect: document.getElementById('btn-phone-connect'),
  
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  filterChips: document.querySelectorAll('.ios-chip'),
  
  noteTitleInput: document.getElementById('note-title-input'),
  noteBodyEditor: document.getElementById('note-body-editor'),
  editorTimestamp: document.getElementById('editor-timestamp'),
  editorHeaderTitle: document.getElementById('editor-header-title'),
  
  syncPill: document.getElementById('sync-pill'),
  syncDot: document.getElementById('sync-dot'),
  syncText: document.getElementById('sync-text'),
  
  btnEditFolders: document.getElementById('btn-edit-folders'),
  tbBold: document.getElementById('tb-bold'),
  tbItalic: document.getElementById('tb-italic'),
  tbUnderline: document.getElementById('tb-underline'),
  // Toolbar buttons
  tbChecklist: document.getElementById('tb-checklist'),
  tbFormat: document.getElementById('tb-format'),
  tbMedia: document.getElementById('tb-media'),
  tbMic: document.getElementById('tb-mic'),
  tbDraw: document.getElementById('tb-draw'),
  mediaFileInput: document.getElementById('media-file-input'),
  
  // Modals
  modalPhoneConnect: document.getElementById('modal-phone-connect'),
  btnClosePhoneModal: document.getElementById('btn-close-phone-modal'),
  qrCodeImg: document.getElementById('qr-code-img'),
  phoneUrlDisplay: document.getElementById('phone-url-display'),
  phoneUrlCopyBox: document.getElementById('phone-url-copy-box'),
  
  modalPinLock: document.getElementById('modal-pin-lock'),
  pinDots: document.querySelectorAll('.ios-pin-dot'),
  pinModalTitle: document.getElementById('pin-modal-title'),
  pinModalSubtitle: document.getElementById('pin-modal-subtitle'),
  btnPinCancel: document.getElementById('btn-pin-cancel'),
  keypadBtns: document.querySelectorAll('.ios-keypad-btn'),
  
  modalDrawing: document.getElementById('modal-drawing'),
  drawingCanvas: document.getElementById('drawing-canvas'),
  btnDrawCancel: document.getElementById('btn-draw-cancel'),
  btnDrawSave: document.getElementById('btn-draw-save'),
  btnDrawUndo: document.getElementById('btn-draw-undo'),
  btnDrawClear: document.getElementById('btn-draw-clear'),
  swatches: document.querySelectorAll('.ios-swatch'),
  
  modalNoteOptions: document.getElementById('modal-note-options'),
  btnNoteOptions: document.getElementById('btn-note-options'),
  btnCloseOptionsModal: document.getElementById('btn-close-options-modal'),
  btnShareNote: document.getElementById('btn-share-note'),
  optVoiceMemo: document.getElementById('opt-voice-memo'),
  modalSyncSettings: document.getElementById('modal-sync-settings'),
  btnCloseSyncModal: document.getElementById('btn-close-sync-modal'),
  syncSettingsDot: document.getElementById('sync-settings-dot'),
  syncSettingsStatus: document.getElementById('sync-settings-status'),
  inputSyncServerUrl: document.getElementById('input-sync-server-url'),
  btnSaveSyncServer: document.getElementById('btn-save-sync-server'),
  btnClearSyncServer: document.getElementById('btn-clear-sync-server'),
  dictationBar: document.getElementById('dictation-bar'),
  dictationStatusText: document.getElementById('dictation-status-text'),
  btnStopDictation: document.getElementById('btn-stop-dictation'),
  optPinNote: document.getElementById('opt-pin-note'),
  optPinText: document.getElementById('opt-pin-text'),
  optLockNote: document.getElementById('opt-lock-note'),
  optLockText: document.getElementById('opt-lock-text'),
  optExportMd: document.getElementById('opt-export-md'),
  optPrintNote: document.getElementById('opt-print-note'),
  optDeleteNote: document.getElementById('opt-delete-note'),
  btnBackupModal: document.getElementById('btn-backup-modal'),
  btnOpenBackupFromSync: document.getElementById('btn-open-backup-from-sync'),
  modalBackupRestore: document.getElementById('modal-backup-restore'),
  btnCloseBackupModal: document.getElementById('btn-close-backup-modal'),
  backupSummaryText: document.getElementById('backup-summary-text'),
  btnExportDb: document.getElementById('btn-export-db'),
  btnImportDbTrigger: document.getElementById('btn-import-db-trigger'),
  inputDbFile: document.getElementById('db-file-input'),
  restorePreviewBox: document.getElementById('restore-preview-box'),
  restorePreviewTitle: document.getElementById('restore-preview-title'),
  restorePreviewDesc: document.getElementById('restore-preview-desc'),
  btnRestoreReplace: document.getElementById('btn-restore-replace'),
  btnRestoreMerge: document.getElementById('btn-restore-merge'),
  btnRestoreCancel: document.getElementById('btn-restore-cancel'),
  btnBottomBackup: document.getElementById('btn-bottom-backup'),
  optBackupDb: document.getElementById('opt-backup-db'),
  btnServerDbDownload: document.getElementById('btn-server-db-download'),
  
  toast: document.getElementById('toast-notification')
};

// =============================================================================
// INITIALIZATION
// =============================================================================
function init() {
  applyTheme(state.theme);
  loadCachedState();
  setupAudioPlayersInEditor();
  initWebSocket();
  setupEventListeners();
  initDrawingCanvas();
  fetchServerInfo();
  registerServiceWorker();
  purgeExpiredDeletedNotes();
  renderFolders();
  renderNotesList();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registered:', reg.scope))
      .catch(err => console.log('SW registration error:', err));
  }
}

// Local Cache Persistence
function loadCachedState() {
  try {
    const cached = localStorage.getItem('cownotes_store');
    if (cached) {
      const data = JSON.parse(cached);
      if (data.notes && data.notes.length) state.notes = data.notes;
      if (data.folders && data.folders.length) state.folders = deduplicateFolders(data.folders);
    }
    if (state.notes && state.notes.length) {
      let cleaned = false;
      state.notes.forEach(n => {
        if (n.content && /iOS|Apple/i.test(n.content)) {
          n.content = n.content.replace(/iOS Math Notes/gi, 'CowNotes Math Solver')
                               .replace(/iOS Math/gi, 'CowNotes Math')
                               .replace(/iOS Notes/gi, 'CowNotes')
                               .replace(/iOS/gi, 'CowNotes')
                               .replace(/Apple/gi, 'CowNotes');
          cleaned = true;
        }
        if (n.title && /iOS|Apple/i.test(n.title)) {
          n.title = n.title.replace(/iOS/gi, 'CowNotes').replace(/Apple/gi, 'CowNotes');
          cleaned = true;
        }
      });
      if (cleaned) persistState();
    }
  } catch (e) {
    console.error('Failed to load local cache:', e);
  }

  // Clean up legacy 'all' folder from cache and ensure 'notes' is default
  if (state.folders && state.folders.length > 0) {
    state.folders = state.folders.filter(f => f.id !== 'all');
    if (!state.folders.some(f => f.id === 'notes')) {
      state.folders.unshift({ id: 'notes', name: 'Notes', icon: 'folder-yellow', system: true });
    }
  } else {
    state.folders = [
      { id: 'notes', name: 'Notes', icon: 'folder-yellow', system: true },
      { id: 'pinned', name: 'Pinned', icon: 'pin', system: true },
      { id: 'quick', name: 'Quick Notes', icon: 'square-pencil', system: true },
      { id: 'trash', name: 'Recently Deleted', icon: 'trash', system: true },
      { id: 'work', name: 'Work & Projects', icon: 'briefcase', system: false },
      { id: 'personal', name: 'Personal', icon: 'heart', system: false }
    ];
  }
  if (!state.activeFolderId || state.activeFolderId === 'all') {
    state.activeFolderId = 'notes';
  }
  if (state.notes) {
    state.notes.forEach(n => {
      if (!n.folderId || n.folderId === 'all') n.folderId = 'notes';
    });
  }
  if (!state.notes || state.notes.length === 0) {
    state.notes = [
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
        color: '#0A84FF',
        createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        deleted: false,
        attachments: []
      }
    ];
  }
}

function persistState() {
  try {
    state.folders = deduplicateFolders(state.folders);
    localStorage.setItem('cownotes_store', JSON.stringify({
      folders: state.folders,
      notes: state.notes
    }));
  } catch (e) {
    console.error('Failed to save to local cache:', e);
  }
}

// =============================================================================
// WEBSOCKET & SYNC (UNIVERSAL FOR ANY ANDROID DEVICE + STANDALONE OFFLINE)
// =============================================================================
// Standalone Mode Helpers
function isStandaloneMode() {
  const stored = localStorage.getItem('cownotes_standalone');
  if (stored !== null) return stored === 'true';
  // Default to standalone offline mode if on Android local assets or no stored server URL
  return !getStoredServerUrl();
}

function setStandaloneMode(enabled) {
  if (enabled) {
    localStorage.setItem('cownotes_standalone', 'true');
  } else {
    localStorage.removeItem('cownotes_standalone');
  }
}

function getStoredServerUrl() {
  return (localStorage.getItem('cownotes_server_url') || '').trim();
}

function setStoredServerUrl(url) {
  if (url) {
    url = url.trim().replace(/\/+$/, '');
  }
  localStorage.setItem('cownotes_server_url', url || '');
}

const DEFAULT_CLOUD_URL = '';

function getEffectiveServerUrl() {
  if (isStandaloneMode()) {
    return null;
  }
  const saved = getStoredServerUrl();
  if (saved) return saved;
  if (window.location.protocol.startsWith('http') && window.location.host) {
    return window.location.origin;
  }
  return null;
}

function getWebSocketUrl() {
  if (isStandaloneMode()) return null;
  const base = getEffectiveServerUrl();
  if (!base) return null;
  try {
    const url = new URL(base);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws`;
  } catch (e) {
    return null;
  }
}

function getApiUrl(path) {
  const base = getEffectiveServerUrl();
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

let wsReconnectTimeout = null;

function initWebSocket() {
  if (wsReconnectTimeout) {
    clearTimeout(wsReconnectTimeout);
    wsReconnectTimeout = null;
  }

  const wsUrl = getWebSocketUrl();
  if (!wsUrl) {
    state.wsConnected = false;
    setSyncStatus('offline', 'Standalone');
    updateSyncSettingsModalUI();
    return;
  }

  setSyncStatus('syncing', 'Connecting...');
  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      state.wsConnected = true;
      setSyncStatus('online', 'Live Sync');
      updateSyncSettingsModalUI();
      // Send CLIENT_HELLO with local notes & folders to ensure no local notes are lost
      sendSocketMessage({
        type: 'CLIENT_HELLO',
        notes: state.notes || [],
        folders: state.folders || []
      });
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSocketMessage(msg);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    state.ws.onclose = () => {
      state.wsConnected = false;
      setSyncStatus('offline', 'Offline');
      updateSyncSettingsModalUI();
      wsReconnectTimeout = setTimeout(initWebSocket, 4000);
    };

    state.ws.onerror = () => {
      state.wsConnected = false;
      setSyncStatus('offline', 'Offline');
      updateSyncSettingsModalUI();
    };
  } catch (err) {
    state.wsConnected = false;
    setSyncStatus('offline', 'Standalone');
    updateSyncSettingsModalUI();
  }
}

function handleSocketMessage(msg) {
  switch (msg.type) {
    

    case 'SERVER_READY':
      sendSocketMessage({
        type: 'CLIENT_HELLO',
        notes: state.notes || [],
        folders: state.folders || []
      });
      break;

    case 'INIT_STATE':
      if (msg.data) {
        const incomingNotes = Array.isArray(msg.data.notes) ? msg.data.notes : [];
        const incomingFolders = Array.isArray(msg.data.folders) ? msg.data.folders : [];

        // Bidirectional Safety: Merge local notes with incoming server notes (NEVER wipe local notes!)
        const incomingNoteIds = new Set(incomingNotes.map(n => n.id));
        const mergedNotes = [...incomingNotes];

        // Retain any notes present locally that the server didn't have yet
        (state.notes || []).forEach(localNote => {
          if (localNote && localNote.id && !incomingNoteIds.has(localNote.id)) {
            mergedNotes.push(localNote);
          }
        });

        // Merge folders
        const incomingFolderIds = new Set(incomingFolders.map(f => f.id));
        const mergedFolders = [...incomingFolders];
        (state.folders || []).forEach(localFolder => {
          if (localFolder && localFolder.id && !incomingFolderIds.has(localFolder.id)) {
            mergedFolders.push(localFolder);
          }
        });

        state.folders = deduplicateFolders(mergedFolders.map(f => {
          if (f.name === 'All iCloud') f.name = 'CowSync';
          return f;
        }));
        state.notes = mergedNotes;
        state.deviceCount = msg.connectedDevices || 1;
        persistState();
        renderFolders();
        renderNotesList();
        
        if (state.activeNoteId && document.activeElement !== el.noteBodyEditor && document.activeElement !== el.noteTitleInput) {
          const note = state.notes.find(n => n.id === state.activeNoteId);
          if (note) loadNoteIntoEditor(note, false);
        }
      }
      break;

    case 'NOTE_UPDATED': {
      const incoming = msg.note;
      const index = state.notes.findIndex(n => n.id === incoming.id);
      if (index >= 0) {
        state.notes[index] = incoming;
      } else {
        state.notes.unshift(incoming);
      }
      persistState();
      renderFolders();
      renderNotesList();

      if (state.activeNoteId === incoming.id) {
        if (document.activeElement !== el.noteBodyEditor && document.activeElement !== el.noteTitleInput) {
          loadNoteIntoEditor(incoming, false);
        }
      }
      break;
    }

    case 'NOTE_DELETED': {
      const { id, permanent } = msg;
      if (permanent) {
        state.notes = state.notes.filter(n => n.id !== id);
      } else {
        const n = state.notes.find(n => n.id === id);
        if (n) n.deleted = true;
      }
      if (state.activeNoteId === id) {
        navigateBackToList();
      }
      persistState();
      renderFolders();
      renderNotesList();
      break;
    }

    case 'NOTE_RESTORED': {
      const restored = msg.note;
      const index = state.notes.findIndex(n => n.id === restored.id);
      if (index >= 0) state.notes[index] = restored;
      persistState();
      renderFolders();
      renderNotesList();
      break;
    }

    case 'FOLDER_CREATED':
    case 'FOLDER_UPDATED': {
      if (!msg.folder || !msg.folder.id) break;
      const index = state.folders.findIndex(f => f.id === msg.folder.id);
      if (index >= 0) {
        state.folders[index] = { ...state.folders[index], ...msg.folder };
      } else {
        state.folders.push(msg.folder);
      }
      state.folders = deduplicateFolders(state.folders);
      persistState();
      renderFolders();
      break;
    }

    case 'FOLDER_DELETED':
      state.folders = state.folders.filter(f => f.id !== msg.id);
      persistState();
      renderFolders();
      break;

    case 'DEVICE_COUNT_UPDATE':
      state.deviceCount = msg.connectedDevices;
      updateSyncBadge();
      break;
  }
}

function sendSocketMessage(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  } else {
    if (msg.type === 'NOTE_UPSERT') {
      fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg.note)
      }).catch(err => console.log('REST fallback note save failed:', err));
    }
  }
}

function setSyncStatus(status, text) {
  const dots = [
    el.syncDot, 
    document.getElementById('notes-sync-dot'), 
    document.getElementById('sync-settings-dot')
  ].filter(Boolean);

  dots.forEach(dot => {
    dot.className = 'ios-sync-dot';
  });

  if (el.syncText) {
    el.syncText.textContent = '';
  }
}

function updateSyncBadge() {
  if (el.syncText) {
    el.syncText.textContent = '';
  }
}

// Fetch Server info & QR Code (supports Global Cloud Tunnel & Local Wi-Fi)
let currentQrType = 'cloud';


function openPhoneConnectModal() {
  updateSyncSettingsModalUI();
  const syncModal = el.modalSyncSettings || document.getElementById('modal-sync-settings');
  if (syncModal) syncModal.classList.add('active');
}

async function fetchServerInfo(type = currentQrType) {
  try {
    currentQrType = type;
    const path = `/api/info?type=${type}`;
    const apiUrl = getApiUrl(path) || path;
    const res = await fetch(apiUrl);
    const info = await res.json();
    if (info.phoneUrl && el.phoneUrlDisplay) {
      el.phoneUrlDisplay.textContent = info.phoneUrl;
    }
    if (info.qrCodeDataUrl && el.qrCodeImg) {
      el.qrCodeImg.src = info.qrCodeDataUrl;
    }

    const btnCloud = document.getElementById('btn-qr-cloud');
    const btnWifi = document.getElementById('btn-qr-wifi');
    if (btnCloud && btnWifi) {
      if (type === 'cloud' && info.publicTunnelUrl) {
        btnCloud.style.background = 'var(--ios-yellow)';
        btnCloud.style.color = '#000000';
        btnCloud.style.fontWeight = '700';
        btnCloud.style.border = 'none';

        btnWifi.style.background = 'transparent';
        btnWifi.style.color = 'var(--text-secondary)';
        btnWifi.style.fontWeight = '400';
        btnWifi.style.border = '1px solid var(--border-subtle)';
      } else {
        btnWifi.style.background = 'var(--ios-yellow)';
        btnWifi.style.color = '#000000';
        btnWifi.style.fontWeight = '700';
        btnWifi.style.border = 'none';

        btnCloud.style.background = 'transparent';
        btnCloud.style.color = 'var(--text-secondary)';
        btnCloud.style.fontWeight = '400';
        btnCloud.style.border = '1px solid var(--border-subtle)';
      }
    }
  } catch (e) {
    console.error('Failed to fetch server info:', e);
  }
}

// =============================================================================
// FOLDERS RENDERING
// =============================================================================

// 30-Day Automatic Trash Purge (Purge Specification)
function purgeExpiredDeletedNotes() {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const initialLength = state.notes.length;
  
  const expiredNotes = [];
  state.notes = state.notes.filter(n => {
    if (!n.deleted) return true;
    const deletedTime = n.deletedAt ? new Date(n.deletedAt).getTime() : (n.updatedAt ? new Date(n.updatedAt).getTime() : now);
    const isExpired = (now - deletedTime) >= thirtyDaysMs;
    if (isExpired) expiredNotes.push(n.id);
    return !isExpired;
  });

  if (expiredNotes.length > 0) {
    expiredNotes.forEach(id => {
      sendSocketMessage({ type: 'NOTE_DELETE', id, permanent: true });
    });
    persistState();
    renderNotesList();
    renderFolders();
  }
}

function renderFolders() {
  if (!el.systemFoldersGroup || !el.customFoldersGroup) return;
  state.folders = deduplicateFolders(state.folders);
  el.systemFoldersGroup.innerHTML = '';
  el.customFoldersGroup.innerHTML = '';

  const systemFolders = state.folders.filter(f => f.system);
  const customFolders = state.folders.filter(f => !f.system);

  const sysFrag = document.createDocumentFragment();
  systemFolders.forEach(folder => {
    sysFrag.appendChild(createFolderElement(folder));
  });
  el.systemFoldersGroup.appendChild(sysFrag);

  const custFrag = document.createDocumentFragment();
  customFolders.forEach(folder => {
    custFrag.appendChild(createFolderElement(folder));
  });
  el.customFoldersGroup.appendChild(custFrag);

  const customCard = document.getElementById('custom-folders-card');
  if (customCard) {
    customCard.style.display = customFolders.length > 0 ? '' : 'none';
  }
}

function getFolderCount(folderId) {
  if (folderId === 'trash') {
    return state.notes.filter(n => n.deleted).length;
  }
  if (folderId === 'pinned') {
    return state.notes.filter(n => !n.deleted && n.pinned).length;
  }
  return state.notes.filter(n => !n.deleted && (n.folderId === folderId || (!n.folderId && folderId === 'notes'))).length;
}

function toggleEditFoldersMode(enable) {
  isEditingFolders = enable !== undefined ? enable : !isEditingFolders;
  if (el.btnEditFolders) {
    el.btnEditFolders.textContent = isEditingFolders ? 'Done' : 'Edit';
    el.btnEditFolders.classList.toggle('bold', isEditingFolders);
  }
  if (el.paneFolders) {
    el.paneFolders.classList.toggle('editing-folders', isEditingFolders);
  }
}


function executeDeleteFolder(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder || folder.system) return;

  // 1. Move all notes inside this folder to trash
  state.notes.forEach(n => {
    if (n.folderId === folderId && !n.deleted) {
      n.deleted = true;
      n.deletedAt = new Date().toISOString();
      n.updatedAt = new Date().toISOString();
      sendSocketMessage({ type: 'NOTE_DELETE', id: n.id, permanent: false });
    }
  });

  // 2. Remove folder from state
  state.folders = state.folders.filter(f => f.id !== folderId);
  if (state.activeFolderId === folderId) {
    state.activeFolderId = 'all';
    navigateView('view-folders');
  }

  // 3. Send WebSocket & REST delete to server
  sendSocketMessage({ type: 'FOLDER_DELETE', id: folderId });
  const serverUrl = getEffectiveServerUrl();
  if (serverUrl) {
    fetch(`${serverUrl}/api/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }).catch(() => {});
  }

  // 4. Save and re-render
  persistState();
  renderFolders();
  renderNotesList();
  showToast(`Deleted folder "${folder.name}"`);
}

function deleteCustomFolder(folderId) {
  executeDeleteFolder(folderId);
}



// =============================================================================
// EDIT FOLDER MODAL (NAME & CURATED SF ICONS - NO EMOJIS)
// =============================================================================
let currentEditingFolder = null;
let selectedFolderIconKey = 'folder';

function openEditFolderModal(folder) {
  if (!folder || folder.system) {
    showToast('System folder cannot be edited');
    return;
  }
  currentEditingFolder = folder;
  selectedFolderIconKey = folder.icon || 'folder';
  const modal = document.getElementById('modal-edit-folder');
  const nameInput = document.getElementById('edit-folder-name-input');
  const preview = document.getElementById('edit-folder-icon-preview');
  const grid = document.getElementById('edit-folder-icons-grid');
  const title = document.getElementById('edit-folder-title');
  if (!modal || !nameInput || !preview || !grid) return;

  if (title) title.textContent = 'Edit Folder';
  nameInput.value = folder.name || '';
  preview.innerHTML = getFolderIconSvg(selectedFolderIconKey);

  grid.innerHTML = '';
  Object.keys(FOLDER_ICONS).forEach(iconKey => {
    if (iconKey === 'trash') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ios-folder-icon-choice' + (iconKey === selectedFolderIconKey ? ' selected' : '');
    btn.innerHTML = FOLDER_ICONS[iconKey];
    btn.title = iconKey;
    btn.addEventListener('click', () => {
      selectedFolderIconKey = iconKey;
      preview.innerHTML = getFolderIconSvg(selectedFolderIconKey);
      grid.querySelectorAll('.ios-folder-icon-choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    grid.appendChild(btn);
  });

  modal.classList.add('active');
  setTimeout(() => nameInput.focus(), 120);
}

function closeEditFolderModal() {
  const modal = document.getElementById('modal-edit-folder');
  if (modal) modal.classList.remove('active');
  currentEditingFolder = null;
}

function saveEditFolder() {
  if (!currentEditingFolder) return;
  const nameInput = document.getElementById('edit-folder-name-input');
  const newName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Folder';
  currentEditingFolder.name = newName;
  currentEditingFolder.icon = selectedFolderIconKey;

  const idx = state.folders.findIndex(f => f.id === currentEditingFolder.id);
  if (idx >= 0) {
    state.folders[idx] = { ...state.folders[idx], ...currentEditingFolder };
  }
  state.folders = deduplicateFolders(state.folders);

  persistState();
  renderFolders();
  renderNotesList();

  sendSocketMessage({ type: 'FOLDER_UPDATE', folder: currentEditingFolder });
  const serverUrl = getEffectiveServerUrl();
  if (serverUrl) {
    fetch(`${serverUrl}/api/folders/${encodeURIComponent(currentEditingFolder.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentEditingFolder)
    }).catch(() => {});
  }

  showToast(`Updated "${currentEditingFolder.name}"`);
  closeEditFolderModal();
}

// =============================================================================
// REORDER / MOVE FOLDER MODAL
// =============================================================================
function openReorderFolderModal(folder) {
  if (!folder || folder.system) {
    showToast('System folder cannot be moved');
    return;
  }
  const modal = document.getElementById('modal-reorder-folder');
  const actionsList = document.getElementById('reorder-folder-actions');
  const title = document.getElementById('reorder-folder-title');
  if (!modal || !actionsList) return;

  if (title) title.textContent = `Move "${folder.name}"`;
  actionsList.innerHTML = '';

  const customFolders = state.folders.filter(f => !f.system && f.id !== 'all' && f.id !== 'pinned' && f.id !== 'trash');
  const index = customFolders.findIndex(f => f.id === folder.id);

  if (index > 0) {
    const moveUpRow = document.createElement('div');
    moveUpRow.className = 'ios-action-item';
    moveUpRow.innerHTML = `
      <div class="ios-action-left">
        <span class="ios-action-badge" style="background: rgba(0, 122, 255, 0.15); color: #007AFF;">
          <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
        </span>
        <span class="ios-action-name">Move Up</span>
      </div>
    `;
    moveUpRow.addEventListener('click', () => {
      const prevFolder = customFolders[index - 1];
      const i1 = state.folders.findIndex(f => f.id === folder.id);
      const i2 = state.folders.findIndex(f => f.id === prevFolder.id);
      if (i1 !== -1 && i2 !== -1) {
        const temp = state.folders[i1];
        state.folders[i1] = state.folders[i2];
        state.folders[i2] = temp;
        persistState();
        renderFolders();
        sendSocketMessage({ type: 'FOLDERS_REORDER', folders: state.folders });
        showToast(`Moved "${folder.name}" up`);
      }
      closeReorderFolderModal();
    });
    actionsList.appendChild(moveUpRow);

    const moveTopRow = document.createElement('div');
    moveTopRow.className = 'ios-action-item';
    moveTopRow.innerHTML = `
      <div class="ios-action-left">
        <span class="ios-action-badge" style="background: rgba(52, 199, 89, 0.15); color: #34C759;">
          <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M4 4h16v2H4zm8 4l6 6h-4v6h-4v-6H6z"/></svg>
        </span>
        <span class="ios-action-name">Move to Top</span>
      </div>
    `;
    moveTopRow.addEventListener('click', () => {
      const firstCustom = customFolders[0];
      const firstIdx = state.folders.findIndex(f => f.id === firstCustom.id);
      const currIdx = state.folders.findIndex(f => f.id === folder.id);
      if (firstIdx !== -1 && currIdx !== -1) {
        const item = state.folders.splice(currIdx, 1)[0];
        state.folders.splice(firstIdx, 0, item);
        persistState();
        renderFolders();
        sendSocketMessage({ type: 'FOLDERS_REORDER', folders: state.folders });
        showToast(`Moved "${folder.name}" to top`);
      }
      closeReorderFolderModal();
    });
    actionsList.appendChild(moveTopRow);
  }

  if (index !== -1 && index < customFolders.length - 1) {
    const moveDownRow = document.createElement('div');
    moveDownRow.className = 'ios-action-item';
    moveDownRow.innerHTML = `
      <div class="ios-action-left">
        <span class="ios-action-badge" style="background: rgba(0, 122, 255, 0.15); color: #007AFF;">
          <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </span>
        <span class="ios-action-name">Move Down</span>
      </div>
    `;
    moveDownRow.addEventListener('click', () => {
      const nextFolder = customFolders[index + 1];
      const i1 = state.folders.findIndex(f => f.id === folder.id);
      const i2 = state.folders.findIndex(f => f.id === nextFolder.id);
      if (i1 !== -1 && i2 !== -1) {
        const temp = state.folders[i1];
        state.folders[i1] = state.folders[i2];
        state.folders[i2] = temp;
        persistState();
        renderFolders();
        sendSocketMessage({ type: 'FOLDERS_REORDER', folders: state.folders });
        showToast(`Moved "${folder.name}" down`);
      }
      closeReorderFolderModal();
    });
    actionsList.appendChild(moveDownRow);
  }

  const moveNotesRow = document.createElement('div');
  moveNotesRow.className = 'ios-action-item';
  moveNotesRow.innerHTML = `
    <div class="ios-action-left">
      <span class="ios-action-badge" style="background: rgba(234, 168, 0, 0.15); color: var(--ios-yellow);">
        <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3v-3h2v3h3v2z"/></svg>
      </span>
      <span class="ios-action-name">Move All Notes to Another Folder...</span>
    </div>
  `;
  moveNotesRow.addEventListener('click', () => {
    closeReorderFolderModal();
    const folderNotes = state.notes.filter(n => !n.deleted && n.folderId === folder.id);
    if (folderNotes.length === 0) {
      showToast('This folder has no notes to move');
      return;
    }
    selectedNoteIds.clear();
    folderNotes.forEach(n => selectedNoteIds.add(n.id));
    openMoveFolderModal();
  });
  actionsList.appendChild(moveNotesRow);

  modal.classList.add('active');
}

function closeReorderFolderModal() {
  const modal = document.getElementById('modal-reorder-folder');
  if (modal) modal.classList.remove('active');
}

function createFolderElement(folder) {
  const item = document.createElement('div');
  item.className = 'ios-folder-item';
  if (folder.id === state.activeFolderId) item.classList.add('active');

  const count = getFolderCount(folder.id);
  const icon = getFolderIconSvg(folder.icon || 'folder');

  const deleteBtnHtml = !folder.system 
    ? `<button class="ios-folder-delete-btn" data-folder-id="${folder.id}" title="Delete folder">−</button>`
    : '';

  const lockBadgeHtml = folder.locked 
    ? `<span class="ios-folder-lock-badge" title="Locked"><svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></span>`
    : '';

  item.innerHTML = `
    <div class="ios-folder-left">
      ${deleteBtnHtml}
      <span class="ios-folder-icon">${icon}</span>
      <span class="ios-folder-name">${escapeHtml(folder.name)}</span>${lockBadgeHtml}
    </div>
    <div class="ios-folder-right">
      <span>${count}</span>
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
    </div>
  `;

  // Hard-press (long-press) to manage / lock folder
  let isFolderLongPressTriggered = false;

  if (folder.id !== 'trash' && folder.id !== 'pinned') {
    let folderLongPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;

    const openFolderActions = (clientX, clientY) => {
      const lockOption = {
        label: folder.locked ? 'Remove Lock' : 'Lock Folder',
        iconSvg: '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
        onClick: () => {
          if (folder.locked) {
            promptFolderUnlockOrRemove(folder);
          } else {
            promptFolderPinSet(folder);
          }
        }
      };

      const items = [];
      if (!folder.system) {
        items.push({
          label: 'Edit Folder',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
          onClick: () => {
            openEditFolderModal(folder);
          }
        });
      }

      items.push(lockOption);

      if (!folder.system) {
        items.push({
          label: 'Move',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
          onClick: () => {
            openReorderFolderModal(folder);
          }
        });
        items.push({
          label: 'Delete',
          danger: true,
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
          onClick: () => {
            promptDeleteFolder(folder.id);
          }
        });
      }
      showContextMenu(items, clientX, clientY);
    };

    const startPress = (clientX, clientY) => {
      isFolderLongPressTriggered = false;
      touchStartX = clientX;
      touchStartY = clientY;
      clearTimeout(folderLongPressTimer);
      folderLongPressTimer = setTimeout(() => {
        isFolderLongPressTriggered = true;
        if (navigator.vibrate) {
          /* no-op */
        }
        item.classList.add('ios-folder-longpress-active');
        setTimeout(() => item.classList.remove('ios-folder-longpress-active'), 250);
        openFolderActions(clientX, clientY);
      }, 480);
    };

    const cancelPress = () => {
      clearTimeout(folderLongPressTimer);
      folderLongPressTimer = null;
    };

    const checkMove = (clientX, clientY) => {
      if (folderLongPressTimer) {
        const diffX = Math.abs(clientX - touchStartX);
        const diffY = Math.abs(clientY - touchStartY);
        if (diffX > 10 || diffY > 10) {
          cancelPress();
        }
      }
    };

    item.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        startPress(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    item.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 1) {
        checkMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    item.addEventListener('touchend', () => cancelPress());
    item.addEventListener('touchcancel', () => cancelPress());

    item.addEventListener('mousedown', (e) => {
      if (e.button === 0) startPress(e.clientX, e.clientY);
    });
    item.addEventListener('mousemove', (e) => checkMove(e.clientX, e.clientY));
    item.addEventListener('mouseup', () => cancelPress());

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancelPress();
      openFolderActions(e.clientX, e.clientY);
    });
  }

  const deleteBtn = item.querySelector('.ios-folder-delete-btn');
  if (deleteBtn) {
    const handleDeleteAction = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      promptDeleteFolder(folder.id);
    };

    deleteBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
    deleteBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, { passive: false });
    deleteBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
    deleteBtn.addEventListener('click', handleDeleteAction);
  }

  item.addEventListener('click', (e) => {
    if (e.target.closest('.ios-folder-delete-btn')) {
      return;
    }
    if (isFolderLongPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      isFolderLongPressTriggered = false;
      return;
    }
    if (isEditingFolders && !folder.system) {
      openEditFolderModal(folder);
      return;
    }
    if (folder.locked && !folder._unlocked) {
      promptFolderPinUnlock(folder);
      return;
    }
    selectFolder(folder.id);
  });

  return item;
}

const FOLDER_ICONS = {
  'folder': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  'folder-yellow': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  'pin': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>',
  'cloud': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>',
  'square-pencil': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  'trash': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  'briefcase': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg>',
  'heart': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  'star': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
  'bookmark': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
  'tag': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>',
  'code': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  'book': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>',
  'music': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  'camera': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>',
  'cart': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>',
  'bulb': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>',
  'coffee': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3zM2 21h18v2H2z"/></svg>',
  'lock': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
  'shield': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
  'flag': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>',
  'check': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
  'globe': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
  'sparkles': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>',
  'lightning': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
  'terminal': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4z"/></svg>',
  'palette': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l2.25-2.25C9.37 19.38 10.63 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
  'trophy': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1c1.88-.41 3.34-1.89 3.61-3.96C19.08 11.63 21 9.55 21 7V5c0-1.1-.9-2-2-2zm-14 3V7h2v3.8c-1.21-.37-2-1.44-2-2.8zm14 0c0 1.36-.79 2.43-2 2.8V7h2v1z"/></svg>',
  'sun': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.28 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-1 4.5h2v2.95h-2V20zm-7.45-.96l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>',
  'layers': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9.07l-9-7-9 7 1.63 1.2L12 16z"/></svg>',
  'compass': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-5.5l2.5-5.5 5.5-2.5-2.5 5.5-5.5 2.5zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>'
};

function getFolderIconSvg(type) {
  return FOLDER_ICONS[type] || FOLDER_ICONS['folder'];
}

function selectFolder(folderId, bypassLock = false) {
  if (folderId === 'all') folderId = 'notes';
  const targetFolder = state.folders.find(f => f.id === folderId);
  if (!bypassLock && targetFolder && targetFolder.locked && !targetFolder._unlocked) {
    promptFolderPinUnlock(targetFolder);
    return;
  }
  state.activeFolderId = folderId;
  const paneList = document.getElementById('pane-notes-list');
  if (paneList) paneList.setAttribute('data-active-folder', folderId);

  const btnCreateNote = document.getElementById('btn-create-note') || el.btnCreateNote;
  if (btnCreateNote) {
    if (folderId === 'trash') {
      btnCreateNote.style.setProperty('display', 'none', 'important');
    } else {
      btnCreateNote.style.display = 'flex';
    }
  }
  let name = 'Notes';

  if (folderId === 'all') {
    name = 'All Notes';
    state.activeFilter = 'all';
  } else if (folderId === 'pinned') {
    name = 'Pinned';
    state.activeFilter = 'pinned';
  } else if (folderId === 'trash') {
    name = 'Recently Deleted';
    state.activeFilter = 'all';
  } else {
    const folder = state.folders.find(f => f.id === folderId);
    name = folder ? folder.name : 'Notes';
    state.activeFilter = 'all';
  }
  
  el.currentFolderTitle.textContent = name;
  if (el.editorBackFolderName) el.editorBackFolderName.textContent = name;

  if (el.filterChips) {
    el.filterChips.forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === state.activeFilter);
    });
  }
  
  renderFolders();
  navigateView('view-notes');
  requestAnimationFrame(() => {
    renderNotesList();
  });
}

// =============================================================================
// NOTES LIST RENDERING
// =============================================================================
function getFilteredNotes() {
  let notes = state.notes.slice();

  // Strict folder isolation: ALWAYS scope strictly to the current folder!
  if (state.activeFolderId === 'trash') {
    notes = notes.filter(n => n.deleted);
  } else if (state.activeFolderId === 'pinned') {
    notes = notes.filter(n => !n.deleted && n.pinned);
  } else {
    // A note only belongs to ONE folder:
    // 'notes' folder ONLY contains notes created in 'notes'.
    // Custom user folder ONLY contains notes belonging to that custom folder.
    const targetFolder = state.activeFolderId || 'notes';
    notes = notes.filter(n => !n.deleted && (n.folderId === targetFolder || (!n.folderId && targetFolder === 'notes')));
  }

  if (state.activeFilter === 'pinned') {
    notes = notes.filter(n => n.pinned);
  } else if (state.activeFilter === 'checklists') {
    notes = notes.filter(n => n.content && n.content.includes('ios-check-item'));
  } else if (state.activeFilter === 'audio') {
    notes = notes.filter(n => n.content && n.content.includes('ios-audio-card'));
  } else if (state.activeFilter === 'drawings') {
    notes = notes.filter(n => n.content && n.content.includes('ios-drawing-attachment'));
  } else if (state.activeFilter === 'locked') {
    notes = notes.filter(n => n.locked);
  }

  // Search strictly inside the currently active folder/view
  if (state.searchQuery && state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    notes = notes.filter(n => {
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const contentMatch = (stripHtml(n.content) || '').toLowerCase().includes(q);
      return titleMatch || contentMatch;
    });
  }

    // Sort notes based on currentSortMode
  if (currentSortMode === 'title') {
    notes.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' }));
  } else if (currentSortMode === 'updated') {
    notes.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  } else {
    // Default: 'created' (newest created at top, oldest created at bottom)
    notes.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const timeB = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return timeB - timeA;
    });
  }

  return notes;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getNoteMonthYearGroup(note) {
  const dateStr = note.createdAt || note.updatedAt;
  const d = dateStr ? new Date(dateStr) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const year = validDate.getFullYear();
  const month = validDate.getMonth();
  const currentYear = new Date().getFullYear();
  const title = (year === currentYear) ? MONTH_NAMES[month] : `${MONTH_NAMES[month]} ${year}`;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return { key, title };
}

function renderNotesList() {
  const paneList = document.getElementById('pane-notes-list');
  if (paneList) paneList.setAttribute('data-active-folder', state.activeFolderId);

  const btnCreateNote = document.getElementById('btn-create-note') || el.btnCreateNote;
  if (btnCreateNote) {
    if (state.activeFolderId === 'trash') {
      btnCreateNote.style.setProperty('display', 'none', 'important');
    } else {
      btnCreateNote.style.display = 'flex';
    }
  }

  const notes = getFilteredNotes();
  const notesCountText = `${notes.length} ${notes.length === 1 ? 'Note' : 'Notes'}`;
  if (el.notesCountBadge) el.notesCountBadge.textContent = notesCountText;
  const summaryEl = document.getElementById('notes-summary-text') || el.notesSummaryText;
  if (summaryEl) summaryEl.textContent = notesCountText;
  el.notesCardsContainer.innerHTML = '';

  if (notes.length === 0) {
    let emptyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>`;
    let emptyTitle = 'No Notes';
    let emptySubtitle = '';

    if (state.activeFolderId === 'trash') {
      emptyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>`;
      emptyTitle = 'No Recently Deleted Notes';
      emptySubtitle = 'Notes deleted in the last 30 days will appear here.';
    } else if (state.searchQuery && state.searchQuery.trim()) {
      emptyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>`;
      emptyTitle = 'No Results Found';
      emptySubtitle = `No notes match "${escapeHtml(state.searchQuery.trim())}".`;
    }

    el.notesCardsContainer.innerHTML = `
      <div class="ios-empty-state">
        <div class="ios-empty-icon">
          ${emptyIcon}
        </div>
        <p class="ios-empty-title">${emptyTitle}</p>
        ${emptySubtitle ? `<p class="ios-empty-subtitle">${emptySubtitle}</p>` : ''}
      </div>
    `;
    return;
  }

  const pinnedNotes = notes.filter(n => n.pinned);
  const unpinnedNotes = notes.filter(n => !n.pinned);

  const notesFragment = document.createDocumentFragment();

  if (pinnedNotes.length > 0) {
    const pinnedHeader = document.createElement('div');
    pinnedHeader.className = 'ios-section-header';
    pinnedHeader.textContent = 'Pinned';
    notesFragment.appendChild(pinnedHeader);

    const pinnedGroup = document.createElement('div');
    pinnedGroup.className = 'ios-card-group';
    pinnedNotes.forEach(note => pinnedGroup.appendChild(createNoteItemElement(note)));
    notesFragment.appendChild(pinnedGroup);
  }

  if (unpinnedNotes.length > 0) {
    if (currentSortMode === 'title') {
      const notesHeader = document.createElement('div');
      notesHeader.className = 'ios-section-header ios-month-header' + (pinnedNotes.length === 0 ? ' first-header' : '');
      notesHeader.textContent = 'Notes';
      notesFragment.appendChild(notesHeader);

      const notesGroup = document.createElement('div');
      notesGroup.className = 'ios-card-group';
      unpinnedNotes.forEach(note => notesGroup.appendChild(createNoteItemElement(note)));
      notesFragment.appendChild(notesGroup);
    } else {
      // Group notes by month of year (Date Created or Date Modified)
      const monthGroups = [];
      const groupMap = new Map();

      unpinnedNotes.forEach(note => {
        const { key, title } = getNoteMonthYearGroup(note);
        if (!groupMap.has(key)) {
          const groupObj = { key, title, notes: [] };
          groupMap.set(key, groupObj);
          monthGroups.push(groupObj);
        }
        groupMap.get(key).notes.push(note);
      });

      monthGroups.sort((a, b) => b.key.localeCompare(a.key));

      monthGroups.forEach((group, index) => {
        const notesHeader = document.createElement('div');
        notesHeader.className = 'ios-section-header ios-month-header' + (index === 0 && pinnedNotes.length === 0 ? ' first-header' : '');
        notesHeader.textContent = group.title;
        notesFragment.appendChild(notesHeader);

        const notesGroup = document.createElement('div');
        notesGroup.className = 'ios-card-group';
        group.notes.forEach(note => notesGroup.appendChild(createNoteItemElement(note)));
        notesFragment.appendChild(notesGroup);
      });
    }
  }

  el.notesCardsContainer.appendChild(notesFragment);
}

let noteIdPendingDelete = null;


let folderIdPendingDelete = null;

function promptDeleteFolder(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder || folder.system) return;

  folderIdPendingDelete = folderId;
  noteIdPendingDelete = null;
  const modal = document.getElementById('modal-delete-confirm');
  if (modal) {
    const title = document.getElementById('delete-confirm-title') || modal.querySelector('div[style*="font-size: 17px"]');
    const desc = document.getElementById('delete-confirm-desc') || modal.querySelector('div[style*="font-size: 13px"]');
    const btnConfirm = document.getElementById('btn-confirm-delete');

    if (title) title.textContent = `Delete "${folder.name}"?`;
    if (desc) desc.textContent = 'Notes inside will be moved to Recently Deleted.';
    if (btnConfirm) btnConfirm.textContent = 'Delete Folder';

    modal.classList.add('active');
  }
}

function promptDeleteNote(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  noteIdPendingDelete = noteId;
  folderIdPendingDelete = null;
  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
  if (modalDeleteConfirm) {
    const title = modalDeleteConfirm.querySelector('div[style*="font-size: 17px"]');
    const desc = modalDeleteConfirm.querySelector('div[style*="font-size: 13px"]');
    const btnConfirm = document.getElementById('btn-confirm-delete');

    if (note.deleted) {
      if (title) title.textContent = 'Delete Note Permanently?';
      if (desc) desc.textContent = 'This note will be permanently erased. This action cannot be undone.';
      if (btnConfirm) btnConfirm.textContent = 'Delete Immediately';
    } else {
      if (title) title.textContent = 'Delete Note';
      if (desc) desc.textContent = 'This note will be moved to Recently Deleted.';
      if (btnConfirm) btnConfirm.textContent = 'Delete Note';
    }

    modalDeleteConfirm.classList.add('active');
  }
}

function createNoteItemElement(note) {
  const item = document.createElement('div');
  const isSelected = selectedNoteIds.has(note.id);
  item.className = 'ios-note-item' + 
                   (note.id === state.activeNoteId ? ' active' : '') +
                   (isSelectionMode ? ' selection-active' : '') +
                   (isSelected ? ' selected' : '');
  item.dataset.id = note.id;

  const plainText = note.plainText || stripHtml(note.content);
  let title = (note.title && note.title.trim()) || '';
  if (!title) {
    if (plainText) {
      const firstLine = plainText.split(/[.\n]/)[0].trim();
      title = firstLine.length > 45 ? firstLine.substring(0, 45) + '...' : (firstLine || 'New Note');
    } else {
      title = 'New Note';
    }
  }

  let snippet = note.locked ? 'Locked Note' : (plainText || 'No additional text');
  if (note.deleted) {
    const deletedTime = note.deletedAt ? new Date(note.deletedAt).getTime() : new Date(note.updatedAt).getTime();
    const daysElapsed = Math.floor((Date.now() - deletedTime) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(1, 30 - daysElapsed);
    snippet = `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining`;
  }
  const dateFormatted = formatNoteDate(note.createdAt || note.updatedAt);

  let badgesHtml = '';
    if (note.pinned) badgesHtml += `<span class="ios-badge-icon" title="Pinned"><svg viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></span>`;
  if (note.locked) badgesHtml += `<span class="ios-badge-icon" title="Locked"><svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg></span>`;
  if (note.content && note.content.includes('ios-check-item')) badgesHtml += `<span class="ios-badge-icon" title="Checklist"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg></span>`;
  if (note.content && note.content.includes('ios-audio-card')) badgesHtml += `<span class="ios-badge-icon" title="Voice Memo"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg></span>`;
  if (note.content && note.content.includes('ios-drawing-attachment')) badgesHtml += `<span class="ios-badge-icon" title="Sketch"><svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>`;

  const parentFolder = state.folders.find(f => f.id === note.folderId);
  const folderName = parentFolder ? parentFolder.name : 'Notes';

  const selectCheckHtml = `
    <div class="ios-note-select-check ${isSelected ? 'checked' : ''}">
      <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </div>
  `;

  item.innerHTML = `
    ${selectCheckHtml}
    <div class="ios-note-content-col">
      <div class="ios-note-row-top">
        <h3 class="ios-note-title">${escapeHtml(title)}</h3>
        <div class="ios-note-badges">${badgesHtml}</div>
      </div>
      <div class="ios-note-preview-row">
        <span class="ios-note-date">${dateFormatted}</span>
        <span class="ios-note-snippet">${escapeHtml(snippet)}</span>
      </div>
      <div class="ios-note-folder-row">
        <svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
        <span>${escapeHtml(folderName)}</span>
      </div>
    </div>
  `;

  // Long-press / Hard-press gesture to trigger delete popup
  let longPressTimer = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let isLongPressTriggered = false;

  const startPress = (clientX, clientY) => {
    isLongPressTriggered = false;
    touchStartX = clientX;
    touchStartY = clientY;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      isLongPressTriggered = true;
      if (navigator.vibrate) {
        /* no-op */
      }
      item.classList.add('ios-note-longpress-active');
      setTimeout(() => item.classList.remove('ios-note-longpress-active'), 250);
      
      const items = [
        {
          label: note.pinned ? 'Unpin Note' : 'Pin Note',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>',
          onClick: () => {
            note.pinned = !note.pinned;
            note.updatedAt = new Date().toISOString();
  persistState();
  if (state.currentView !== 'view-editor') {
    renderFolders();
    renderNotesList();
  }
            sendSocketMessage({ type: 'NOTE_UPDATE', note });
            showToast(note.pinned ? 'Pinned note 📌' : 'Unpinned note');
          }
        },
        {
          label: 'Move',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
          onClick: () => {
            openMoveFolderModal(note.id);
          }
        },
        {
          label: 'Duplicate',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
          onClick: () => {
            const copyNote = {
              ...note,
              id: 'note_' + Date.now(),
              title: (note.title || 'Untitled') + ' (Copy)',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            state.notes.unshift(copyNote);
            persistState();
            renderFolders();
            renderNotesList();
            sendSocketMessage({ type: 'NOTE_UPDATE', note: copyNote });
            showToast('Duplicated note');
          }
        },
        {
          label: 'Delete',
          danger: true,
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
          onClick: () => {
            promptDeleteNote(note.id);
          }
        }
      ];
      showContextMenu(items, clientX, clientY);

    }, 480);
  };

  const cancelPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const checkMove = (clientX, clientY) => {
    if (longPressTimer) {
      const diffX = Math.abs(clientX - touchStartX);
      const diffY = Math.abs(clientY - touchStartY);
      if (diffX > 10 || diffY > 10) {
        cancelPress(); // Cancel on scroll
      }
    }
  };

  item.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      startPress(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  item.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length === 1) {
      checkMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  item.addEventListener('touchend', () => cancelPress());
  item.addEventListener('touchcancel', () => cancelPress());

  item.addEventListener('mousedown', (e) => {
    if (e.button === 0) startPress(e.clientX, e.clientY);
  });
  item.addEventListener('mousemove', (e) => checkMove(e.clientX, e.clientY));
  item.addEventListener('mouseup', () => cancelPress());

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancelPress();
    promptDeleteNote(note.id);
  });

  item.addEventListener('click', (e) => {
    if (isLongPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      isLongPressTriggered = false;
      return;
    }
    if (isSelectionMode) {
      e.preventDefault();
      e.stopPropagation();
      toggleNoteSelection(note.id);
      return;
    }
    openNote(note.id);
  });

  return item;
}

// =============================================================================
// NOTE EDITOR
// =============================================================================
function openNote(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  if (!note) return;

  if (note.deleted) {
    promptTrashActions(noteId);
    return;
  }

  if (note.locked) {
    promptPinUnlock(note);
    return;
  }

  loadNoteIntoEditor(note, true);
}

function loadNoteIntoEditor(note, navigate = true) {
  state.activeNoteId = note.id;

  // Always reset scroll to the very top so reading begins from title
  const scrollContainer = el.editorScroll || document.getElementById('editor-scroll');
  if (scrollContainer) {
    scrollContainer.scrollTop = 0;
  }
  requestAnimationFrame(() => {
    const sc = el.editorScroll || document.getElementById('editor-scroll');
    if (sc) sc.scrollTop = 0;
  });
  
  el.noteTitleInput.value = note.title || '';
  autoResizeTitle();
  el.noteBodyEditor.innerHTML = note.content || '';
  el.noteBodyEditor.querySelectorAll('.ios-checkbox').forEach(box => {
    box.setAttribute('contenteditable', 'false');
  });
  el.editorTimestamp.textContent = formatFullTimestamp(note.createdAt || note.updatedAt);
  if (el.editorHeaderTitle) el.editorHeaderTitle.textContent = '';

  formatIntent.bold = false;
  formatIntent.italic = false;
  formatIntent.underline = false;
  updateFormatButtonStates();
  updateNoteOptionsModalUI(note);
  setupInteractiveChecklistsInEditor();
  setupAudioPlayersInEditor();

  if (navigate) {
    navigateView('view-editor');
  }
}

function createNewNote() {
  if (state.activeFolderId === 'trash') {
    showToast('Cannot create notes in Recently Deleted');
    return;
  }
  const newNote = {
    id: 'note_' + Date.now(),
    title: '',
    content: '',
    folderId: (!state.activeFolderId || state.activeFolderId === 'trash' || state.activeFolderId === 'all' || state.activeFolderId === 'pinned') ? 'notes' : state.activeFolderId,
    pinned: false,
    locked: false,
    pinCode: '',
    color: '#0A84FF',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false,
    attachments: []
  };

  state.notes.unshift(newNote);
  persistState();
  renderFolders();
  renderNotesList();
  showToast('New Note Created', 'note-create');
  
  loadNoteIntoEditor(newNote, true);
  setTimeout(() => el.noteTitleInput.focus(), 250);
}

function saveCurrentNote() {
  if (!state.activeNoteId) return;

  const note = state.notes.find(n => n.id === state.activeNoteId);
  if (!note || note.deleted) return;

  const newTitle = el.noteTitleInput.value.trim();
  const newContent = el.noteBodyEditor.innerHTML;

  if (note.title === newTitle && note.content === newContent) return;

  note.title = newTitle;
  note.content = newContent;
  note.updatedAt = new Date().toISOString();

  persistState();
  renderFolders();
  renderNotesList();

  sendSocketMessage({
    type: 'NOTE_UPSERT',
    note: note
  });

  setSyncStatus('online', 'Saved');
}


function scrollCursorIntoView() {
  // Legacy alias redirected to safe keyboard-aware scrolling
  scheduleScrollCaretIntoView(false);
}

function queueAutoSave() {
  setSyncStatus('syncing', 'Saving...');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveCurrentNote();
  }, 400);
}

// =============================================================================
// CHECKLISTS, MATH NOTES & INTERACTIVE EDITOR ELEMENTS
// =============================================================================
function setupInteractiveChecklistsInEditor() {
  const items = el.noteBodyEditor.querySelectorAll('.ios-check-item');
  items.forEach(item => {
    const box = item.querySelector('.ios-checkbox');
    if (box && !box.dataset.bound) {
      box.dataset.bound = 'true';
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const isChecked = item.classList.contains('checked');
        if (isChecked) {
          item.classList.remove('checked');
          item.dataset.checked = 'false';
        } else {
          item.classList.add('checked');
          item.dataset.checked = 'true';
        }
        queueAutoSave();
      });
    }
  });

  setupAudioPlayersInEditor();
}


const formatIntent = {
  bold: false,
  italic: false,
  underline: false
};

function updateFormatButtonStates() {
  try {
    const isBold = formatIntent.bold || document.queryCommandState('bold');
    const isItalic = formatIntent.italic || document.queryCommandState('italic');
    const isUnderline = formatIntent.underline || document.queryCommandState('underline');

    if (el.tbBold) el.tbBold.classList.toggle('active', !!isBold);
    if (el.tbItalic) el.tbItalic.classList.toggle('active', !!isItalic);
    if (el.tbUnderline) el.tbUnderline.classList.toggle('active', !!isUnderline);
  } catch (_) {}
}

function applyPendingFormats() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (!el.noteBodyEditor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;

    ['bold', 'italic', 'underline'].forEach(cmd => {
      if (formatIntent[cmd] && !document.queryCommandState(cmd)) {
        document.execCommand(cmd, false, null);
      }
    });
    updateFormatButtonStates();
  } catch (_) {}
}

function insertChecklistItem() {
  el.noteBodyEditor.focus();
  const sel = window.getSelection();
  let currentCheckItem = null;

  if (sel && sel.rangeCount > 0) {
    let node = sel.anchorNode;
    while (node && node !== el.noteBodyEditor) {
      if (node.classList && node.classList.contains('ios-check-item')) {
        currentCheckItem = node;
        break;
      }
      node = node.parentNode;
    }
  }

  // If already on a checklist item, toggle it off and remove the circle
  if (currentCheckItem) {
    convertCheckItemToNormalLine(currentCheckItem);
    return;
  }

  const newItem = document.createElement('div');
  newItem.className = 'ios-check-item';
  newItem.dataset.checked = 'false';
  newItem.innerHTML = '<span class="ios-checkbox" contenteditable="false"></span><span class="ios-check-text"><br></span>';

  if (currentCheckItem && currentCheckItem.parentNode) {
    if (currentCheckItem.nextSibling) {
      currentCheckItem.parentNode.insertBefore(newItem, currentCheckItem.nextSibling);
    } else {
      currentCheckItem.parentNode.appendChild(newItem);
    }
  } else {
    const block = document.createElement('div');
    block.className = 'ios-checklist-block';
    block.appendChild(newItem);

    if (sel && sel.rangeCount > 0 && el.noteBodyEditor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(block);
      if (!block.nextSibling) {
        const blank = document.createElement('div');
        blank.innerHTML = '<br>';
        block.parentNode.insertBefore(blank, block.nextSibling);
      }
    } else {
      el.noteBodyEditor.appendChild(block);
    }
  }

  setupInteractiveChecklistsInEditor();
  queueAutoSave();

  const textSpan = newItem.querySelector('.ios-check-text');
  if (textSpan && sel) {
    const range = document.createRange();
    range.selectNodeContents(textSpan);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// Smart Math Solver
function handleMathEvaluation(textNode, offset, inputEvent) {
  if (!textNode || !textNode.nodeValue) return;

  // Never evaluate math when deleting / backspacing!
  if (inputEvent) {
    if (inputEvent.inputType && inputEvent.inputType.startsWith('delete')) {
      return;
    }
    if (inputEvent.data && !inputEvent.data.includes('=')) {
      return;
    }
  }

  const text = textNode.nodeValue;
  const match = text.match(/([0-9\.\s\+\-\*\/\(\)\%]+)\s*=\s*$/);
  if (match) {
    const expr = match[1].trim();
    if (/^[0-9\.\s\+\-\*\/\(\)\%]+$/.test(expr) && /[\+\-\*\/]/.test(expr)) {
      try {
        const evaluated = Function(`'use strict'; return (${expr})`)();
        if (typeof evaluated === 'number' && !isNaN(evaluated) && isFinite(evaluated)) {
          const rounded = Math.round(evaluated * 1000) / 1000;
          const newText = text + ' ' + rounded;
          textNode.nodeValue = newText;

          // Set caret directly after the inserted result
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.setStart(textNode, newText.length);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }

          showToast(`Math: ${expr} = ${rounded}`);
          queueAutoSave();
        }
      } catch (err) {}
    }
  }
}

function formatAudioTime(secs) {
  if (isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Audio memos inside note editor
function setupAudioPlayersInEditor() {
  const editor = el.noteBodyEditor || document.getElementById('note-body-editor');
  if (!editor) return;
  const audioCards = editor.querySelectorAll('.ios-audio-card');
  audioCards.forEach(card => {
    const playBtn = card.querySelector('.ios-audio-play-btn');
    const audioData = card.dataset.audioSrc;
    const durationEl = card.querySelector('.ios-audio-duration');
    const progressBar = card.querySelector('.ios-audio-progress-bar');
    const fill = card.querySelector('.ios-audio-progress-fill');

    if (playBtn && audioData && !playBtn.dataset.bound) {
      playBtn.dataset.bound = 'true';
      let audio = null;
      let isPlaying = false;

      function initAudio() {
        if (!audio) {
          audio = new Audio(audioData);
          audio.onloadedmetadata = () => {
            if (durationEl && audio.duration) {
              durationEl.textContent = formatAudioTime(audio.duration);
            }
          };
          audio.onended = () => {
            isPlaying = false;
            playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
            if (fill) fill.style.width = '0%';
            if (durationEl && audio.duration) {
              durationEl.textContent = formatAudioTime(audio.duration);
            }
          };
          audio.ontimeupdate = () => {
            if (fill && audio.duration) {
              fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
            }
            if (durationEl && audio.duration) {
              durationEl.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(audio.duration)}`;
            }
          };
        }
      }

      // Pre-load duration if possible
      initAudio();

      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        initAudio();

        if (isPlaying) {
          audio.pause();
          isPlaying = false;
          playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
        } else {
          audio.play().then(() => {
            isPlaying = true;
            playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
          }).catch(err => {
            console.error('Audio play error:', err);
            showToast('Unable to play audio', 'mic');
          });
        }
      });

      if (progressBar) {
        progressBar.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          initAudio();
          if (audio && audio.duration) {
            const rect = progressBar.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
            if (fill) fill.style.width = `${ratio * 100}%`;
          }
        });
      }
    }
  });
}


// =============================================================================
// SPEECH RECOGNITION / VOICE-TO-TEXT DICTATION
// =============================================================================
let isDictating = false;
let isEditingFolders = false;
let webSpeechRecognition = null;

// =============================================================================
// HIGH-FIDELITY SPEECH-TO-TEXT DICTATION ENGINE (NATIVE + WEB SPEECH + SERVER VAD)
// =============================================================================
let serverDictationStream = null;
let serverAudioContext = null;
let serverAudioProcessor = null;
let serverAudioChunks = [];
let isServerDictating = false;
let vadSpeaking = false;
let vadSilenceSamples = 0;

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let p = 44;
  for (let i = 0; i < samples.length; i++, p += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function updateDictationUI(active, text) {
  const bar = document.getElementById('dictation-bar');
  const statusEl = document.getElementById('dictation-status-text');

  if (bar) {
    if (active) {
      bar.classList.add('active');
    } else {
      bar.classList.remove('active');
    }
  }

  if (statusEl && text) {
    statusEl.textContent = text;
  }

  if (el.tbMic) {
    if (active) {
      el.tbMic.classList.add('ios-mic-active');
    } else {
      el.tbMic.classList.remove('ios-mic-active');
    }
  }
}

function insertDictatedText(text) {
  if (!text) return;
  const formatted = text.trim() + ' ';

  if (el.noteBodyEditor) {
    el.noteBodyEditor.focus();
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, formatted);
    } catch (_) {}

    if (!inserted) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.noteBodyEditor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(formatted);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        inserted = true;
      }
    }

    if (!inserted) {
      let lastNode = el.noteBodyEditor.lastElementChild;
      if (!lastNode) {
        lastNode = document.createElement('div');
        el.noteBodyEditor.appendChild(lastNode);
      }
      lastNode.appendChild(document.createTextNode(formatted));
    }

    queueAutoSave();
  }
}

function stopDictation() {
  isDictating = false;
  isServerDictating = false;
  updateDictationUI(false);

  try {
    if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.stopListening === 'function') {
      window.AndroidSpeechBridge.stopListening();
    }
  } catch (_) {}

  if (webSpeechRecognition) {
    try { webSpeechRecognition.abort(); } catch (_) {}
    webSpeechRecognition = null;
  }
}

function toggleVoiceDictation() {
  if (isDictating || isServerDictating) {
    stopDictation();
  } else {
    startDictation();
  }
}

function startDictation() {
  if (!state.activeNoteId) {
    createNewNote();
  }

  saveEditorSelection();
  const userLang = navigator.language || 'en-US';

  // 1. Android Native SpeechRecognizer Bridge
  let nativeAvailable = false;
  try {
    nativeAvailable = !!(window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.startListening === 'function');
    if (nativeAvailable && typeof window.AndroidSpeechBridge.isAvailable === 'function') {
      nativeAvailable = window.AndroidSpeechBridge.isAvailable();
    }
  } catch (_) {}

  if (nativeAvailable) {
    isDictating = true;
    updateDictationUI(true, 'Listening... speak to write');
    try {
      window.AndroidSpeechBridge.startListening(userLang);
      return;
    } catch (e) {
      console.warn('Native speech failed, falling back to Web Speech:', e);
    }
  }

  // 2. Web Speech API (Chrome, Edge, Safari, Opera, WebViews)
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    try {
      if (webSpeechRecognition) {
        try { webSpeechRecognition.abort(); } catch (_) {}
      }
      webSpeechRecognition = new SpeechRec();
      webSpeechRecognition.continuous = false; // universally stable continuous loop via onend
      webSpeechRecognition.interimResults = true;
      webSpeechRecognition.lang = userLang;

      webSpeechRecognition.onstart = () => {
        isDictating = true;
        updateDictationUI(true, 'Listening... speak now');
      };

      webSpeechRecognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        if (finalTranscript) {
          insertDictatedText(finalTranscript);
          updateDictationUI(true, `Wrote: "${finalTranscript.trim()}"`);
        } else if (interimTranscript) {
          updateDictationUI(true, `Hearing: "${interimTranscript}"`);
        }
      };

      webSpeechRecognition.onerror = (event) => {
        console.warn('Web speech error:', event.error);
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return; // pause in speech
        }
        stopDictation();
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showToast('Microphone access denied. Please allow microphone in browser.', 'mic');
        } else if (event.error === 'network') {
          showToast('Speech service network error. Check internet connection.', 'mic');
        } else {
          showToast('Speech recognition: ' + event.error, 'mic');
        }
      };

      webSpeechRecognition.onend = () => {
        // Continuous dictation loop until user taps "Done" or mic icon
        if (isDictating && !isServerDictating) {
          try {
            webSpeechRecognition.start();
          } catch (_) {
            setTimeout(() => {
              if (isDictating && !isServerDictating && webSpeechRecognition) {
                try { webSpeechRecognition.start(); } catch (_) { stopDictation(); }
              }
            }, 200);
          }
        }
      };

      webSpeechRecognition.start();
      isDictating = true;
      updateDictationUI(true, 'Listening... speak now');
      return;
    } catch (err) {
      console.warn('Web speech recognition start error:', err);
    }
  }

  showToast('Speech recognition is not supported in this browser.', 'mic');
}

// Global Android Speech Bridge dispatch handlers
window.onSpeechReady = function() {
  updateDictationUI(true, 'Listening... speak to write');
};

window.onSpeechStarted = function() {
  updateDictationUI(true, 'Hearing speech...');
};

window.onSpeechProcessing = function() {
  updateDictationUI(true, 'Transcribing speech...');
};

window.onSpeechRmsChanged = function(rms) {
  // Voice amplitude
};

window.onSpeechResult = function(text, isFinal) {
  if (!text) return;
  if (isFinal) {
    insertDictatedText(text);
    updateDictationUI(true, 'Wrote: "' + text.trim() + '"');
  } else {
    updateDictationUI(true, 'Hearing: "' + text.trim() + '"');
  }
};

window.onSpeechError = function(msg) {
  console.warn('Android speech error:', msg);
  stopDictation();
  if (msg) showToast(msg, 'mic');
};

window.onSpeechEnded = function() {
  if (isDictating) {
    stopDictation();
  }
};

// Global Android & Browser Back Button Navigation Handler
let lastBackPressTime = 0;

window.handleBackNavigation = function() {
  // 1. Voice dictation active -> stop dictation
  if (typeof isDictating !== 'undefined' && isDictating) {
    stopDictation();
    return true;
  }

  // 2. Active modal / action sheet / alert dialog -> dismiss it
  const activeModal = document.querySelector('.ios-modal-overlay.active');
  if (activeModal) {
    activeModal.classList.remove('active');
    return true;
  }

  // 3. Selection mode active -> cancel selection
  if (typeof isSelectionMode !== 'undefined' && isSelectionMode) {
    exitSelectionMode();
    return true;
  }

  // 4. Searching notes -> clear search
  if (el.searchInput && el.searchInput.value) {
    el.searchInput.value = '';
    state.searchQuery = '';
    if (el.searchClear) el.searchClear.style.display = 'none';
    renderNotesList();
    return true;
  }

  // 5. In Note Editor -> navigate back to Notes List
  if (el.container.classList.contains('view-editor') || state.currentView === 'view-editor' || state.activeNoteId) {
    navigateBackToList();
    return true;
  }

  // 6. In Notes List -> navigate back to Folders List
  if (el.container.classList.contains('view-notes') || state.currentView === 'view-notes') {
    navigateView('view-folders');
    return true;
  }

  // 7. At Root (view-folders): Require double-tap back within 2s to exit
  const now = Date.now();
  if (now - lastBackPressTime < 2000) {
    return false; // Tells Android to minimize/exit cleanly
  }
  lastBackPressTime = now;
  showToast('Press back again to exit');
  return true;
};

// Listen to browser popstate (hardware back button & swipe back on mobile)
window.addEventListener('popstate', (e) => {
  window.handleBackNavigation();
});

let voiceMemoTimer = null;
let voiceMemoElapsedSeconds = 0;
let isVoiceRecordingCancelled = false;

function updateVoiceMemoUI(active) {
  const bar = document.getElementById('voicememo-bar');
  if (bar) {
    if (active) bar.classList.add('active');
    else bar.classList.remove('active');
  }
  if (el.tbMic) {
    if (active) el.tbMic.classList.add('ios-mic-active');
    else el.tbMic.classList.remove('ios-mic-active');
  }
}

function updateVoiceMemoTimerDisplay(secs) {
  const timerEl = document.getElementById('voicememo-timer');
  if (timerEl) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    timerEl.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

async function startVoiceRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    return;
  }
  if (!state.activeNoteId) {
    createNewNote();
  }

  isVoiceRecordingCancelled = false;
  voiceMemoElapsedSeconds = 0;
  updateVoiceMemoTimerDisplay(0);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported('audio/webm')) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/aac')) mimeType = 'audio/aac';
      else mimeType = '';
    }

    state.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.audioChunks = [];
    state.recordingStartTime = Date.now();

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.onstop = () => {
      if (voiceMemoTimer) {
        clearInterval(voiceMemoTimer);
        voiceMemoTimer = null;
      }
      updateVoiceMemoUI(false);
      stream.getTracks().forEach(t => t.stop());

      if (isVoiceRecordingCancelled) {
        showToast('Recording cancelled', 'trash');
        return;
      }

      const audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result;
        insertAudioCardIntoNote(base64Audio, voiceMemoElapsedSeconds);
        showToast('Voice memo saved', 'check');
      };
      reader.readAsDataURL(audioBlob);
    };

    state.mediaRecorder.start(250);
    updateVoiceMemoUI(true);

    voiceMemoTimer = setInterval(() => {
      voiceMemoElapsedSeconds++;
      updateVoiceMemoTimerDisplay(voiceMemoElapsedSeconds);
    }, 1000);

    showToast('Recording Voice Memo', 'mic');
  } catch (err) {
    console.error('Microphone access failed:', err);
    showToast('Microphone access denied', 'mic');
  }
}

function stopVoiceRecording(discard = false) {
  isVoiceRecordingCancelled = discard;
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
  } else {
    updateVoiceMemoUI(false);
  }
}

async function toggleVoiceRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    stopVoiceRecording(false);
  } else {
    await startVoiceRecording();
  }
}

function insertAudioCardIntoNote(audioDataUrl, recordedDuration = 0) {
  const editor = el.noteBodyEditor || document.getElementById('note-body-editor');
  if (!editor) return;

  const initialDurationText = recordedDuration > 0 ? formatAudioTime(recordedDuration) : 'Tap to play';

  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'ios-audio-card-wrapper';
  cardWrapper.setAttribute('contenteditable', 'false');
  cardWrapper.innerHTML = `
    <div class="ios-audio-card" data-audio-src="${audioDataUrl}" contenteditable="false">
      <button class="ios-audio-play-btn" type="button" aria-label="Play voice memo">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="ios-audio-info">
        <div class="ios-audio-title">Voice Memo</div>
        <div class="ios-audio-progress-bar"><div class="ios-audio-progress-fill"></div></div>
        <div class="ios-audio-duration">${initialDurationText}</div>
      </div>
    </div>
  `;

  const breakLine = document.createElement('div');
  breakLine.innerHTML = '<br>';

  let inserted = false;
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
    try {
      savedEditorRange.deleteContents();
      savedEditorRange.insertNode(breakLine);
      savedEditorRange.insertNode(cardWrapper);
      inserted = true;
    } catch (_) {}
  }

  if (!inserted) {
    editor.appendChild(cardWrapper);
    editor.appendChild(breakLine);
  }

  // Immediately setup interactive listeners for the new audio card
  setupAudioPlayersInEditor();
  setupInteractiveChecklistsInEditor();
  queueAutoSave();

  // Scroll into view smoothly so the user sees the new voice memo card immediately
  setTimeout(() => {
    try {
      cardWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}
  }, 60);
}

let savedEditorRange = null;

function saveEditorSelection() {
  const sel = window.getSelection();
  const editor = el.noteBodyEditor || document.getElementById('note-body-editor');
  if (sel && sel.rangeCount > 0 && editor && editor.contains(sel.anchorNode)) {
    savedEditorRange = sel.getRangeAt(0).cloneRange();
  }
}

function insertMediaBlock(imgSrc, isDrawing = false) {
  const editor = el.noteBodyEditor || document.getElementById('note-body-editor');
  if (!editor) return;

  editor.focus();

  // Create isolated atomic container
  const container = document.createElement('div');
  container.className = 'ios-media-container';
  container.setAttribute('contenteditable', 'false');

  const img = document.createElement('img');
  img.src = imgSrc;
  img.className = isDrawing ? 'ios-drawing-attachment' : 'ios-media-attachment';
  img.alt = isDrawing ? 'Sketch' : 'Photo';
  container.appendChild(img);

  // Dedicated empty editable line below image for immediate smooth typing
  const lineAfter = document.createElement('div');
  lineAfter.innerHTML = '<br>';

  const sel = window.getSelection();
  let range = savedEditorRange;

  if (!range || !editor.contains(range.commonAncestorContainer)) {
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = null;
    }
  }

  let inserted = false;
  if (range) {
    let child = range.startContainer;
    while (child && child.parentNode !== editor) {
      child = child.parentNode;
    }

    if (child && child.parentNode === editor) {
      const isEmptyLine = !child.textContent.trim() && !child.querySelector?.('img, .ios-checkbox, .ios-audio-card');
      if (isEmptyLine) {
        editor.replaceChild(container, child);
        if (container.nextSibling) {
          editor.insertBefore(lineAfter, container.nextSibling);
        } else {
          editor.appendChild(lineAfter);
        }
      } else {
        if (child.nextSibling) {
          editor.insertBefore(container, child.nextSibling);
          editor.insertBefore(lineAfter, container.nextSibling);
        } else {
          editor.appendChild(container);
          editor.appendChild(lineAfter);
        }
      }
      inserted = true;
    }
  }

  if (!inserted) {
    editor.appendChild(container);
    editor.appendChild(lineAfter);
  }

  try {
    const newRange = document.createRange();
    newRange.setStart(lineAfter, 0);
    newRange.collapse(true);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  } catch (_) {}

  savedEditorRange = null;
  setupInteractiveChecklistsInEditor();
  queueAutoSave();
  scheduleScrollCaretIntoView(true);
}

function handlePhotoUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    insertMediaBlock(event.target.result, false);
    showToast('📷 Photo inserted into note');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

// =============================================================================
// DRAWING CANVAS
// =============================================================================
let canvasCtx = null;
let isDrawing = false;
let lastX = 0, lastY = 0;

function initDrawingCanvas() {
  const canvas = el.drawingCanvas;
  canvasCtx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
      redrawCanvasHistory();
    }
  }

  window.addEventListener('resize', resizeCanvas);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startDraw(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    state.drawingHistory.push([]);
  }

  function drawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);

    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
    canvasCtx.lineTo(pos.x, pos.y);
    canvasCtx.strokeStyle = state.drawingColor;
    canvasCtx.lineWidth = state.drawingLineWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.stroke();

    const currentStroke = state.drawingHistory[state.drawingHistory.length - 1];
    if (currentStroke) {
      currentStroke.push({
        x1: lastX, y1: lastY,
        x2: pos.x, y2: pos.y,
        color: state.drawingColor,
        width: state.drawingLineWidth
      });
    }

    lastX = pos.x;
    lastY = pos.y;
  }

  function endDraw() {
    isDrawing = false;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', drawMove);
  window.addEventListener('mouseup', endDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', drawMove, { passive: false });
  window.addEventListener('touchend', endDraw);
}

function redrawCanvasHistory() {
  if (!canvasCtx) return;
  const canvas = el.drawingCanvas;
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  state.drawingHistory.forEach(stroke => {
    stroke.forEach(seg => {
      canvasCtx.beginPath();
      canvasCtx.moveTo(seg.x1, seg.y1);
      canvasCtx.lineTo(seg.x2, seg.y2);
      canvasCtx.strokeStyle = seg.color;
      canvasCtx.lineWidth = seg.width;
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';
      canvasCtx.stroke();
    });
  });
}

function openDrawingModal() {
  saveEditorSelection();
  state.drawingHistory = [];
  const modal = el.modalDrawing || document.getElementById('modal-drawing');
  if (modal) modal.classList.add('active');
  setTimeout(() => {
    const canvas = el.drawingCanvas || document.getElementById('drawing-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    canvasCtx = canvas.getContext('2d');
    canvasCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }, 100);
}

function saveDrawingToNote() {
  const canvas = el.drawingCanvas || document.getElementById('drawing-canvas');
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/png');
  insertMediaBlock(dataUrl, true);
  const modal = el.modalDrawing || document.getElementById('modal-drawing');
  if (modal) modal.classList.remove('active');
  showToast('🎨 Sketch added to note');
}

// =============================================================================
// PIN PASSCODE LOCK & SECURITY (NOTES & FOLDERS)
// =============================================================================
function promptFolderPinSet(folder) {
  state.pinAction = { target: 'folder', type: 'lock', folderId: folder.id };
  state.pinBuffer = '';
  updatePinDots();
  if (el.pinModalTitle) el.pinModalTitle.textContent = 'Set Folder Passcode';
  if (el.pinModalSubtitle) el.pinModalSubtitle.textContent = `Choose a 4-digit PIN to lock "${folder.name}".`;
  if (el.modalPinLock) el.modalPinLock.classList.add('active');
}

function promptFolderPinUnlock(folder) {
  state.pinAction = { target: 'folder', type: 'unlock', folderId: folder.id };
  state.pinBuffer = '';
  updatePinDots();
  if (el.pinModalTitle) el.pinModalTitle.textContent = 'Enter Passcode';
  if (el.pinModalSubtitle) el.pinModalSubtitle.textContent = `Enter the 4-digit PIN for "${folder.name}".`;
  if (el.modalPinLock) el.modalPinLock.classList.add('active');
}

function promptFolderUnlockOrRemove(folder) {
  state.pinAction = { target: 'folder', type: 'removeLock', folderId: folder.id };
  state.pinBuffer = '';
  updatePinDots();
  if (el.pinModalTitle) el.pinModalTitle.textContent = 'Enter Passcode';
  if (el.pinModalSubtitle) el.pinModalSubtitle.textContent = `Enter passcode to remove lock from "${folder.name}".`;
  if (el.modalPinLock) el.modalPinLock.classList.add('active');
}

function promptPinUnlock(note) {
  state.pinAction = { target: 'note', type: 'unlock', noteId: note.id };
  state.pinBuffer = '';
  updatePinDots();
  if (el.pinModalTitle) el.pinModalTitle.textContent = 'Enter Passcode';
  if (el.pinModalSubtitle) el.pinModalSubtitle.textContent = 'Enter the 4-digit PIN for this note.';
  if (el.modalPinLock) el.modalPinLock.classList.add('active');
}

function promptPinSet(note) {
  state.pinAction = { target: 'note', type: 'lock', noteId: note.id };
  state.pinBuffer = '';
  updatePinDots();
  if (el.pinModalTitle) el.pinModalTitle.textContent = 'Set Note Passcode';
  if (el.pinModalSubtitle) el.pinModalSubtitle.textContent = 'Choose a 4-digit PIN to lock this note.';
  if (el.modalPinLock) el.modalPinLock.classList.add('active');
}

function handleKeypadPress(key) {
  if (key === 'backspace') {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    updatePinDots();
    return;
  }

  if (state.pinBuffer.length < 4) {
    state.pinBuffer += key;
    updatePinDots();
  }

  if (state.pinBuffer.length === 4) {
    setTimeout(verifyPinCode, 150);
  }
}

function updatePinDots() {
  el.pinDots.forEach((dot, index) => {
    if (index < state.pinBuffer.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

function verifyPinCode() {
  const enteredPin = state.pinBuffer;
  const action = state.pinAction;
  if (!action) return;

  if (action.target === 'folder') {
    const folder = state.folders.find(f => f.id === action.folderId);
    if (!folder) return;

    if (action.type === 'unlock') {
      if (folder.pinCode === enteredPin || !folder.pinCode) {
        if (el.modalPinLock) el.modalPinLock.classList.remove('active');
        folder._unlocked = true;
        selectFolder(folder.id, true);
        showToast('Folder unlocked');
      } else {
        showToast('Incorrect passcode!');
        state.pinBuffer = '';
        updatePinDots();
      }
    } else if (action.type === 'removeLock') {
      if (folder.pinCode === enteredPin || !folder.pinCode) {
        folder.locked = false;
        folder.pinCode = '';
        delete folder._unlocked;
        if (el.modalPinLock) el.modalPinLock.classList.remove('active');
        persistState();
        renderFolders();
        sendSocketMessage({ type: 'FOLDER_UPDATE', folder });
        const serverUrl = getEffectiveServerUrl();
        if (serverUrl) {
          fetch(`${serverUrl}/api/folders/${encodeURIComponent(folder.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(folder)
          }).catch(() => {});
        }
        showToast('Lock removed from folder');
      } else {
        showToast('Incorrect passcode!');
        state.pinBuffer = '';
        updatePinDots();
      }
    } else if (action.type === 'lock') {
      folder.locked = true;
      folder.pinCode = enteredPin;
      folder._unlocked = false;
      if (el.modalPinLock) el.modalPinLock.classList.remove('active');
      persistState();
      renderFolders();
      sendSocketMessage({ type: 'FOLDER_UPDATE', folder });
      const serverUrl = getEffectiveServerUrl();
      if (serverUrl) {
        fetch(`${serverUrl}/api/folders/${encodeURIComponent(folder.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(folder)
        }).catch(() => {});
      }
      showToast('Folder locked with passcode');
    }
    return;
  }

  const note = state.notes.find(n => n.id === action.noteId);
  if (!note) return;

  if (action.type === 'unlock') {
    if (note.pinCode === enteredPin || !note.pinCode) {
      if (el.modalPinLock) el.modalPinLock.classList.remove('active');
      loadNoteIntoEditor(note, true);
      showToast('Note unlocked');
    } else {
      showToast('Incorrect passcode!');
      state.pinBuffer = '';
      updatePinDots();
    }
  } else if (action.type === 'lock') {
    note.locked = true;
    note.pinCode = enteredPin;
    if (el.modalPinLock) el.modalPinLock.classList.remove('active');
    persistState();
    renderNotesList();
    sendSocketMessage({ type: 'NOTE_UPSERT', note });
    showToast('Note locked with passcode');
    navigateBackToList();
  }
}

// =============================================================================
// NAVIGATION & HELPERS
// =============================================================================
function navigateView(viewName) {
  state.currentView = viewName;
  el.container.classList.remove('view-folders', 'view-notes', 'view-editor');
  el.container.classList.add(viewName);
  if (viewName === 'view-folders') {
    state.folders.forEach(f => { delete f._unlocked; });
    if (typeof isSelectionMode !== 'undefined' && isSelectionMode) exitSelectionMode();
  }
  try {
    history.pushState({ view: viewName }, '');
  } catch (_) {}
}

function navigateBackToList() {
  const currentNote = state.notes.find(n => n.id === state.activeNoteId);
  if (currentNote && !currentNote.title && (!currentNote.content || !stripHtml(currentNote.content)) && !el.noteBodyEditor.querySelector('img, .ios-media-container, .ios-drawing-attachment, .ios-audio-card')) {
    state.notes = state.notes.filter(n => n.id !== currentNote.id);
    sendSocketMessage({ type: 'NOTE_DELETE', id: currentNote.id, permanent: true });
    persistState();
  } else {
    saveCurrentNote();
  }
  state.activeNoteId = null;
  navigateView('view-notes');
  renderNotesList();
}

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem('cownotes_theme', theme);

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(next === 'dark' ? 'Switched to Dark Mode 🌙' : 'Switched to Light Mode ☀️');
}

let toastTimer = null;

const TOAST_ICONS = {
  moon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  'note-create': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  restore: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6a3 3 0 0 0-6 0v4.76a2 2 0 0 1-1.11 1.8l-1.78.89A2 2 0 0 0 5 15.24Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
};

function showToast(msg, iconType = null) {
  let toastEl = document.getElementById('toast-notification');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast-notification';
    toastEl.className = 'ios-toast';
    document.body.appendChild(toastEl);
  }

  // Strip emojis from message text for clean UI typography
  const cleanMsg = (msg || '').replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

  let resolvedIcon = iconType;
  if (!resolvedIcon) {
    const lower = cleanMsg.toLowerCase();
    if (lower.includes('dark mode')) resolvedIcon = 'moon';
    else if (lower.includes('light mode')) resolvedIcon = 'sun';
    else if (lower.includes('delet')) resolvedIcon = 'trash';
    else if (lower.includes('recover') || lower.includes('restore')) resolvedIcon = 'restore';
    else if (lower.includes('created') || lower.includes('new note')) resolvedIcon = 'note-create';
    else if (lower.includes('folder')) resolvedIcon = 'folder';
    else if (lower.includes('pin')) resolvedIcon = 'pin';
    else if (lower.includes('lock')) resolvedIcon = 'lock';
    else if (lower.includes('dictat') || lower.includes('speech') || lower.includes('voice')) resolvedIcon = 'mic';
    else resolvedIcon = 'check';
  }

  const iconSvg = TOAST_ICONS[resolvedIcon] || TOAST_ICONS.check;
  toastEl.innerHTML = `<span class="ios-toast-icon">${iconSvg}</span><span class="ios-toast-text">${escapeHtml(cleanMsg)}</span>`;

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // Force CSS reflow to re-trigger spring animation
  toastEl.classList.add('show');

  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = null;
  }, 1900);
}

function htmlToMarkdown(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll('.ios-check-item').forEach(item => {
    const isChecked = item.classList.contains('checked');
    const label = item.querySelector('.ios-check-text')?.textContent || item.textContent || '';
    const mdTask = document.createTextNode('\n- [' + (isChecked ? 'x' : ' ') + '] ' + label.trim() + '\n');
    item.parentNode.replaceChild(mdTask, item);
  });

  for (let i = 1; i <= 6; i++) {
    div.querySelectorAll('h' + i).forEach(h => {
      const mdH = document.createTextNode('\n' + '#'.repeat(i) + ' ' + h.textContent.trim() + '\n');
      h.parentNode.replaceChild(mdH, h);
    });
  }

  div.querySelectorAll('strong, b').forEach(b => {
    b.textContent = '**' + b.textContent + '**';
  });

  div.querySelectorAll('em, i').forEach(i => {
    i.textContent = '*' + i.textContent + '*';
  });

  div.querySelectorAll('u').forEach(u => {
    u.textContent = '<u>' + u.textContent + '</u>';
  });

  div.querySelectorAll('br').forEach(br => {
    br.replaceWith('\n');
  });

  div.querySelectorAll('div, p').forEach(p => {
    p.prepend(document.createTextNode('\n'));
  });

  return (div.textContent || div.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNoteDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}



function formatFullTimestamp(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + 
         ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function updateNoteOptionsModalUI(note) {
  el.optPinText.textContent = note.pinned ? 'Unpin Note' : 'Pin Note';
  el.optLockText.textContent = note.locked ? 'Unlock Note' : 'Lock Note';
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function updateSyncSettingsModalUI() {
  if (!el.modalSyncSettings) return;
  const summaryEl = document.getElementById('backup-summary-text-sync');
  if (summaryEl) {
    const active = (state.notes || []).filter(n => !n.deleted).length;
    summaryEl.textContent = active + ' Notes (' + (state.folders ? state.folders.length : 0) + ' Folders)';
  }
  const standalone = isStandaloneMode();
  const currentServer = getStoredServerUrl();
  if (el.inputSyncServerUrl) {
    // If the input is currently focused by the user, never overwrite their typing!
    if (document.activeElement !== el.inputSyncServerUrl) {
      if (standalone) {
        el.inputSyncServerUrl.value = '';
      } else {
        const currentServer = getStoredServerUrl();
        if (currentServer) {
          el.inputSyncServerUrl.value = currentServer;
        } else if (window.location.protocol.startsWith('http')) {
          el.inputSyncServerUrl.value = window.location.origin;
        } else {
          el.inputSyncServerUrl.value = '';
        }
      }
    }
  }

  if (el.syncSettingsDot) {
    el.syncSettingsDot.className = 'ios-sync-dot';
    if (standalone || !state.wsConnected) {
      el.syncSettingsDot.classList.add('offline');
    }
  }

  if (standalone) {
    if (el.syncSettingsStatus) el.syncSettingsStatus.textContent = 'Status: Standalone Mode (Offline Only)';
    setSyncStatus('offline', 'Standalone');
  } else if (state.wsConnected) {
    if (el.syncSettingsStatus) el.syncSettingsStatus.textContent = `Status: Live Sync Connected (${currentServer || window.location.origin})`;
  } else if (currentServer) {
    if (el.syncSettingsStatus) el.syncSettingsStatus.textContent = `Status: Connecting to ${currentServer}...`;
  } else {
    if (el.syncSettingsStatus) el.syncSettingsStatus.textContent = 'Status: Offline / Disconnected';
    setSyncStatus('offline', 'Offline');
  }
}


// =============================================================================
// DATABASE BACKUP & RESTORE (.db)
// =============================================================================
let pendingBackupData = null;

function updateBackupSummary() {
  const summaryEl = el.backupSummaryText || document.getElementById('backup-summary-text');
  if (!summaryEl) return;
  const activeCount = state.notes.filter(n => !n.deleted).length;
  const trashCount = state.notes.length - activeCount;
  summaryEl.textContent = `Database: ${activeCount} Notes (${state.folders.length} Folders${trashCount > 0 ? `, ${trashCount} Trash` : ''})`;
}

function openBackupModal() {
  updateBackupSummary();
  const preview = el.restorePreviewBox || document.getElementById('restore-preview-box');
  if (preview) preview.style.display = 'none';
  pendingBackupData = null;
  const modal = el.modalBackupRestore || document.getElementById('modal-backup-restore');
  if (modal) modal.classList.add('active');
  const optModal = el.modalNoteOptions || document.getElementById('modal-note-options');
  if (optModal) optModal.classList.remove('active');
  const syncModal = el.modalSyncSettings || document.getElementById('modal-sync-settings');
  if (syncModal) syncModal.classList.remove('active');
}

function closeBackupModal() {
  const modal = el.modalBackupRestore || document.getElementById('modal-backup-restore');
  if (modal) modal.classList.remove('active');
  const preview = el.restorePreviewBox || document.getElementById('restore-preview-box');
  if (preview) preview.style.display = 'none';
  pendingBackupData = null;
  const fileInput = el.inputDbFile || document.getElementById('db-file-input');
  if (fileInput) fileInput.value = '';
}

function exportDatabaseBackup() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeFilename = `cownotes_backup_${dateStr}.db`;
  const dbPayload = {
    format: 'COWNOTES_DB',
    version: 1,
    exportedAt: new Date().toISOString(),
    appName: 'CowNotes',
    folders: state.folders,
    notes: state.notes,
    stats: {
      totalNotes: state.notes.length,
      activeNotes: state.notes.filter(n => !n.deleted).length,
      totalFolders: state.folders.length
    }
  };
  const jsonContent = JSON.stringify(dbPayload, null, 2);

  // 1. Android Native Bridge
  if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.exportDatabase === 'function') {
    window.AndroidSpeechBridge.exportDatabase(safeFilename, jsonContent);
    showToast('Database backup saved (.db)');
    return;
  }

  // 2. Web Share API with File
  try {
    if (navigator.canShare) {
      const file = new File([jsonContent], safeFilename, { type: 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'CowNotes Database Backup'
        }).catch(err => {
          if (err.name !== 'AbortError') fallbackDownload();
        });
        return;
      }
    }
  } catch (_) {}

  // 3. Fallback: Browser download
  fallbackDownload();

  function fallbackDownload() {
    const blob = new Blob([jsonContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
    showToast(`Exported ${safeFilename}`);
  }
}

function extractDateFromMarkdown(text, filename, lastModified) {
  const cleanText = (text || '').replace(/^\uFEFF/, '').trimStart();
  // 1. Look for YAML frontmatter date: e.g. date: 2024-08-15
  const frontmatterMatch = cleanText.match(/^---\s*\n[\s\S]*?date:\s*([^\n\r]+)[\s\S]*?\n---/i);
  if (frontmatterMatch) {
    const d = new Date(frontmatterMatch[1].trim());
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 2. Look for lines like "Date: 12 March 2024" or "Created: 2024-05-10"
  const lineDateMatch = text.match(/^(?:date|created|time|modified):\s*([^\n\r]+)/im);
  if (lineDateMatch) {
    const d = new Date(lineDateMatch[1].trim());
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 3. Look for date in filename like 2024-05-10 or 20240510 or 2024_05_10
  if (filename) {
    const fnMatch = filename.match(/\b(20\d{2})[-_]?(\d{2})[-_]?(\d{2})\b/);
    if (fnMatch) {
      const d = new Date(`${fnMatch[1]}-${fnMatch[2]}-${fnMatch[3]}`);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  // 4. Use file.lastModified timestamp if available
  if (lastModified) {
    const d = new Date(lastModified);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      return d.toISOString();
    }
  }

  return new Date().toISOString();
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}


window.onNativeFileImport = function() {
  try {
    let rawData = null;
    if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.getLastImportedFile === 'function') {
      const jsonStr = window.AndroidSpeechBridge.getLastImportedFile();
      if (jsonStr) {
        rawData = JSON.parse(jsonStr);
      }
    }
    if (!rawData) {
      showToast('No content found in selected file(s)');
      return;
    }

    const files = Array.isArray(rawData) ? rawData : [rawData];
    if (files.length === 0) {
      showToast('No files found to import');
      return;
    }

    // Clean up any accidentally created raw JSON note from previous buggy import
    state.notes = state.notes.filter(n => {
      const t = (n.title || '').trim();
      const c = (n.content || '').trim();
      return !t.startsWith('{') && !t.includes('COWNOTES_DB') && !c.includes('"format": "COWNOTES_DB"');
    });

    // 1. Check if any selected file is a Database Backup (.db, .json, or JSON text)
    for (const fileData of files) {
      if (!fileData || !fileData.content) continue;
      const cleanContent = fileData.content.replace(/^\uFEFF/, '').trim();
      
      if (cleanContent.startsWith('{') || (fileData.name && /\.(db|json)$/i.test(fileData.name))) {
        try {
          const parsed = JSON.parse(cleanContent);
          if (parsed && Array.isArray(parsed.notes)) {
            pendingBackupData = parsed;
            executeRestore('merge');
            sortNotesList();
            persistState();
            renderFolders();
            renderNotesList();
            closeBackupModal();
            showToast(`Restored ${parsed.notes.length} notes from database! 🎉`);
            return;
          }
        } catch (_) {}
      }
    }

    // 2. Otherwise, import each file as an individual Markdown / Text note
    let importedCount = 0;
    const serverUrl = getEffectiveServerUrl();

    files.forEach(fileData => {
      if (!fileData || !fileData.content) return;
      const cleanText = fileData.content.replace(/^\uFEFF/, '').trim();
      if (cleanText.startsWith('{') && cleanText.includes('COWNOTES_DB')) return; // skip raw DB json

      const fileName = fileData.name || 'Imported Note';
      const lastModified = fileData.lastModified || 0;

      const note = parseMarkdownToNote(cleanText, fileName, lastModified > 0 ? lastModified : Date.now());
      if (note.title.includes('COWNOTES_DB') || note.content.includes('COWNOTES_DB')) return;

      const existingIdx = state.notes.findIndex(n => n.title.toLowerCase() === note.title.toLowerCase() && !n.deleted);
      if (existingIdx >= 0) {
        note.id = state.notes[existingIdx].id;
        state.notes[existingIdx] = note;
      } else {
        state.notes.unshift(note);
      }

      importedCount++;

      if (serverUrl) {
        fetch(`${serverUrl}/api/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(note)
        }).catch(() => {});
      }
    });

    if (importedCount > 0) {
      sortNotesList();
      persistState();
      renderFolders();
      renderNotesList();
      showToast(`Imported ${importedCount} ${importedCount === 1 ? 'note' : 'notes'}! 🎉`);
    } else {
      showToast('No valid notes found in selected file(s)');
    }

    closeBackupModal();
  } catch (err) {
    console.error('Error importing file(s):', err);
    showToast('Failed to import: ' + err.message);
  }
};

function parseMarkdownToNote(text, filename, lastModified) {
  let cleanText = (text || '').replace(/^\uFEFF/, '').trimStart();
  let explicitCreated = null;
  let explicitUpdated = null;
  let explicitTitle = null;
  let explicitFolder = null;

  // Extract YAML frontmatter metadata (date, created, updated, folder, title)
  const fmMatch = cleanText.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]*/);
  if (fmMatch) {
    const yaml = fmMatch[1];
    cleanText = cleanText.slice(fmMatch[0].length);

    const titleMatch = yaml.match(/^title:\s*["']?([^"'\r\n]+)["']?/im);
    if (titleMatch) explicitTitle = titleMatch[1].trim();

    const crMatch = yaml.match(/^(?:created|date):\s*["']?([^"'\r\n]+)["']?/im);
    if (crMatch) {
      const d = new Date(crMatch[1].trim());
      if (!isNaN(d.getTime())) explicitCreated = d.toISOString();
    }

    const upMatch = yaml.match(/^updated:\s*["']?([^"'\r\n]+)["']?/im);
    if (upMatch) {
      const d = new Date(upMatch[1].trim());
      if (!isNaN(d.getTime())) explicitUpdated = d.toISOString();
    }

    const folderMatch = yaml.match(/^folder:\s*["']?([^"'\r\n]+)["']?/im);
    if (folderMatch) explicitFolder = folderMatch[1].trim();
  }

  // Ensure any loose frontmatter dashes or metadata lines at top are stripped
  cleanText = cleanText.replace(/^---[\r\n]*/, '').replace(/^(?:title|date|created|updated|folder):[^\r\n]*[\r\n]*/gim, '').trimStart();

  const noteDate = explicitCreated || extractDateFromMarkdown(text, filename, lastModified);
  const updatedDate = explicitUpdated || noteDate;

  let targetFolderId = (state && state.activeFolderId && state.activeFolderId !== 'trash' && state.activeFolderId !== 'pinned') ? state.activeFolderId : 'notes';
  if (explicitFolder) {
    let fObj = state.folders.find(f => f.name.toLowerCase() === explicitFolder.toLowerCase());
    if (!fObj && explicitFolder && explicitFolder.toLowerCase() !== 'notes' && explicitFolder.toLowerCase() !== 'all icloud') {
      fObj = { id: 'folder_' + Date.now().toString(36), name: explicitFolder, isCustom: true };
      state.folders.push(fObj);
    }
    if (fObj) targetFolderId = fObj.id;
  }

  const lines = cleanText.split(/\r?\n/);
  let title = explicitTitle || '';
  let startIdx = 0;
  
  if (!title) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith('#')) {
        title = l.replace(/^#+\s*/, '').trim();
        startIdx = i + 1;
        break;
      } else {
        title = l;
        startIdx = i + 1;
        break;
      }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith('#') && l.replace(/^#+\s*/, '').trim().toLowerCase() === title.toLowerCase()) {
        startIdx = i + 1;
      }
      break;
    }
  }
  if (!title) {
    title = (filename || 'Untitled Note').replace(/\.(markdown|md|txt)$/i, '');
  }

  let html = '';
  let inChecklist = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const checkMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      if (!inChecklist) {
        html += '<div class="ios-checklist-block">';
        inChecklist = true;
      }
      const isChecked = checkMatch[1].toLowerCase() === 'x';
      const itemText = checkMatch[2] || '&nbsp;';
      html += '<div class="ios-check-item' + (isChecked ? ' checked' : '') + '">' +
              '<span class="ios-check-circle"></span>' +
              '<span class="ios-check-text">' + itemText + '</span>' +
              '</div>';
    } else {
      if (inChecklist) {
        html += '</div>';
        inChecklist = false;
      }
      if (trimmed.startsWith('#')) {
        const hText = trimmed.replace(/^#+\s*/, '');
        html += '<div><b>' + hText + '</b></div>';
      } else if (!trimmed) {
        html += '<div><br></div>';
      } else {
        html += '<div>' + trimmed + '</div>';
      }
    }
  }
  if (inChecklist) html += '</div>';

  return {
    id: 'note_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
    title: title,
    content: html || '<div><br></div>',
    folderId: targetFolderId,
    pinned: false,
    deleted: false,
    createdAt: noteDate,
    updatedAt: updatedDate
  };
}

async function handleDbFileSelected(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const fileList = Array.from(files);
  const isAllMarkdown = fileList.every(f => {
    const name = f.name.toLowerCase();
    return name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt');
  });

  if (isAllMarkdown) {
    try {
      const parsedNotes = [];
      for (const f of fileList) {
        const text = await readFileAsText(f);
        parsedNotes.push(parseMarkdownToNote(text, f.name, f.lastModified));
      }
      pendingBackupData = { notes: parsedNotes, folders: [] };
      if (el.restorePreviewBox) {
        el.restorePreviewTitle.textContent = fileList.length === 1 
          ? `Markdown Note: ${fileList[0].name}` 
          : `${fileList.length} Markdown Notes Selected`;
        el.restorePreviewDesc.textContent = `Contains ${parsedNotes.length} note(s). Choose how to import:`;
        el.restorePreviewBox.style.display = 'block';
      }
      return;
    } catch (err) {
      console.error('Failed to read markdown files:', err);
      showToast('Error reading markdown file(s)');
      return;
    }
  }

  const file = fileList[0];
  const lowerName = file.name.toLowerCase();

  // Read file header to intelligently detect JSON DB vs SQLite Binary
  try {
    const textSample = await readFileAsText(file);
    const cleanSample = textSample.replace(/^\uFEFF/, '').trim();
    if (cleanSample.startsWith('{')) {
      const data = JSON.parse(cleanSample);
      if (data && Array.isArray(data.notes)) {
        pendingBackupData = data;
        if (el.restorePreviewBox) {
          el.restorePreviewTitle.textContent = `Database Backup: ${file.name}`;
          el.restorePreviewDesc.textContent = `Contains ${data.notes.length} notes. Choose how to restore:`;
          el.restorePreviewBox.style.display = 'block';
        }
        return;
      }
    }
  } catch (_) {}

  const isDbFile = lowerName.endsWith('.db') || lowerName.endsWith('.sqlite');
  if (isDbFile) {
    pendingBackupData = { isSqliteFile: true, file: file };
    if (el.restorePreviewBox) {
      el.restorePreviewTitle.textContent = `Database Backup: ${file.name}`;
      el.restorePreviewDesc.textContent = `Database backup file detected. Choose how to restore your notes and folders:`;
      el.restorePreviewBox.style.display = 'block';
    }
    return;
  }

  const name = file.name.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
    try {
      const text = await readFileAsText(file);
      const note = parseMarkdownToNote(text, file.name, file.lastModified);
      pendingBackupData = { notes: [note], folders: [] };
      if (el.restorePreviewBox) {
        el.restorePreviewTitle.textContent = `Markdown Note: ${file.name}`;
        el.restorePreviewDesc.textContent = `Ready to import "${note.title}". Choose how to restore:`;
        el.restorePreviewBox.style.display = 'block';
      }
      return;
    } catch (err) {
      showToast('Error reading markdown file');
      return;
    }
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const rawText = evt.target.result;
      if (rawText.startsWith('SQLite format 3')) {
        pendingBackupData = { isSqliteFile: true, file: file };
        if (el.restorePreviewBox) {
          el.restorePreviewTitle.textContent = `SQLite Database: ${file.name}`;
          el.restorePreviewDesc.textContent = `SQLite backup file detected. Choose how to restore your notes and folders:`;
          el.restorePreviewBox.style.display = 'block';
        }
        return;
      }
      const data = JSON.parse(rawText);
      if (!data || !Array.isArray(data.notes)) {
        showToast('Invalid backup file format');
        return;
      }
      pendingBackupData = data;
      const noteCount = data.notes.length;
      const folderCount = Array.isArray(data.folders) ? data.folders.length : 0;
      if (el.restorePreviewBox) {
        el.restorePreviewTitle.textContent = `Backup File: ${file.name}`;
        el.restorePreviewDesc.textContent = `Contains ${noteCount} notes and ${folderCount} folders. Choose how to restore:`;
        el.restorePreviewBox.style.display = 'block';
      }
    } catch (err) {
      console.error('Failed to parse backup:', err);
      showToast('Error reading backup file');
    }
  };
  reader.onerror = function() {
    showToast('Failed to read file');
  };
  reader.readAsText(file);
}

function executeRestore(mode, password = '') {
  if (!pendingBackupData) {
    showToast('No valid backup data selected');
    return;
  }

  if (pendingBackupData.isSqliteFile) {
    showToast('Processing backup file...');
    const serverUrl = getEffectiveServerUrl();
    if (!serverUrl) {
      showToast('Cannot connect to sync server to parse backup file');
      return;
    }
    fetch(`${serverUrl}/api/restore/db-file?mode=${mode}&password=${encodeURIComponent(password)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pendingBackupData.file
    })
    .then(res => res.json())
    .then(data => {
      if (data.error === 'PASSWORD_REQUIRED') {
        const pwd = window.prompt(data.message || 'This backup is encrypted. Please enter your backup password or PIN:');
        if (pwd !== null && pwd.trim().length > 0) {
          executeRestore(mode, pwd.trim());
        } else {
          showToast('Restore cancelled (password required)');
        }
        return;
      }
      if (data.success) {
        showToast(`Restored ${data.notesCount !== undefined ? data.notesCount : data.count} notes and ${data.foldersCount || 0} folders! 🎉`);
        if (el.restorePreviewBox) el.restorePreviewBox.style.display = 'none';
        pendingBackupData = null;
        if (el.inputRestoreFile) el.inputRestoreFile.value = '';
        fetch(`${serverUrl}/api/notes`).then(r => r.json()).then(remoteData => {
          if (remoteData && remoteData.notes) {
            state.notes = remoteData.notes;
            if (remoteData.folders) state.folders = remoteData.folders;
            persistState();
            renderFolders();
            renderNotesList();
          }
        }).catch(() => {});
      } else {
        showToast(data.error || 'Failed to parse backup database');
      }
    })
    .catch(err => {
      console.error('SQLite restore error:', err);
      showToast('Error sending database to server');
    });
    return;
  }

  if (!Array.isArray(pendingBackupData.notes)) {
    showToast('No valid backup data selected');
    return;
  }

  const backupNotes = pendingBackupData.notes;
  const backupFolders = Array.isArray(pendingBackupData.folders) ? pendingBackupData.folders : [];

  if (mode === 'merge') {
    const existingNoteIds = new Set(state.notes.map(n => n.id));
    let addedNotes = 0;
    backupNotes.forEach(bn => {
      if (!existingNoteIds.has(bn.id)) {
        state.notes.push(bn);
        addedNotes++;
      }
    });

    const existingFolderIds = new Set(state.folders.map(f => f.id));
    backupFolders.forEach(bf => {
      if (!existingFolderIds.has(bf.id)) {
        state.folders.push(bf);
      }
    });
    showToast(`Merged ${addedNotes} new notes from backup 🎉`);
  } else {
    state.notes = backupNotes;
    if (backupFolders.length > 0) {
      state.folders = backupFolders;
    }
    showToast(`Restored all ${state.notes.length} notes from backup 🎉`);
  }

  persistState();
  renderFolders();
  renderNotesList();

  // Sync with server if connected
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'STORE_RESTORE',
      data: {
        folders: state.folders,
        notes: state.notes
      },
      mode: mode
    }));
  } else {
    const serverUrl = getEffectiveServerUrl();
    if (serverUrl) {
      fetch(`${serverUrl}/api/restore/db?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folders: state.folders,
          notes: state.notes
        })
      }).catch(err => console.log('REST sync error on restore:', err));
    }
  }

  closeBackupModal();
}


function openNewFolderModal() {
  const modal = document.getElementById('modal-new-folder');
  const input = document.getElementById('new-folder-input');
  if (modal && input) {
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 150);
  }
}

function closeNewFolderModal() {
  const modal = document.getElementById('modal-new-folder');
  if (modal) modal.classList.remove('active');
}

function submitNewFolder() {
  const input = document.getElementById('new-folder-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  
  const folder = {
    id: 'folder_' + Date.now(),
    name: name,
    icon: 'folder',
    system: false
  };
  state.folders.push(folder);
  persistState();
  renderFolders();
  sendSocketMessage({ type: 'FOLDER_CREATE', folder });
  closeNewFolderModal();
  showToast('Created folder "' + folder.name + '"');
  
  // Smoothly glide into the newly created folder
  setTimeout(() => {
    selectFolder(folder.id);
  }, 250);
}

function setupEventListeners() {
  if (el.btnNavToFolders) el.btnNavToFolders.addEventListener('click', () => navigateView('view-folders'));
  const foldersSearchInput = document.getElementById('folders-search-input');
  if (foldersSearchInput) {
    foldersSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = document.querySelectorAll('.ios-folder-item');
      items.forEach(item => {
        const name = item.querySelector('.ios-folder-name')?.textContent.toLowerCase() || '';
        item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
      });
    });
  }
  
  const btnFolderOptions = document.getElementById('btn-folder-options');
  if (btnFolderOptions) {
    btnFolderOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btnFolderOptions.getBoundingClientRect();
      const x = rect.right;
      const y = rect.bottom + 8;

      const checkSvg = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

      const items = [
        {
          label: 'Select Notes',
          iconSvg: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
          onClick: () => {
            enterSelectionMode();
          }
        },
        {
          label: 'Date Created',
          sub: 'Newest to Oldest',
          iconSvg: currentSortMode === 'created' ? checkSvg : '',
          onClick: () => {
            if (currentSortMode === 'created') return;
            currentSortMode = 'created';
            try { localStorage.setItem('cownotes_sort_mode', 'created'); } catch (_) {}
            requestAnimationFrame(() => {
              sortNotesList();
              renderNotesList();
              showToast('Sorted by Date Created');
            });
          }
        },
        {
          label: 'Date Modified',
          sub: 'Recently Edited',
          iconSvg: currentSortMode === 'updated' ? checkSvg : '',
          onClick: () => {
            if (currentSortMode === 'updated') return;
            currentSortMode = 'updated';
            try { localStorage.setItem('cownotes_sort_mode', 'updated'); } catch (_) {}
            requestAnimationFrame(() => {
              sortNotesList();
              renderNotesList();
              showToast('Sorted by Date Modified');
            });
          }
        },
        {
          label: 'Title',
          sub: 'Alphabetical (A-Z)',
          iconSvg: currentSortMode === 'title' ? checkSvg : '',
          onClick: () => {
            if (currentSortMode === 'title') return;
            currentSortMode = 'title';
            try { localStorage.setItem('cownotes_sort_mode', 'title'); } catch (_) {}
            requestAnimationFrame(() => {
              sortNotesList();
              renderNotesList();
              showToast('Sorted by Title');
            });
          }
        }
      ];

      showContextMenu(items, x, y, true);
    });
  }

  if (el.btnEditorBack) el.btnEditorBack.addEventListener('click', navigateBackToList);
  if (el.btnEditorDone) el.btnEditorDone.addEventListener('click', navigateBackToList);

  
  const btnSelDone = document.getElementById('btn-selection-done');
  if (btnSelDone) btnSelDone.addEventListener('click', exitSelectionMode);

  const btnSelDelete = document.getElementById('btn-selection-delete');
  if (btnSelDelete) btnSelDelete.addEventListener('click', deleteSelectedNotes);

  const btnSelMove = document.getElementById('btn-selection-move');
  if (btnSelMove) btnSelMove.addEventListener('click', handleSelectionMoveOrRecover);

  if (el.btnCreateNote) el.btnCreateNote.addEventListener('click', createNewNote);
  if (el.btnSidebarNewNote) el.btnSidebarNewNote.addEventListener('click', createNewNote);

  if (el.btnNewFolder) {
    el.btnNewFolder.addEventListener('click', openNewFolderModal);
  }
  const btnFolderCancel = document.getElementById('btn-new-folder-cancel');
  if (btnFolderCancel) btnFolderCancel.addEventListener('click', closeNewFolderModal);

  // Edit Folder Modal Listeners
  const btnEditFolderCancel = document.getElementById('btn-edit-folder-cancel');
  if (btnEditFolderCancel) btnEditFolderCancel.addEventListener('click', closeEditFolderModal);

  const btnEditFolderDone = document.getElementById('btn-edit-folder-done');
  if (btnEditFolderDone) btnEditFolderDone.addEventListener('click', saveEditFolder);

  const btnEditFolderClear = document.getElementById('edit-folder-clear-btn');
  if (btnEditFolderClear) {
    btnEditFolderClear.addEventListener('click', () => {
      const input = document.getElementById('edit-folder-name-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  }

  // Reorder Folder Modal Listeners
  const btnCloseReorderFolder = document.getElementById('btn-close-reorder-folder');
  if (btnCloseReorderFolder) btnCloseReorderFolder.addEventListener('click', closeReorderFolderModal);

  
  const btnFolderSave = document.getElementById('btn-new-folder-save');
  if (btnFolderSave) btnFolderSave.addEventListener('click', submitNewFolder);
  
  const folderInput = document.getElementById('new-folder-input');
  if (folderInput) {
    folderInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitNewFolder();
      if (e.key === 'Escape') closeNewFolderModal();
    });
  }

  if (el.btnThemeToggle) el.btnThemeToggle.addEventListener('click', toggleTheme);

  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    el.searchClear.style.display = state.searchQuery ? 'block' : 'none';
    renderNotesList();
  });

  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    state.searchQuery = '';
    el.searchClear.style.display = 'none';
    renderNotesList();
  });

  el.filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      el.filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeFilter = chip.dataset.filter;
      renderNotesList();
    });
  });

  el.noteTitleInput.addEventListener('input', queueAutoSave);
  el.noteBodyEditor.addEventListener('input', (e) => {
    queueAutoSave();
    // NEVER auto-scroll on delete/backspace
    if (!e.inputType || !e.inputType.startsWith('delete')) {
      scheduleScrollCaretIntoView(false);
    }
    const sel = window.getSelection();
    if (sel && sel.anchorNode && sel.anchorNode.nodeType === Node.TEXT_NODE) {
      handleMathEvaluation(sel.anchorNode, sel.anchorOffset, e);
    }
  });

  // Delegated checklist toggle on pointerdown / click
  function toggleCheckboxItem(box) {
    const item = box.closest('.ios-check-item');
    if (!item) return;
    const isChecked = item.classList.contains('checked');
    if (isChecked) {
      item.classList.remove('checked');
      item.dataset.checked = 'false';
    } else {
      item.classList.add('checked');
      item.dataset.checked = 'true';
    }
    queueAutoSave();
  }

  el.noteBodyEditor.addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.ios-checkbox');
    if (box) {
      e.preventDefault();
      e.stopPropagation();
      toggleCheckboxItem(box);
    }
  });

  el.noteBodyEditor.addEventListener('click', (e) => {
    const box = e.target.closest('.ios-checkbox');
    if (box) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  if (el.btnEditFolders) {
    el.btnEditFolders.addEventListener('click', () => toggleEditFoldersMode());
  }

  // Formatting buttons: Bold, Italic, Underline with persistent typing intent
  let lastEditorRange = null;
  function saveEditorSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.noteBodyEditor.contains(range.commonAncestorContainer)) {
        lastEditorRange = range.cloneRange();
      }
    }
  }

// =========================================================================
// AUTO-SCROLL TO CARET (KEYBOARD-AWARE SCROLLING)
// Ensures typed text is never obscured by the mobile keypad or toolbar.
// =========================================================================
let scrollCaretRaf = null;

function scheduleScrollCaretIntoView(smooth = false) {
  if (scrollCaretRaf) cancelAnimationFrame(scrollCaretRaf);
  scrollCaretRaf = requestAnimationFrame(() => {
    scrollCaretRaf = null;
    scrollCaretIntoView(smooth);
  });
}

function scrollCaretIntoView(smooth = false) {
  const scrollContainer = el.editorScroll || document.getElementById('editor-scroll');
  if (!scrollContainer) return;

  const sel = window.getSelection();
  const editor = el.noteBodyEditor || document.getElementById('note-body-editor');
  const titleInput = el.noteTitleInput || document.getElementById('note-title-input');

  const isEditorFocused = editor && document.activeElement === editor;
  const isTitleFocused = titleInput && document.activeElement === titleInput;

  // Strictly only scroll when user is actively focused and typing
  if (!isEditorFocused && !isTitleFocused) return;

  let rect = null;

  if (isTitleFocused) {
    rect = titleInput.getBoundingClientRect();
  } else if (sel && sel.rangeCount > 0) {
    try {
      const range = sel.getRangeAt(0);
      const clientRects = range.getClientRects();
      if (clientRects && clientRects.length > 0) {
        rect = clientRects[clientRects.length - 1];
      } else {
        const rRect = range.getBoundingClientRect();
        if (rRect && rRect.height > 0) rect = rRect;
      }

      // If rect is still invalid or zero, check the node safely
      if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
        let node = range.startContainer;
        if (node) {
          if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
          // NEVER EVER use editor or scrollContainer itself as caret measurement!
          if (node && node !== editor && node !== scrollContainer && editor.contains(node) && node.getBoundingClientRect) {
            const nodeRect = node.getBoundingClientRect();
            if (nodeRect && nodeRect.height > 0 && nodeRect.height <= 60) {
              rect = nodeRect;
            } else if (nodeRect && nodeRect.height > 60) {
              // Multi-line container: estimate caret at top of block, never bottom!
              rect = {
                top: nodeRect.top,
                bottom: nodeRect.top + 28,
                left: nodeRect.left,
                right: nodeRect.right,
                height: 28,
                width: nodeRect.width
              };
            }
          }
        }
      }
    } catch (_e) {}
  }

  if (!rect || (rect.top === 0 && rect.bottom === 0)) return;

  // Cap caretBottom to prevent container elements from jumping the view to bottom
  let caretBottom = rect.bottom;
  if (rect.height > 75) {
    caretBottom = rect.top + 28;
  }

  // Determine bottom obstacle (keypad / toolbar)
  const toolbar = el.editorToolbar || document.getElementById('editor-toolbar');
  let obstacleTop = window.innerHeight;

  if (window.visualViewport) {
    obstacleTop = Math.min(obstacleTop, window.visualViewport.height + (window.visualViewport.offsetTop || 0));
  }

  if (toolbar) {
    const tbRect = toolbar.getBoundingClientRect();
    if (tbRect.top > 0 && tbRect.top < obstacleTop) {
      obstacleTop = tbRect.top;
    }
  }

  // Safe bottom margin: Caret should always stay at least 70px above toolbar/keyboard
  const comfortableMargin = 70;
  const safeBottom = obstacleTop - comfortableMargin;

  // Safe top margin: Avoid top header bar
  const navBar = document.querySelector('.ios-editor-pane .ios-nav-bar');
  const safeTop = (navBar ? navBar.getBoundingClientRect().bottom : 50) + 14;

  if (caretBottom > safeBottom) {
    const scrollAmount = caretBottom - safeBottom;
    if (smooth) {
      scrollContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    } else {
      scrollContainer.scrollTop += scrollAmount;
    }
  } else if (rect.top < safeTop) {
    const scrollAmount = safeTop - rect.top;
    if (smooth) {
      scrollContainer.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
    } else {
      scrollContainer.scrollTop -= scrollAmount;
    }
  }
}

// Visual Viewport & Keyboard Height Handling for Mobile Web & Android
if (window.visualViewport) {
  const updateVisualViewport = () => {
    const kbHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
    document.documentElement.style.setProperty('--keyboard-height', kbHeight + 'px');
    document.documentElement.setAttribute('data-keyboard-open', kbHeight > 80 ? 'true' : 'false');
  };
  window.visualViewport.addEventListener('resize', updateVisualViewport);
}

window.onKeyboardUpdated = function(kbHeight) {
  const h = Math.max(0, kbHeight || 0);
  document.documentElement.style.setProperty('--keyboard-height', h + 'px');
  document.documentElement.setAttribute('data-keyboard-open', h > 80 ? 'true' : 'false');
};

  // Editor event listeners: Selection & format state on interaction
  ['keyup', 'mouseup', 'touchend', 'input', 'pointerup', 'focus', 'click'].forEach(evt => {
    el.noteBodyEditor.addEventListener(evt, () => {
      saveEditorSelection();
      applyPendingFormats();
      updateFormatButtonStates();
    });
  });

  // ONLY auto-scroll when user is actively inserting text
  el.noteBodyEditor.addEventListener('beforeinput', (e) => {
    if (e.inputType && e.inputType.startsWith('insert')) {
      applyPendingFormats();
    }
  });

  // Only update format states on selection change, NEVER auto-scroll on click/select
  document.addEventListener('selectionchange', () => {
    saveEditorSelection();
    updateFormatButtonStates();
  });

  // Title auto-resize & keyboard handling
  if (el.noteTitleInput) {
    el.noteTitleInput.addEventListener('input', () => {
      autoResizeTitle();
      scheduleScrollCaretIntoView(false);
    });
    el.noteTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (el.noteBodyEditor) {
          el.noteBodyEditor.focus();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            if (el.noteBodyEditor.firstChild) {
              range.setStart(el.noteBodyEditor.firstChild, 0);
              range.collapse(true);
            } else {
              range.selectNodeContents(el.noteBodyEditor);
              range.collapse(true);
            }
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
    });
  }

  function toggleFormatCommand(command) {
    el.noteBodyEditor.focus();
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed && sel.toString().length > 0 && el.noteBodyEditor.contains(sel.getRangeAt(0).commonAncestorContainer);

    if (hasSelection) {
      document.execCommand(command, false, null);
      formatIntent[command] = document.queryCommandState(command);
    } else {
      formatIntent[command] = !formatIntent[command];
      if (formatIntent[command]) {
        if (!document.queryCommandState(command)) {
          document.execCommand(command, false, null);
        }
      } else {
        if (document.queryCommandState(command)) {
          document.execCommand(command, false, null);
        }
      }
    }
    saveEditorSelection();
    updateFormatButtonStates();
    queueAutoSave();
  }

  function setupFormatButton(btn, command) {
    if (!btn) return;
    let lastAction = 0;

    const handleAction = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastAction < 220) return;
      lastAction = now;
      toggleFormatCommand(command);
    };

    btn.addEventListener('pointerdown', handleAction);
    btn.addEventListener('touchstart', handleAction);
    btn.addEventListener('mousedown', handleAction);
    btn.addEventListener('click', handleAction);
  }

  setupFormatButton(el.tbBold, 'bold');
  setupFormatButton(el.tbItalic, 'italic');
  setupFormatButton(el.tbUnderline, 'underline');

  // Editor Keydown: Checklist Enter & Backspace management
  el.noteBodyEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      const rawText = (el.noteBodyEditor.textContent || '').replace(/[\u200B\n\r\s]/g, '');
      const hasMedia = el.noteBodyEditor.querySelector('img, .ios-media-container, .ios-drawing-attachment, .ios-audio-card');
      if (!rawText && !hasMedia) {
        // Body is completely empty: smoothly move cursor to end of Title without any auto-scrolling jitter
        e.preventDefault();
        if (el.noteTitleInput) {
          el.noteTitleInput.focus();
          if (typeof el.noteTitleInput.setSelectionRange === 'function') {
            const len = el.noteTitleInput.value.length;
            el.noteTitleInput.setSelectionRange(len, len);
          }
        }
        return;
      }
    }
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        let node = sel.anchorNode;
        let checkItem = null;
        while (node && node !== el.noteBodyEditor) {
          if (node.classList && node.classList.contains('ios-check-item')) {
            checkItem = node;
            break;
          }
          node = node.parentNode;
        }

        if (checkItem) {
          const textSpan = checkItem.querySelector('.ios-check-text');
          const rawText = textSpan ? (textSpan.innerText || textSpan.textContent || '').replace(/[\u200B\n\r]/g, '') : '';
          
          let shouldRemoveCircle = false;
          if (!rawText.trim()) {
            shouldRemoveCircle = true;
          } else if (sel.anchorNode === textSpan && sel.anchorOffset === 0) {
            shouldRemoveCircle = true;
          } else if (sel.anchorNode && textSpan && textSpan.contains(sel.anchorNode)) {
            try {
              const r = document.createRange();
              r.setStart(textSpan, 0);
              r.setEnd(sel.anchorNode, sel.anchorOffset);
              if (!r.toString().replace(/[\u200B\n\r]/g, '').trim()) {
                shouldRemoveCircle = true;
              }
            } catch (_) {}
          }

          if (shouldRemoveCircle) {
            e.preventDefault();
            convertCheckItemToNormalLine(checkItem);
            return;
          }
        }
      }
    }

    if (e.key === 'Enter') {
      setTimeout(() => scheduleScrollCaretIntoView(true), 20);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node = sel.anchorNode;
        let checkItem = null;
        while (node && node !== el.noteBodyEditor) {
          if (node.classList && node.classList.contains('ios-check-item')) {
            checkItem = node;
            break;
          }
          node = node.parentNode;
        }

        if (checkItem) {
          e.preventDefault();
          const textSpan = checkItem.querySelector('.ios-check-text');
          const text = textSpan ? textSpan.innerText.trim() : '';

          if (!text) {
            // Exit checklist
            const block = checkItem.closest('.ios-checklist-block');
            checkItem.remove();

            const blankLine = document.createElement('div');
            blankLine.innerHTML = '<br>';

            if (block && block.parentNode) {
              if (block.children.length === 0) {
                block.parentNode.replaceChild(blankLine, block);
              } else if (block.nextSibling) {
                block.parentNode.insertBefore(blankLine, block.nextSibling);
              } else {
                block.parentNode.appendChild(blankLine);
              }
            } else {
              el.noteBodyEditor.appendChild(blankLine);
            }

            const range = document.createRange();
            range.setStart(blankLine, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            // Next checklist item directly below
            const newItem = document.createElement('div');
            newItem.className = 'ios-check-item';
            newItem.dataset.checked = 'false';
            newItem.innerHTML = '<span class="ios-checkbox" contenteditable="false"></span><span class="ios-check-text"><br></span>';

            if (checkItem.nextSibling) {
              checkItem.parentNode.insertBefore(newItem, checkItem.nextSibling);
            } else {
              checkItem.parentNode.appendChild(newItem);
            }

            setupInteractiveChecklistsInEditor();

            const newText = newItem.querySelector('.ios-check-text');
            const range = document.createRange();
            range.setStart(newText, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          queueAutoSave();
          return;
        }
      }
    }
  });

  if (el.tbChecklist) el.tbChecklist.addEventListener('click', insertChecklistItem);
  if (el.tbMedia) {
    el.tbMedia.addEventListener('pointerdown', saveEditorSelection);
    el.tbMedia.addEventListener('mousedown', saveEditorSelection);
    el.tbMedia.addEventListener('click', () => {
      saveEditorSelection();
      if (el.mediaFileInput) el.mediaFileInput.click();
    });
  }
  if (el.mediaFileInput) el.mediaFileInput.addEventListener('change', handlePhotoUpload);
  if (el.noteBodyEditor) {
    el.noteBodyEditor.addEventListener('mouseup', saveEditorSelection);
    el.noteBodyEditor.addEventListener('keyup', (e) => {
    saveEditorSelection();
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key.startsWith('Arrow')) return;
  });
    el.noteBodyEditor.addEventListener('touchend', saveEditorSelection);
  }
  
  // Microphone button: Strictly Voice Dictation (speech-to-text) ONLY
  if (el.tbMic) {
    el.tbMic.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleVoiceDictation();
    });
  }

  if (el.btnStopDictation) {
    el.btnStopDictation.addEventListener('click', stopDictation);
  }

  if (el.optVoiceMemo) {
    el.optVoiceMemo.addEventListener('click', () => {
      el.modalNoteOptions.classList.remove('active');
      toggleVoiceRecording();
    });
  }

  // Voice memo floating popup action buttons
  const btnStopVoiceMemo = document.getElementById('btn-stop-voicememo');
  if (btnStopVoiceMemo) {
    btnStopVoiceMemo.addEventListener('click', () => {
      stopVoiceRecording(false);
    });
  }

  const btnCancelVoiceMemo = document.getElementById('btn-cancel-voicememo');
  if (btnCancelVoiceMemo) {
    btnCancelVoiceMemo.addEventListener('click', () => {
      stopVoiceRecording(true);
    });
  }

  // CowSync Sync & Server IP configuration modal
  if (el.syncPill) {
    el.syncPill.addEventListener('click', () => {
      updateSyncSettingsModalUI();
      if (el.modalSyncSettings) el.modalSyncSettings.classList.add('active');
    });
  }

  if (el.btnCloseSyncModal) {
    el.btnCloseSyncModal.addEventListener('click', () => {
      if (el.modalSyncSettings) el.modalSyncSettings.classList.remove('active');
    });
  }

  const btnExportDbSync = document.getElementById('btn-export-db-sync');
  if (btnExportDbSync) {
    btnExportDbSync.addEventListener('click', () => {
      if (el.modalSyncSettings) el.modalSyncSettings.classList.remove('active');
      exportDatabaseBackup();
    });
  }

  const btnImportDbSync = document.getElementById('btn-import-db-sync');
  if (btnImportDbSync) {
    btnImportDbSync.addEventListener('click', () => {
      if (el.modalSyncSettings) el.modalSyncSettings.classList.remove('active');
      openBackupModal();
      const input = el.inputDbFile || document.getElementById('db-file-input');
      if (input) input.click();
    });
  }

  if (el.btnSaveSyncServer) {
    el.btnSaveSyncServer.addEventListener('click', () => {
      const url = el.inputSyncServerUrl ? el.inputSyncServerUrl.value.trim() : '';
      setStandaloneMode(false);
      if (url) {
        setStoredServerUrl(url);
        showToast(`Connecting to ${url}...`);
      } else {
        setStoredServerUrl('');
        showToast('Connecting...');
      }
      if (el.modalSyncSettings) el.modalSyncSettings.classList.remove('active');
      if (state.ws) {
        try { 
          state.ws.onclose = null;
          state.ws.onerror = null;
          state.ws.close(); 
        } catch (_) {}
        state.ws = null;
      }
      setSyncStatus('syncing', 'Connecting...');
      initWebSocket();
      fetchServerInfo();
    });
  }

  if (el.btnClearSyncServer) {
    el.btnClearSyncServer.addEventListener('click', () => {
      setStandaloneMode(true);
      setStoredServerUrl('');
      if (state.ws) {
        try { 
          state.ws.onclose = null;
          state.ws.onerror = null;
          state.ws.close(); 
        } catch (_) {}
        state.ws = null;
      }
      state.wsConnected = false;
      setSyncStatus('offline', 'Standalone');
      updateSyncSettingsModalUI();
      if (el.modalSyncSettings) el.modalSyncSettings.classList.remove('active');
      showToast('Switched to Standalone Mode (Offline)');
    });
  }

  // Clear button for IP input
  const btnClearIpInput = document.getElementById('btn-clear-ip-input');
  if (btnClearIpInput && el.inputSyncServerUrl) {
    btnClearIpInput.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.inputSyncServerUrl.value = '';
      setStoredServerUrl('');
      localStorage.removeItem('cownotes_server_url');
      localStorage.removeItem('cownotes_user_server_url');
      el.inputSyncServerUrl.focus();
    });
  }

  // Auto-scroll input into view and lift sheet above mobile keyboard ONLY on small screens
  if (el.inputSyncServerUrl) {
    el.inputSyncServerUrl.addEventListener('focus', () => {
      const isMobileScreen = window.innerWidth < 768;
      if (!isMobileScreen) return; // NEVER add padding on PC / desktop web!
      const sheet = el.inputSyncServerUrl.closest('.ios-sheet');
      if (sheet) {
        sheet.style.paddingBottom = '280px';
        setTimeout(() => {
          el.inputSyncServerUrl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
      }
    });

    el.inputSyncServerUrl.addEventListener('blur', () => {
      const sheet = el.inputSyncServerUrl.closest('.ios-sheet');
      if (sheet) {
        sheet.style.paddingBottom = '';
      }
    });
  }
  if (el.tbDraw) {
    el.tbDraw.addEventListener('pointerdown', saveEditorSelection);
    el.tbDraw.addEventListener('mousedown', saveEditorSelection);
    el.tbDraw.addEventListener('click', openDrawingModal);
  }
  if (el.tbFormat) el.tbFormat.addEventListener('click', () => { document.execCommand('bold', false, null); });


  
  const btnQrCloud = document.getElementById('btn-qr-cloud');
  if (btnQrCloud) {
    btnQrCloud.addEventListener('click', () => fetchServerInfo('cloud'));
  }
  const btnQrWifi = document.getElementById('btn-qr-wifi');
  if (btnQrWifi) {
    btnQrWifi.addEventListener('click', () => fetchServerInfo('local'));
  }

  const btnOpenSyncAdvanced = document.getElementById('btn-open-sync-advanced');
  if (btnOpenSyncAdvanced) {
    btnOpenSyncAdvanced.addEventListener('click', () => {
      const phoneModal = el.modalPhoneConnect || document.getElementById('modal-phone-connect');
      if (phoneModal) phoneModal.classList.remove('active');
      updateSyncSettingsModalUI();
      if (el.modalSyncSettings) el.modalSyncSettings.classList.add('active');
    });
  }

  const btnOpenBackupFromPhone = document.getElementById('btn-open-backup-from-phone');
  if (btnOpenBackupFromPhone) {
    btnOpenBackupFromPhone.addEventListener('click', () => {
      const phoneModal = el.modalPhoneConnect || document.getElementById('modal-phone-connect');
      if (phoneModal) phoneModal.classList.remove('active');
      openBackupModal();
    });
  }

  if (el.btnClosePhoneModal) el.btnClosePhoneModal.addEventListener('click', () => {
    el.modalPhoneConnect.classList.remove('active');
  });
  if (el.phoneUrlCopyBox) el.phoneUrlCopyBox.addEventListener('click', () => {
    const text = el.phoneUrlDisplay ? el.phoneUrlDisplay.textContent : '';
    if (text) {
      navigator.clipboard.writeText(text);
      showToast('Phone URL copied to clipboard!');
    }
  });

  el.keypadBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key) handleKeypadPress(key);
    });
  });
  if (el.btnPinCancel) el.btnPinCancel.addEventListener('click', () => {
    state.pinAction = null;
    state.pinBuffer = '';
    updatePinDots();
    el.modalPinLock.classList.remove('active');
  });

  if (el.btnDrawCancel) el.btnDrawCancel.addEventListener('click', () => el.modalDrawing.classList.remove('active'));
  if (el.btnDrawSave) el.btnDrawSave.addEventListener('click', saveDrawingToNote);
  if (el.btnDrawClear) el.btnDrawClear.addEventListener('click', () => {
    state.drawingHistory = [];
    redrawCanvasHistory();
  });
  if (el.btnDrawUndo) el.btnDrawUndo.addEventListener('click', () => {
    state.drawingHistory.pop();
    redrawCanvasHistory();
  });

  el.swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      el.swatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      state.drawingColor = swatch.dataset.color;
    });
  });

  function dismissKeyboard() {
    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      const editor = document.getElementById('note-body-editor');
      if (editor) editor.blur();
      const title = document.getElementById('note-title-input');
      if (title) title.blur();

      if (window.getSelection) {
        const sel = window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      }

      if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.hideKeyboard === 'function') {
        window.AndroidSpeechBridge.hideKeyboard();
      }
    } catch (e) {
      console.warn('dismissKeyboard err', e);
    }
  }

  function openNoteOptionsModal() {
    dismissKeyboard();
    if (!state.activeNoteId) {
      if (state.notes.length > 0) state.activeNoteId = state.notes[0].id;
      else return;
    }
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note && el.modalNoteOptions) {
      updateNoteOptionsModalUI(note);
      el.modalNoteOptions.classList.add('active');
    }
  }

  if (el.btnNoteOptions) {
    el.btnNoteOptions.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissKeyboard();
      openNoteOptionsModal();
    });
    el.btnNoteOptions.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissKeyboard();
      openNoteOptionsModal();
    });
  }

  if (el.btnCloseOptionsModal) el.btnCloseOptionsModal.addEventListener('click', () => {
    el.modalNoteOptions.classList.remove('active');
  });

  if (el.optPinNote) el.optPinNote.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note) {
      note.pinned = !note.pinned;
      persistState();
      renderNotesList();
      sendSocketMessage({ type: 'NOTE_UPSERT', note });
      showToast(note.pinned ? 'Note Pinned 📌' : 'Note Unpinned');
      el.modalNoteOptions.classList.remove('active');
    }
  });

  if (el.optLockNote) el.optLockNote.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note) {
      el.modalNoteOptions.classList.remove('active');
      if (note.locked) {
        note.locked = false;
        note.pinCode = '';
        persistState();
        renderNotesList();
        sendSocketMessage({ type: 'NOTE_UPSERT', note });
        showToast('Lock removed from note');
      } else {
        promptPinSet(note);
      }
    }
  });

  if (el.optExportMd) el.optExportMd.addEventListener('click', () => {
    el.modalNoteOptions.classList.remove('active');
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (!note) return;

    const rawTitle = (note.title || 'Untitled').trim();
    const safeFilename = `${rawTitle.replace(/[/\\?%*:|"<>]/g, '_')}.md`;
    const noteCreated = note.createdAt || new Date().toISOString();
    const noteUpdated = note.updatedAt || noteCreated;
    const folder = state.folders.find(f => f.id === note.folderId);
    const folderName = folder ? folder.name : 'Notes';

    const markdownContent = [
      '---',
      `title: "${rawTitle.replace(/"/g, '\\"')}"`,
      `created: ${noteCreated}`,
      `updated: ${noteUpdated}`,
      `date: ${noteCreated}`,
      `folder: "${folderName.replace(/"/g, '\\"')}"`,
      '---',
      '',
      `# ${rawTitle}`,
      '',
      htmlToMarkdown(note.content)
    ].join('\n');

    if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.exportMarkdown === 'function') {
      window.AndroidSpeechBridge.exportMarkdown(safeFilename, markdownContent);
      showToast('Exported Markdown to Downloads 📥');
      return;
    }

    try {
      if (navigator.canShare) {
        const file = new File([markdownContent], safeFilename, { type: 'text/markdown' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: rawTitle
          }).catch(err => {
            if (err.name !== 'AbortError') fallbackDownload();
          });
          return;
        }
      }
    } catch (_) {}

    fallbackDownload();

    function fallbackDownload() {
      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFilename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 300);
      showToast('Exported Markdown file 📥');
    }
  });

  if (el.optPrintNote) el.optPrintNote.addEventListener('click', () => {
    el.modalNoteOptions.classList.remove('active');
    const note = state.notes.find(n => n.id === state.activeNoteId);
    const title = (note && note.title) ? note.title : 'CowNotes';
    if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.printNote === 'function') {
      window.AndroidSpeechBridge.printNote(title);
    } else {
      window.print();
    }
  });

  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');
  const btnCancelDelete = document.getElementById('btn-cancel-delete');

  if (el.optDeleteNote) {
    el.optDeleteNote.addEventListener('click', () => {
      if (!state.activeNoteId) return;
      el.modalNoteOptions.classList.remove('active');
      promptDeleteNote(state.activeNoteId);
    });
  }

    if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', () => {
      const modalDeleteConfirm = document.getElementById('modal-delete-confirm');

      // 0. Batch Delete (Selection Mode)
      if (pendingBatchDeleteIds && pendingBatchDeleteIds.length > 0) {
        const ids = pendingBatchDeleteIds;
        const isTrash = isPendingBatchTrash;
        pendingBatchDeleteIds = null;
        isPendingBatchTrash = false;
        if (modalDeleteConfirm) modalDeleteConfirm.classList.remove('active');

        const serverUrl = getEffectiveServerUrl();
        ids.forEach(id => {
          if (isTrash) {
            deleteNotePermanently(id);
          } else {
            const n = state.notes.find(note => note.id === id);
            if (n) {
              n.deleted = true;
              n.deletedAt = new Date().toISOString();
              n.updatedAt = new Date().toISOString();
              sendSocketMessage({ type: 'NOTE_DELETE', id, permanent: false });
              if (serverUrl) {
                fetch(`${serverUrl}/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
              }
            }
          }
        });

        persistState();
        renderFolders();
        renderNotesList();
        showToast(isTrash ? `Permanently deleted ${ids.length} ${ids.length === 1 ? 'note' : 'notes'}` : `Moved ${ids.length} ${ids.length === 1 ? 'note' : 'notes'} to Recently Deleted`);
        exitSelectionMode();
        return;
      }

      // 1. Folder Deletion
      if (folderIdPendingDelete) {
        const fId = folderIdPendingDelete;
        folderIdPendingDelete = null;
        if (modalDeleteConfirm) modalDeleteConfirm.classList.remove('active');
        executeDeleteFolder(fId);
        return;
      }

      // 2. Note Deletion (Permanent vs Trash)
      const id = noteIdPendingDelete || state.activeNoteId;
      const note = state.notes.find(n => n.id === id);
      if (note) {
        if (note.deleted) {
          deleteNotePermanently(id);
        } else {
          note.deleted = true;
          note.deletedAt = new Date().toISOString();
          note.updatedAt = new Date().toISOString();
          sendSocketMessage({ type: 'NOTE_DELETE', id, permanent: false });
          const serverUrl = getEffectiveServerUrl();
          if (serverUrl) {
            fetch(`${serverUrl}/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
          }
          persistState();
          renderNotesList();
          renderFolders();
          showToast('Moved to Recently Deleted 🗑️');
          if (state.activeNoteId === id) {
            navigateBackToList();
          }
        }
      }
      noteIdPendingDelete = null;
      if (modalDeleteConfirm) modalDeleteConfirm.classList.remove('active');
    });
  }

  // Connect Trash Action Sheet Buttons
  const btnTrashRecover = document.getElementById('btn-trash-recover');
  if (btnTrashRecover) btnTrashRecover.addEventListener('click', recoverPendingTrashNote);

  const btnTrashDeleteForever = document.getElementById('btn-trash-delete-forever');
  if (btnTrashDeleteForever) btnTrashDeleteForever.addEventListener('click', deletePendingTrashNoteForever);

  const btnTrashCancel = document.getElementById('btn-trash-cancel');
  if (btnTrashCancel) btnTrashCancel.addEventListener('click', closeTrashActions);

  // Connect Move to Folder Buttons
  const optMoveFolder = document.getElementById('opt-move-folder');
  if (optMoveFolder) optMoveFolder.addEventListener('click', openMoveFolderModal);

  const btnCloseMoveFolder = document.getElementById('btn-close-move-folder');
  if (btnCloseMoveFolder) btnCloseMoveFolder.addEventListener('click', closeMoveFolderModal);

  if (btnCancelDelete) {
    btnCancelDelete.addEventListener('click', () => {
      noteIdPendingDelete = null;
      if (modalDeleteConfirm) modalDeleteConfirm.classList.remove('active');
    });
  }

  // Database Backup & Restore (.db) event listeners
  const btnBackupModal = el.btnBackupModal || document.getElementById('btn-backup-modal');
  if (btnBackupModal) btnBackupModal.addEventListener('click', openBackupModal);

  const btnBottomBackup = el.btnBottomBackup || document.getElementById('btn-bottom-backup');
  if (btnBottomBackup) btnBottomBackup.addEventListener('click', openBackupModal);

  const btnBottomSync = document.getElementById('btn-bottom-sync');
  if (btnBottomSync) {
    btnBottomSync.addEventListener('click', openPhoneConnectModal);
  }

  const notesSyncPill = document.getElementById('notes-sync-pill');
  if (notesSyncPill) {
    notesSyncPill.addEventListener('click', openPhoneConnectModal);
  }

  const btnOpenSyncFromBackup = document.getElementById('btn-open-sync-from-backup');
  if (btnOpenSyncFromBackup) {
    btnOpenSyncFromBackup.addEventListener('click', () => {
      closeBackupModal();
      updateSyncSettingsModalUI();
      if (el.modalSyncSettings) el.modalSyncSettings.classList.add('active');
    });
  }

  const optSyncCloud = document.getElementById('opt-sync-cloud');
  if (optSyncCloud) {
    optSyncCloud.addEventListener('click', () => {
      const optModal = el.modalNoteOptions || document.getElementById('modal-note-options');
      if (optModal) optModal.classList.remove('active');
      openPhoneConnectModal();
    });
  }

  const optBackupDb = el.optBackupDb || document.getElementById('opt-backup-db');
  if (optBackupDb) optBackupDb.addEventListener('click', () => {
    const optModal = el.modalNoteOptions || document.getElementById('modal-note-options');
    if (optModal) optModal.classList.remove('active');
    openBackupModal();
  });

  const btnOpenBackupFromSync = el.btnOpenBackupFromSync || document.getElementById('btn-open-backup-from-sync');
  if (btnOpenBackupFromSync) btnOpenBackupFromSync.addEventListener('click', () => {
    const syncModal = el.modalSyncSettings || document.getElementById('modal-sync-settings');
    if (syncModal) syncModal.classList.remove('active');
    openBackupModal();
  });

  const btnCloseBackupModal = el.btnCloseBackupModal || document.getElementById('btn-close-backup-modal');
  if (btnCloseBackupModal) btnCloseBackupModal.addEventListener('click', closeBackupModal);

  const btnExportDb = el.btnExportDb || document.getElementById('btn-export-db');
  if (btnExportDb) btnExportDb.addEventListener('click', exportDatabaseBackup);

  

  const btnImportDbTrigger = el.btnImportDbTrigger || document.getElementById('btn-import-db-trigger');
  if (btnImportDbTrigger) btnImportDbTrigger.addEventListener('click', () => {
    if (window.AndroidSpeechBridge && typeof window.AndroidSpeechBridge.openNativeFilePicker === 'function') {
      window.AndroidSpeechBridge.openNativeFilePicker();
    } else {
      const fileInput = el.inputDbFile || document.getElementById('db-file-input');
      if (fileInput) fileInput.click();
    }
  });

  const inputDbFile = el.inputDbFile || document.getElementById('db-file-input');
  if (inputDbFile) inputDbFile.addEventListener('change', handleDbFileSelected);

  const btnRestoreReplace = el.btnRestoreReplace || document.getElementById('btn-restore-replace');
  if (btnRestoreReplace) btnRestoreReplace.addEventListener('click', () => executeRestore('replace'));

  const btnRestoreMerge = el.btnRestoreMerge || document.getElementById('btn-restore-merge');
  if (btnRestoreMerge) btnRestoreMerge.addEventListener('click', () => executeRestore('merge'));

  const btnRestoreCancel = el.btnRestoreCancel || document.getElementById('btn-restore-cancel');
  if (btnRestoreCancel) btnRestoreCancel.addEventListener('click', () => {
    const preview = el.restorePreviewBox || document.getElementById('restore-preview-box');
    if (preview) preview.style.display = 'none';
    pendingBackupData = null;
    const fileInput = el.inputDbFile || document.getElementById('db-file-input');
    if (fileInput) fileInput.value = '';
  });

  if (el.btnShareNote) el.btnShareNote.addEventListener('click', () => {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (!note) return;

    if (navigator.share) {
      navigator.share({
        title: note.title || 'CowNotes',
        text: stripHtml(note.content)
      }).catch(err => console.log('Share canceled'));
    } else {
      navigator.clipboard.writeText(`${note.title}\n\n${stripHtml(note.content)}`);
      showToast('Note copied to clipboard!');
    }
  });

  document.querySelectorAll('.ios-modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
