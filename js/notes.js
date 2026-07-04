/* =========================================================
 * notes.js — 議事録（会議メモ）の作成・編集
 * window.Notes として公開。
 * ======================================================= */
(function () {
  "use strict";
  const D = window.Store.Dates;
  let currentId = null;
  let searchTerm = "";
  let saveTimer = null;

  const el = {};
  function cache() {
    el.list = document.getElementById("noteList");
    el.empty = document.getElementById("noteEmpty");
    el.form = document.getElementById("noteForm");
    el.title = document.getElementById("noteTitle");
    el.datetime = document.getElementById("noteDatetime");
    el.attendees = document.getElementById("noteAttendees");
    el.agenda = document.getElementById("noteAgenda");
    el.body = document.getElementById("noteBody");
    el.actions = document.getElementById("actionItems");
    el.actionInput = document.getElementById("actionInput");
    el.actionOwner = document.getElementById("actionOwner");
    el.actionDue = document.getElementById("actionDue");
    el.saved = document.getElementById("noteSaved");
    el.search = document.getElementById("noteSearch");
  }

  function init() {
    cache();
    document.getElementById("newNoteBtn").addEventListener("click", () => createNew());
    document.getElementById("deleteNoteBtn").addEventListener("click", deleteCurrent);
    document.getElementById("addActionBtn").addEventListener("click", addAction);
    el.actionInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addAction(); });

    // 入力で自動保存
    [el.title, el.datetime, el.attendees, el.agenda, el.body].forEach((input) => {
      input.addEventListener("input", scheduleSave);
    });

    el.search.addEventListener("input", () => { searchTerm = el.search.value.toLowerCase(); renderList(); });

    window.Store.on("notes", () => renderList());
    renderList();
  }

  function scheduleSave() {
    if (!currentId) return;
    clearTimeout(saveTimer);
    el.saved.textContent = "保存中…";
    saveTimer = setTimeout(saveCurrent, 500);
  }

  function saveCurrent() {
    if (!currentId) return;
    const note = window.Store.getNote(currentId);
    if (!note) return;
    note.title = el.title.value.trim();
    note.datetime = el.datetime.value;
    note.attendees = el.attendees.value;
    note.agenda = el.agenda.value;
    note.body = el.body.value;
    window.Store.upsertNote(note);
    el.saved.textContent = "✓ 保存しました " + timeNow();
  }

  function timeNow() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function createNew(prefill) {
    const now = new Date();
    const dt = D.key(now) + "T" + String(now.getHours()).padStart(2, "0") + ":00";
    const note = window.Store.upsertNote({
      title: "",
      datetime: (prefill && prefill.datetime) || dt,
      attendees: "",
      agenda: "",
      body: "",
      actions: [],
    });
    select(note.id);
    el.title.focus();
  }

  function select(id) {
    currentId = id;
    const note = window.Store.getNote(id);
    if (!note) { showEmpty(); return; }
    el.empty.classList.add("hidden");
    el.form.classList.remove("hidden");
    el.title.value = note.title || "";
    el.datetime.value = note.datetime || "";
    el.attendees.value = note.attendees || "";
    el.agenda.value = note.agenda || "";
    el.body.value = note.body || "";
    el.saved.textContent = "";
    renderActions();
    renderList();
  }

  function showEmpty() {
    currentId = null;
    el.empty.classList.remove("hidden");
    el.form.classList.add("hidden");
  }

  function deleteCurrent() {
    if (!currentId) return;
    if (!confirm("この議事録を削除しますか？")) return;
    window.Store.deleteNote(currentId);
    showEmpty();
    window.App.toast("議事録を削除しました");
  }

  /* ---------- アクションアイテム ---------- */
  function addAction() {
    if (!currentId) return;
    const text = el.actionInput.value.trim();
    if (!text) return;
    const note = window.Store.getNote(currentId);
    note.actions = note.actions || [];
    note.actions.push({
      id: window.Store.uid(),
      text,
      owner: el.actionOwner.value.trim(),
      due: el.actionDue.value || "",
      done: false,
      taskId: null,
    });
    window.Store.upsertNote(note);
    el.actionInput.value = "";
    el.actionOwner.value = "";
    el.actionDue.value = "";
    renderActions();
    el.actionInput.focus();
  }

  function renderActions() {
    const note = window.Store.getNote(currentId);
    const actions = (note && note.actions) || [];
    if (actions.length === 0) {
      el.actions.innerHTML = '<div style="font-size:13px;color:var(--text-soft);padding:4px 0;">アクションアイテムはありません。</div>';
      return;
    }
    el.actions.innerHTML = actions.map((a) => `
      <div class="action-item ${a.done ? "done" : ""}" data-id="${a.id}">
        <div class="ai-check ${a.done ? "done" : ""}" data-act="toggle"></div>
        <div class="ai-text">${esc(a.text)}</div>
        ${a.owner ? `<span class="ai-owner">👤 ${esc(a.owner)}</span>` : ""}
        ${a.due ? `<span class="ai-due">📅 ${esc(a.due)}</span>` : ""}
        <button class="ai-totask ${a.taskId ? "added" : ""}" data-act="totask">${a.taskId ? "✓ タスク化済" : "→ タスク化"}</button>
        <button class="ai-del" data-act="del" title="削除">✕</button>
      </div>
    `).join("");

    el.actions.querySelectorAll(".action-item").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-act="toggle"]').addEventListener("click", () => toggleAction(id));
      row.querySelector('[data-act="del"]').addEventListener("click", () => delAction(id));
      row.querySelector('[data-act="totask"]').addEventListener("click", () => actionToTask(id));
    });
  }

  function toggleAction(id) {
    const note = window.Store.getNote(currentId);
    const a = note.actions.find((x) => x.id === id);
    if (a) { a.done = !a.done; window.Store.upsertNote(note); renderActions(); }
  }
  function delAction(id) {
    const note = window.Store.getNote(currentId);
    note.actions = note.actions.filter((x) => x.id !== id);
    window.Store.upsertNote(note);
    renderActions();
  }
  function actionToTask(id) {
    const note = window.Store.getNote(currentId);
    const a = note.actions.find((x) => x.id === id);
    if (!a || a.taskId) return;
    const task = window.Store.upsertTask({
      title: a.text + (note.title ? `（${note.title}）` : ""),
      due: a.due || "",
      priority: "medium",
      done: false,
    });
    a.taskId = task.id;
    window.Store.upsertNote(note);
    renderActions();
    window.App.toast("タスクに追加しました");
  }

  /* ---------- 一覧 ---------- */
  function renderList() {
    let notes = window.Store.getNotes().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (searchTerm) {
      notes = notes.filter((n) =>
        (n.title || "").toLowerCase().includes(searchTerm) ||
        (n.body || "").toLowerCase().includes(searchTerm) ||
        (n.attendees || "").toLowerCase().includes(searchTerm)
      );
    }
    if (notes.length === 0) {
      el.list.innerHTML = '<li class="empty-state" style="padding:30px 16px;font-size:13px;">議事録がありません</li>';
      return;
    }
    el.list.innerHTML = notes.map((n) => {
      const dt = n.datetime ? formatDt(n.datetime) : "日時未設定";
      return `<li class="note-list-item ${n.id === currentId ? "active" : ""}" data-id="${n.id}">
        <div class="nli-title">${esc(n.title || "（無題）")}</div>
        <div class="nli-meta">${dt}${n.attendees ? " ・ " + esc(n.attendees) : ""}</div>
      </li>`;
    }).join("");
    el.list.querySelectorAll(".note-list-item").forEach((li) => {
      li.addEventListener("click", () => select(li.dataset.id));
    });
  }

  function formatDt(s) {
    const d = new Date(s);
    if (isNaN(d)) return s;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 外部（作成メニュー等）から新規作成→表示
  function openNew(prefill) { createNew(prefill); }

  window.Notes = { init, select, openNew, renderList };
})();
