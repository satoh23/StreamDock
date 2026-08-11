# 061c エフェクトテンプレート取り込み（アセット＋宣言的レイアウト）

> 状態: ✅ **実装済み（2026-08-11）／security-review 実施済み（判定「問題なし」）**。
> ⚠ **実機確認は [061d](061d-effect-template-ui.md) へ移管した**（下記「実装で判明した前提」①）。
> 判断の根拠・ミューテーション結果・申し送りは [`docs/progress.md`](../progress.md) の 061c 節が正。
> 分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、発火層 [061b](061b-monetary-effect-builtin.md)（`EffectRequest` の正）、
> **取り込み方式の先行実装 [060b](060b-custom-css-import-backend.md)（本タスクはこれをなぞる）** と先行設計 [039a](039a-font-import-rust-storage.md)、
> Rust モジュールの層構造 [`viewer_memory/`](../../apps/desktop/src-tauri/src/viewer_memory/)、
> data URI 供給の先例 [036a](036a-avatar-wire-and-overlay-render.md)（`avatarDataUri` のガード）と [`tools/icon.rs`](../../apps/desktop/src-tauri/src/tools/icon.rs)、
> capability [`default.json`](../../apps/desktop/src-tauri/capabilities/default.json)（**main 窓は `dialog:allow-open` を既に持つ**）、
> [`docs/security.md`](../security.md)（**§3／§5／§8／§9／§10／## CSP方針／レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **security-review 必須**（第三者が作ったファイルの取り込み・新規ファイル書き込み経路）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[061b](061b-monetary-effect-builtin.md) 完了**。

## 目的

依頼者の要望④の**マスト要件**「OBS のエフェクトを import して**そのままテンプレートとして適用**できる形にしたい」を実装する。

親 061 の決定どおり、テンプレートは **アセット（画像/GIF/APNG/WebM(alpha)/音源）＋宣言的レイアウト（`manifest.json`）**で、
**HTML/CSS/JS は実行しない**。

## 現在の前提（調査結果・実コード）

- **ファイル取り込みの経路は [060b](060b-custom-css-import-backend.md) で 1 度作られている**（CSS 用）。
  `app_data_dir/<種別>/` へコピー＋Rust 検証＋SQLite レジストリ＋文字列/data URI で webview へ供給、という形。
  **本タスクはその 2 例目**なので、設計を発明せず 060b をなぞる。
- **main 窓（`default.json`）は既に `dialog:allow-open` を持っている。**
  エフェクト画面は main 窓なので、**capability の追加は不要**（060b が `comment-viewer.json` に足したのとは事情が違う）。
- data URI で webview へメディアを渡す先例が複数ある（`tools.icon_png` の base64 PNG・036 系のアバター）。
  ⚠ **036a のガード**（`avatarDataUri`）が「webview が踏むのは data URI のみ」という §1 の不変条件を
  描画シンクで強制している。**エフェクトのメディアにも同じ形のガードを置く。**
- DB は `CREATE TABLE IF NOT EXISTS` ＋ `ensure_column` の作法。マイグレーション基盤は無い。
- ⚠ **アプリ定義コマンドは ACL の対象外**（[`docs/security.md`](../security.md) 046b 節）＝
  ここで足すコマンドは**全窓から呼べる**。コマンド自体を狭く作る。

## このタスクでやること

### (1) テンプレートの形式を定義する

**1 テンプレート = 1 ディレクトリ**。ユーザーが選ぶのは**ディレクトリ**（またはその中の `manifest.json`）。

```
my-effect/
  manifest.json
  main.webm        （または .png / .gif / .apng）
  sound.wav        （任意）
```

`manifest.json` のスキーマ（**URL フィールドを作らない**＝外部取得の経路を最初から作らない）:

```jsonc
{
  "schemaVersion": 1, // 1 と完全一致のみ（>1 は「更新してください」・それ以外は「不正な形式」）
  "name": "きらきら", // 1〜80 文字・制御文字なし・trim される
  "media": "main.webm", // ⚠ 単一のファイル名のみ（下記の規則）
  "sound": "sound.wav", // 任意・同上
  "durationMs": 5000, // 500〜15000
  "layout": {
    "anchor": "center", // 9 値の固定 union
    "offsetX": 0, // 任意（既定 0）・-4096〜4096
    "offsetY": 0, // 任意（既定 0）・-4096〜4096
    "width": 640, // 16〜1920
    "height": 360, // 16〜1080
  },
  "text": {
    // 任意。差し込み変数の配置
    "template": "{name} さんが {amount}", // 金額**あり**のとき。1〜200 文字
    "templateWithoutAmount": "{message}", // 任意（既定 "{message}"）。金額**なし**のとき
    "anchor": "bottom", // 9 値の固定 union
    "fontSize": 32, // 8〜128
  },
}
```

- `anchor` の 9 値: `top-left` / `top` / `top-right` / `left` / `center` / `right` /
  `bottom-left` / `bottom` / `bottom-right`。
- **`media` / `sound` のファイル名規則**（`service::is_template_asset_name`）:
  非空・100 文字以下／`/` `\` `:` を含まない／NUL・制御文字を含まない／`..` を含まない／先頭が `.` でない／
  拡張子が許可リストに一致（ASCII 大小無視）／**語幹が Windows の予約デバイス名でない**
  （`CON` / `PRN` / `AUX` / `NUL` / `CONIN$` / `CONOUT$` / `COM0`〜`COM9` / `LPT0`〜`LPT9` /
  **上付き数字版 `COM¹` `COM²` `COM³` `LPT¹` `LPT²` `LPT³`** の 32 件。⚠ 語幹は **trim してから**比較する
  ——Windows は名前部の末尾空白を除去してからデバイス判定するので `"CON .png"` も解決しうる。
  ⚠ Windows では `COM1.png` がシリアルポートに解決して**開いた瞬間に固まりうる**。macOS では踏めないので
  実挙動は [098](098-windows-build.md) へ申し送り。
  ⚠⚠ 当初は 22 件・trim 無しで、上記の**上付き数字版・`COM0`/`LPT0`・`CONIN$`/`CONOUT$`・末尾空白形が
  素通りしていた**（security-review② S-2）。**不完全な拒否リストは「守られている」と誤読させる**）。
- 拡張子の許可リスト: media = `png` / `apng` / `gif` / `webp` / `webm`、sound = `wav` / `mp3` / `ogg`。
  ⚠⚠ **`.svg` は入れない**（理由は `docs/security.md` §8 の 061c 節）。
- ⚠ **すべての struct が `deny_unknown_fields`**。ただし **`schemaVersion` を先に見る 2 段構え**にしてある
  （直接落とすと、将来の版で増えたフィールドが `deny_unknown_fields` に先に落とされ
  「アプリを更新してください」と案内できない）。
- ⚠ **URL フィールドは 1 つも無い**（外部取得の経路を最初から作らない・§1）。
  契約テストが `model.rs` に `url:` / `href:` / `src:` / `endpoint:` が現れないことを固定している。

**⚠⚠ 差し込み変数は 3 つ → 4 つへ変更した**（`{name}` / `{amount}` / `{event}` / **`{message}`**）。

- 理由＝実コードの `EffectRequest` は **`amountText: string | null`** で、
  **サブスク／メンシプ／ギフト（課金イベントの大半）では null** になる。さらに
  `commentAmount` と `composeEventMessage` の仕様上 **`amountText` と `message` は同時に null になりうる**。
  3 つのままだと `"{name} さんが {amount}"` が「**テスト さんが 」**になり、
  「出さない」に倒すとサブスク系でテンプレートが一切出なくなる。
- **§9 の正当化**: `{message}` の値は `composeEventMessage` が組む文で、その入力は
  `eventType` / `source` / `author.name` / `monthCount` / `giftCount` / `tier` **だけ**。
  **第三者の自由入力は `author.name` ただ 1 つ**で、それは**既に `{name}` として露出済み**。
  ＝ **新しい第三者データ面を 1 バイトも増やしていない。**
- ⚠ **本文（`text`）とアバターは、変数を足しても渡せない**——`EffectRequest` にフィールドとして
  存在しないため（**型による担保**）。allow-list はその二重目。
- ⚠ **変数を増やすときは §9 の観点で再評価すること**（`docs/security.md` §8 の 061c 節）。

- ⚠ **`schemaVersion` を最初から持つ**。テンプレートは第三者が作って配るものなので、
  後方互換を切るときに黙って壊れないようにする。

### (2) `effect_templates` テーブルとモジュール新設

- `src-tauri/src/effect_template/`（`commands.rs` / `service.rs` / `repository.rs` / `model.rs`）。

```sql
CREATE TABLE IF NOT EXISTS effect_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    dir_name    TEXT NOT NULL,   -- app_data_dir/effects/ 配下（id 由来・元パスは保存しない）
    manifest    TEXT NOT NULL,   -- 検証済み manifest の JSON（正規化後）
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

- `lib.rs` の `setup` に `effect_template::repository::init(&conn)` を追加。

### (3) コマンド（**単一目的・狭く**）

| コマンド                    | 引数          | 戻り                                             | 備考                                               |
| --------------------------- | ------------- | ------------------------------------------------ | -------------------------------------------------- |
| `import_effect_template`    | `dir: String` | `EffectTemplateRecord`                           | ⚠ 汎用のディレクトリコピーにしない（§3）           |
| `list_effect_templates`     | —             | `Vec<EffectTemplateRecord>`                      | read-only                                          |
| `get_effect_template_media` | `id: String`  | `EffectTemplateMedia`（media/sound の data URI） | **036 系と同型**・asset protocol も CSP も触らない |
| `delete_effect_template`    | `id: String`  | `()`                                             | ディレクトリ実体も消す                             |

- ⚠ **`get_effect_template_media` は毎回 base64 を作る**とサイズが問題になりうる。
  **サイズ上限（下記）でそもそも大きいものを弾く**設計にする。

### (4) 検証（`service.rs`・§5/§8）— **本タスクの本体**（実装済みの順序）

**フェーズ 1（DB ロックの外）**。1 つでも落ちたら 1 バイトも保存しない（fail-closed）。

| # | 検査 | 防ぐもの |
|---|---|---|
| 1 | `dir` の trim → 空拒否 → 制御文字拒否 | 引数の密輸 |
| 2 | ⚠⚠ **`\\` / `//` 始まりを拒否**（`fs::metadata` の**前**） | UNC 経由の SMB 接続と NTLM 資格情報流出（060b S-4）。⚠ **061c は 060b より効く**——中のファイルも読むので接続が 1 回で済まない |
| 3 | `fs::metadata` → **ディレクトリ**であること | ファイルパスを渡された場合 |
| 4 | `manifest.json`（**symlink 拒否** → 64KiB → `read` → 実長で再チェック → UTF-8） | 管理外読み取り／メモリ枯渇／TOCTOU |
| 5 | **`schemaVersion` を先に見る** → `deny_unknown_fields` → 範囲 → `anchor` union → `name` | 未知形式の誤動作／タイポの黙殺／画面全体を覆う値 |
| 6 | **差し込み変数の allow-list**（4 つ） | `{text}` で本文を配信に出す形 |
| 7 | ⚠⚠ **`media` / `sound` の単一ファイル名規則** | **パストラバーサル** |
| 8 | **拡張子の許可リスト** | `.html` / `.svg` / 実行ファイル／Windows 予約デバイス名 |
| 9 | アセット（**symlink 拒否** → 単体上限 → `read` → 実長で再チェック → **合計上限**） | ⚠⚠ 第三者が仕込んだリンク経由の管理外読み取り／webview の固まり／TOCTOU |
| 10 | **マジックバイト** | 「`.png` と名乗る HTML」という素朴な偽装 |

**フェーズ 2（DB ロックの中）**: 11. 件数上限 → 12. uuid 採番 → `create_dir_all` → 書き込み →
13. INSERT（失敗したらディレクトリを掃除）。

**上限**: `manifest.json` **64KiB** ／ media 1 ファイル **4MiB** ／ sound 1 ファイル **2MiB** ／
1 テンプレート合計 **5MiB** ／ 登録 **64 件**（ディスク天井 320MiB）。
⚠⚠ **合計上限は個別上限の和（6MiB）にしていない**——和にすると「個別を通れば合計も必ず通る」＝
**その検査が構造的に到達不能**になり、効いていない安全装置がソース上に残る。
5MiB の単位は「**1 回のエフェクトで webview へ載る base64 の総量**」。

⚠⚠ **ファイル数上限は置いていない（要らなくなった）。** `manifest.json` を読み、`media` と `sound` を
**名指しで**読むだけなので **`read_dir` を 1 度も呼ばない**（契約テストが不在を固定）。
＝「参照されているファイルだけコピー」が**数値ではなく構造**で担保される。
さらに **`manifest.json` 自体もコピーしない**（検証済み JSON は DB にある）ので、
**管理ディレクトリに入りうるのは最大 2 ファイル**（`media.<拡張子>` / `sound.<拡張子>`）。

**⚠⚠ canonicalize と symlink（タスクファイル初版の指示を導出し直した結果）**:

| 軸 | 060b | 061c | 結論 |
|---|---|---|---|
| 保存先の組み立て | ユーザー入力ゼロ | ユーザー入力ゼロ（拡張子も**許可リストの定数**） | **060b 踏襲＝ canonicalize しない** |
| 読み込み元の組み立て | 存在しない | ⚠ `<選ばれたディレクトリ>/<manifest.media>` | **単一ファイル名規則で閉じる**（canonicalize 不要） |
| 特権境界 | 選ぶのは**ユーザー本人** | ⚠ **`media` を決めるのは第三者** | ⚠⚠ **アセットの symlink は拒否** |
| 正当な構成 | Dropbox / iCloud のリンクを壊さない | **ディレクトリ自体のリンクは拒否しない** | **受容** |

⚠ **canonicalize を足さない理由（symlink を拒否しても）**: `media` は単一のファイル名なので、
結合したパスの構成要素は「選ばれたディレクトリ ＋ 1 要素」しかない。
**「途中の要素が symlink」という形が構造的に存在しない**ため、葉の `symlink_metadata` に足せるものが無い。

⚠⚠ **リンク拒否を担っているのは `symlink_metadata` を使っていること自体**（security-review R-2）。
`metadata` へ変えるとリンクを辿るので**その 1 語が壁**。`is_symlink()` の明示分岐を消すだけでは
振る舞いが変わらない（＝ミューテーションで生存する equivalent mutant）ので、
**「symlink 拒否のテストが緑だから守れている」と読まないこと**。契約テストが出現回数を固定している。

**`remove_dir_all` の安全策 5 点**: ①`dir_name` が `<uuid v4>` 完全一致 ②パス結合は 1 か所
③消す直前に **`symlink_metadata` で「リンクではない実ディレクトリ」を確認** ④**DB 行が先・実体は best-effort**
⑤**DB に無いディレクトリは消さない**（`effects/` を列挙して掃除する経路を作らない＝
**列挙して消す形こそが `remove_dir_all` を最も危険にする**）。孤児ディレクトリは放置する（不可視・無害）。

### (5) 描画側のガード（frontend・`src/screens/obs-effects/effectMedia.ts`）

- [036a](036a-avatar-wire-and-overlay-render.md) の `avatarDataUri` と同型の**描画シンクのガード**。
  ⚠ **Rust が正しくても描画側で最終防波堤を持つ**（036a の「2 実装に分裂させると片方だけ緩む」の逆で、
  ここは**層が違う**ので両方に置くのが正しい）。
- ⚠⚠ **`data:` 始まりだけでは足りない**ので、**MIME の完全一致許可リスト**と **base64 の文字集合**まで見る。
  ⚠ 許可リストに `image/svg+xml` と `text/html` を足さないこと。
- ⚠⚠ **Rust が完全な data URI を組み立て、frontend はそれを検査する**という向きが要点。
  frontend が生 base64 から組み立てる形（`tools::icon` の `extract_app_icon` がそれ）にすると、
  **ガードが自分で作った文字列を検査するだけ**になり何も守らない。
- API: `effectMediaDataUri` / `effectSoundDataUri` / `safeEffectMedia`。
  `safeEffectMedia` は**メディアが弾かれたら `undefined`**（061d は組み込み意匠へフォールバック）、
  **音源だけ弾かれたらメディアは出す**（音が鳴らないことは配信を壊さないが、
  エフェクトが出ないことは「反応が無い」に見えるため）。
- ⚠ **長さの上限は frontend に置かない**（サイズの方針は Rust が唯一の持ち主。複製すると片方が古くなる）。
- 描画（061d）: メディアは `<img>` / `<video>` の `src` に data URI を入れる。
  ⚠ **`<video>` は `autoplay muted playsinline loop=false`**。音は `manifest.sound` を別に鳴らす。

### (6) security.md の更新（**実施済み**）

| 節 | 追記内容 |
| --- | --- |
| §5 ファイル操作 | **例外節（061c）を新設**（3 回目）。保存先の組み立て／**元ディレクトリを列挙しない**／読み込み元の第三者入力／**symlink 拒否**／canonicalize しない理由／**ハードリンクの限界**／UNC／`remove_dir_all` 安全策 5 点／上限 |
| §5 の 060b 例外節 | ⚠⚠ **再修正トリガー（`path` を受け取る 3 本目）が 061c で発火**したので、合成の再評価を追記 |
| §8 入力検証 | **061c 節を新設**。`deny_unknown_fields`／`schemaVersion` を先に見る／変数の allow-list と §9 の正当化／拡張子（**`.svg` を足さない**）／マジックバイトの**限界**／範囲（`i32::abs` を使わない）／エラーに入力を載せない |
| ## CSP方針 | **061c 節を新設**。data URI のみ／`blob:` を使わない理由／**ガードの向き**（Rust が組み立て frontend が検査）／MIME 許可リスト |
| Capabilities 方針 061a 節 | ⚠⚠ **失効条件の再評価**（段階的な失効・永続層の再評価・**061d でもう一度見ること**） |
| レビュー必須条件 | **061c の項目を新設**（変更すると本項に該当するもの 8 種） |
| §10 依存 | **新規依存ゼロ**を記録（デコーダを増やさない／ZIP 展開しない／⚠ **`rodio` にデコーダ feature を足さない**） |

### (7) テスト（**実施済み**）

- `manifest.rs`（純粋・I/O ゼロ・12 件）／`repository.rs`（5 件）／`service.rs`（**28 件**＋契約テスト 10 件）
- frontend `effectMedia.test.ts`（18 件）
- ⚠ **「ガードが見ていない入力」のテストを別に作った**（055e の教訓）:
  全角ソリダス（U+FF0F）・FRACTION SLASH（U+2044）・**RTL override（U+202E・`char::is_control` では弾けない Cf）**・
  多重拡張子を**実際に通し**、①受け入れられること ②管理ディレクトリの中身が `media.png` ちょうどで
  **第三者が付けた名前がディスクに 1 バイトも残らない**ことを固定した。
- **ミューテーション 12 件**（結果と「固定できていないもの」は `docs/progress.md` の 061c 節が正）。
  ⚠ **M5（`is_symlink()` 分岐の削除）は SURVIVED だが equivalent mutant**で、
  追試（`symlink_metadata` → `metadata`）は KILLED。**件数ではなく「何を固定できていないか」を書くこと。**

## このタスクでやらないこと

- **テンプレート適用 UI・イベント割り当て**（[061d](061d-effect-template-ui.md)）。
- **HTML/CSS/JS テンプレートの実行**（親 061 の決定。たぬえさ3 の `forOBS3.html` 互換は採らない）。
- **外部 URL の取得**。`manifest.json` に URL フィールドを作らない。
- テンプレートの**編集**（アプリ内でテンプレートを作る機能）。⚠ ガチャの景品編集は
  [063a](063a-gacha-definition-editor.md) の範囲で、テンプレート自体の編集ではない。
- テンプレートの共有・書き出し・マーケットプレイス。
- ZIP での取り込み（**ディレクトリのみ**。ZIP 展開は攻撃面が増えるうえ crate が要る）。
- 画像/動画の完全な形式検証（マジックバイトまで）。
- 複数エフェクトの同時再生・重ね合わせ（1 度に 1 つ）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。`manifest.json` に URL フィールドを持たせない。
- **第三者コードを実行しない。** HTML/CSS/JS を受け付けない。`dangerouslySetInnerHTML` を使わない。
- **ファイル操作は Rust 側・`app_data_dir/effects/` 限定**（§5）。
  ⚠⚠ **パス検証は「単一ファイル名規則 ＋ symlink 拒否」で閉じる。canonicalize は呼ばない**
  （初版は「canonicalize せよ」と書いていたが、(4) の軸ごとの導出で不要と結論した）。
  **ファイル名にユーザー入力を使わない**（id 由来で採番）。
  **`manifest.json` が参照するファイルだけコピーする**（＝ `read_dir` を呼ばない）。
- **入力検証は Rust 側で必ず行う**（§8）。frontend の生パス・生 manifest を信用しない。
- **メディアは data URI で渡す**（asset protocol も CSP も capability も増やさない）。
  描画側にも**最終防波堤のガード**を置く（036a と同型）。
- **コマンドは単一目的・最小権限**（§3）。⚠ 全窓から呼べる前提で設計する。
- **capability の追加ゼロ**（main 窓は既に `dialog:allow-open` を持つ）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ・**新規依存ゼロを目指す**。
- ログにテンプレート名・ファイルパスを出さない（§9・`with_filename_detail` 流儀）。

## ⚠⚠ 実装で判明した前提（着手前に洗い出した「穴」10 件と、その結論）

| # | 内容 | 結論 |
|---|---|---|
| ① | **取り込みを呼ぶ UI が無いので確認①〜⑦が 1 つも実行できない** | ⚠ **061d へ移管**（060b → 060d の申し送り⓪と同じ形）。⚠ **確認⑧はそもそも 061c の範囲外**（描画層を持たない）なので **061d の項目として新設**。061c に残したのは**確認⑨だけ** |
| ② | **`{amount}` が実装済みの `EffectRequest` と一対一に対応しない** | **変数を 4 つへ**＋`templateWithoutAmount`。⚠ `amountText` と `message` は**同時に null になりうる**（上記スキーマ節） |
| ③ | `kind` を触るか | **触らない**。`effectTrigger.ts` は差分ゼロ。拡張点は JSDoc に宣言済みで、061d が判別可能 union へ広げる |
| ④ | **canonicalize と symlink の指示が 060b と逆** | ⚠⚠ **軸で結論が分かれた**（(4) の表）。canonicalize しない／**アセットの symlink は拒否**／ディレクトリの symlink は拒否しない |
| ⑤ | UNC / ネットワークパスの拒否が書かれていない | `fs::metadata` の**前**に拒否。⚠ **061c は 060b より効く** |
| ⑥ | `remove_dir_all` という 060b に無い操作 | 安全策 5 点（(4) 末尾） |
| ⑦ | data URI のサイズとエフェクト窓の性質 | data URI 維持。上限を **4MiB / 2MiB / 合計 5MiB / 64 件**へ。⚠ **実測は 061d**（061c は描画しない） |
| ⑧ | **security.md 061a 節の失効条件が発火する** | 再評価済み。⚠ **失効は段階的**で、061c は「経路ができた」まで。**061d でもう一度見ること** |
| ⑨ | bindings の置き場所と `check:bindings` の穴 | `features/obs-effects/bindings/` ＋ 列挙に 1 パス追加。⚠ **S-8（未追跡は `git diff` が見ない）は `git add -N` で回避して実測** |
| ⑩ | 音の扱いが 058a / 059b と交差する | 061c は**保存・検証・供給**まで。⚠⚠ **Rust ではデコードできない**（`rodio` に decoder feature が無い＝ 058a の判断）ので、鳴らすのは **webview の `<audio>`＋data URI**（061d） |

**⚠ 実装中に追加で判明した 3 件**（計画にも無かったもの）:

- **A: `path` を受け取るコマンドが 2 本目**になり、§5 の 060b 例外節の再修正トリガーが**発火した**（再評価済み）。
- **B: ディレクトリを列挙しなければファイル数上限は要らない**（構造で担保）。`manifest.json` もコピー不要。
- **C: 合計サイズ上限を個別上限の和にすると到達不能な検査になる**（→ 5MiB へ設計変更）。

## 完了条件

- ✅ テンプレートのディレクトリを選ぶと検証され、`app_data_dir/effects/<uuid v4>/` に**必要なファイルだけ**コピーされる。
- ✅ **パストラバーサル・symlink・未知スキーマ・拡張子外・サイズ超過がすべて拒否される**（テストで固定）。
- ✅ `get_effect_template_media` が **完全な data URI** を返し、描画側のガードが
  `data:` ＋ **MIME 完全一致** ＋ base64 文字集合で弾く。
- ✅ **`manifest.json` が参照していないファイルがコピーされない**（`read_dir` を呼ばない＝構造で担保）。
- ✅ `text.template` の変数が **4 つ**（`{name}` / `{amount}` / `{event}` / `{message}`）に制限されている。
- ✅ [`docs/security.md`](../security.md) に (6) の 7 項目が追記されている。
- ✅ ts-rs binding が生成され `check:bindings` が通る（⚠ **初回コミット後にもう一度回すこと**＝ 060b S-8）。
- ✅ Rust テストが通り、**ミューテーション 12 件で実効性を確認**している。
- ✅ **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ**
  （⚠ `package.json` は `check:bindings` の 1 行だけ動く。`dependencies` は不変）。
- ✅ `typecheck` / `lint` / `test` / `cargo check` / `cargo test` が通る。[`docs/progress.md`](../progress.md) を更新。
- ⚠ **実機確認は [061d](061d-effect-template-ui.md) の完了条件へ移管**（確認⑨のみ 061c 側に残す）。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
# ⚠ 新規 binding は未追跡だと `git diff` が見ない（060b S-8）。初回だけこの順で確かめる:
git add -N apps/desktop/src/features/obs-effects/bindings
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
git status --short -- apps/comment-sidecar/
# 新規依存ゼロの担保（⚠ package.json は check:bindings の 1 行だけ動く。diff で依存が不変であることを示す）
git status --short -- pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git diff -- apps/desktop/package.json
# 061b の発火層・描画を触っていないことの担保
git status --short -- apps/desktop/src/screens/obs-effects/effectTrigger.ts \
  apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx

# ⑨ 外部通信ゼロ（契約テストと二重）
grep -rn "reqwest\|TcpStream\|ureq\|hyper::" apps/desktop/src-tauri/src/effect_template/
lsof -i   # 実行中に外部 ESTABLISHED が増えないこと
```

⚠⚠ **実機確認①〜⑧は [061d](061d-effect-template-ui.md) の完了条件へ移管した**
（コマンドを呼ぶ UI が 061d の領分なので、061c 側に置いたままだと忘れられる＝ 060b → 060d の先例）。

## 実装後に必要なレビュー（**実施済み**）

- **security-review 実施済み**（2026-08-11・判定「**問題なし**」・コード上の欠陥 0 件）。
  レビュー中に **2 件を検出して修正**した:
  - **R-1** … `get_effect_template_media` の出口だけ `std::fs::read` で**リンクを辿っていた**。
    入口だけ拒否して出口では辿るのは不変条件として不揃いなので、出口にも `symlink_metadata` を入れた
    （契約テストの固定値 3 → 4）。
  - **R-2** … ⚠⚠ **`is_symlink()` の明示分岐は壁ではなかった**（ミューテーションが生存＝ equivalent mutant）。
    壁は **`symlink_metadata` という 1 語**のほうで、契約テストが出現回数を固定している。
    **「symlink 拒否のテストが緑だから守れている」と読むのは誤り。**
  - 受容した既知の限界（**ハードリンク** / TOCTOU / 同時取り込みのメモリ / **Windows の実挙動** /
    マジックバイトを通る crafted ファイル）は `docs/security.md` §5 の 061c 例外節と
    [`docs/progress.md`](../progress.md) の 061c 節が正。
- ⚠ レビュー時に**パス検証の迂回を狙った独自のミューテーション**を作った（055e の教訓）。
  結果と「**固定できていないもの**」は [`docs/progress.md`](../progress.md) の 061c 節が正。
  ⚠ **Windows のパス（`C:\` / `\\?\` / `\\server\share` / 予約デバイス名）は macOS 開発機では踏めない**ので、
  検証はロジックで担保し、実挙動は [098](098-windows-build.md) へ申し送る。
