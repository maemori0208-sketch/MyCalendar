/* =========================================================
 * gcal.js — Google カレンダーの取り込み（読み取り専用）
 *
 * Google ログイン（Google Identity Services）＋ Google Calendar API。
 * 予定を単発の予定に展開して取得し、カレンダー上に「Google」印で表示します。
 * あなたの Google カレンダーには一切書き込みません（calendar.readonly）。
 * 取得結果はローカルにキャッシュし、オフラインでも直近の内容を表示します。
 * ======================================================= */
window.GCal = (function () {
  "use strict";
  const D = window.Store.Dates;
  const LS_CFG = "mycal.gcal";
  const LS_CACHE = "mycal.gcal.cache";
  // 読み取り（取り込み表示）に加え、双方向同期のためカレンダー作成・書き込みも行うため full scope
  const SCOPE = "https://www.googleapis.com/auth/calendar";

  let cfg = load(LS_CFG) || {};             // { enabled, clientId, calendarId }
  let gEvents = load(LS_CACHE) || [];       // 正規化済みイベント（キャッシュ）
  let byDate = {};
  let token = null, tokenExp = 0, tokenClient = null, gisLoaded = false, waiters = [];
  let refreshTimer = null;
  let statusCb = function () {}, changeCb = function () {}, calsCb = function () {};

  index();

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveCfg() { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); }
  function saveCache() { try { localStorage.setItem(LS_CACHE, JSON.stringify(gEvents)); } catch (e) {} }
  function setStatus(s, d) { statusCb(s, d); }
  function hhmm(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

  function index() {
    byDate = {};
    gEvents.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  }

  /* ---------- 認証（Google Identity Services） ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error("読み込み失敗: " + src));
      document.head.appendChild(s);
    });
  }
  async function ensureGis() {
    if (gisLoaded) return;
    await loadScript("https://accounts.google.com/gsi/client");
    gisLoaded = true;
  }
  function tokenCallback(resp) {
    const ws = waiters; waiters = [];
    if (resp && resp.access_token) {
      token = resp.access_token;
      tokenExp = Date.now() + ((resp.expires_in || 3600) * 1000);
      ws.forEach((w) => w.res(token));
    } else {
      const err = new Error((resp && (resp.error_description || resp.error)) || "認証に失敗しました");
      ws.forEach((w) => w.rej(err));
    }
  }
  function ensureTokenClient() {
    if (tokenClient) return;
    tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: cfg.clientId, scope: SCOPE, callback: tokenCallback });
  }
  function requestToken(interactive) {
    return new Promise((res, rej) => {
      waiters.push({ res, rej });
      // interactive=false は prompt:'none'（UIを一切出さない）。取得できなければ静かに失敗
      try { tokenClient.requestAccessToken(interactive ? {} : { prompt: "none" }); }
      catch (e) { waiters.pop(); rej(e); }
    });
  }
  async function getToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    return requestToken(false);
  }
  function withAuth(opts, t) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + t });
    return opts;
  }
  async function apiFetch(url, opts) {
    let t = await getToken();
    let res = await fetch(url, withAuth(opts, t));
    if (res.status === 401) { token = null; t = await getToken(); res = await fetch(url, withAuth(opts, t)); }
    if (!res.ok) {
      let detail = "", reason = "";
      try {
        const j = await res.json();
        if (j && j.error) {
          detail = j.error.message || "";
          reason = (j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || j.error.status || "";
        }
      } catch (_) {}
      // よくある原因を日本語で補足
      let hint = "";
      if (res.status === 403) {
        if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(detail + reason)) {
          hint = "（Google Calendar API が未有効化の可能性。Cloud Console で有効化してください）";
        } else if (/insufficient|scope/i.test(detail + reason)) {
          hint = "（カレンダー権限が未付与。いったん切断してログインし直してください）";
        } else {
          hint = "（APIの有効化 / スコープ付与 をご確認ください）";
        }
      }
      throw new Error("Calendar HTTP " + res.status + (detail ? "：" + detail : "") + hint);
    }
    return res;
  }

  /* ---------- 取り込み ---------- */
  function normalize(items) {
    const out = [];
    items.forEach((ev) => {
      if (ev.status === "cancelled") return;
      const title = ev.summary || "(無題)";
      const base = { title, htmlLink: ev.htmlLink || "", desc: ev.description || "", calId: ev._calId || "" };
      if (ev.start && ev.start.date) {
        // 終日（複数日は各日に展開。end.date は排他的）
        let d = D.fromKey(ev.start.date);
        const endD = (ev.end && ev.end.date) ? D.fromKey(ev.end.date) : D.addDays(d, 1);
        let guard = 0;
        while (d < endD && guard < 400) {
          out.push(Object.assign({}, base, { id: ev.id + "@" + D.key(d), date: D.key(d), allDay: true, start: "", end: "" }));
          d = D.addDays(d, 1); guard++;
        }
      } else if (ev.start && ev.start.dateTime) {
        const sd = new Date(ev.start.dateTime);
        const ed = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
        out.push(Object.assign({}, base, { id: ev.id, date: D.key(sd), allDay: false, start: hhmm(sd), end: hhmm(ed) }));
      }
    });
    return out;
  }

  async function fetchCalendars() {
    const res = await apiFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,primary,backgroundColor)");
    const j = await res.json();
    return (j.items || []);
  }

  async function importEvents() {
    if (!cfg.enabled) return;
    setStatus("syncing");
    try {
      const calId = cfg.calendarId || "primary";
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
      const timeMax = new Date(now.getFullYear() + 1, now.getMonth() + 6, 1).toISOString();
      let items = [], pageToken = null, guard = 0;
      do {
        const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calId) +
          "/events?singleEvents=true&orderBy=startTime&maxResults=2500" +
          "&timeMin=" + encodeURIComponent(timeMin) + "&timeMax=" + encodeURIComponent(timeMax) +
          "&fields=" + encodeURIComponent("items(id,summary,description,start,end,htmlLink,status),nextPageToken") +
          (pageToken ? "&pageToken=" + pageToken : "");
        const res = await apiFetch(url);
        const j = await res.json();
        items = items.concat(j.items || []);
        pageToken = j.nextPageToken;
        guard++;
      } while (pageToken && guard < 20);
      gEvents = normalize(items);
      saveCache(); index();
      setStatus("synced", Date.now());
      changeCb();
    } catch (e) {
      setStatus("error", (e && e.message) || "取得失敗");
    }
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(() => { if (cfg.enabled) importEvents(); }, 600000); // 10分ごと
  }
  function stopRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

  /* ---------- 公開操作 ---------- */
  async function connect(clientId, calendarId) {
    clientId = (clientId || "").trim();
    if (!clientId) throw new Error("OAuth クライアントIDを入力してください");
    cfg.clientId = clientId;
    if (calendarId) cfg.calendarId = calendarId;
    cfg.enabled = true;
    saveCfg();
    setStatus("connecting");
    await ensureGis();
    ensureTokenClient();
    await requestToken(true);
    try { const cals = await fetchCalendars(); calsCb(cals); } catch (e) {}
    await importEvents();
    startRefresh();
  }

  function setCalendar(calendarId) {
    cfg.calendarId = calendarId; saveCfg();
    if (cfg.enabled) importEvents();
  }

  function disconnect() {
    try { if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token); } catch (e) {}
    token = null; tokenExp = 0; cfg.enabled = false; saveCfg();
    stopRefresh();
    gEvents = []; saveCache(); index();
    setStatus("disabled");
    changeCb();
  }

  function resume() {
    if (!(cfg.enabled && cfg.clientId)) { setStatus("disabled"); return; }
    // 自動ではトークンを要求しない（起動時ポップアップを避けるため）。
    // キャッシュ済みのGoogle予定はそのまま表示し、更新はユーザー操作時に行う。
    setStatus("signin");
    changeCb();
  }

  return {
    connect, disconnect, setCalendar, resume,
    refresh: importEvents,
    isEnabled: () => !!cfg.enabled,
    getConfig: () => ({ clientId: cfg.clientId || "", calendarId: cfg.calendarId || "primary" }),
    eventsOn: (dateKey) => byDate[dateKey] || [],
    onStatus: (cb) => { statusCb = cb; },
    onChange: (cb) => { changeCb = cb; },
    onCalendars: (cb) => { calsCb = cb; },
    // 双方向同期エンジン（gcalsync.js）が認証済みfetchを再利用するために公開
    api: (url, opts) => apiFetch(url, opts),
    hasToken: () => !!(token && Date.now() < tokenExp),
  };
})();
