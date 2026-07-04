/* =========================================================
 * tasks.js — タスク管理ページ
 * window.Tasks として公開。
 * ======================================================= */
(function () {
  "use strict";
  const D = window.Store.Dates;
  let filter = "all";

  function init() {
    // クイック追加
    const input = document.getElementById("quickTaskInput");
    const dateInput = document.getElementById("quickTaskDate");
    const prioInput = document.getElementById("quickTaskPriority");
    const addBtn = document.getElementById("quickTaskAdd");

    function add() {
      const title = input.value.trim();
      if (!title) return;
      window.Store.upsertTask({
        title,
        due: dateInput.value || "",
        priority: prioInput.value,
        done: false,
      });
      input.value = "";
      dateInput.value = "";
      window.App.toast("タスクを追加しました");
      input.focus();
    }
    addBtn.addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

    // フィルタ
    document.querySelectorAll("#taskFilters button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#taskFilters button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        filter = btn.dataset.filter;
        render();
      });
    });

    window.Store.on("tasks", () => { render(); updateBadge(); });
    updateBadge();
  }

  function updateBadge() {
    const badge = document.getElementById("taskBadge");
    const n = window.Store.getTasks().filter((t) => !t.done).length;
    badge.textContent = n;
    badge.dataset.zero = n === 0 ? "true" : "false";
  }

  function matches(t) {
    const todayKey = D.key(D.today());
    if (filter === "active") return !t.done;
    if (filter === "done") return t.done;
    if (filter === "today") return t.due === todayKey;
    return true;
  }

  function render() {
    const list = document.getElementById("taskList");
    let tasks = window.Store.getTasks().filter(matches);
    // 並び順：未完了→完了、期限昇順、優先度
    const prioRank = { high: 0, medium: 1, low: 2 };
    tasks = tasks.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.due || "9999", bd = b.due || "9999";
      if (ad !== bd) return ad.localeCompare(bd);
      return prioRank[a.priority] - prioRank[b.priority];
    });

    if (tasks.length === 0) {
      list.innerHTML = '<li class="empty-state">タスクはありません 🎉</li>';
      return;
    }

    const todayKey = D.key(D.today());
    list.innerHTML = tasks.map((t) => {
      const overdue = t.due && !t.done && t.due < todayKey;
      const dueLabel = t.due ? formatDue(t.due, todayKey) : "";
      return `<li class="task-item ${t.done ? "done" : ""}" data-id="${t.id}">
        <div class="task-check ${t.done ? "done" : ""}" data-act="toggle"></div>
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-sub">
            <span class="prio ${t.priority}">${prioLabel(t.priority)}</span>
            ${dueLabel ? `<span class="${overdue ? "overdue" : ""}">📅 ${dueLabel}</span>` : ""}
          </div>
        </div>
        <button class="task-del" data-act="del" title="削除">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
        </button>
      </li>`;
    }).join("");

    list.querySelectorAll(".task-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector('[data-act="toggle"]').addEventListener("click", () => window.Store.toggleTask(id));
      li.querySelector('[data-act="del"]').addEventListener("click", () => {
        window.Store.deleteTask(id);
        window.App.toast("タスクを削除しました");
      });
    });
  }

  function prioLabel(p) { return { high: "高", medium: "中", low: "低" }[p] || p; }

  function formatDue(due, todayKey) {
    if (due === todayKey) return "今日";
    const tomorrow = D.key(D.addDays(D.today(), 1));
    if (due === tomorrow) return "明日";
    const d = D.fromKey(due);
    return `${d.getMonth() + 1}/${d.getDate()}(${D.weekdaysJa[d.getDay()]})`;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  window.Tasks = { init, render, updateBadge };
})();
