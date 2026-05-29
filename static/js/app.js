// ===== State =====
let state = {
    categories: [],
    books: [],
    currentCategory: null,
    searchQuery: "",
    currentBook: null,
    notes: [],
    currentNote: null,
    editor: null,
    batchMode: false,
    selectedNoteIds: new Set(),
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
});

// ===== Categories =====
async function loadCategories() {
    state.categories = await api("/api/categories");
    renderCategories();
    populateUploadCategories();
}

function renderCategories() {
    const container = document.getElementById("category-list");
    container.innerHTML = state.categories.map(cat => `
        <div class="nav-item ${state.currentCategory === cat.id ? 'active' : ''}"
             data-category="${cat.id}"
             onclick="selectCategory(${cat.id})">
            <span class="nav-icon">📁</span>
            <span class="nav-label">${escapeHtml(cat.name)}</span>
        </div>
    `).join("");
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

async function createCategory() {
    const name = document.getElementById("new-category-name").value.trim();
    if (!name) return showToast("请输入分类名称", "error");
    try {
        await api("/api/categories", {
            method: "POST",
            body: JSON.stringify({ name }),
        });
        showToast("分类创建成功", "success");
        closeCategoryModal();
        document.getElementById("new-category-name").value = "";
        await loadCategories();
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ===== Books =====
async function loadBooks() {
    const url = new URL("/api/books", location.origin);
    if (state.currentCategory) url.searchParams.set("category_id", state.currentCategory);
    if (state.searchQuery) url.searchParams.set("search", state.searchQuery);
    state.books = await api(url.toString());
    renderBooks();
}

function renderBooks() {
    const grid = document.getElementById("book-grid");
    document.getElementById("book-count").textContent = `${state.books.length} 本`;

    if (state.books.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <p style="font-size: 32px;">📚</p>
                <p>暂无图书，点击右上角 📤 上传</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = state.books.map(book => `
        <div class="book-card" onclick="openBookDetail(${book.id})">
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
    document.getElementById("detail-cover").src = `/static/${book.cover_path || 'covers/default.jpg'}`;
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
            <h4>📝 笔记 <span style="font-size:12px;color:var(--text-light);font-weight:400;">(已选 ${state.selectedNoteIds.size} 条)</span></h4>
            <div class="notes-header-actions">
                <button class="btn-small" style="background:#fee2e2;color:#ef4444;" onclick="batchDeleteNotes()">删除选中</button>
                <button class="btn-small" onclick="toggleBatchMode()">取消</button>
            </div>
        `;
    } else {
        header.innerHTML = `
            <h4>📝 笔记</h4>
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
            ? `<button class="note-delete-btn" onclick="event.stopPropagation(); deleteNote(${note.id})">🗑️</button>`
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
function showUploadModal() {
    populateUploadCategories();
    document.getElementById("upload-modal").classList.add("active");
}

function closeUploadModal() {
    document.getElementById("upload-modal").classList.remove("active");
    document.getElementById("upload-file").value = "";
}

function populateUploadCategories() {
    const select = document.getElementById("upload-category");
    select.innerHTML = state.categories.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
}

function handleDrop(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("active");
    const files = ev.dataTransfer.files;
    if (files.length > 0) {
        document.getElementById("upload-file").files = files;
    }
}

async function uploadBook() {
    const fileInput = document.getElementById("upload-file");
    const categoryId = document.getElementById("upload-category").value;
    if (!fileInput.files.length) return showToast("请选择文件", "error");

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("category_id", categoryId);

    try {
        const resp = await fetch("/api/books/upload", {
            method: "POST",
            body: formData,
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || "上传失败");
        }
        showToast("上传成功", "success");
        closeUploadModal();
        await loadBooks();
    } catch (e) {
        showToast(e.message, "error");
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
function showAIPrompt() {
    document.getElementById("ai-modal").classList.add("active");
}

function closeAIModal() {
    document.getElementById("ai-modal").classList.remove("active");
    document.getElementById("ai-prompt-input").value = "";
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
}

function showSettingsModal() {
    document.getElementById("settings-modal").classList.add("active");
}

function closeSettingsModal() {
    document.getElementById("settings-modal").classList.remove("active");
}

async function saveSettings() {
    const apiKey = document.getElementById("setting-api-key").value.trim();
    const baseUrl = document.getElementById("setting-base-url").value.trim();
    const model = document.getElementById("setting-model").value.trim();

    const payload = {};
    if (apiKey) payload.deepseek_api_key = apiKey;
    if (baseUrl) payload.deepseek_base_url = baseUrl;
    if (model) payload.deepseek_model = model;

    try {
        await api("/api/config", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        showToast("设置已保存", "success");
        closeSettingsModal();
        document.getElementById("setting-api-key").value = "";
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function testAPIKey() {
    const btn = event.target;
    const original = btn.textContent;
    btn.textContent = "测试中...";
    btn.disabled = true;
    try {
        // Save first to test
        await saveSettings();
        const result = await api("/api/config/test", { method: "POST" });
        showToast(result.valid ? "API 连接成功" : "API 连接失败，请检查 Key", result.valid ? "success" : "error");
    } catch (e) {
        showToast("测试失败: " + e.message, "error");
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
    document.getElementById("category-modal").classList.add("active");
}

function closeCategoryModal() {
    document.getElementById("category-modal").classList.remove("active");
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
