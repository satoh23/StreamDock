# 063a ガチャ定義のデータモデル＋作成 UI（表 1 枚）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [063](063-gacha-effect.md) を正とする。
>
> **必読前提**: 親 [063](063-gacha-effect.md)、**調査 [063s](063s-tanuesa-gacha-spike.md)（表の列と設計目標の正・着手条件）**、
> エフェクトのテンプレート [061c](061c-effect-template-import.md) と割り当て UI [061d](061d-effect-template-ui.md)、
> Rust モジュールの層構造 [`viewer_memory/`](../../apps/desktop/src-tauri/src/viewer_memory/)、
> 保存作法の先例 [060b](060b-custom-css-import-backend.md) / [062b](062b-stream-session-recording.md)、
> 一覧・並べ替え UI の作法 [`PresetEditor`](../../apps/desktop/src/screens/add-preset/) 系と [006](006-preset-item-ordering.md)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§3／§8／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[063s](063s-tanuesa-gacha-spike.md) 完了**（表の列が確定していないと作れない）。

## 目的

ガチャを**作る体験そのもの**を実装する。要望の芯は「**たぬえさよりかなり簡単に作成できる**」なので、
本タスクの成否は**手順の少なさ**で決まる。

## 現在の前提（調査結果・実コード）

- ガチャに相当する実装は**存在しない**（`gacha` / `ガチャ` の参照ゼロ）。
- [061c](061c-effect-template-import.md) でエフェクトテンプレートが `effect_templates` に登録されており、
  [061d](061d-effect-template-ui.md) で「イベント → エフェクト」の割り当て UI ができている。
  **ガチャは「1 つのイベントに N 個のエフェクトを確率で割り当てる」**もの＝061d の拡張に見えるが、
  **抽選という概念が増える**ので別テーブルにする。
- Rust モジュールは `commands.rs` / `service.rs` / `repository.rs` / `model.rs` の 4 分割。
  テーブルは `CREATE TABLE IF NOT EXISTS`、列追加は `ensure_column`（冪等）。
- 並べ替え UI の先例は `preset_items` の `order_index` ＋ `reorder_preset_items`（[006](006-preset-item-ordering.md)）。
  ⚠ **ガチャの景品に並び順が要るか**を決める（推奨＝**要る**。重み順に並べ替えたいはず）。

## このタスクでやること

### (1) データモデル（`src-tauri/src/gacha/`）

```sql
CREATE TABLE IF NOT EXISTS gachas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gacha_prizes (
    id           TEXT PRIMARY KEY,
    gacha_id     TEXT NOT NULL REFERENCES gachas(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    weight       INTEGER NOT NULL,          -- 重み（1 以上）
    template_id  TEXT,                      -- effect_templates.id / NULL = 組み込み意匠
    order_index  INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gacha_prizes_gacha ON gacha_prizes(gacha_id);
```

- ⚠ **`gacha_prizes.gacha_id` には FK を張ってよい**（両テーブルとも本タスクで新設＝既存データが無い）。
  ⚠ **`template_id` には FK を張らない**（`effect_templates` の行が消えても景品を消したくない。
  実在しない id は読み込み時に「組み込み意匠」へフォールバックする＝[061d](061d-effect-template-ui.md) と同じ作法）。
- **確率は保存しない**（重みから毎回計算する）。⚠ 保存すると重みと確率がずれる。

### (2) コマンド（**単一目的**・§3）

| コマンド | 引数 | 戻り |
|---|---|---|
| `create_gacha` | `name` | `GachaRecord` |
| `list_gachas` | — | `Vec<GachaRecord>` |
| `get_gacha` | `id` | `GachaWithPrizes` |
| `update_gacha` | `id, name` | `GachaRecord` |
| `delete_gacha` | `id` | `()` |
| `add_gacha_prize` | `gacha_id, name, weight, template_id` | `GachaPrizeRecord` |
| `update_gacha_prize` | `id, name, weight, template_id` | `GachaPrizeRecord` |
| `remove_gacha_prize` | `id` | `()` |
| `reorder_gacha_prizes` | `gacha_id, ids` | `()` |

- ⚠ `preset` / `preset_items` のコマンド構成をそのままなぞる（発明しない）。

### (3) 検証（`service.rs`・§8）

- `name`: 空でない・長さ上限（例 60）・制御文字拒否・前後空白トリム
- `weight`: **1 以上**・上限（例 1,000,000）
  ⚠ **0 を許すと「絶対に出ない景品」ができ、合計 0 で 0 除算になる**。0 を許すなら
  「無効」として明示的に扱う（推奨＝**1 以上のみ許可**し、出したくない景品は削除する）
- 景品数の上限（例 50）。⚠ 上限が無いと抽選と UI が重くなる
- `template_id`: 存在しなくてもエラーにしない（読み込み時にフォールバック）
- ⚠ **`reorder_gacha_prizes` は `ids` が当該ガチャの景品と完全一致することを確認する**
  （他ガチャの id を混ぜられない・§8）

### (4) 作成 UI（`obs-effects` 画面の中に「ガチャ」タブ）

**表 1 枚で完結させる。** これが本タスクの成否そのもの。

| 景品名 | 重み | 確率 | エフェクト | |
|---|---|---|---|---|
| 大当たり | `1` | **10.0%** | （テンプレート選択） | 🗑 |
| 当たり | `3` | **30.0%** | 〃 | 🗑 |
| はずれ | `6` | **60.0%** | 〃 | 🗑 |
| **＋ 景品を追加** | | 合計 10 | **100.0%** | | |

- ⚠ **「条件を追加」に相当する操作をゼロにする。** 行を足す＝景品を足す、だけ。
- ⚠ **確率は自動計算して常時表示**（`weight / sum(weight)`）。**合計 100% にする作業をユーザーにさせない。**
  ⚠ たぬえさ3 が本数指定や％指定で「合計を合わせる」作業を強いているなら、**ここが最大の差別化**になる
  （[063s](063s-tanuesa-gacha-spike.md) の (2) で確認済みのはず）。
- **エフェクト列は [061d](061d-effect-template-ui.md) と同じセレクタ**を再利用する
  （組み込み / インポート済みテンプレート）。⚠ **2 実装に分けない。**
- **並べ替え**は既存の `preset_items` の作法（`order_index` ＋ `reorder_*`）。
- ⚠ **プレビュー（テスト抽選）ボタンを置く**。実際に 1 回引いて結果を出す
  （[063c](063c-gacha-presentation.md) 完了後は演出まで、それ以前は結果のテキストだけ）。
  **これが無いと確率の体感が確認できない。**
- 書式は [054](054-comment-viewer-settings-readability.md) の規則どおり。**新しい px / weight を発明しない。**

### (5) ⚠ 空・不整合の扱い

- 景品 0 件のガチャは**トリガーに割り当てられない**（[063b](063b-gacha-draw-and-triggers.md) で弾く）。
  UI では「景品がありません」と出す。
- 実在しない `template_id` を持つ景品は「組み込み意匠」にフォールバックし、**UI に警告を出す**
  （[061d](061d-effect-template-ui.md) と同じ・黙って違うものが出るのが最悪）。

### (6) テスト

- Rust `service.rs` / `repository.rs`:
  - `weight` が 0 / 負 / 上限超で拒否されること
  - `name` の検証（空・長すぎ・制御文字）
  - 景品数の上限
  - **`reorder_gacha_prizes` に他ガチャの id を混ぜると拒否される**こと
  - `delete_gacha` で景品が CASCADE で消えること
  - `template_id` が実在しなくても保存・取得できること
- frontend:
  - **確率の自動計算**（重み 1/3/6 → 10.0% / 30.0% / 60.0%）
  - 重みを変えると確率が即座に更新されること
  - 合計が常に 100.0% になること（丸め誤差の表示規則も固定する）
  - 景品 0 件のときの表示
  - 実在しない `template_id` の警告
- **ミューテーションで実効性を確認**する。最低限、確率の分母を固定値にする変異でレッドになること。

## このタスクでやらないこと

- **抽選ロジック・トリガー割り当て**（[063b](063b-gacha-draw-and-triggers.md)）。
  ⚠ ただし (4) の「テスト抽選」ボタンのために、**最小限の抽選関数は本タスクで書いてよい**
  （063b が本実装で置き換える）。**どちらにするか実装時に決めてコメントに残す。**
- **演出**（[063c](063c-gacha-presentation.md)）。
- **テンプレートの取り込み**（[061c](061c-effect-template-import.md)）。
- **天井・確定枠・在庫・確率変動**（親 063 の決定）。
- 視聴者ごとの所持品・履歴。
- ガチャ定義の書き出し・共有。
- たぬえさ3 の設定ファイルのインポート（親 063 の IP 線引き）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。
- **§9**: 保存するのは**ユーザー自身が作ったガチャ定義**（景品名・重み・テンプレート id）で、
  **第三者の個人データを含まない**。[062b](062b-stream-session-recording.md) と同じく §9 では軽い。
  ⚠ **抽選履歴・誰が当てたかを保存しない**（保存すると §9 の重みが跳ね上がる）。
- **入力検証は Rust 側で必ず行う**（§8）。`name` / `weight` / 景品数 / `reorder` の id 集合。
- **識別子はコンパイル時定数のみ・値はパラメータバインド**（§8）。
- **コマンドは単一目的**（§3）。⚠ 全窓から呼べる前提で設計する。
- **capability を増やさない**・`csp: null` 不変・**新規依存ゼロ**・生 hex ゼロ（トークンのみ）。
- ログに景品名を出さない（§9）。

## 完了条件

- ガチャを作成でき、**表 1 枚**で景品を足す／消す／並べ替える／重みを変えることができる。
- **確率が自動計算されて常時表示され、合計が常に 100.0%** になる。
- **「条件を追加」に相当する操作が存在しない**（行を足す＝景品を足す、だけ）。
- テスト抽選ボタンで結果が確認できる。
- 景品 0 件・実在しない `template_id` が UI で分かる。
- `weight` 0 / 負 / 上限超・不正な `name`・他ガチャ id の混入がすべて拒否される。
- **抽選履歴・当選者を保存していない。**
- ts-rs binding が生成され `pnpm check:bindings` が通る。
- Rust / frontend のテストが通り、**ミューテーションで実効性を確認**している。
- **capability 追加ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ・生 hex ゼロ。**
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` / `cargo check` / `cargo test` が通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css も含む
pnpm --filter ./apps/desktop check:bindings
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/ apps/comment-sidecar/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml

pnpm --filter ./apps/desktop tauri dev
# ① ガチャを作る → 景品を 3 つ足す（**表に行を足すだけ**で完結すること）
# ② 重みを 1/3/6 にすると 10.0% / 30.0% / 60.0% が自動で出る
# ③ 重みを変えると確率が即座に更新され、合計が常に 100.0%
# ④ 景品を並べ替えられる／削除できる
# ⑤ テスト抽選を 20 回押して、体感が確率どおりか（大当たりが 2 回前後）
# ⑥ 景品 0 件のガチャ → 「景品がありません」が出る
# ⑦ 割り当て済みのテンプレートを削除 → 景品に警告が出て組み込み意匠にフォールバックする
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **§8 の入力検証**（`weight` の 0 / 負・`reorder` の id 集合・`name`）
  - **§9 の保存内容**（抽選履歴・当選者を保存していないこと）
  - **確率の自動計算が正しく、0 除算しない**こと
