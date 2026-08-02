# 061c エフェクトテンプレート取り込み（アセット＋宣言的レイアウト）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [061](061-obs-effects.md) を正とする。
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
  "schemaVersion": 1,
  "name": "きらきら",
  "media": "main.webm",        // 同ディレクトリ内の相対ファイル名のみ（"/" と ".." を含まない）
  "sound": "sound.wav",        // 任意・同上
  "durationMs": 5000,          // 表示時間（上限あり）
  "layout": {
    "anchor": "center",        // "top-left" | "top" | ... | "center" の固定 union
    "offsetX": 0, "offsetY": 0,
    "width": 640, "height": 360
  },
  "text": {                    // 任意。差し込み変数の配置
    "template": "{name} さんが {amount}",   // 使える変数は {name} / {amount} / {event} の 3 つだけ
    "anchor": "bottom",
    "fontSize": 32
  }
}
```

- ⚠ **差し込み変数は 3 つに固定**（`{name}` / `{amount}` / `{event}`）。
  [061b](061b-monetary-effect-builtin.md) の `EffectRequest` が持つ値だけを渡せる形にする
  （**本文もアバターも渡せない**＝061b の判断を形式レベルで固定する）。
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

| コマンド | 引数 | 戻り | 備考 |
|---|---|---|---|
| `import_effect_template` | `dir: String` | `EffectTemplateRecord` | ⚠ 汎用のディレクトリコピーにしない（§3） |
| `list_effect_templates` | — | `Vec<EffectTemplateRecord>` | read-only |
| `get_effect_template_media` | `id: String` | `EffectTemplateMedia`（media/sound の data URI） | **036 系と同型**・asset protocol も CSP も触らない |
| `delete_effect_template` | `id: String` | `()` | ディレクトリ実体も消す |

- ⚠ **`get_effect_template_media` は毎回 base64 を作る**とサイズが問題になりうる。
  **サイズ上限（下記）でそもそも大きいものを弾く**設計にする。

### (4) 検証（`service.rs`・§5/§8）— **本タスクの本体**

取り込み時に**この順で**行う。1 つでも落ちたら取り込まない（fail-closed）。

1. **`manifest.json` が存在し、UTF-8 の JSON として読めること**。サイズ上限（例 64KB）。
2. **スキーマ検証**（serde の型で受ける＝未知フィールドは**拒否**するか無視するかを決める。
   **推奨は `deny_unknown_fields`**＝タイポで黙って効かないのを防ぐ）。
   - `schemaVersion` が既知の値であること
   - `anchor` が固定 union であること
   - `durationMs` が範囲内（例 500〜15000）
   - `width` / `height` / `fontSize` が範囲内
   - `text.template` に**未知の変数が含まれないこと**（`{name}` / `{amount}` / `{event}` 以外は拒否）
3. **`media` / `sound` のファイル名検証** ← ⚠ **最重要**
   - `/` `\` `..` `:` を含まない・空でない・制御文字なし・絶対パスでない
   - **`app_data_dir/effects/<id>/` 配下に解決されることを実際に確認する**
     （文字列検査だけでなく、**canonicalize して管理ディレクトリの下にあることを確認**する。
     `process/service.rs` に canonicalize の先例がある）
   - ⚠ **シンボリックリンクを追わない**（追うと管理ディレクトリ外を読める）
4. **拡張子許可リスト**: media = `.png` / `.gif` / `.apng` / `.webm` / `.webp`、sound = `.wav` / `.mp3` / `.ogg`。
5. **サイズ上限**: 1 ファイル例 **8MB**、1 テンプレート合計例 **16MB**、
   ディレクトリ内ファイル数上限（例 16）。⚠ 上限が無いと data URI 化で webview が固まる。
6. **拡張子と中身の一致を最低限確認する**（マジックバイト）。
   ⚠ **完全な検証は目指さない**（画像デコーダを増やさない）。
   「`.png` と言いながら HTML」のような素朴な偽装を弾くところまで。
   ⚠ **弾けなかった場合の被害**（webview が `data:image/png;base64,<HTML>` を読む＝**画像として壊れるだけ**で
   スクリプトは動かない）を security-review で確認すること。
7. **`app_data_dir/effects/<id>/` へコピー**。⚠ **ディレクトリ名・ファイル名はアプリが採番した id 由来**にし、
   ユーザー入力（元ディレクトリ名・`name`）を**パスに使わない**。
   ⚠ **元ディレクトリ内のファイルを無条件に全部コピーしない**。`manifest.json` が参照している
   ファイルだけをコピーする（`.html` や実行ファイルが紛れ込む経路を作らない）。

### (5) 描画側のガード（frontend）

- [036a](036a-avatar-wire-and-overlay-render.md) の `avatarDataUri` と同型の**描画シンクのガード**を置く。
  `get_effect_template_media` の戻り値が `data:` 始まりでなければ**描画しない**。
- ⚠ **Rust が正しくても描画側で最終防波堤を持つ**（036a の「2 実装に分裂させると片方だけ緩む」の逆で、
  ここは**層が違う**ので両方に置くのが正しい）。
- メディアは `<img>` / `<video>` の `src` に data URI を入れる。
  ⚠ **`<video>` は `autoplay muted playsinline loop=false`**。音は `manifest.sound` を別に鳴らす
  （メディアに音声トラックがあっても鳴らさない＝音の ON/OFF を独立に制御できるようにする）。

### (6) security.md の更新

| 節 | 追記内容 |
|---|---|
| §5 ファイル操作 | 例外節（`app_data_dir/effects/` への取り込み書き込み・060b と同型） |
| §8 入力検証 | `manifest.json` のスキーマ検証・**ファイル名のパス検証（canonicalize ＋ symlink 不追跡）**・拡張子/サイズ/件数上限 |
| ## CSP方針 | メディアは **data URI のみ**で webview に渡す（外部 media を読み込まない・asset protocol を増やさない） |
| §10 依存 | 新規依存ゼロを記録（マジックバイト検査で crate を足す場合はその理由） |

### (7) テスト

- `service.rs` の `#[cfg(test)] mod`:
  - ⚠ **パストラバーサル**: `media: "../../evil.png"` / `"/etc/passwd"` / `"a/b.png"` / 絶対パス →**すべて拒否**
  - ⚠ **symlink**: 管理ディレクトリ外を指す symlink を置いても読めないこと
  - 未知の `schemaVersion` / 未知の `anchor` / 範囲外の `durationMs` → 拒否
  - `text.template` に未知の変数 → 拒否
  - 拡張子許可リスト外 → 拒否
  - サイズ上限・ファイル数上限 → 拒否
  - **`manifest.json` が参照していないファイルがコピーされない**こと
  - マジックバイト不一致 → 拒否
  - `delete_effect_template` がディレクトリ実体を消すこと
- frontend: 描画ガードが `data:` 以外を弾くこと
- **ミューテーションで実効性を確認**する。最低限、パス検証を外したときにレッドになること。

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
  ⚠ **パス検証は canonicalize で実際に確認する**（文字列検査だけにしない）。**symlink を追わない。**
  **ファイル名にユーザー入力を使わない**（id 由来で採番）。
  **`manifest.json` が参照するファイルだけコピーする。**
- **入力検証は Rust 側で必ず行う**（§8）。frontend の生パス・生 manifest を信用しない。
- **メディアは data URI で渡す**（asset protocol も CSP も capability も増やさない）。
  描画側にも**最終防波堤のガード**を置く（036a と同型）。
- **コマンドは単一目的・最小権限**（§3）。⚠ 全窓から呼べる前提で設計する。
- **capability の追加ゼロ**（main 窓は既に `dialog:allow-open` を持つ）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ・**新規依存ゼロを目指す**。
- ログにテンプレート名・ファイルパスを出さない（§9・`with_filename_detail` 流儀）。

## 完了条件

- テンプレートのディレクトリを選ぶと検証され、`app_data_dir/effects/<id>/` に**必要なファイルだけ**コピーされる。
- **パストラバーサル・symlink・未知スキーマ・拡張子外・サイズ超過がすべて拒否される**（テストで固定）。
- `get_effect_template_media` が data URI を返し、描画側のガードが `data:` 以外を弾く。
- **`manifest.json` が参照していないファイルがコピーされない。**
- `text.template` の変数が `{name}` / `{amount}` / `{event}` の 3 つに制限されている。
- [`docs/security.md`](../security.md) に (6) の 4 項目が追記されている。
- ts-rs binding が生成され `pnpm check:bindings` が通る。
- Rust テストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ**（または §10 に記録済み）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo check` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock

pnpm --filter ./apps/desktop tauri dev
# ① 正常なテンプレートを取り込む → 一覧に出て、app_data_dir/effects/<id>/ に manifest が参照するファイルだけ入る
# ② media に "../../evil.png" を書いたテンプレート → 取り込みが拒否される
# ③ 管理ディレクトリ外を指す symlink を置いたテンプレート → 拒否される
# ④ .html を同梱したテンプレート → .html はコピーされない
# ⑤ 8MB 超のメディア → 拒否される
# ⑥ text.template に {ipaddr} など未知の変数 → 拒否される
# ⑦ 削除するとディレクトリ実体も消える
# ⑧ lsof -i で外部 ESTABLISHED が増えないこと
```

## 実装後に必要なレビュー

- **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。対象:
  - **パス検証の網羅性**（`..` / 絶対パス / symlink / canonicalize / Windows のパス区切りとドライブレター）
  - `manifest.json` のスキーマ検証（`deny_unknown_fields` の是非・変数の制限）
  - **コピー対象の限定**（参照されていないファイルが入らない）
  - サイズ / 件数上限と、data URI 化したときの webview への影響
  - マジックバイト検査の限界と、**弾けなかった場合の被害の評価**
  - §5 ファイル書き込み経路の新設
- ⚠ レビュー時は**パス検証の迂回を狙った独自のミューテーション**を必ず作ること
  （055e の教訓：自分のガードの主張を裏返す変異だけでは、ガードが見ていない領域の穴は見つからない）。
  ⚠ **Windows のパス（`C:\` / `\\?\` / `\\server\share`）は macOS 開発機では踏めない**ので、
  検証はロジックで担保し、実挙動は [098](098-windows-build.md) へ申し送ること。
