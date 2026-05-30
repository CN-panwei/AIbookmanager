// ===== State =====
let state = {
    categories: [],
    books: [],
    allBooks: [],
    currentCategory: null,
    searchQuery: "",
    currentBook: null,
    notes: [],
    currentNote: null,
    editor: null,
    batchMode: false,
    selectedNoteIds: new Set(),
    prompts: [],
};

// ===== API =====
async function api(url, options = {}) {
    const resp = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

// ===== Toast =====
function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", async () => {
    await loadCategories();
    await loadBooks();
    await loadSettings();
    // Display app version
    try {
        const cfg = await api("/api/config");
        const verEl = document.getElementById("app-version");
        if (verEl && cfg.app_version) {
            verEl.textContent = "v" + cfg.app_version;
        }
    } catch (e) {
        // ignore
    }
    // Heartbeat: keep server alive while page is open
    // Use Page Visibility API to handle background tab throttling
    const sendPing = () => fetch("/api/ping").catch(() => {});
    sendPing(); // immediate ping on load

    let pingInterval = setInterval(sendPing, 20000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            // Page became visible: send immediate ping and restore normal interval
            sendPing();
            if (pingInterval) clearInterval(pingInterval);
            pingInterval = setInterval(sendPing, 20000);
        }
    });
});

// ===== Categories =====
async function loadCategories() {
    state.categories = await api("/api/categories");
    // Ensure allBooks is loaded before rendering category counts
    if (state.allBooks.length === 0) {
        state.allBooks = await api("/api/books");
    }
    renderCategories();
    populateUploadCategories();
}

function getCategoryBookCount(catId) {
    return state.allBooks.filter(b => b.category_id === catId).length;
}

function renderCategories() {
    // Update "All" count (always shows total, not filtered count)
    const allCountEl = document.getElementById("nav-count-all");
    if (allCountEl) allCountEl.textContent = state.allBooks.length;

    const container = document.getElementById("category-list");
    container.innerHTML = state.categories.map(cat => {
        const count = getCategoryBookCount(cat.id);
        return `
            <div class="nav-item ${state.currentCategory === cat.id ? 'active' : ''}"
                 data-category="${cat.id}"
                 onclick="selectCategory(${cat.id})"
                 ondragover="onCategoryDragOver(event, ${cat.id})"
                 ondragleave="onCategoryDragLeave(event, ${cat.id})"
                 ondrop="onCategoryDrop(event, ${cat.id})">
                <img src="/static/icon/folder.svg" class="nav-icon" alt="">
                <span class="nav-label">${escapeHtml(cat.name)}</span>
                <span class="nav-count">${count}</span>
                <span class="nav-actions" onclick="event.stopPropagation()">
                    <button class="nav-action-btn" onclick="showEditCategoryModal(${cat.id})" title="编辑">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="nav-action-btn delete" onclick="deleteCategory(${cat.id})" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </span>
            </div>
        `;
    }).join("");
}

function selectCategory(catId) {
    state.currentCategory = catId;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    const selector = catId === null ? '[data-category="all"]' : `[data-category="${catId}"]`;
    const active = document.querySelector(selector);
    if (active) active.classList.add("active");

    const title = catId === null ? "全部图书" : state.categories.find(c => c.id === catId)?.name || "图书";
    document.getElementById("section-title").textContent = title;
    loadBooks();
}

// ===== Drag & Drop: Move book to category =====
let _draggingBookId = null;

function onBookDragStart(ev, bookId) {
    _draggingBookId = bookId;
    ev.dataTransfer.effectAllowed = "move";
    ev.target.classList.add("dragging");
    document.querySelector(".sidebar").classList.add("drag-active");
}

function onBookDragEnd(ev) {
    _draggingBookId = null;
    ev.target.classList.remove("dragging");
    document.querySelector(".sidebar").classList.remove("drag-active");
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("drag-over"));
}

function onCategoryDragOver(ev, catId) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    const el = ev.currentTarget;
    if (!el.classList.contains("drag-over")) {
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("drag-over"));
        el.classList.add("drag-over");
    }
}

function onCategoryDragLeave(ev, catId) {
    ev.currentTarget.classList.remove("drag-over");
}

async function onCategoryDrop(ev, catId) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drag-over");
    document.querySelector(".sidebar").classList.remove("drag-active");
    if (!_draggingBookId) return;

    const bookId = _draggingBookId;
    const book = state.books.find(b => b.id === bookId);
    if (!book) return;

    // If dropped on same category, do nothing
    if (book.category_id === catId) return;

    const cat = state.categories.find(c => c.id === catId);
    const catName = cat ? cat.name : "新分类";

    try {
        const formData = new FormData();
        formData.append("category_id", catId);
        const resp = await fetch(`/api/books/${bookId}/category`, {
            method: "PUT",
            body: formData,
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || "移动失败");
        }
        showToast(`已移动到「${catName}」`, "success");
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function handleCategoryModal() {
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return showToast("请输入分类名称", "error");
    const editId = document.getElementById("edit-category-id").value;
    try {
        if (editId) {
            // Edit mode
            await api(`/api/categories/${editId}`, {
                method: "PUT",
                body: JSON.stringify({ name }),
            });
            showToast("分类修改成功", "success");
        } else {
            // Create mode
            await api("/api/categories", {
                method: "POST",
                body: JSON.stringify({ name }),
            });
            showToast("分类创建成功", "success");
        }
        closeCategoryModal();
        await loadCategories();
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function deleteCategory(catId) {
    const cat = state.categories.find(c => c.id === catId);
    if (!cat) return;
    const count = getCategoryBookCount(catId);
    if (count > 0) {
        return showToast("该分类下还有图书，请先移走图书再删除", "error");
    }
    if (!confirm(`确定要删除分类「${cat.name}」吗？`)) return;
    try {
        await api(`/api/categories/${catId}`, { method: "DELETE" });
        showToast("分类已删除", "success");
        if (state.currentCategory === catId) {
            state.currentCategory = null;
            document.getElementById("section-title").textContent = "全部图书";
        }
        await loadCategories();
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ===== Books =====
async function loadBooks() {
    // Always fetch all books first (for category counts)
    state.allBooks = await api("/api/books");
    // Then fetch filtered books for display
    const url = new URL("/api/books", location.origin);
    if (state.currentCategory) url.searchParams.set("category_id", state.currentCategory);
    if (state.searchQuery) url.searchParams.set("search", state.searchQuery);
    state.books = await api(url.toString());
    renderBooks();
    renderCategories(); // refresh category counts
}

function renderBooks() {
    const grid = document.getElementById("book-grid");
    document.getElementById("book-count").textContent = `${state.books.length} 本`;

    if (state.books.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <p><img src="/static/icon/folder-open.svg" class="icon-svg large" alt="" style="opacity:0.4;"></p>
                <p>暂无图书，点击右上角上传按钮上传</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = state.books.map(book => `
        <div class="book-card" draggable="true"
             ondragstart="onBookDragStart(event, ${book.id})"
             ondragend="onBookDragEnd(event)"
             onclick="openBookDetail(${book.id})">
            <img class="book-cover" src="/static/${book.cover_path || 'covers/default.jpg'}" alt="${escapeHtml(book.title)}">
            <div class="book-info">
                <div class="book-title">${escapeHtml(book.title)}</div>
                <div class="book-author">${escapeHtml(book.author || "未知作者")}</div>
            </div>
            <div class="book-meta-hover">
                <span>${book.file_format?.toUpperCase()}</span>
                <span>${formatSize(book.file_size)}</span>
            </div>
        </div>
    `).join("");
}

function handleSearch() {
    state.searchQuery = document.getElementById("search-input").value.trim();
    loadBooks();
}

async function openBookDetail(bookId) {
    state.currentBook = await api(`/api/books/${bookId}`);
    state.notes = await api(`/api/books/${bookId}/notes`);
    state.batchMode = false;
    state.selectedNoteIds.clear();
    renderBookDetail();
    renderNotesHeader();
    renderNotesList();
    document.getElementById("book-modal").classList.add("active");
}

function renderBookDetail() {
    const book = state.currentBook;
    if (!book) return;
    const coverImg = document.getElementById("detail-cover");
    coverImg.src = `/static/${book.cover_path || 'covers/default.jpg'}`;
    coverImg.title = "点击用系统程序打开书籍";
    coverImg.onclick = async () => {
        try {
            await api(`/api/books/${book.id}/open`, { method: "POST" });
        } catch (e) {
            showToast(e.message, "error");
        }
    };
    document.getElementById("detail-title").textContent = book.title;
    document.getElementById("detail-author").textContent = book.author || "未知作者";
    document.getElementById("detail-format").textContent = book.file_format?.toUpperCase() || "";
    document.getElementById("detail-pages").textContent = book.page_count ? `${book.page_count} 页` : "";
    document.getElementById("detail-desc").textContent = book.description || "暂无简介，点击「生成简介」按钮使用 AI 生成。";
}

function renderNotesHeader() {
    const header = document.getElementById("notes-header");
    if (state.batchMode) {
        header.innerHTML = `
            <h4><img src="/static/icon/note.svg" class="icon-svg title" alt="">笔记 <span style="font-size:12px;color:var(--text-light);font-weight:400;">(已选 ${state.selectedNoteIds.size} 条)</span></h4>
            <div class="notes-header-actions">
                <button class="btn-small" style="background:#e0f2fe;color:#0284c7;" onclick="batchExportNotes()">导出选中</button>
                <button class="btn-small" style="background:#fee2e2;color:#ef4444;" onclick="batchDeleteNotes()">删除选中</button>
                <button class="btn-small" onclick="toggleBatchMode()">取消</button>
            </div>
        `;
    } else {
        header.innerHTML = `
            <h4><img src="/static/icon/note.svg" class="icon-svg title" alt="">笔记</h4>
            <div class="notes-header-actions">
                <button class="btn-small" onclick="toggleBatchMode()">批量管理</button>
                <button class="btn-small" onclick="showNoteEditor()">+ 新建笔记</button>
            </div>
        `;
    }
}

function renderNotesList() {
    const container = document.getElementById("notes-list");
    if (state.notes.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>暂无笔记</p></div>`;
        return;
    }
    container.innerHTML = state.notes.map(note => {
        const checked = state.selectedNoteIds.has(note.id) ? 'checked' : '';
        const checkbox = state.batchMode
            ? `<input type="checkbox" class="note-checkbox" ${checked} onchange="toggleNoteSelection(${note.id})" onclick="event.stopPropagation()">`
            : '';
        const deleteBtn = !state.batchMode
            ? `<button class="note-delete-btn" onclick="event.stopPropagation(); deleteNote(${note.id})"><img src="/static/icon/trash.svg" style="width:14px;height:14px;vertical-align:middle;opacity:0.6;" alt=""></button>`
            : '';
        const clickAction = state.batchMode ? '' : `onclick="editNote(${note.id})"`;
        return `
            <div class="note-item" ${clickAction}>
                ${checkbox}
                <div style="flex:1;">
                    <div class="note-item-header">
                        <span class="note-item-title">${escapeHtml(note.title)}</span>
                        <div class="note-item-actions">
                            ${note.is_ai_generated ? '<span class="note-item-badge">AI</span>' : ''}
                            ${deleteBtn}
                        </div>
                    </div>
                    <div class="note-item-preview">${stripMarkdown(note.content || "")}</div>
                </div>
            </div>
        `;
    }).join("");
}

async function generateSummary() {
    if (!state.currentBook) return;
    const btn = event.target;
    const original = btn.textContent;
    btn.textContent = "⏳ 生成中...";
    btn.disabled = true;
    try {
        const result = await api(`/api/books/${state.currentBook.id}/summary`, { method: "POST" });
        document.getElementById("detail-desc").textContent = result.summary;
        showToast("简介生成成功", "success");
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.textContent = original;
        btn.disabled = false;
    }
}

async function deleteBook() {
    if (!state.currentBook) return;
    if (!confirm(`确定要删除《${state.currentBook.title}》吗？同时删除原文件？`)) return;
    try {
        await api(`/api/books/${state.currentBook.id}?delete_file=true`, { method: "DELETE" });
        showToast("图书已删除", "success");
        closeBookModal();
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ===== Upload =====
let pendingUploadFiles = [];

function showUploadModal() {
    populateUploadCategories();
    pendingUploadFiles = [];
    renderUploadFileList();
    resetUploadUI();
    document.getElementById("upload-modal").classList.add("active");
}

function closeUploadModal() {
    document.getElementById("upload-modal").classList.remove("active");
    document.getElementById("upload-file").value = "";
    pendingUploadFiles = [];
    renderUploadFileList();
    resetUploadUI();
}

function resetUploadUI() {
    document.getElementById("upload-progress").style.display = "none";
    document.getElementById("upload-result").style.display = "none";
    document.getElementById("upload-result").className = "upload-result";
    document.getElementById("upload-btn").disabled = false;
    document.getElementById("upload-btn").textContent = "上传";
}

function populateUploadCategories() {
    const select = document.getElementById("upload-category");
    select.innerHTML = state.categories.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
}

function onFilesSelected() {
    const input = document.getElementById("upload-file");
    addFilesToPending(input.files);
    input.value = "";
}

function addFilesToPending(fileList) {
    for (const file of fileList) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf' || ext === 'epub') {
            // avoid duplicates by name+size
            const exists = pendingUploadFiles.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
                pendingUploadFiles.push(file);
            }
        }
    }
    renderUploadFileList();
}

function renderUploadFileList() {
    const container = document.getElementById("upload-file-list");
    if (!container) return;
    if (pendingUploadFiles.length === 0) {
        container.innerHTML = "";
        document.getElementById("upload-btn").textContent = "上传";
        return;
    }
    container.innerHTML = pendingUploadFiles.map((file, idx) => {
        const ext = file.name.split('.').pop().toUpperCase();
        return `
            <div class="upload-file-item">
                <span class="file-name">${escapeHtml(file.name)}</span>
                <span class="file-meta">${ext} · ${formatSize(file.size)}</span>
                <button class="file-remove" onclick="removeUploadFile(${idx})" title="移除">×</button>
            </div>
        `;
    }).join("");
    document.getElementById("upload-btn").textContent = `上传 (${pendingUploadFiles.length})`;
}

function removeUploadFile(index) {
    pendingUploadFiles.splice(index, 1);
    renderUploadFileList();
}

function handleDrop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("active");
    if (ev.dataTransfer.files.length > 0) {
        addFilesToPending(ev.dataTransfer.files);
    }
}

function findDuplicateFiles(files) {
    const duplicates = [];
    const newFiles = [];
    for (const file of files) {
        const stem = file.name.replace(/\.[^/.]+$/, "").trim();
        const isDup = state.books.some(b => {
            const bookFileName = b.file_path ? b.file_path.split('/').pop().replace(/\.[^/.]+$/, "").trim() : "";
            const bookTitle = (b.title || "").trim();
            return bookFileName === stem || bookTitle === stem;
        });
        if (isDup) {
            duplicates.push(file);
        } else {
            newFiles.push(file);
        }
    }
    return { duplicates, newFiles };
}

async function uploadBooks() {
    const categoryId = document.getElementById("upload-category").value;
    if (pendingUploadFiles.length === 0) return showToast("请选择文件", "error");

    // Check duplicates — not allowed to upload duplicates
    const { duplicates, newFiles } = findDuplicateFiles(pendingUploadFiles);
    if (duplicates.length > 0) {
        const dupNames = duplicates.map(f => f.name).join("\n");
        const ok = confirm(`检测到 ${duplicates.length} 本图书已存在：\n\n${dupNames}\n\n点击「确定」跳过重复文件只上传新书，点击「取消」取消本次上传。`);
        if (!ok) {
            return; // Cancel entire upload
        }
        // Skip duplicates, only upload new files
        pendingUploadFiles = newFiles;
        renderUploadFileList();
        if (pendingUploadFiles.length === 0) {
            return showToast("没有新文件需要上传", "info");
        }
    }

    const btn = document.getElementById("upload-btn");
    btn.disabled = true;
    btn.textContent = "上传中...";

    const progressEl = document.getElementById("upload-progress");
    const progressFill = document.getElementById("progress-fill");
    const progressText = document.getElementById("progress-text");
    const resultEl = document.getElementById("upload-result");

    progressEl.style.display = "block";
    resultEl.style.display = "none";

    let successCount = 0;
    let failCount = 0;
    const failedNames = [];

    for (let i = 0; i < pendingUploadFiles.length; i++) {
        const file = pendingUploadFiles[i];
        const pct = Math.round(((i) / pendingUploadFiles.length) * 100);
        progressFill.style.width = pct + "%";
        progressText.textContent = `正在上传第 ${i + 1}/${pendingUploadFiles.length} 个：${file.name}`;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("category_id", categoryId);

        try {
            const resp = await fetch("/api/books/upload", {
                method: "POST",
                body: formData,
            });
            if (resp.ok) {
                successCount++;
            } else {
                const err = await resp.json().catch(() => ({}));
                failCount++;
                let errMsg = "";
                if (err.detail) {
                    errMsg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
                } else if (err.message) {
                    errMsg = err.message;
                } else {
                    errMsg = `HTTP ${resp.status}`;
                }
                failedNames.push(file.name + (errMsg ? ` (${errMsg})` : ""));
            }
        } catch (e) {
            failCount++;
            failedNames.push(file.name + " (网络错误)");
        }
    }

    progressFill.style.width = "100%";
    progressText.textContent = `上传完成：成功 ${successCount} 个，失败 ${failCount} 个`;

    resultEl.style.display = "block";
    if (failCount === 0) {
        resultEl.className = "upload-result success";
        resultEl.textContent = `✓ 全部上传成功！共 ${successCount} 本图书。`;
    } else if (successCount === 0) {
        resultEl.className = "upload-result error";
        resultEl.textContent = `✗ 全部上传失败。${failedNames.slice(0, 3).join("；")}${failedNames.length > 3 ? " 等" : ""}`;
    } else {
        resultEl.className = "upload-result partial";
        resultEl.textContent = `部分成功：${successCount} 本成功，${failCount} 本失败。${failedNames.slice(0, 2).join("；")}${failedNames.length > 2 ? " 等" : ""}`;
    }

    btn.disabled = false;
    btn.textContent = "上传";

    if (successCount > 0) {
        showToast(`成功上传 ${successCount} 本图书`, "success");
        await loadBooks();
        // Reset to initial state after successful upload
        pendingUploadFiles = [];
        renderUploadFileList();
        resetUploadUI();
    }
}

// ===== Notes & Editor =====
function showNoteEditor(note = null) {
    state.currentNote = note;
    document.getElementById("note-title-input").value = note ? note.title : "";
    document.getElementById("note-modal").classList.add("active");

    if (state.editor) {
        state.editor.destroy();
        state.editor = null;
    }

    // Show loading state while editor initializes
    const container = document.getElementById("editor-container");
    container.innerHTML = '<div class="editor-loading">编辑器加载中...</div>';

    // Wait for modal animation to finish before initializing editor
    // CodeMirror needs the container to be fully visible with final dimensions
    setTimeout(() => {
        container.innerHTML = "";
        state.editor = new toastui.Editor({
            el: container,
            height: "100%",
            initialEditType: "wysiwyg",
            initialValue: note ? (note.content || "") : "",
            placeholder: "在此输入笔记内容...",
            hideModeSwitch: true,
            toolbarItems: [
                ["heading", "bold", "italic", "strike"],
                ["hr", "quote"],
                ["ul", "ol", "task", "indent", "outdent"],
                ["table", "image", "link"],
                ["code", "codeblock"],
            ],
            autofocus: false,
        });
        // Add undo/redo buttons to toolbar
        setTimeout(() => {
            addUndoRedoButtons();
        }, 100);

        // Explicitly focus the editor after initialization
        setTimeout(() => {
            if (state.editor) state.editor.focus();
        }, 100);
    }, 350);
}

function addUndoRedoButtons() {
    if (!state.editor) return;
    const toolbar = document.querySelector('#editor-container .toastui-editor-toolbar');
    if (!toolbar) return;

    // Check if already added
    if (toolbar.querySelector('.custom-undo')) return;

    const firstGroup = toolbar.querySelector('.toastui-editor-toolbar-group');
    if (!firstGroup) return;

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'toastui-editor-toolbar-icons custom-undo';
    undoBtn.title = '撤销 (Ctrl+Z / Cmd+Z)';
    undoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 13"/></svg>';
    undoBtn.style.cssText = 'background-image:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;';
    undoBtn.onclick = (e) => { e.preventDefault(); editorUndo(); };

    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.className = 'toastui-editor-toolbar-icons custom-redo';
    redoBtn.title = '重做 (Ctrl+Shift+Z / Cmd+Shift+Z)';
    redoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 13"/></svg>';
    redoBtn.style.cssText = 'background-image:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;';
    redoBtn.onclick = (e) => { e.preventDefault(); editorRedo(); };

    firstGroup.insertBefore(redoBtn, firstGroup.firstChild);
    firstGroup.insertBefore(undoBtn, firstGroup.firstChild);
}

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function editorUndo() {
    if (!state.editor) return;
    const pmEl = document.querySelector('.toastui-editor-ww-container .ProseMirror');
    if (pmEl) {
        pmEl.focus();
        const opts = { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true };
        if (isMac) opts.metaKey = true;
        else opts.ctrlKey = true;
        pmEl.dispatchEvent(new KeyboardEvent('keydown', opts));
    }
}

function editorRedo() {
    if (!state.editor) return;
    const pmEl = document.querySelector('.toastui-editor-ww-container .ProseMirror');
    if (pmEl) {
        pmEl.focus();
        const opts = { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true, shiftKey: true };
        if (isMac) opts.metaKey = true;
        else opts.ctrlKey = true;
        pmEl.dispatchEvent(new KeyboardEvent('keydown', opts));
    }
}

function closeNoteModal() {
    document.getElementById("note-modal").classList.remove("active");
    if (state.editor) {
        state.editor.destroy();
        state.editor = null;
    }
    state.currentNote = null;
}

function editNote(noteId) {
    const note = state.notes.find(n => n.id === noteId);
    if (note) showNoteEditor(note);
}

async function deleteNote(noteId) {
    if (!confirm('确定要删除这条笔记吗？')) return;
    try {
        await api(`/api/notes/${noteId}`, { method: "DELETE" });
        showToast("笔记已删除", "success");
        state.notes = await api(`/api/books/${state.currentBook.id}/notes`);
        renderNotesList();
    } catch (e) {
        showToast(e.message, "error");
    }
}

function toggleBatchMode() {
    state.batchMode = !state.batchMode;
    state.selectedNoteIds.clear();
    renderNotesHeader();
    renderNotesList();
}

function toggleNoteSelection(noteId) {
    if (state.selectedNoteIds.has(noteId)) {
        state.selectedNoteIds.delete(noteId);
    } else {
        state.selectedNoteIds.add(noteId);
    }
    renderNotesHeader();
}

async function batchDeleteNotes() {
    if (state.selectedNoteIds.size === 0) {
        showToast("请先选择要删除的笔记", "error");
        return;
    }
    if (!confirm(`确定要删除选中的 ${state.selectedNoteIds.size} 条笔记吗？`)) return;

    const promises = Array.from(state.selectedNoteIds).map(id =>
        api(`/api/notes/${id}`, { method: "DELETE" })
    );
    try {
        await Promise.all(promises);
        showToast(`已删除 ${state.selectedNoteIds.size} 条笔记`, "success");
        state.batchMode = false;
        state.selectedNoteIds.clear();
        state.notes = await api(`/api/books/${state.currentBook.id}/notes`);
        renderNotesHeader();
        renderNotesList();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function batchExportNotes() {
    if (state.selectedNoteIds.size === 0) {
        showToast("请先选择要导出的笔记", "error");
        return;
    }

    const noteIds = Array.from(state.selectedNoteIds);
    try {
        const resp = await fetch("/api/notes/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note_ids: noteIds }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || "导出失败");
        }
        // Trigger download
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `notes_export_${new Date().toISOString().slice(0,10)}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast(`已导出 ${noteIds.length} 条笔记`, "success");
        state.batchMode = false;
        state.selectedNoteIds.clear();
        renderNotesHeader();
        renderNotesList();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function saveNote() {
    const title = document.getElementById("note-title-input").value.trim();
    const content = state.editor ? state.editor.getMarkdown() : "";
    if (!title) return showToast("请输入笔记标题", "error");

    try {
        if (state.currentNote) {
            await api(`/api/notes/${state.currentNote.id}`, {
                method: "PUT",
                body: JSON.stringify({ title, content }),
            });
            showToast("笔记已保存", "success");
        } else {
            await api("/api/notes", {
                method: "POST",
                body: JSON.stringify({
                    book_id: state.currentBook.id,
                    title,
                    content,
                }),
            });
            showToast("笔记已创建", "success");
        }
        state.notes = await api(`/api/books/${state.currentBook.id}/notes`);
        renderNotesList();
        closeNoteModal();
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ===== AI Generate =====
async function loadAIPrompts() {
    const cfg = await api("/api/config");
    state.prompts = cfg.ai_prompts || [];
}

function showAIPrompt() {
    loadAIPrompts().then(() => {
        const select = document.getElementById("ai-prompt-select");
        select.innerHTML = '<option value="">-- 自定义提示词 --</option>';
        state.prompts.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
        document.getElementById("ai-modal").classList.add("active");
    });
}

function onPromptSelect() {
    const select = document.getElementById("ai-prompt-select");
    const id = select.value;
    const input = document.getElementById("ai-prompt-input");
    if (!id) {
        input.value = "";
        return;
    }
    const prompt = state.prompts.find((p) => p.id === id);
    if (prompt) {
        input.value = prompt.content;
    }
}

function closeAIModal() {
    document.getElementById("ai-modal").classList.remove("active");
    document.getElementById("ai-prompt-input").value = "";
    document.getElementById("ai-prompt-select").value = "";
}

async function generateNote() {
    const prompt = document.getElementById("ai-prompt-input").value.trim();
    if (!prompt) return showToast("请输入提示词", "error");

    closeAIModal();
    const btn = document.querySelector(".btn-ai");
    const original = btn.textContent;
    btn.textContent = "⏳ 生成中...";
    btn.disabled = true;

    try {
        const note = await api("/api/notes/ai-generate", {
            method: "POST",
            body: JSON.stringify({
                book_id: state.currentBook.id,
                prompt,
            }),
        });
        showToast("AI 笔记生成成功", "success");
        state.notes = await api(`/api/books/${state.currentBook.id}/notes`);
        renderNotesList();
        // Open the generated note for editing
        editNote(note.id);
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.textContent = original;
        btn.disabled = false;
    }
}

// ===== Settings =====
async function loadSettings() {
    const cfg = await api("/api/config");
    document.getElementById("setting-base-url").value = cfg.deepseek_base_url || "";
    document.getElementById("setting-model").value = cfg.deepseek_model || "";
    const apiKeyInput = document.getElementById("setting-api-key");
    if (cfg.deepseek_api_key_set && cfg.deepseek_api_key) {
        apiKeyInput.value = cfg.deepseek_api_key;
        apiKeyInput.dataset.masked = "true";
    } else {
        apiKeyInput.value = "";
        apiKeyInput.dataset.masked = "false";
    }
    // Load prompts
    state.prompts = cfg.ai_prompts || [];
    renderPromptsList();
    // clear previous test result
    const resultEl = document.getElementById("test-result");
    resultEl.classList.remove("visible", "success", "error");
    resultEl.innerHTML = "";
}

function showSettingsModal() {
    loadSettings();
    switchSettingsTab("api");
    document.getElementById("settings-modal").classList.add("active");
}

function closeSettingsModal() {
    document.getElementById("settings-modal").classList.remove("active");
}

function switchSettingsTab(tab) {
    // Update tab styles
    document.querySelectorAll(".settings-tab").forEach((el) => {
        el.classList.toggle("active", el.dataset.tab === tab);
    });
    // Update panel visibility
    document.querySelectorAll(".settings-panel").forEach((el) => {
        el.classList.toggle("active", el.id === "tab-" + tab);
    });
}

async function saveSettings(silent) {
    const apiKeyInput = document.getElementById("setting-api-key");
    const isMasked = apiKeyInput.dataset.masked === "true";
    const apiKey = isMasked ? "" : apiKeyInput.value.trim();
    const baseUrl = document.getElementById("setting-base-url").value.trim();
    const model = document.getElementById("setting-model").value.trim();

    const payload = {};
    if (apiKey) payload.deepseek_api_key = apiKey;
    if (baseUrl) payload.deepseek_base_url = baseUrl;
    if (model) payload.deepseek_model = model;

    // Collect prompts from DOM
    const promptItems = document.querySelectorAll("#prompts-list .prompt-item");
    const prompts = [];
    promptItems.forEach((item) => {
        const id = item.dataset.id;
        const name = item.querySelector(".prompt-name").value.trim();
        const content = item.querySelector("textarea.prompt-content").value.trim();
        if (name && content) {
            prompts.push({ id, name, content });
        }
    });
    payload.ai_prompts = prompts;

    // If nothing changed at all
    if (Object.keys(payload).length === 1 && payload.ai_prompts.length === 0 && !apiKey && !baseUrl && !model) {
        if (!silent) {
            showToast("没有需要保存的更改", "info");
        }
        return;
    }

    try {
        const cfg = await api("/api/config", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        // Update input to show masked key after save
        if (cfg.deepseek_api_key_set && cfg.deepseek_api_key) {
            apiKeyInput.value = cfg.deepseek_api_key;
            apiKeyInput.dataset.masked = "true";
        }
        state.prompts = cfg.ai_prompts || [];
        if (!silent) {
            showToast("设置已保存", "success");
            closeSettingsModal();
        }
    } catch (e) {
        if (!silent) {
            showToast(e.message, "error");
        }
        throw e;
    }
}

function renderPromptsList() {
    const container = document.getElementById("prompts-list");
    if (!container) return;
    container.innerHTML = "";
    state.prompts.forEach((p) => {
        const div = document.createElement("div");
        div.className = "prompt-item";
        div.dataset.id = p.id;
        div.innerHTML = `
            <div class="prompt-item-header">
                <input type="text" class="prompt-name" value="${escapeHtml(p.name)}" placeholder="提示词名称" onchange="updatePrompt('${p.id}', 'name', this.value)">
                <div class="prompt-actions">
                    <button onclick="deletePrompt('${p.id}')" title="删除">删除</button>
                </div>
            </div>
            <textarea class="prompt-content" placeholder="在此输入提示词正文..." onchange="updatePrompt('${p.id}', 'content', this.value)">${escapeHtml(p.content)}</textarea>
        `;
        container.appendChild(div);
    });
}

function addNewPrompt() {
    const id = Date.now().toString();
    state.prompts.push({ id, name: "", content: "" });
    renderPromptsList();
    // Focus the new name input
    const items = document.querySelectorAll("#prompts-list .prompt-item");
    if (items.length > 0) {
        const last = items[items.length - 1];
        const nameInput = last.querySelector(".prompt-name");
        if (nameInput) nameInput.focus();
    }
}

function deletePrompt(id) {
    state.prompts = state.prompts.filter((p) => p.id !== id);
    renderPromptsList();
}

function updatePrompt(id, field, value) {
    const p = state.prompts.find((x) => x.id === id);
    if (p) {
        p[field] = value;
    }
}

function showTestResult(result) {
    const el = document.getElementById("test-result");
    el.classList.remove("success", "error", "visible");
    if (result.valid) {
        el.classList.add("success", "visible");
        el.innerHTML = '✓ ' + (result.message || "连接成功");
    } else {
        el.classList.add("error", "visible");
        el.innerHTML = '✗ ' + (result.message || "连接失败");
    }
}

async function testAPIKey() {
    const btn = event.target;
    const original = btn.textContent;
    btn.textContent = "测试中...";
    btn.disabled = true;
    try {
        // If user typed a new key (not masked), save it first
        const apiKeyInput = document.getElementById("setting-api-key");
        if (apiKeyInput.dataset.masked !== "true" && apiKeyInput.value.trim()) {
            await saveSettings(true); // silent save
        }
        const result = await api("/api/config/test", { method: "POST" });
        showTestResult(result);
    } catch (e) {
        showTestResult({ valid: false, message: "测试失败: " + e.message });
    } finally {
        btn.textContent = original;
        btn.disabled = false;
    }
}

// ===== Modal Helpers =====
function closeBookModal() {
    document.getElementById("book-modal").classList.remove("active");
    state.currentBook = null;
    state.notes = [];
}

function showNewCategoryModal() {
    document.getElementById("category-modal-title").innerHTML = '<img src="/static/icon/folder.svg" class="icon-svg title" alt="">新建分类';
    document.getElementById("category-modal-btn").textContent = "创建";
    document.getElementById("edit-category-id").value = "";
    document.getElementById("new-category-name").value = "";
    document.getElementById("category-modal").classList.add("active");
}

function showEditCategoryModal(catId) {
    const cat = state.categories.find(c => c.id === catId);
    if (!cat) return;
    document.getElementById("category-modal-title").innerHTML = '<img src="/static/icon/folder.svg" class="icon-svg title" alt="">编辑分类';
    document.getElementById("category-modal-btn").textContent = "保存";
    document.getElementById("edit-category-id").value = catId;
    document.getElementById("new-category-name").value = cat.name;
    document.getElementById("category-modal").classList.add("active");
}

function closeCategoryModal() {
    document.getElementById("category-modal").classList.remove("active");
    document.getElementById("edit-category-id").value = "";
    document.getElementById("new-category-name").value = "";
}

// ===== Utils =====
function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatSize(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function stripMarkdown(md) {
    if (!md) return "";
    return md
        .replace(/#{1,6}\s/g, "")
        .replace(/\*\*|__/g, "")
        .replace(/\*|_/g, "")
        .replace(/`{1,3}[^`]*`{1,3}/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
        .replace(/\n/g, " ")
        .substring(0, 120);
}
