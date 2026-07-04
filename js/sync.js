/* =========================================================
 * sync.js — PC↔スマホの自動同期（クラウド）
 *
 * 3つの方式に対応：
 *   1) Google ドライブ（推奨・Firebase不要）
 *      Google ログイン（Google Identity Services）＋ Drive API。
 *      データはあなたの Google ドライブの「アプリ専用フォルダ(appDataFolder)」に
 *      1ファイル(mycalendar.json)として保存。DB構築は不要。
 *      各端末で同じ OAuth クライアントID を使いログインするだけ。
 *   2) Google ログイン（Firebase Authentication）
 *      /users/{uid} に保存。ルールで本人のみ読み書き可。
 *   3) 同期コード（ログイン不要・Firebase RTDB）
 *      /spaces/{code} に保存。両端末で同じURL＋コード。
 *
 * 競合はドキュメント全体の後勝ち（個人利用向け）。
 * ======================================================= */
window.Sync = (function () {
  "use strict";
  const S = window.Store;
  const LS = "mycal.sync";
  const FB_VER = "9.23.0";
  const DRIVE_FILE = "mycalendar.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";

  let cfg = loadCfg();          // { enabled, mode, url, code, fb, driveClientId }
  let es = null;
  let pollTimer = null;
  let pushTimer = null;
  let applying = false;
  let lastSig = null;
  let subscribed = false;
  let initialDone = false;
  let statusCb = function () {};
  let authCb = function () {};

  // Firebase(google) 用
  let fbLoaded = false, app = null, uid = null, idToken = null;
  // Drive 用
  let gisLoaded = false, tokenClient = null, driveToken = null, driveTokenExp = 0;
  let driveFileId = null, driveLastModified = null, driveEmail = "", tokenWaiters = [];

  function loadCfg() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function saveCfg() { localStorage.setItem(LS, JSON.stringify(cfg)); }
  function trim(s) { return (s || "").replace(/\/+$/, ""); }

  /* ---------- 共通ユーティリティ ---------- */
  function stable(x) {
    if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stable(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  function sig(d) { return stable({ events: d.events || [], tasks: d.tasks || [], notes: d.notes || [] }); }
  function localData() { return { events: S.getEvents(), tasks: S.getTasks(), notes: S.getNotes(), _updatedAt: Date.now() }; }
  function hasData(d) { return d && (Array.isArray(d.events) || Array.isArray(d.tasks) || Array.isArray(d.notes)); }
  function setStatus(s, detail) { statusCb(s, detail); }

  function applyRemote(remote) {
    if (!remote) return;
    const s = sig(remote);
    if (s === lastSig) return;
    lastSig = s;
    applying = true;
    try { S.importData({ events: remote.events || [], tasks: remote.tasks || [], notes: remote.notes || [] }, "replace"); }
    finally { applying = false; }
    setStatus("synced", Date.now());
  }
  function subscribeLocal() {
    if (subscribed) return;
    subscribed = true;
    const onChange = () => {
      if (applying || !cfg.enabled) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => doPush(false), 700);
    };
    S.on("events", onChange); S.on("tasks", onChange); S.on("notes", onChange);
  }
  function doPush(force) { return cfg.mode === "drive" ? drivePush(force) : rtdbPush(force); }

  async function initialSync(getRemote, promptChoice) {
    let remote = null;
    try { remote = await getRemote(); } catch (e) {}
    if (!hasData(remote)) { await doPush(true); return; }
    if (promptChoice) {
      const pull = confirm("クラウドに既存のデータがあります。\n\n［OK］クラウドを取り込む（この端末を置き換え）\n［キャンセル］この端末の内容でクラウドを上書き");
      if (pull) applyRemote(remote); else await doPush(true);
    } else applyRemote(remote);
  }

  /* ========== RTDB（google / code 共通のデータプレーン） ========== */
  function endpoint() {
    if (cfg.mode === "google") {
      if (!uid || !idToken || !cfg.fb || !cfg.fb.databaseURL) return null;
      return trim(cfg.fb.databaseURL) + "/users/" + uid + ".json?auth=" + encodeURIComponent(idToken);
    }
    if (cfg.mode === "code") {
      if (!cfg.url || !cfg.code) return null;
      return trim(cfg.url) + "/spaces/" + encodeURIComponent(cfg.code) + ".json";
    }
    return null;
  }
  async function getJSON(ep) {
    const res = await fetch(ep, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }
  async function rtdbPush(force) {
    if (!cfg.enabled) return;
    const ep = endpoint();
    if (!ep) return;
    const data = localData(), s = sig(data);
    if (!force && s === lastSig) return;
    lastSig = s;
    setStatus("syncing");
    try {
      const res = await fetch(ep, { method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setStatus("synced", Date.now());
    } catch (e) { setStatus("error", (e && e.message) || "送信失敗"); }
  }
  function startStream() {
    stopStream();
    const ep = endpoint();
    if (!ep || typeof EventSource === "undefined") return;
    try {
      es = new EventSource(ep);
      const onMsg = (e) => {
        if (!e.data) return;
        let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg.path === "/") { if (msg.data != null) applyRemote(msg.data); }
        else { const p = endpoint(); if (p) getJSON(p).then((d) => { if (d) applyRemote(d); }).catch(() => {}); }
      };
      es.addEventListener("put", onMsg);
      es.addEventListener("patch", onMsg);
      es.onerror = () => setStatus("reconnecting");
    } catch (e) { setStatus("error", (e && e.message) || "接続失敗"); }
  }
  function stopStream() { if (es) { es.close(); es = null; } }

  /* ---------- ポーリング（保険 / Driveは主手段） ---------- */
  function startPoll() {
    stopPoll();
    const iv = cfg.mode === "drive" ? 15000 : 25000;
    pollTimer = setInterval(() => {
      if (!cfg.enabled) return;
      if (cfg.mode === "drive") { drivePull().catch(() => {}); return; }
      const ep = endpoint();
      if (ep) getJSON(ep).then((d) => { if (d) applyRemote(d); }).catch(() => {});
    }, iv);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  /* ========== 方式1：Google ドライブ ========== */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error("読み込み失敗: " + src));
      document.head.appendChild(s);
    });
  }
  async function ensureGis() {
    if (gisLoaded) return;
    await loadScript("https://accounts.google.com/gsi/client");
    gisLoaded = true;
  }
  function tokenCallback(resp) {
    const ws = tokenWaiters; tokenWaiters = [];
    if (resp && resp.access_token) {
      driveToken = resp.access_token;
      driveTokenExp = Date.now() + ((resp.expires_in || 3600) * 1000);
      ws.forEach((w) => w.res(driveToken));
    } else {
      const err = new Error((resp && (resp.error_description || resp.error)) || "認証に失敗しました");
      ws.forEach((w) => w.rej(err));
    }
  }
  function ensureTokenClient() {
    if (tokenClient) return;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.driveClientId, scope: DRIVE_SCOPE, callback: tokenCallback,
    });
  }
  function requestToken(interactive) {
    return new Promise((res, rej) => {
      tokenWaiters.push({ res, rej });
      // interactive=false は prompt:'none'（UIを出さずに静かに試行）
      try { tokenClient.requestAccessToken(interactive ? {} : { prompt: "none" }); }
      catch (e) { tokenWaiters.pop(); rej(e); }
    });
  }
  async function getToken() {
    if (driveToken && Date.now() < driveTokenExp - 60000) return driveToken;
    return requestToken(false); // サイレント更新
  }
  async function driveFetch(url, opts) {
    const t = await getToken();
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + t });
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 404) throw new Error("Drive HTTP " + res.status);
    return res;
  }
  async function driveFindFile() {
    const q = encodeURIComponent("name='" + DRIVE_FILE + "'");
    const res = await driveFetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=" + q);
    const j = await res.json();
    return (j.files && j.files[0]) || null;
  }
  async function driveDownload(id) {
    const res = await driveFetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media");
    return await res.json();
  }
  async function driveCreate(data) {
    const boundary = "mcb" + Math.random().toString(36).slice(2);
    const meta = { name: DRIVE_FILE, parents: ["appDataFolder"], mimeType: "application/json" };
    const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify(data) + "\r\n--" + boundary + "--";
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body });
    return await res.json();
  }
  async function driveUpdate(id, data) {
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media&fields=id,modifiedTime",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return await res.json();
  }
  let drivePushing = false;
  async function drivePush(force) {
    if (!cfg.enabled || cfg.mode !== "drive") return;
    const data = localData(), s = sig(data);
    if (!force && s === lastSig) return;
    if (drivePushing) return;
    drivePushing = true;
    lastSig = s;
    setStatus("syncing");
    try {
      if (!driveFileId) { const f = await driveFindFile(); driveFileId = f && f.id; }
      const r = driveFileId ? await driveUpdate(driveFileId, data) : await driveCreate(data);
      driveFileId = r.id || driveFileId;
      driveLastModified = r.modifiedTime || driveLastModified;
      setStatus("synced", Date.now());
    } catch (e) { setStatus("error", (e && e.message) || "送信失敗"); }
    finally { drivePushing = false; }
  }
  async function drivePull() {
    if (!cfg.enabled || cfg.mode !== "drive") return;
    const f = await driveFindFile();
    if (!f) return;
    driveFileId = f.id;
    if (f.modifiedTime === driveLastModified) return; // 変化なし
    const data = await driveDownload(f.id);
    driveLastModified = f.modifiedTime;
    if (hasData(data)) applyRemote(data);
  }
  async function fetchDriveEmail() {
    try {
      const res = await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo");
      const j = await res.json();
      driveEmail = j.email || "";
      authCb({ signedIn: true, email: driveEmail, name: j.name || "" });
    } catch (e) { authCb({ signedIn: true, email: "", name: "Google" }); }
  }
  async function onDriveAuthed() {
    setStatus("connecting");
    if (!initialDone) {
      initialDone = true;
      const f = await driveFindFile();
      if (!f) { await drivePush(true); }
      else {
        driveFileId = f.id; driveLastModified = f.modifiedTime;
        const remote = await driveDownload(f.id);
        if (hasData(remote)) {
          const pull = confirm("Google ドライブに既存のデータがあります。\n\n［OK］ドライブを取り込む（この端末を置き換え）\n［キャンセル］この端末の内容でドライブを上書き");
          if (pull) applyRemote(remote); else await drivePush(true);
        } else await drivePush(true);
      }
      subscribeLocal();
    }
    startPoll();
    setStatus("synced", Date.now());
  }
  function setDriveConfig(clientId) {
    clientId = (clientId || "").trim();
    if (!clientId) throw new Error("OAuth クライアントIDを入力してください");
    cfg.mode = "drive"; cfg.driveClientId = clientId; saveCfg();
  }
  async function driveSignIn() {
    if (cfg.mode !== "drive" || !cfg.driveClientId) throw new Error("先に OAuth クライアントID を保存してください");
    cfg.enabled = true; saveCfg();
    await ensureGis();
    ensureTokenClient();
    await requestToken(true);   // 対話ログイン
    await fetchDriveEmail();
    await onDriveAuthed();
  }
  async function driveSignOut() {
    try { if (driveToken && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(driveToken); } catch (e) {}
    driveToken = null; driveTokenExp = 0; driveFileId = null; driveLastModified = null; initialDone = false;
    stopPoll();
    authCb({ signedIn: false });
    setStatus(cfg.enabled ? "signin" : "disabled");
  }

  /* ========== 方式2：Google ログイン（Firebase） ========== */
  async function ensureFirebase() {
    if (fbLoaded) return;
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth-compat.js`);
    fbLoaded = true;
  }
  function initApp() {
    if (app) return;
    app = (window.firebase.apps && window.firebase.apps.length) ? window.firebase.app() : window.firebase.initializeApp(cfg.fb);
    window.firebase.auth().onIdTokenChanged(handleUser);
    window.firebase.auth().getRedirectResult().catch(() => {});
  }
  function handleUser(user) {
    if (user) user.getIdToken().then((t) => { idToken = t; onSignedIn(user); }).catch((e) => setStatus("error", e.message));
    else onSignedOut();
  }
  async function onSignedIn(user) {
    uid = user.uid;
    authCb({ signedIn: true, email: user.email || "", name: user.displayName || "" });
    setStatus("connecting");
    if (!initialDone) {
      initialDone = true;
      try { await initialSync(() => getJSON(endpoint()), true); } catch (e) { setStatus("error", (e && e.message) || "同期失敗"); }
      subscribeLocal();
    }
    startStream(); startPoll();
    setStatus("synced", Date.now());
  }
  function onSignedOut() {
    uid = null; idToken = null; initialDone = false;
    stopStream(); stopPoll();
    authCb({ signedIn: false });
    setStatus(cfg.enabled ? "signin" : "disabled");
  }
  function setGoogleConfig(fb) {
    if (!fb || !fb.apiKey || !fb.authDomain || !fb.databaseURL || !fb.projectId) throw new Error("apiKey / authDomain / databaseURL / projectId が必要です");
    cfg.mode = "google"; cfg.fb = fb; saveCfg();
  }
  async function googleSignIn() {
    if (cfg.mode !== "google" || !cfg.fb) throw new Error("先に Firebase 設定を保存してください");
    cfg.enabled = true; saveCfg();
    await ensureFirebase(); initApp();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    try { await window.firebase.auth().signInWithPopup(provider); }
    catch (e) {
      if (e && e.code && /popup|cancelled|blocked/i.test(e.code)) await window.firebase.auth().signInWithRedirect(provider);
      else throw e;
    }
  }
  async function googleSignOut() {
    try { if (fbLoaded && window.firebase.apps.length) await window.firebase.auth().signOut(); } catch (e) {}
    onSignedOut();
  }

  /* ========== 方式3：同期コード ========== */
  async function enableCode(url, code, choice) {
    url = (url || "").trim(); code = (code || "").trim();
    if (!url || !code) throw new Error("URLと同期コードを入力してください");
    cfg = Object.assign({}, cfg, { mode: "code", url, code, enabled: true });
    saveCfg();
    setStatus("connecting");
    const remote = await getJSON(endpoint());
    if (!hasData(remote)) await rtdbPush(true);
    else if (choice === "push") await rtdbPush(true);
    else applyRemote(remote);
    startStream(); startPoll(); subscribeLocal();
    setStatus("synced", Date.now());
  }
  async function probeCode(url, code) { return await getJSON(trim(url) + "/spaces/" + encodeURIComponent(code) + ".json"); }

  /* ========== 共通 ========== */
  function disable() {
    const mode = cfg.mode;
    cfg.enabled = false; saveCfg();
    stopStream(); stopPoll();
    if (mode === "drive") driveSignOut();
    else if (mode === "google") googleSignOut();
    setStatus("disabled");
  }
  function resume() {
    if (!cfg.enabled) { setStatus("disabled"); return; }
    if (cfg.mode === "drive") {
      // 自動ではトークンを要求しない（起動時ポップアップを避ける）。ユーザー操作で再開。
      setStatus("signin");
      return;
    }
    if (cfg.mode === "google") {
      setStatus("connecting");
      ensureFirebase().then(() => initApp()).catch((e) => setStatus("error", (e && e.message) || "接続失敗"));
      return;
    }
    // code
    setStatus("connecting");
    subscribeLocal(); startStream(); startPoll();
    getJSON(endpoint())
      .then((d) => { if (hasData(d)) applyRemote(d); else rtdbPush(true); setStatus("synced", Date.now()); })
      .catch((e) => setStatus("error", (e && e.message) || "接続失敗"));
  }

  window.addEventListener("online", () => {
    if (!cfg.enabled) return;
    if (cfg.mode === "drive") { drivePull().catch(() => {}); return; }
    startStream();
    const ep = endpoint();
    if (ep) getJSON(ep).then((d) => { if (d) applyRemote(d); }).catch(() => {});
  });

  return {
    resume, disable,
    isEnabled: () => !!cfg.enabled,
    getMode: () => cfg.mode || "drive",
    getConfig: () => ({ url: cfg.url || "", code: cfg.code || "", fb: cfg.fb || null, driveClientId: cfg.driveClientId || "" }),
    onStatus: (cb) => { statusCb = cb; },
    onAuth: (cb) => { authCb = cb; },
    pushNow: () => doPush(true),
    // Drive
    setDriveConfig, driveSignIn, driveSignOut,
    // Firebase Google
    setGoogleConfig, googleSignIn, googleSignOut,
    // Code
    enableCode, probeCode,
  };
})();
