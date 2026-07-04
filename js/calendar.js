/* =========================================================
 * calendar.js — 月 / 週 / 日ビューの描画 + ドラッグ移動
 * window.Calendar として公開。App から render() を呼びます。
 * ======================================================= */
(function () {
  "use strict";
  const D = window.Store.Dates;

  // App から渡されるコールバック
  let hooks = {
    openEvent: function () {},   // (instanceDateKey, masterEventOrNull, timeHint)
    onDateSelect: function () {},// (Date)
    onDrop: function () {},      // ({masterId, instanceDate, newDate, newStart?, newEnd?})
    onSwipe: function () {},     // (dir: -1 前へ / +1 次へ)
  };
  function setHooks(h) { hooks = Object.assign(hooks, h); }

  function showTasks() { return document.getElementById("showTasksOnCal").checked; }
  function showNotes() { return document.getElementById("showNotesOnCal").checked; }

  function extrasForDate(dateKey) {
    const items = [];
    if (showTasks()) {
      window.Store.getTasks().filter((t) => t.due === dateKey).forEach((t) => {
        items.push({ type: "task", id: t.id, title: t.title, done: t.done });
      });
    }
    if (showNotes()) {
      window.Store.getNotes().filter((n) => (n.datetime || "").slice(0, 10) === dateKey).forEach((n) => {
        items.push({ type: "note", id: n.id, title: n.title || "（無題の議事録）" });
      });
    }
    return items;
  }

  function showGCal() {
    const el = document.getElementById("showGCalOnCal");
    return window.GCal && window.GCal.isEnabled() && (!el || el.checked);
  }
  // Google カレンダー由来のイベント（読み取り専用）
  function gcalItems(dateKey) {
    if (!showGCal()) return [];
    return window.GCal.eventsOn(dateKey).map((e) => ({ type: "gcal", ...e }));
  }

  /* ---------- 月ビュー ---------- */
  function renderMonth(container, cursor) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = D.startOfWeek(first);
    const today = new Date();

    let html = '<div class="cal-month">';
    html += '<div class="cal-dow-row">';
    D.weekdaysJa.forEach((w, i) => {
      const cls = i === 0 ? "sun" : i === 6 ? "sat" : "";
      html += `<div class="cal-dow ${cls}">${w}</div>`;
    });
    html += "</div>";
    html += '<div class="cal-grid">';

    for (let i = 0; i < 42; i++) {
      const day = D.addDays(start, i);
      const dateKey = D.key(day);
      const other = day.getMonth() !== cursor.getMonth();
      const isToday = D.sameDay(day, today);
      const events = window.Store.occurrencesOn(dateKey).slice().sort(sortEvents);
      const extras = extrasForDate(dateKey);
      const gcal = gcalItems(dateKey);
      const all = [...events.map((e) => ({ type: "event", ...e })), ...gcal, ...extras];

      html += `<div class="cal-cell ${other ? "other" : ""} ${isToday ? "today" : ""}" data-date="${dateKey}">`;
      html += `<div class="cell-date">${day.getDate()}</div>`;
      html += '<div class="cell-events">';
      const MAX = 3;
      all.slice(0, MAX).forEach((it) => { html += chipHtml(it); });
      if (all.length > MAX) html += `<div class="more-link" data-more="${dateKey}">他 ${all.length - MAX} 件</div>`;
      html += "</div></div>";
    }
    html += "</div></div>";
    container.innerHTML = html;

    container.querySelectorAll(".cal-cell").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        if (Drag.suppress()) return;
        const chip = e.target.closest(".chip");
        const more = e.target.closest(".more-link");
        const dateKey = cell.dataset.date;
        if (more) { hooks.onDateSelect(D.fromKey(dateKey)); return; }
        if (chip) { handleChipClick(chip, dateKey); return; }
        hooks.openEvent(dateKey, null);
      });
    });
    Drag.attachMonth(container);
  }

  function chipHtml(it) {
    if (it.type === "event") {
      const rep = it.recurring ? '<span class="chip-rep">↻</span>' : "";
      if (it.allDay) {
        return `<div class="chip allday" style="background:${it.color}" data-type="event" data-id="${it.id}">${rep}${esc(it.title)}</div>`;
      }
      return `<div class="chip" style="background:${it.color}" data-type="event" data-id="${it.id}"><span class="chip-time">${it.start || ""}</span>${rep}${esc(it.title)}</div>`;
    }
    if (it.type === "task") {
      return `<div class="chip task-chip ${it.done ? "done" : ""}" data-type="task" data-id="${it.id}">${esc(it.title)}</div>`;
    }
    if (it.type === "note") {
      return `<div class="chip note-chip" data-type="note" data-id="${it.id}">📝 ${esc(it.title)}</div>`;
    }
    if (it.type === "gcal") {
      const time = it.allDay ? "" : `<span class="chip-time">${it.start || ""}</span>`;
      return `<div class="chip gcal-chip" data-type="gcal" data-link="${esc(it.htmlLink || "")}" title="Googleカレンダー（読み取り専用）">${time}<span class="gbadge">G</span>${esc(it.title)}</div>`;
    }
    return "";
  }

  function handleChipClick(chip, dateKey) {
    const type = chip.dataset.type;
    const id = chip.dataset.id;
    if (type === "event") {
      const ev = window.Store.getEvent(id);
      hooks.openEvent(dateKey, ev);
    } else if (type === "task") {
      window.App.goTo("tasks");
    } else if (type === "note") {
      window.App.goTo("notes", id);
    } else if (type === "gcal") {
      const link = chip.dataset.link;
      if (link) window.open(link, "_blank", "noopener");
    }
  }

  function sortEvents(a, b) {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return (a.start || "").localeCompare(b.start || "");
  }

  /* ---------- 週 / 日ビュー（タイムグリッド） ---------- */
  const HOUR_PX = 48;

  function renderTime(container, cursor, days) {
    const today = new Date();
    const base = days === 7 ? D.startOfWeek(cursor) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const cols = [];
    for (let i = 0; i < days; i++) cols.push(D.addDays(base, i));
    const gridCols = `60px repeat(${days}, 1fr)`;

    let html = '<div class="cal-time">';
    html += `<div class="time-header" style="grid-template-columns:${gridCols}">`;
    html += '<div class="th-corner"></div>';
    cols.forEach((d) => {
      const isT = D.sameDay(d, today);
      html += `<div class="th-day ${isT ? "today" : ""}" data-date="${D.key(d)}">
        <div class="th-dow">${D.weekdaysJa[d.getDay()]}</div>
        <div class="th-num">${d.getDate()}</div>
      </div>`;
    });
    html += "</div>";
    // 終日行
    html += `<div class="time-header" style="grid-template-columns:${gridCols}">`;
    html += '<div class="th-corner th-allday-label">終日</div>';
    cols.forEach((d) => {
      const dk = D.key(d);
      const allday = window.Store.occurrencesOn(dk).filter((e) => e.allDay);
      const extras = extrasForDate(dk);
      const gcalAll = gcalItems(dk).filter((e) => e.allDay);
      let inner = "";
      allday.forEach((e) => { inner += chipHtml({ type: "event", ...e }); });
      gcalAll.forEach((it) => { inner += chipHtml(it); });
      extras.forEach((it) => { inner += chipHtml(it); });
      html += `<div class="th-allday" data-date="${dk}">${inner}</div>`;
    });
    html += "</div>";

    html += '<div class="time-body"><div class="time-grid" style="grid-template-columns:' + gridCols + '">';
    html += '<div class="time-col-labels">';
    for (let h = 0; h < 24; h++) {
      html += `<div class="hour-label">${h === 0 ? "" : String(h).padStart(2, "0") + ":00"}</div>`;
    }
    html += "</div>";
    cols.forEach((d) => {
      const dk = D.key(d);
      html += `<div class="day-col" data-date="${dk}">`;
      for (let h = 0; h < 24; h++) {
        html += `<div class="hour-cell" data-date="${dk}" data-hour="${h}"></div>`;
      }
      const timed = window.Store.occurrencesOn(dk).filter((e) => !e.allDay);
      timed.forEach((e) => { html += timedEventHtml(e); });
      gcalItems(dk).filter((e) => !e.allDay).forEach((e) => { html += gcalTimedHtml(e); });
      if (D.sameDay(d, today)) {
        const mins = today.getHours() * 60 + today.getMinutes();
        html += `<div class="now-line" style="top:${(mins / 60) * HOUR_PX}px"></div>`;
      }
      html += "</div>";
    });
    html += "</div></div></div>";
    container.innerHTML = html;

    const body = container.querySelector(".time-body");
    if (body) body.scrollTop = 8 * HOUR_PX;

    container.querySelectorAll(".hour-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        if (Drag.suppress()) return;
        const h = cell.dataset.hour;
        hooks.openEvent(cell.dataset.date, null, String(h).padStart(2, "0") + ":00");
      });
    });
    container.querySelectorAll(".th-day").forEach((el) => {
      el.addEventListener("click", () => hooks.onDateSelect(D.fromKey(el.dataset.date)));
    });
    container.querySelectorAll(".th-allday .chip").forEach((chip) => {
      chip.addEventListener("click", (e) => { e.stopPropagation(); handleChipClick(chip, chip.closest(".th-allday").dataset.date); });
    });
    // Google の時間指定イベント（読み取り専用・リンクを開く）
    container.querySelectorAll(".tg-event.gcal").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const link = el.dataset.link;
        if (link) window.open(link, "_blank", "noopener");
      });
    });
    Drag.attachTime(container);
  }

  function gcalTimedHtml(e) {
    const [sh, sm] = (e.start || "09:00").split(":").map(Number);
    const [eh, em] = (e.end || "10:00").split(":").map(Number);
    const top = (sh * 60 + sm) / 60 * HOUR_PX;
    let height = ((eh * 60 + em) - (sh * 60 + sm)) / 60 * HOUR_PX;
    if (height < 20) height = 20;
    return `<div class="tg-event gcal" style="top:${top}px;height:${height}px" data-link="${esc(e.htmlLink || "")}" title="Googleカレンダー（読み取り専用）">
      <div class="tg-title"><span class="gbadge">G</span>${esc(e.title)}</div>
      <div class="tg-time">${e.start} - ${e.end}</div>
    </div>`;
  }

  function timedEventHtml(e) {
    const [sh, sm] = (e.start || "09:00").split(":").map(Number);
    const [eh, em] = (e.end || "10:00").split(":").map(Number);
    const top = (sh * 60 + sm) / 60 * HOUR_PX;
    let height = ((eh * 60 + em) - (sh * 60 + sm)) / 60 * HOUR_PX;
    if (height < 20) height = 20;
    const rep = e.recurring ? '<span class="chip-rep">↻</span>' : "";
    return `<div class="tg-event" style="top:${top}px;height:${height}px;background:${e.color}" data-id="${e.id}" data-date="${e.date}">
      <div class="tg-title">${rep}${esc(e.title)}</div>
      <div class="tg-time">${e.start} - ${e.end}</div>
    </div>`;
  }

  /* ================= ドラッグ移動 ================= */
  const Drag = (function () {
    let d = null;          // 現在のドラッグ状態
    let dropEl = null;     // ドロップ先ハイライト要素
    let justDragged = false;

    function setDrop(el) {
      if (dropEl === el) return;
      if (dropEl) dropEl.classList.remove("drop-target");
      dropEl = el;
      if (el) el.classList.add("drop-target");
    }
    function clearDrop() { if (dropEl) { dropEl.classList.remove("drop-target"); dropEl = null; } }

    function elUnder(e, sel) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el ? el.closest(sel) : null;
    }
    function toHHMM(mins) {
      mins = Math.max(0, Math.min(1439, mins));
      return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    }
    function hhmmToMin(s) { const [h, m] = (s || "0:0").split(":").map(Number); return h * 60 + m; }

    function start(e, info) {
      if (typeof e.button === "number" && e.button !== 0) return;
      d = { info, startX: e.clientX, startY: e.clientY, started: false, el: info.el };
      if (info.mode === "time") { d.origTop = info.top; d.durMin = info.durMin; d.curTop = info.top; }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    function onMove(e) {
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (!d.started) {
        if (Math.hypot(dx, dy) < 6) return;
        beginVisual(e);
      }
      if (d.info.mode === "month") {
        moveGhost(e);
        setDrop(elUnder(e, ".cal-cell"));
      } else {
        let top = Math.round((d.origTop + dy) / 12) * 12; // 15分 = 12px スナップ
        if (top < 0) top = 0;
        d.curTop = top;
        d.el.style.top = top + "px";
        setDrop(elUnder(e, ".day-col"));
      }
    }

    function beginVisual(e) {
      d.started = true;
      document.body.classList.add("dragging");
      if (d.info.mode === "month") {
        const g = document.createElement("div");
        g.className = "drag-ghost";
        g.textContent = d.info.title;
        g.style.background = d.info.color;
        document.body.appendChild(g);
        d.ghost = g;
        moveGhost(e);
      } else {
        d.el.style.pointerEvents = "none";
        d.el.classList.add("dragging");
      }
    }

    function moveGhost(e) {
      if (d.ghost) { d.ghost.style.left = (e.clientX + 8) + "px"; d.ghost.style.top = (e.clientY + 8) + "px"; }
    }

    function onUp(e) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!d) return;
      if (d.started) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 60);
        document.body.classList.remove("dragging");
        clearDrop();
        if (d.info.mode === "month") {
          if (d.ghost) d.ghost.remove();
          const cell = elUnder(e, ".cal-cell");
          if (cell) {
            const newDate = cell.dataset.date;
            if (newDate !== d.info.instanceDate) {
              hooks.onDrop({ masterId: d.info.masterId, instanceDate: d.info.instanceDate, newDate });
            }
          }
        } else {
          d.el.style.pointerEvents = "";
          d.el.classList.remove("dragging");
          const col = elUnder(e, ".day-col");
          const newDate = col ? col.dataset.date : d.info.instanceDate;
          const mins = Math.round((d.curTop) / HOUR_PX * 60);
          const ns = toHHMM(mins), ne = toHHMM(mins + d.durMin);
          if (newDate !== d.info.instanceDate || ns !== d.info.start) {
            hooks.onDrop({ masterId: d.info.masterId, instanceDate: d.info.instanceDate, newDate, newStart: ns, newEnd: ne });
          }
        }
      }
      d = null;
    }

    function attachMonth(container) {
      container.querySelectorAll('.chip[data-type="event"]').forEach((chip) => {
        chip.addEventListener("pointerdown", (e) => {
          const cell = chip.closest(".cal-cell");
          const master = window.Store.getEvent(chip.dataset.id);
          if (!master || !cell) return;
          start(e, { mode: "month", el: chip, masterId: master.id, instanceDate: cell.dataset.date, title: master.title, color: master.color });
        });
      });
    }

    function attachTime(container) {
      container.querySelectorAll(".tg-event:not(.gcal)").forEach((el) => {
        el.addEventListener("pointerdown", (e) => {
          const col = el.closest(".day-col");
          const master = window.Store.getEvent(el.dataset.id);
          if (!master || !col) return;
          const dur = hhmmToMin(master.end) - hhmmToMin(master.start);
          const top = parseFloat(el.style.top) || 0;
          start(e, { mode: "time", el, masterId: master.id, instanceDate: col.dataset.date, start: master.start, top, durMin: dur > 0 ? dur : 60 });
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (justDragged) return;
          const master = window.Store.getEvent(el.dataset.id);
          const col = el.closest(".day-col");
          hooks.openEvent(col.dataset.date, master);
        });
      });
    }

    // スワイプでの期間切替（タッチ端末）
    let swipeBound = false;
    function attachSwipe(container) {
      if (swipeBound) return;
      swipeBound = true;
      let sx = 0, sy = 0, active = false, startTarget = null;
      container.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { active = false; return; }
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; startTarget = e.target; active = true;
      }, { passive: true });
      container.addEventListener("touchend", (e) => {
        if (!active) return;
        active = false;
        // 予定の上から始まった場合はドラッグ移動の領域なので無視
        if (startTarget && startTarget.closest && startTarget.closest('.tg-event, .chip[data-type="event"]')) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          justDragged = true; // 直後の合成クリック（予定作成）を抑制
          setTimeout(() => { justDragged = false; }, 80);
          hooks.onSwipe(dx < 0 ? 1 : -1); // 左スワイプ=次へ / 右スワイプ=前へ
        }
      }, { passive: true });
    }

    return { attachMonth, attachTime, attachSwipe, suppress: () => justDragged };
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function label(view, cursor) {
    if (view === "month") return D.monthLabel(cursor);
    if (view === "week") {
      const s = D.startOfWeek(cursor);
      const e = D.addDays(s, 6);
      if (s.getMonth() === e.getMonth()) return `${s.getFullYear()}年 ${s.getMonth() + 1}月 ${s.getDate()}–${e.getDate()}日`;
      return `${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`;
    }
    return `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月 ${cursor.getDate()}日 (${D.weekdaysJa[cursor.getDay()]})`;
  }

  function render(view, cursor) {
    const container = document.getElementById("calendarView");
    Drag.attachSwipe(container); // 初回のみバインド
    if (view === "month") renderMonth(container, cursor);
    else if (view === "week") renderTime(container, cursor, 7);
    else renderTime(container, cursor, 1);
  }

  window.Calendar = { render, label, setHooks };
})();
