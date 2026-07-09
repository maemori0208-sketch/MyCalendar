/* =========================================================
 * app.js — 全体の初期化・ルーティング・ヘッダー・モーダル
 *          テーマ / ドラッグ移動 / 繰り返し / ホイール / モバイル対応
 * ======================================================= */
(function () {
  "use strict";
  const D = window.Store.Dates;
  const S = window.Store;

  const COLORS = [
    "var(--c-blue)", "var(--c-green)", "var(--c-red)",
    "var(--c-orange)", "var(--c-purple)", "var(--c-teal)", "var(--c-gray)",
  ];

  const state = {
    cursor: D.today(),
    selected: D.today(),
    view: "month",
    page: "calendar",
    miniCursor: D.today(),
    editingColor: COLORS[0],
    editingEventId: null,
    editingInstanceDate: null,
  };

  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------- テーマ（ダークモード） ---------- */
  function initTheme() {
    let theme = localStorage.getItem("mycal.theme");
    if (!theme) theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(theme);
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mycal.theme", theme);
    const btn = document.getElementById("themeToggle");
    if (btn) btn.title = theme === "dark" ? "ライトモードに切替" : "ダークモードに切替";
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  }

  /* ---------- ルーティング ---------- */
  function goTo(page, arg) {
    state.page = page;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    document.getElementById("page-" + page).classList.remove("hidden");

    const calHeaderOn = page === "calendar";
    document.getElementById("viewSwitch").style.visibility = calHeaderOn ? "visible" : "hidden";
    document.getElementById("calNav").style.visibility = calHeaderOn ? "visible" : "hidden";
    document.getElementById("todayBtn").style.visibility = calHeaderOn ? "visible" : "hidden";

    if (page === "calendar") { renderCalendar(); }
    else if (page === "tasks") { document.getElementById("currentLabel").textContent = "タスク"; window.Tasks.render(); }
    else if (page === "notes") {
      document.getElementById("currentLabel").textContent = "議事録";
      window.Notes.renderList();
      if (arg) window.Notes.select(arg);
    }
    if (isMobile()) closeDrawer();
  }

  /* ---------- カレンダー描画 ---------- */
  function renderCalendar(anim) {
    window.Calendar.render(state.view, state.cursor);
    document.getElementById("currentLabel").textContent = window.Calendar.label(state.view, state.cursor);
    if (anim) playCalAnim(anim);
  }

  // 表示切り替え・移動のアニメーション（#calendarView にクラスを付け直して再生）
  function playCalAnim(type) {
    const el = document.getElementById("calendarView");
    el.classList.remove("cal-anim-next", "cal-anim-prev", "cal-anim-fade");
    void el.offsetWidth; // リフローで再生をリセット
    el.classList.add(type === "next" ? "cal-anim-next" : type === "prev" ? "cal-anim-prev" : "cal-anim-fade");
  }

  function navigate(dir) {
    const c = state.cursor;
    if (state.view === "month") state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    else if (state.view === "week") state.cursor = D.addDays(c, dir * 7);
    else state.cursor = D.addDays(c, dir);
    renderCalendar(dir > 0 ? "next" : "prev");
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    renderCalendar("fade");
  }

  /* ---------- ミニカレンダー ---------- */
  function renderMini() {
    const container = document.getElementById("miniCalendar");
    const cur = state.miniCursor;
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const start = D.startOfWeek(first);
    let html = `<div class="mini-head">
      <button id="miniPrev">‹</button>
      <span>${cur.getFullYear()}年 ${cur.getMonth() + 1}月</span>
      <button id="miniNext">›</button>
    </div><div class="mini-grid">`;
    ["日", "月", "火", "水", "木", "金", "土"].forEach((w) => { html += `<div class="mini-dow">${w}</div>`; });
    for (let i = 0; i < 42; i++) {
      const day = D.addDays(start, i);
      const other = day.getMonth() !== cur.getMonth();
      const today = D.isToday(day);
      const sel = D.sameDay(day, state.selected);
      html += `<div class="mini-day ${other ? "other" : ""} ${today ? "today" : ""} ${sel ? "selected" : ""}" data-date="${D.key(day)}">${day.getDate()}</div>`;
    }
    html += "</div>";
    container.innerHTML = html;

    document.getElementById("miniPrev").addEventListener("click", () => { state.miniCursor = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); renderMini(); });
    document.getElementById("miniNext").addEventListener("click", () => { state.miniCursor = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); renderMini(); });
    container.querySelectorAll(".mini-day").forEach((el) => {
      el.addEventListener("click", () => {
        const date = D.fromKey(el.dataset.date);
        state.selected = date;
        state.cursor = date;
        if (state.page !== "calendar") goTo("calendar");
        else renderCalendar();
        renderMini();
      });
    });
  }

  /* ---------- 日付ユーティリティ ---------- */
  function daysBetween(k1, k2) { return Math.round((D.fromKey(k2) - D.fromKey(k1)) / 86400000); }
  function addDaysKey(k, delta) { return D.key(D.addDays(D.fromKey(k), delta)); }

  /* ---------- 予定モーダル ---------- */
  const modal = {
    open(dateKey, ev, timeHint) {
      state.editingEventId = ev ? ev.id : null;
      state.editingInstanceDate = dateKey || D.key(D.today());
      document.getElementById("eventModalTitle").textContent = ev ? "予定を編集" : "予定を作成";
      document.getElementById("evTitle").value = ev ? ev.title : "";
      document.getElementById("evAllDay").checked = ev ? !!ev.allDay : false;
      document.getElementById("evDate").value = state.editingInstanceDate;
      document.getElementById("evStart").value = ev ? ev.start : (timeHint || "09:00");
      document.getElementById("evEnd").value = ev ? ev.end : addHour(timeHint || "09:00");
      document.getElementById("evDesc").value = ev ? ev.desc || "" : "";
      const rep = ev ? (ev.repeat || "none") : "none";
      document.getElementById("evRepeat").value = rep;
      document.getElementById("evRepeatUntil").value = ev ? (ev.repeatUntil || "") : "";
      updateRepeatUI();
      // 既存の「毎月◯曜日」設定を反映
      if (rep === "monthly" && ev && ev.monthlyMode) {
        const mm = document.getElementById("evMonthlyMode");
        if ([].some.call(mm.options, (o) => o.value === ev.monthlyMode)) mm.value = ev.monthlyMode;
      }
      state.editingColor = ev ? ev.color : COLORS[0];
      renderColorPicker();
      toggleTimeInputs();
      document.getElementById("deleteEventBtn").style.visibility = ev ? "visible" : "hidden";
      document.getElementById("eventModal").classList.remove("hidden");
      setTimeout(() => document.getElementById("evTitle").focus(), 50);
    },
    close() {
      document.getElementById("eventModal").classList.add("hidden");
      state.editingEventId = null;
    },
  };

  function addHour(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const nh = Math.min(h + 1, 23);
    return String(nh).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }
  function toggleTimeInputs() {
    const allDay = document.getElementById("evAllDay").checked;
    document.getElementById("evStart").style.display = allDay ? "none" : "";
    document.getElementById("evEnd").style.display = allDay ? "none" : "";
    document.querySelector("#eventModal .tilde").style.display = allDay ? "none" : "";
  }
  function updateRepeatUI() {
    const rep = document.getElementById("evRepeat").value;
    document.getElementById("evRepeatUntilRow").style.display = rep === "none" ? "none" : "";
    const mm = document.getElementById("evMonthlyMode");
    if (rep === "monthly") { mm.style.display = ""; buildMonthlyOptions(mm); }
    else { mm.style.display = "none"; }
  }
  // 選択中の日付から「毎月◯日／第N◯曜日／最終◯曜日」の選択肢を組み立てる
  function buildMonthlyOptions(sel) {
    const dk = document.getElementById("evDate").value;
    if (!dk) return;
    const d = D.fromKey(dk);
    const wd = D.weekdaysJa[d.getDay()];
    const nth = Math.floor((d.getDate() - 1) / 7) + 1;
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const isLast = d.getDate() + 7 > daysInMonth;
    const prev = sel.value;
    const opts = [`<option value="date">毎月 ${d.getDate()}日</option>`];
    if (nth <= 4) opts.push(`<option value="weekday">毎月 第${nth}${wd}曜日</option>`);
    if (isLast) opts.push(`<option value="weekdayLast">毎月 最終${wd}曜日</option>`);
    sel.innerHTML = opts.join("");
    if ([].some.call(sel.options, (o) => o.value === prev)) sel.value = prev;
  }
  function renderColorPicker() {
    const picker = document.getElementById("colorPicker");
    picker.innerHTML = COLORS.map((c) =>
      `<div class="swatch ${c === state.editingColor ? "selected" : ""}" style="background:${c}" data-color="${c}"></div>`
    ).join("");
    picker.querySelectorAll(".swatch").forEach((s) => {
      s.addEventListener("click", () => { state.editingColor = s.dataset.color; renderColorPicker(); });
    });
  }

  function readModalFields() {
    const allDay = document.getElementById("evAllDay").checked;
    const repeat = document.getElementById("evRepeat").value;
    return {
      title: document.getElementById("evTitle").value.trim() || "（タイトルなし）",
      date: document.getElementById("evDate").value,
      allDay,
      start: allDay ? "" : document.getElementById("evStart").value,
      end: allDay ? "" : document.getElementById("evEnd").value,
      color: state.editingColor,
      desc: document.getElementById("evDesc").value,
      repeat,
      repeatUntil: repeat === "none" ? "" : document.getElementById("evRepeatUntil").value,
      monthlyMode: repeat === "monthly" ? document.getElementById("evMonthlyMode").value : "",
    };
  }

  async function saveEvent() {
    const fields = readModalFields();
    const master = state.editingEventId ? S.getEvent(state.editingEventId) : null;

    if (!master) {
      S.upsertEvent(Object.assign({ exdates: [] }, fields));
      modal.close();
      toast("予定を作成しました");
      return;
    }

    const wasRecurring = master.repeat && master.repeat !== "none";
    if (wasRecurring) {
      const scope = await askScope("編集");
      if (!scope) return;
      if (scope === "all") {
        const delta = daysBetween(state.editingInstanceDate, fields.date);
        Object.assign(master, fields, { date: addDaysKey(master.date, delta) });
        S.upsertEvent(master);
      } else {
        S.addExdate(master.id, state.editingInstanceDate);
        S.upsertEvent(Object.assign({}, fields, { id: null, repeat: "none", repeatUntil: "", exdates: [] }));
      }
    } else {
      Object.assign(master, fields);
      S.upsertEvent(master);
    }
    modal.close();
    toast("予定を保存しました");
  }

  async function deleteEvent() {
    const master = S.getEvent(state.editingEventId);
    if (!master) return;
    if (master.repeat && master.repeat !== "none") {
      const scope = await askScope("削除");
      if (!scope) return;
      if (scope === "all") S.deleteEvent(master.id);
      else S.addExdate(master.id, state.editingInstanceDate);
    } else {
      S.deleteEvent(master.id);
    }
    modal.close();
    toast("予定を削除しました");
  }

  // ドラッグ移動のドロップ処理
  async function onDrop(info) {
    const master = S.getEvent(info.masterId);
    if (!master) return;
    const recurring = master.repeat && master.repeat !== "none";
    const apply = (target) => {
      if (info.newDate) target.date = info.newDate;
      if (info.newStart) { target.start = info.newStart; target.end = info.newEnd; target.allDay = false; }
    };

    if (recurring) {
      const scope = await askScope("移動");
      if (!scope) { renderCalendar(); return; }
      if (scope === "all") {
        if (info.newDate) {
          const delta = daysBetween(info.instanceDate, info.newDate);
          master.date = addDaysKey(master.date, delta);
        }
        if (info.newStart) { master.start = info.newStart; master.end = info.newEnd; }
        S.upsertEvent(master);
      } else {
        S.addExdate(master.id, info.instanceDate);
        const copy = Object.assign({}, master, { id: null, repeat: "none", repeatUntil: "", exdates: [], date: info.instanceDate });
        apply(copy);
        S.upsertEvent(copy);
      }
    } else {
      apply(master);
      S.upsertEvent(master);
    }
    toast("予定を移動しました");
  }

  /* ---------- 繰り返し予定：適用範囲ダイアログ ---------- */
  let scopeResolver = null;
  function askScope(actionLabel) {
    return new Promise((resolve) => {
      scopeResolver = resolve;
      document.getElementById("scopeTitle").textContent = "繰り返し予定の" + actionLabel;
      document.getElementById("scopeModal").classList.remove("hidden");
    });
  }
  function closeScope(value) {
    document.getElementById("scopeModal").classList.add("hidden");
    if (scopeResolver) { const r = scopeResolver; scopeResolver = null; r(value); }
  }

  /* ---------- 作成メニュー ---------- */
  function toggleCreateMenu(anchor) {
    const menu = document.getElementById("createMenu");
    if (!menu.classList.contains("hidden")) { menu.classList.add("hidden"); return; }
    const rect = anchor.getBoundingClientRect();
    menu.style.left = rect.left + "px";
    menu.style.top = rect.bottom + 8 + "px";
    menu.classList.remove("hidden");
  }

  /* ---------- モバイル用ドロワー ---------- */
  function openDrawer() {
    document.body.classList.add("nav-open");
    document.getElementById("backdrop").classList.remove("hidden");
  }
  function closeDrawer() {
    document.body.classList.remove("nav-open");
    document.getElementById("backdrop").classList.add("hidden");
  }
  function toggleMenu() {
    if (isMobile()) {
      if (document.body.classList.contains("nav-open")) closeDrawer(); else openDrawer();
    } else {
      document.getElementById("sidebar").classList.toggle("collapsed");
    }
  }

  /* ---------- ホイールでのカレンダー移動 ---------- */
  let lastWheel = 0;
  function wheelNav(deltaY) {
    const now = Date.now();
    if (now - lastWheel < 220) return; // 連続スクロールの抑制
    lastWheel = now;
    navigate(deltaY > 0 ? 1 : -1);
  }

  /* ---------- データのエクスポート / インポート（同期・バックアップ） ---------- */
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  }
  async function exportData() {
    if (isMobile()) closeDrawer();
    const json = JSON.stringify(S.exportData(), null, 2);
    const fname = `mycalendar-backup-${stamp()}.json`;
    const file = new File([json], fname, { type: "application/json" });
    // iPhone/対応端末では共有シート（ファイルに保存・AirDrop・メール等）を優先
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "MyCalendar バックアップ" });
        toast("バックアップを共有しました");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // ユーザーがキャンセル
      }
    }
    // フォールバック：ファイルとしてダウンロード
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("バックアップを書き出しました");
  }
  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const merge = confirm(
          "取り込み方法を選んでください。\n\n［OK］統合：現在のデータに追加（同じ項目は取り込み側で上書き）\n［キャンセル］全置換：現在のデータを消して置き換え"
        );
        if (!merge && !confirm("現在のデータをすべて置き換えます。よろしいですか？")) { e.target.value = ""; return; }
        const r = S.importData(data, merge ? "merge" : "replace");
        renderMini();
        if (state.page === "calendar") renderCalendar();
        window.Tasks.updateBadge();
        window.Notes.renderList();
        toast(`取り込み完了：予定 ${r.events} / タスク ${r.tasks} / 議事録 ${r.notes}`);
      } catch (err) {
        alert("読み込みに失敗しました：" + err.message);
      }
      e.target.value = "";
      if (isMobile()) closeDrawer();
    };
    reader.readAsText(file);
  }

  /* ---------- 自動同期（クラウド）のUI ---------- */
  const SYNC_LABELS = {
    disabled: "未接続", connecting: "接続中…", syncing: "同期中…", synced: "同期済み",
    reconnecting: "再接続中…", error: "エラー", signin: "ログインが必要です",
  };
  function renderSyncStatus(status, detail) {
    const el = document.getElementById("syncStatus");
    if (el) {
      let text = SYNC_LABELS[status] || status;
      if (status === "synced" && typeof detail === "number") {
        const d = new Date(detail);
        text += `（${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}）`;
      } else if (status === "error" && detail) {
        text += "：" + detail;
      }
      el.textContent = text;
      el.dataset.state = status;
    }
    const dot = document.getElementById("syncDot");
    if (dot) dot.dataset.state = window.Sync.isEnabled() ? status : "off";
  }
  function renderAuth(info) {
    const mode = window.Sync.getMode();
    const signedIn = !!(info && info.signedIn);
    // Drive 用の表示
    document.getElementById("driveAccount").classList.toggle("hidden", !(signedIn && mode === "drive"));
    document.getElementById("driveSetup").classList.toggle("hidden", signedIn && mode === "drive");
    if (signedIn && mode === "drive") document.getElementById("driveEmail").textContent = info.email || info.name || "";
    // Firebase Google 用の表示
    document.getElementById("googleAccount").classList.toggle("hidden", !(signedIn && mode === "google"));
    document.getElementById("googleSetup").classList.toggle("hidden", signedIn && mode === "google");
    if (signedIn && mode === "google") document.getElementById("googleEmail").textContent = info.email || info.name || "";
    document.getElementById("syncDisableBtn").style.visibility = window.Sync.isEnabled() ? "visible" : "hidden";
  }
  function switchSyncMethod(m) {
    const sel = document.getElementById("syncMethodSel");
    if (sel.value !== m) sel.value = m;
    document.getElementById("syncDrive").classList.toggle("hidden", m !== "drive");
    document.getElementById("syncGoogle").classList.toggle("hidden", m !== "google");
    document.getElementById("syncCodeMethod").classList.toggle("hidden", m !== "code");
  }
  function openSyncModal() {
    if (isMobile()) closeDrawer();
    const c = window.Sync.getConfig();
    document.getElementById("syncUrl").value = c.url;
    document.getElementById("syncCode").value = c.code;
    document.getElementById("driveClientId").value = c.driveClientId || "";
    if (c.fb) document.getElementById("syncFbConfig").value = fbToText(c.fb);
    switchSyncMethod(window.Sync.getMode());
    document.getElementById("syncDisableBtn").style.visibility = window.Sync.isEnabled() ? "visible" : "hidden";
    document.getElementById("syncModal").classList.remove("hidden");
  }
  function closeSyncModal() { document.getElementById("syncModal").classList.add("hidden"); }

  // Firebase 構成スニペットから必要な値を抽出（不完全な貼り付けにも寛容に）
  function parseFbConfig(text) {
    const fb = {};
    const re = /(\w+)\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(text)) !== null) fb[m[1]] = m[2];
    return fb;
  }
  function fbToText(fb) {
    return "const firebaseConfig = {\n" + Object.keys(fb).map((k) => `  ${k}: "${fb[k]}"`).join(",\n") + "\n};";
  }
  async function driveSignIn() {
    const clientId = document.getElementById("driveClientId").value.trim();
    try { window.Sync.setDriveConfig(clientId); }
    catch (e) { alert(e.message); return; }
    renderSyncStatus("connecting");
    try {
      await window.Sync.driveSignIn();
      afterSyncApplied();
      toast("Googleドライブと同期を開始しました");
      closeSyncModal();
    } catch (e) {
      renderSyncStatus("error", (e && e.message) || "ログイン失敗");
      alert("ログインに失敗しました。\n・Google Drive API を有効化\n・OAuth同意画面のテストユーザーに自分を追加\n・承認済みJavaScript生成元に公開URLを追加\nをご確認ください。\n\n詳細：" + ((e && e.message) || e));
    }
  }
  async function driveSignOut() {
    await window.Sync.driveSignOut();
    toast("ログアウトしました");
  }
  async function googleSignIn() {
    const text = document.getElementById("syncFbConfig").value;
    const fb = parseFbConfig(text);
    try {
      window.Sync.setGoogleConfig(fb);
    } catch (e) {
      alert("Firebase設定が不足しています。\nコンソールの構成（apiKey / authDomain / databaseURL / projectId）を貼り付けてください。\n\n" + e.message);
      return;
    }
    renderSyncStatus("connecting");
    try {
      await window.Sync.googleSignIn();
      // 以降は onAuth / onStatus コールバックで反映
    } catch (e) {
      renderSyncStatus("error", (e && e.message) || "ログイン失敗");
      alert("ログインに失敗しました。\n・Authenticationで Google を有効化\n・承認済みドメインに公開URLを追加\n・databaseURL が正しいか\nをご確認ください。\n\n詳細：" + ((e && e.message) || e));
    }
  }
  async function googleSignOut() {
    await window.Sync.googleSignOut();
    toast("ログアウトしました");
  }
  async function enableCodeSync() {
    const url = document.getElementById("syncUrl").value.trim();
    const code = document.getElementById("syncCode").value.trim();
    if (!url || !code) { alert("データベースURLと同期コードを入力してください。"); return; }
    renderSyncStatus("connecting");
    try {
      const remote = await window.Sync.probeCode(url, code);
      let choice = "push";
      if (remote && (remote.events || remote.tasks || remote.notes)) {
        choice = confirm("同期先に既存のデータがあります。\n\n［OK］同期先を取り込む（この端末を置き換え）\n［キャンセル］この端末の内容で上書き") ? "pull" : "push";
      }
      await window.Sync.enableCode(url, code, choice);
      afterSyncApplied();
      toast("自動同期を有効にしました");
      closeSyncModal();
    } catch (e) {
      renderSyncStatus("error", (e && e.message) || "接続失敗");
      alert("接続に失敗しました。URLとルール設定をご確認ください。\n\n詳細：" + ((e && e.message) || e));
    }
  }
  function disableSync() {
    window.Sync.disable();
    toast("同期を停止しました");
    renderAuth({ signedIn: false });
  }
  // リモート取り込み後に各画面を更新
  function afterSyncApplied() {
    renderMini();
    if (state.page === "calendar") renderCalendar();
    window.Tasks.updateBadge();
    window.Notes.renderList();
  }

  /* ---------- Googleカレンダー取り込みのUI ---------- */
  function renderGcalStatus(status, detail) {
    const el = document.getElementById("gcalStatus");
    if (el) {
      let text = SYNC_LABELS[status] || status;
      if (status === "synced" && typeof detail === "number") {
        const d = new Date(detail);
        text += `（${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} 更新）`;
      } else if (status === "error" && detail) { text += "：" + detail; }
      el.textContent = text; el.dataset.state = status;
    }
    const enabled = window.GCal.isEnabled();
    const dot = document.getElementById("gcalDot");
    if (dot) dot.dataset.state = enabled ? status : "off";
    document.getElementById("showGCalRow").style.display = enabled ? "" : "none";
    const connected = enabled && status !== "signin" && status !== "disabled";
    document.getElementById("gcalAccount").classList.toggle("hidden", !connected);
    document.getElementById("gcalSetup").classList.toggle("hidden", connected);
    document.getElementById("gcalCalendarRow").style.display = connected ? "" : "none";
    document.getElementById("gcalRefreshBtn").style.display = connected ? "" : "none";
    document.getElementById("gcalTwoWayBox").style.display = connected ? "" : "none";
    document.getElementById("gcalTwoWay").checked = window.GCalSync.isEnabled();
  }
  function renderGcalSyncStatus(status, detail) {
    const el = document.getElementById("gcalSyncStatus");
    if (!el) return;
    let text = SYNC_LABELS[status] || status;
    if (status === "synced" && typeof detail === "number") {
      const d = new Date(detail);
      text += `（${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}）`;
    } else if (status === "error" && detail) { text += "：" + detail; }
    el.textContent = "双方向：" + text;
    el.dataset.state = status;
  }
  async function toggleTwoWay(checked) {
    if (checked) {
      renderGcalSyncStatus("connecting");
      try {
        await window.GCalSync.enable();
        afterSyncApplied();
        toast("双方向同期を開始しました（専用カレンダーを使用）");
      } catch (e) {
        document.getElementById("gcalTwoWay").checked = false;
        renderGcalSyncStatus("error", (e && e.message) || "開始失敗");
        alert("双方向同期の開始に失敗しました。\n\n詳細：" + ((e && e.message) || e));
      }
    } else {
      window.GCalSync.disable();
      toast("双方向同期を停止しました");
    }
  }
  function populateGcalCalendars(list) {
    const sel = document.getElementById("gcalCalendarSel");
    const cur = window.GCal.getConfig().calendarId;
    sel.innerHTML = "";
    (list || []).forEach((c) => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.summary + (c.primary ? "（メイン）" : "");
      sel.appendChild(o);
    });
    if ([].some.call(sel.options, (o) => o.value === cur)) sel.value = cur;
    else { const p = (list || []).find((c) => c.primary); if (p) sel.value = p.id; }
  }
  function openGcalModal() {
    if (isMobile()) closeDrawer();
    const c = window.GCal.getConfig();
    document.getElementById("gcalClientId").value = c.clientId || (window.Sync.getConfig().driveClientId || "");
    document.getElementById("gcalModal").classList.remove("hidden");
  }
  function closeGcalModal() { document.getElementById("gcalModal").classList.add("hidden"); }
  async function gcalConnect() {
    const clientId = document.getElementById("gcalClientId").value.trim();
    if (!clientId) { alert("OAuth クライアントIDを入力してください。"); return; }
    renderGcalStatus("connecting");
    try {
      await window.GCal.connect(clientId, document.getElementById("gcalCalendarSel").value || undefined);
      // 双方向同期が有効だった場合は、取得したトークンで再開
      if (window.GCalSync.isEnabled()) { try { await window.GCalSync.enable(); afterSyncApplied(); } catch (e2) {} }
      if (state.page === "calendar") renderCalendar();
      toast("Googleカレンダーを取り込みました");
    } catch (e) {
      renderGcalStatus("error", (e && e.message) || "接続失敗");
      alert("接続に失敗しました。\n・Google Calendar API を有効化\n・OAuth同意画面のテストユーザーに自分を追加\n・承認済みJavaScript生成元に公開URLを追加\nをご確認ください。\n\n詳細：" + ((e && e.message) || e));
    }
  }
  function gcalDisconnect() {
    window.GCal.disconnect();
    if (state.page === "calendar") renderCalendar();
    toast("Googleカレンダーを切断しました");
  }

  /* ---------- 横断検索 ---------- */
  function globalSearch(term) {
    term = term.trim().toLowerCase();
    if (!term) return;
    const events = S.getEvents().filter((e) => (e.title || "").toLowerCase().includes(term));
    const tasks = S.getTasks().filter((t) => (t.title || "").toLowerCase().includes(term));
    const notes = S.getNotes().filter((n) => (n.title || "").toLowerCase().includes(term) || (n.body || "").toLowerCase().includes(term));
    const total = events.length + tasks.length + notes.length;
    if (total === 0) { toast("「" + term + "」に一致する項目はありません"); return; }
    if (notes.length) { goTo("notes", notes[0].id); toast(`議事録 ${notes.length}件・予定 ${events.length}件・タスク ${tasks.length}件 一致`); }
    else if (tasks.length) { goTo("tasks"); toast(`タスク ${tasks.length}件・予定 ${events.length}件 一致`); }
    else if (events.length) {
      const e = events[0];
      state.cursor = D.fromKey(e.date); goTo("calendar");
      toast(`予定 ${events.length}件 一致`);
    }
  }

  /* ---------- 初期化 ---------- */
  function init() {
    initTheme();

    window.Calendar.setHooks({
      openEvent: (dateKey, ev, timeHint) => modal.open(dateKey, ev, timeHint),
      onDateSelect: (date) => {
        state.selected = date; state.cursor = date;
        setView("day"); renderMini();
      },
      onDrop: (info) => onDrop(info),
      onSwipe: (dir) => navigate(dir),
    });

    window.Tasks.init();
    window.Notes.init();

    // ヘッダー
    document.getElementById("themeToggle").addEventListener("click", toggleTheme);
    document.getElementById("todayBtn").addEventListener("click", () => {
      state.cursor = D.today(); state.selected = D.today(); state.miniCursor = D.today();
      renderCalendar("fade"); renderMini();
    });
    document.getElementById("prevBtn").addEventListener("click", () => navigate(-1));
    document.getElementById("nextBtn").addEventListener("click", () => navigate(1));
    document.querySelectorAll("#viewSwitch button").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    // ナビゲーション
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => goTo(btn.dataset.page));
    });

    // サイドバー / モバイルドロワー
    document.getElementById("menuToggle").addEventListener("click", toggleMenu);
    document.getElementById("backdrop").addEventListener("click", closeDrawer);

    // データのエクスポート / インポート
    document.getElementById("exportBtn").addEventListener("click", exportData);
    document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", handleImportFile);

    // 自動同期
    window.Sync.onStatus(renderSyncStatus);
    window.Sync.onAuth(renderAuth);
    document.getElementById("syncBtn").addEventListener("click", openSyncModal);
    document.getElementById("closeSyncModal").addEventListener("click", closeSyncModal);
    document.getElementById("syncCancelBtn").addEventListener("click", closeSyncModal);
    document.getElementById("syncMethodSel").addEventListener("change", (e) => switchSyncMethod(e.target.value));
    document.getElementById("driveSignInBtn").addEventListener("click", driveSignIn);
    document.getElementById("driveSignOutBtn").addEventListener("click", driveSignOut);
    document.getElementById("googleSignInBtn").addEventListener("click", googleSignIn);
    document.getElementById("googleSignOutBtn").addEventListener("click", googleSignOut);
    document.getElementById("syncEnableBtn").addEventListener("click", enableCodeSync);
    document.getElementById("syncDisableBtn").addEventListener("click", disableSync);
    document.getElementById("syncModal").addEventListener("click", (e) => { if (e.target.id === "syncModal") closeSyncModal(); });
    window.Sync.resume();

    // Googleカレンダー取り込み
    window.GCal.onStatus(renderGcalStatus);
    window.GCal.onChange(() => { if (state.page === "calendar") renderCalendar(); });
    window.GCal.onCalendars(populateGcalCalendars);
    document.getElementById("gcalBtn").addEventListener("click", openGcalModal);
    document.getElementById("closeGcalModal").addEventListener("click", closeGcalModal);
    document.getElementById("gcalCancelBtn").addEventListener("click", closeGcalModal);
    document.getElementById("gcalConnectBtn").addEventListener("click", gcalConnect);
    document.getElementById("gcalDisconnectBtn").addEventListener("click", gcalDisconnect);
    document.getElementById("gcalRefreshBtn").addEventListener("click", () => window.GCal.refresh());
    document.getElementById("gcalCalendarSel").addEventListener("change", (e) => window.GCal.setCalendar(e.target.value));
    document.getElementById("gcalModal").addEventListener("click", (e) => { if (e.target.id === "gcalModal") closeGcalModal(); });
    document.getElementById("showGCalOnCal").addEventListener("change", () => { if (state.page === "calendar") renderCalendar(); });
    window.GCal.resume();

    // 双方向同期（Phase 1）
    window.GCalSync.onStatus(renderGcalSyncStatus);
    document.getElementById("gcalTwoWay").addEventListener("change", (e) => toggleTwoWay(e.target.checked));
    window.GCalSync.resume();

    // 表示切替
    document.getElementById("showTasksOnCal").addEventListener("change", () => { if (state.page === "calendar") renderCalendar(); });
    document.getElementById("showNotesOnCal").addEventListener("change", () => { if (state.page === "calendar") renderCalendar(); });

    // 作成メニュー
    document.getElementById("createBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleCreateMenu(e.currentTarget); });
    document.querySelectorAll("#createMenu button").forEach((b) => {
      b.addEventListener("click", () => {
        document.getElementById("createMenu").classList.add("hidden");
        const type = b.dataset.create;
        if (type === "event") { goTo("calendar"); modal.open(D.key(state.selected), null); }
        else if (type === "task") { goTo("tasks"); document.getElementById("quickTaskInput").focus(); }
        else if (type === "note") { goTo("notes"); window.Notes.openNew(); }
      });
    });
    document.addEventListener("click", () => document.getElementById("createMenu").classList.add("hidden"));

    // 予定モーダル
    document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
    document.getElementById("cancelEventBtn").addEventListener("click", () => modal.close());
    document.getElementById("closeEventModal").addEventListener("click", () => modal.close());
    document.getElementById("deleteEventBtn").addEventListener("click", deleteEvent);
    document.getElementById("evAllDay").addEventListener("change", toggleTimeInputs);
    document.getElementById("evRepeat").addEventListener("change", updateRepeatUI);
    document.getElementById("evDate").addEventListener("change", () => {
      if (document.getElementById("evRepeat").value === "monthly") buildMonthlyOptions(document.getElementById("evMonthlyMode"));
    });
    document.getElementById("eventModal").addEventListener("click", (e) => { if (e.target.id === "eventModal") modal.close(); });
    document.getElementById("evTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") saveEvent(); });

    // 適用範囲ダイアログ
    document.getElementById("scopeThis").addEventListener("click", () => closeScope("this"));
    document.getElementById("scopeAll").addEventListener("click", () => closeScope("all"));
    document.getElementById("scopeCancel").addEventListener("click", () => closeScope(null));
    document.getElementById("scopeModal").addEventListener("click", (e) => { if (e.target.id === "scopeModal") closeScope(null); });

    // 検索
    const search = document.getElementById("globalSearch");
    search.addEventListener("keydown", (e) => { if (e.key === "Enter") globalSearch(search.value); });

    // ホイールでカレンダー移動
    const calView = document.getElementById("calendarView");
    calView.addEventListener("wheel", (e) => {
      if (state.page !== "calendar") return;
      if (state.view === "month") { e.preventDefault(); wheelNav(e.deltaY); }
      else if (e.target.closest(".time-header")) { e.preventDefault(); wheelNav(e.deltaY); }
    }, { passive: false });

    // データ変更の購読
    S.on("events", () => { if (state.page === "calendar") renderCalendar(); });
    S.on("tasks", () => { if (state.page === "calendar") renderCalendar(); });
    S.on("notes", () => { if (state.page === "calendar") renderCalendar(); });

    // キーボードショートカット
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "Escape") { modal.close(); closeScope(null); closeDrawer(); closeSyncModal(); closeGcalModal(); }
      if (state.page !== "calendar") return;
      if (e.key === "m") setView("month");
      else if (e.key === "w") setView("week");
      else if (e.key === "d") setView("day");
      else if (e.key === "t") document.getElementById("todayBtn").click();
      else if (e.key === "ArrowLeft") navigate(-1);
      else if (e.key === "ArrowRight") navigate(1);
    });

    // 初回描画
    renderMini();
    goTo("calendar");

    registerServiceWorker();
  }

  /* ---------- Service Worker 登録（オフライン対応） ---------- */
  function registerServiceWorker() {
    // http/https でのみ有効（file:// で直接開いた場合は登録しない）
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW登録失敗", e));
    });
  }

  window.App = { goTo, toast };
  document.addEventListener("DOMContentLoaded", init);
})();
