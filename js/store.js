/* =========================================================
 * store.js — localStorage 永続化 + 共有ステート + ユーティリティ
 * すべてのモジュールから window.Store としてアクセスします。
 * ======================================================= */
(function () {
  "use strict";

  const KEYS = {
    events: "mycal.events",
    tasks: "mycal.tasks",
    notes: "mycal.notes",
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn("読み込み失敗", key, e);
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("保存失敗", key, e);
    }
  }

  // ----- ID 生成 -----
  let _counter = 0;
  function uid() {
    _counter += 1;
    return "id_" + Date.now().toString(36) + "_" + _counter.toString(36);
  }

  // ----- 日付ユーティリティ -----
  const Dates = {
    // ローカル日付を YYYY-MM-DD 文字列に
    key(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    },
    // YYYY-MM-DD をローカル Date(00:00) に
    fromKey(s) {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d);
    },
    today() {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    },
    addDays(d, n) {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    },
    startOfWeek(d) {
      // 日曜始まり
      const r = new Date(d);
      r.setDate(r.getDate() - r.getDay());
      r.setHours(0, 0, 0, 0);
      return r;
    },
    sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    },
    isToday(d) {
      return Dates.sameDay(d, new Date());
    },
    monthLabel(d) {
      return `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
    },
    weekdaysJa: ["日", "月", "火", "水", "木", "金", "土"],
    fmtTime(hhmm) {
      return hhmm || "";
    },
  };

  // ----- コレクション -----
  const state = {
    events: load(KEYS.events, null),
    tasks: load(KEYS.tasks, null),
    notes: load(KEYS.notes, null),
  };

  // 初回起動時のサンプルデータ
  if (state.events === null && state.tasks === null && state.notes === null) {
    seed();
  } else {
    state.events = state.events || [];
    state.tasks = state.tasks || [];
    state.notes = state.notes || [];
  }

  function seed() {
    const t = Dates.today();
    const k = Dates.key;
    state.events = [
      { id: uid(), title: "朝会", date: k(t), allDay: false, start: "09:30", end: "10:00", color: "var(--c-blue)", desc: "デイリースクラム", repeat: "daily", repeatUntil: k(Dates.addDays(t, 30)), exdates: [] },
      { id: uid(), title: "ランチ", date: k(t), allDay: false, start: "12:00", end: "13:00", color: "var(--c-green)", desc: "", repeat: "none", repeatUntil: "", exdates: [] },
      { id: uid(), title: "プロジェクトレビュー", date: k(Dates.addDays(t, 2)), allDay: false, start: "15:00", end: "16:30", color: "var(--c-purple)", desc: "Q3の進捗確認", repeat: "none", repeatUntil: "", exdates: [] },
    ];
    state.tasks = [
      { id: uid(), title: "資料の作成", due: k(t), priority: "high", done: false, created: Date.now() },
      { id: uid(), title: "メールの返信", due: k(Dates.addDays(t, 1)), priority: "medium", done: false, created: Date.now() },
      { id: uid(), title: "請求書の確認", due: "", priority: "low", done: true, created: Date.now() },
    ];
    state.notes = [
      {
        id: uid(),
        title: "週次定例ミーティング",
        datetime: k(t) + "T10:00",
        attendees: "山田, 佐藤, 鈴木",
        agenda: "・先週の振り返り\n・今週の目標\n・課題共有",
        body: "先週リリースした機能は好調。\n次のスプリントではパフォーマンス改善に着手する。",
        actions: [
          { id: uid(), text: "負荷テストを実施", owner: "佐藤", due: k(Dates.addDays(t, 3)), done: false, taskId: null },
        ],
        updated: Date.now(),
      },
    ];
    persist();
  }

  function persist() {
    save(KEYS.events, state.events);
    save(KEYS.tasks, state.tasks);
    save(KEYS.notes, state.notes);
  }

  // 月内の第何週の曜日か（1〜5）
  function nthWeekdayOfMonth(d) { return Math.floor((d.getDate() - 1) / 7) + 1; }
  // その月における「最終◯曜日」かどうか
  function isLastWeekdayOfMonth(d) {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() + 7 > daysInMonth;
  }

  // ----- 繰り返し予定：指定日に発生するか判定 -----
  function eventOccursOn(ev, dateKey, targetDate) {
    const repeat = ev.repeat || "none";
    if (repeat === "none") return dateKey === ev.date;
    // 繰り返しあり
    if (dateKey < ev.date) return false;                       // アンカーより前は無し
    if (ev.repeatUntil && dateKey > ev.repeatUntil) return false; // 終了日を過ぎている
    if (ev.exdates && ev.exdates.indexOf(dateKey) >= 0) return false; // 除外日（この予定のみ削除/分離）
    const anchor = Dates.fromKey(ev.date);
    const diffDays = Math.round((targetDate - anchor) / 86400000);
    switch (repeat) {
      case "daily": return true;
      case "weekly": return diffDays % 7 === 0;
      case "monthly":
        if (ev.monthlyMode === "weekday") {
          // 毎月 第N◯曜日（Nはアンカー日から算出）
          return targetDate.getDay() === anchor.getDay() && nthWeekdayOfMonth(targetDate) === nthWeekdayOfMonth(anchor);
        }
        if (ev.monthlyMode === "weekdayLast") {
          // 毎月 最終◯曜日
          return targetDate.getDay() === anchor.getDay() && isLastWeekdayOfMonth(targetDate);
        }
        // 既定：毎月 同じ日付
        return targetDate.getDate() === anchor.getDate();
      case "yearly": return targetDate.getMonth() === anchor.getMonth() && targetDate.getDate() === anchor.getDate();
      default: return false;
    }
  }

  // ----- 変更通知（簡易イベントバス） -----
  const listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt) {
    (listeners[evt] || []).forEach((fn) => fn());
  }

  // ===== 公開 API =====
  window.Store = {
    Dates,
    uid,
    on,
    emit,
    persist,

    // Events
    getEvents() { return state.events; },
    getEvent(id) { return state.events.find((e) => e.id === id); },
    getEventsByDate(dateKey) { return state.events.filter((e) => e.date === dateKey); },
    // 指定日に発生する予定（繰り返しを展開して返す。date は発生日、masterId は元予定ID）
    occurrencesOn(dateKey) {
      const target = Dates.fromKey(dateKey);
      const out = [];
      state.events.forEach((ev) => {
        if (eventOccursOn(ev, dateKey, target)) {
          out.push(Object.assign({}, ev, {
            date: dateKey,
            masterId: ev.id,
            recurring: !!(ev.repeat && ev.repeat !== "none"),
          }));
        }
      });
      return out;
    },
    // 「この予定のみ」削除/分離のための除外日を追加
    addExdate(id, dateKey) {
      const e = state.events.find((x) => x.id === id);
      if (e) {
        e.exdates = e.exdates || [];
        if (e.exdates.indexOf(dateKey) < 0) e.exdates.push(dateKey);
        persist(); emit("events");
      }
    },
    upsertEvent(ev) {
      if (ev.id) {
        const i = state.events.findIndex((e) => e.id === ev.id);
        if (i >= 0) state.events[i] = ev; else state.events.push(ev);
      } else {
        ev.id = uid();
        state.events.push(ev);
      }
      persist(); emit("events");
      return ev;
    },
    deleteEvent(id) {
      state.events = state.events.filter((e) => e.id !== id);
      persist(); emit("events");
    },

    // Tasks
    getTasks() { return state.tasks; },
    upsertTask(task) {
      if (task.id) {
        const i = state.tasks.findIndex((t) => t.id === task.id);
        if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
      } else {
        task.id = uid();
        task.created = Date.now();
        state.tasks.push(task);
      }
      persist(); emit("tasks");
      return task;
    },
    deleteTask(id) {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      persist(); emit("tasks");
    },
    toggleTask(id) {
      const t = state.tasks.find((x) => x.id === id);
      if (t) { t.done = !t.done; persist(); emit("tasks"); }
    },

    // Notes
    getNotes() { return state.notes; },
    getNote(id) { return state.notes.find((n) => n.id === id); },
    upsertNote(note) {
      note.updated = Date.now();
      if (note.id) {
        const i = state.notes.findIndex((n) => n.id === note.id);
        if (i >= 0) state.notes[i] = note; else state.notes.push(note);
      } else {
        note.id = uid();
        state.notes.push(note);
      }
      persist(); emit("notes");
      return note;
    },
    deleteNote(id) {
      state.notes = state.notes.filter((n) => n.id !== id);
      persist(); emit("notes");
    },

    // ----- バックアップ（同期用の書き出し／取り込み） -----
    exportData() {
      return {
        app: "MyCalendar",
        version: 1,
        exportedAt: new Date().toISOString(),
        events: state.events,
        tasks: state.tasks,
        notes: state.notes,
      };
    },
    // mode: "merge"（既存に統合・同IDは取り込み側で上書き）/ "replace"（全置換）
    importData(data, mode) {
      if (!data || typeof data !== "object") throw new Error("不正なデータ形式です");
      const cols = ["events", "tasks", "notes"];
      if (!cols.some((c) => Array.isArray(data[c]))) throw new Error("MyCalendarのバックアップではありません");
      cols.forEach((c) => {
        if (!Array.isArray(data[c])) return;
        if (mode === "replace") {
          state[c] = data[c];
        } else {
          const byId = {};
          state[c].forEach((x) => { if (x && x.id) byId[x.id] = x; });
          data[c].forEach((x) => { if (x && x.id) byId[x.id] = x; });
          state[c] = Object.keys(byId).map((k) => byId[k]);
        }
      });
      persist();
      emit("events"); emit("tasks"); emit("notes");
      return { events: state.events.length, tasks: state.tasks.length, notes: state.notes.length };
    },
  };
})();
