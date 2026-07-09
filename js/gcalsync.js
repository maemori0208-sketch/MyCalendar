/* =========================================================
 * gcalsync.js — アプリ⇄Googleカレンダーの双方向同期（Phase 1）
 *
 * 方針（安全側）：
 *  - 書き込みは専用カレンダー「MyCalendar (アプリ)」に限定（誤操作の影響を隔離）
 *  - 同期対象は「単発予定のみ」。繰り返し予定は対象外（gcal.js の取り込み表示のまま）
 *  - 有効化した時点の既存予定は基準(baseline)として保持し、以後に作成/編集した分だけ送信
 *  - 競合はドキュメント単位の後勝ち。自分の書き込みが戻ってきても二重化しないようエコー抑制
 *  - リアルタイムはポーリング（約20秒）で近似。認証は GCal と共有
 *
 * 認証済み fetch は window.GCal.api を再利用します。
 * ======================================================= */
window.GCalSync = (function () {
  "use strict";
  const S = window.Store;
  const D = window.Store.Dates;
  const LS = "mycal.gcalsync";
  const CAL_NAME = "MyCalendar (アプリ)";
  const API = "https://www.googleapis.com/calendar/v3";

  let st = load() || { enabled: false, writeCalId: null, syncToken: null, syncState: {}, initialized: false };
  let applying = false, pushTimer = null, pollTimer = null, subscribed = false, running = false;
  let statusCb = function () {};

  function load() { try { return JSON.parse(localStorage.getItem(LS)); } catch (e) { return null; } }
  function save() { localStorage.setItem(LS, JSON.stringify(st)); }
  function setStatus(s, d) { statusCb(s, d); }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } }
  function pad(n) { return String(n).padStart(2, "0"); }

  /* ===================== 純粋関数（テスト可能） ===================== */
  // Phase 1 の同期対象は「単発予定」のみ
  function isSyncable(ev) { return !ev.repeat || ev.repeat === "none"; }
  // 同期に関わるフィールドの署名（変更検知用。gcalId等は含めない）
  function sig(ev) {
    return [ev.title || "", ev.date || "", ev.allDay ? 1 : 0, ev.start || "", ev.end || "", ev.desc || ""].join("|");
  }
  // ローカル予定 → Google イベント資源
  function localToGoogle(ev) {
    const g = { summary: ev.title || "(タイトルなし)", description: ev.desc || "" };
    if (ev.allDay) {
      g.start = { date: ev.date };
      g.end = { date: D.key(D.addDays(D.fromKey(ev.date), 1)) };
    } else {
      g.start = { dateTime: ev.date + "T" + (ev.start || "09:00") + ":00", timeZone: tz() };
      g.end = { dateTime: ev.date + "T" + (ev.end || ev.start || "10:00") + ":00", timeZone: tz() };
    }
    return g;
  }
  // Google イベント → ローカル予定のフィールド
  function googleToLocalFields(gi) {
    const f = { title: gi.summary || "(無題)", desc: gi.description || "", gcalId: gi.id };
    if (gi.start && gi.start.date) {
      f.allDay = true; f.date = gi.start.date; f.start = ""; f.end = "";
    } else if (gi.start && gi.start.dateTime) {
      const sd = new Date(gi.start.dateTime);
      const ed = new Date((gi.end && gi.end.dateTime) || gi.start.dateTime);
      f.allDay = false; f.date = D.key(sd);
      f.start = pad(sd.getHours()) + ":" + pad(sd.getMinutes());
      f.end = pad(ed.getHours()) + ":" + pad(ed.getMinutes());
    } else {
      f.allDay = true; f.date = D.key(new Date()); f.start = ""; f.end = "";
    }
    return f;
  }
  // ローカルの現状と syncState から、送信すべき差分を算出
  function computeDiff(events, syncState) {
    const creates = [], updates = [], deletes = [];
    const cur = {};
    events.filter(isSyncable).forEach((ev) => { cur[ev.id] = ev; });
    Object.keys(cur).forEach((id) => {
      const ev = cur[id], prev = syncState[id];
      if (!prev) { creates.push(ev); }
      else if (prev.sig !== sig(ev)) { if (prev.gcalId) updates.push(ev); else creates.push(ev); }
    });
    Object.keys(syncState).forEach((id) => {
      if (!cur[id]) { const p = syncState[id]; deletes.push({ id: id, gcalId: p.gcalId || null }); }
    });
    return { creates, updates, deletes };
  }

  /* ===================== ネットワーク（GCal.api 経由） ===================== */
  function api(url, opts) { return window.GCal.api(url, opts); }
  function jsonBody(obj) { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) }; }

  async function ensureWriteCalendar() {
    if (st.writeCalId) return st.writeCalId;
    // 既存の同名カレンダーを探す
    const res = await api(API + "/users/me/calendarList?fields=" + encodeURIComponent("items(id,summary)"));
    const j = await res.json();
    const found = (j.items || []).find((c) => c.summary === CAL_NAME);
    if (found) { st.writeCalId = found.id; save(); return found.id; }
    // 無ければ作成
    const cres = await api(API + "/calendars", jsonBody({ summary: CAL_NAME, timeZone: tz() }));
    const cj = await cres.json();
    st.writeCalId = cj.id; save();
    return cj.id;
  }

  function calEventsUrl(extra) { return API + "/calendars/" + encodeURIComponent(st.writeCalId) + "/events" + (extra || ""); }

  // ローカル → Google 送信
  async function pushDiff() {
    if (!st.enabled || applying || !st.writeCalId) return;
    const diff = computeDiff(S.getEvents(), st.syncState);
    for (const ev of diff.creates) {
      try {
        const res = await api(calEventsUrl(), jsonBody(localToGoogle(ev)));
        const gi = await res.json();
        applying = true;
        const e = S.getEvent(ev.id);
        if (e) { e.gcalId = gi.id; S.upsertEvent(e); }
        applying = false;
        st.syncState[ev.id] = { sig: sig(ev), gcalId: gi.id };
      } catch (e) { setStatus("error", (e && e.message) || "送信失敗"); }
    }
    for (const ev of diff.updates) {
      const gcalId = st.syncState[ev.id].gcalId;
      try {
        await api(calEventsUrl("/" + encodeURIComponent(gcalId)), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localToGoogle(ev)) });
        st.syncState[ev.id] = { sig: sig(ev), gcalId: gcalId };
      } catch (e) { setStatus("error", (e && e.message) || "更新失敗"); }
    }
    for (const d of diff.deletes) {
      if (d.gcalId) {
        try { await api(calEventsUrl("/" + encodeURIComponent(d.gcalId)), { method: "DELETE" }); }
        catch (e) { /* 既に無い場合等は無視 */ }
      }
      delete st.syncState[d.id];
    }
    save();
    if (diff.creates.length || diff.updates.length || diff.deletes.length) setStatus("synced", Date.now());
  }

  // Google → ローカル反映
  function applyGoogleItem(gi) {
    const local = S.getEvents().find((e) => e.gcalId === gi.id);
    if (gi.status === "cancelled") {
      if (local) { delete st.syncState[local.id]; S.deleteEvent(local.id); }
      return;
    }
    if (gi.recurringEventId || gi.recurrence) return; // 繰り返しは Phase1 対象外
    const f = googleToLocalFields(gi);
    if (local) {
      Object.assign(local, { title: f.title, date: f.date, allDay: f.allDay, start: f.start, end: f.end, desc: f.desc });
      S.upsertEvent(local);
      st.syncState[local.id] = { sig: sig(local), gcalId: gi.id };
    } else {
      // 自分が送信した直後のエコーは無視
      const owned = Object.keys(st.syncState).some((id) => st.syncState[id].gcalId === gi.id);
      if (owned) return;
      const nev = S.upsertEvent({ title: f.title, date: f.date, allDay: f.allDay, start: f.start, end: f.end, desc: f.desc, color: "var(--c-blue)", repeat: "none", repeatUntil: "", exdates: [], gcalId: gi.id });
      st.syncState[nev.id] = { sig: sig(nev), gcalId: gi.id };
    }
  }

  async function pull() {
    if (!st.enabled || !st.writeCalId) return;
    let items = [], pageToken = null, nextSync = null, guard = 0;
    const fields = encodeURIComponent("items(id,summary,description,start,end,status,recurringEventId,recurrence),nextPageToken,nextSyncToken");
    do {
      let url;
      if (st.syncToken) url = calEventsUrl("?singleEvents=true&showDeleted=true&syncToken=" + encodeURIComponent(st.syncToken) + "&fields=" + fields);
      else {
        const now = new Date();
        const tMin = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
        url = calEventsUrl("?singleEvents=true&showDeleted=true&timeMin=" + encodeURIComponent(tMin) + "&fields=" + fields);
      }
      if (pageToken) url += "&pageToken=" + pageToken;
      const res = await api(url);
      if (res.status === 410) { st.syncToken = null; save(); return pull(); } // 失効 → 全再取得
      const j = await res.json();
      items = items.concat(j.items || []);
      pageToken = j.nextPageToken;
      if (j.nextSyncToken) nextSync = j.nextSyncToken;
      guard++;
    } while (pageToken && guard < 20);

    applying = true;
    try { items.forEach(applyGoogleItem); } finally { applying = false; }
    if (nextSync) st.syncToken = nextSync;
    save();
  }

  /* ===================== 制御 ===================== */
  function initializeBaseline() {
    // 有効化時点の既存単発予定を基準として記録（＝これらは自動送信しない。編集されたら送信）
    st.syncState = {};
    S.getEvents().filter(isSyncable).forEach((ev) => {
      st.syncState[ev.id] = { sig: sig(ev), gcalId: ev.gcalId || null };
    });
    st.initialized = true;
    save();
  }
  function subscribeLocal() {
    if (subscribed) return;
    subscribed = true;
    const onChange = () => {
      if (applying || !st.enabled) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushDiff().catch(() => {}), 800);
    };
    S.on("events", onChange);
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => { if (st.enabled) pull().catch(() => {}); }, 20000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // 有効化（ユーザー操作・GCal ログイン済みが前提）
  async function enable() {
    st.enabled = true; save();
    if (running) return;
    running = true;
    setStatus("connecting");
    try {
      await ensureWriteCalendar();
      if (!st.initialized) initializeBaseline();
      subscribeLocal();
      await pull();       // まず Google 側の変更を取り込み
      await pushDiff();   // 基準以降のローカル変更を送信
      startPoll();
      setStatus("synced", Date.now());
    } catch (e) {
      setStatus("error", (e && e.message) || "同期の開始に失敗しました");
    } finally { running = false; }
  }

  function disable() {
    st.enabled = false; save();
    stopPoll();
    setStatus("disabled");
  }

  function resume() {
    // 起動時は自動でトークン要求しない（ポップアップ回避）。GCal 接続後に enable() される。
    setStatus(st.enabled ? "signin" : "disabled");
  }

  return {
    enable, disable, resume,
    isEnabled: () => !!st.enabled,
    getWriteCalName: () => CAL_NAME,
    onStatus: (cb) => { statusCb = cb; },
    // テスト用に内部関数を公開
    _pure: { isSyncable, sig, localToGoogle, googleToLocalFields, computeDiff },
    _applyGoogleItem: applyGoogleItem,
    _state: () => st,
    _setState: (s) => { st = s; },
    _pushDiff: pushDiff, _pull: pull, _ensureWriteCalendar: ensureWriteCalendar,
  };
})();
