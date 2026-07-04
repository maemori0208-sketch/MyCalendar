# iPhoneで使う（ネット公開 → ホーム画面に追加）

このアプリは静的ファイルだけで動くので、無料の静的ホスティングにアップすればHTTPSでどこからでも使え、オフラインにも対応します（PCの電源は不要）。

## 方法A：Netlify Drop（最も簡単・CLI不要・おすすめ）

1. PCのブラウザで **https://app.netlify.com/drop** を開く
2. 公開用ZIP **`MyCalendar-site.zip`**（このフォルダの1つ上の階層にあります）を、そのページにドラッグ＆ドロップ
   - ※フォルダごとドラッグしてもOK
3. 数秒でデプロイされ、**`https://〇〇〇.netlify.app`** のようなURLが発行される
   - 無料アカウントでログイン（GitHub/メール等）すると、そのURLを保持できます
   - サイト名（サブドメイン）は Site settings → Change site name で変更可能
4. 発行されたURLを控える

## 方法B：GitHub Pages（GitHubアカウントがある場合）

1. GitHubで新しいリポジトリを作成（例: `mycalendar`、Public）
2. リポジトリの「Add file → Upload files」で、このフォルダの中身
   （`index.html` / `styles.css` / `manifest.webmanifest` / `sw.js` / `js/` / `icons/`）をアップロードしてコミット
3. Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `/(root)` にして保存
4. 1〜2分後、**`https://<ユーザー名>.github.io/mycalendar/`** で公開される

> ※ GitHub CLI (`gh`) を入れてもらえれば、リポジトリ作成〜公開までこちらで自動化できます。

## iPhoneでホーム画面に追加（共通）

1. **Safari** で発行されたURLを開く（※iOSではSafari推奨。Chrome等ではホーム画面アプリ化が制限されます）
2. 下部の **共有ボタン**（□に↑）をタップ
3. **「ホーム画面に追加」** をタップ → 「追加」
4. ホーム画面のアイコンから起動すると、アドレスバーなしの**全画面アプリ**として使えます
5. 一度開けば**オフライン**でも起動します（データはiPhone内に保存）

## メモ

- 予定・タスク・議事録のデータは、**その端末のブラウザ内（localStorage）** に保存されます。PCとiPhoneでデータは共有されません（各端末で独立）。
- アプリを更新（ファイル差し替え）したら、`sw.js` の `CACHE = "mycal-v1"` の番号を上げると、iPhone側のキャッシュが新しくなります。
