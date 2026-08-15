# 064d 取り込み機能の全削除（**完了・実機確認済み**・2026-08-16）

> ## 状態: **実装完了 / ✅ 実機確認済み（2026-08-16・依頼者「問題ありませんでした」）/ ⏳ security-review 未実施**
>
> 親: [064](064-obs-source-effects.md)。前段: [064a](064a-obs-source-bridge.md)（✅ 実機確認済み）/
> [064b](064b-obs-source-conditions.md)（✅ 実機確認済み）。
> ⚠ **判断の全文は [`docs/progress.md`](../progress.md) の 064d 節が正。**

## このタスクの範囲

**061c〜061t で作った「エフェクトを StreamDock へ取り込んで描く」経路をすべて消す。**

⚠⚠ **着手条件は「新方式が実機で動くこと」だった**（064 の「削除は最後」）。
064a・064b とも依頼者が実機で確認し「問題ありませんでした」を得たので着手した。
⚠ 移行コストはゼロ（version `0.1.0` / `git tag` **0 件**＝未リリース）。

## 消したもの

| 層 | 内容 |
|---|---|
| **Rust** | `src-tauri/src/effect_template/` 一式（service / manifest / codec / model / repository / commands / mod） |
| **Rust** | コーナー窓の 3 コマンド（`open` / `close` / `is_..._open`）＋ `generate_handler!` の登録 8 本 |
| **Rust** | `effect_templates` テーブルの作成（`repository::init` の呼び出し） |
| **TS 画面** | `EffectTemplateCard` / `EffectTemplateView` / `EffectTemplatePreview` / `useEffectTemplates` |
| **TS ロジック** | `effectMedia` / `effectMediaCache` / **`effectChromaKey`（061r の透過）** / `effectTemplateText` |
| **TS API** | `features/obs-effects/effectTemplateApi.ts` ＋ `bindings/` 6 ファイル |
| **スクリプト** | `scripts/check-effect-template-contract.mjs`（＋ `package.json` の `check:effect-contract` / `check:bindings` の 1 ディレクトリ） |
| **型** | `EffectAssignment` の `template` variant ／ **`EffectOutput`（小さく／大きく）の軸まるごと** ／ `EffectKind` / `EffectRequest` |
| **sidecar** | `OBS_OVERLAYS` の `effects` エントリ（**4 → 3 種別**） |

**差分: 70 ファイル / +3,894 / −12,471 行**（削除ファイル 14 本）。

## 残したもの

- **ステージ窓**（`stage-overlay`）と **061l の配信イベント**（＝ StreamDock が自分で描くもの）
- **条件**（キーワード・イベント）と**発火層**、OBS ソースを鳴らす経路一式（064a/064b）
- `OBS_OVERLAYS` の `comments` / `pinned` / `stage`

## ⚠⚠ 削除しただけでは壊れた 2 点（064d で作り直した）

### 1. `STAGE_OVERLAY_ENABLED_KEY` の書き手が居なくなった

旧: 意味は「**stage 出力の条件が 1 件以上あるか**」で、書き手は削除した `useEffectTemplates`。
⇒ 放置すると **①ステージ窓が OBS へ自動追加されない ②セットアップ用ガイドが二度と出ない**
（＝**ユーザーが OBS でこの窓を見つけられない**）という、どちらも黙って壊れる形になる。

⇒ **旗の意味を「いま配信イベントでステージ窓を使っているか」へ移した**（`ObsEffectsScreen`）:
- **開始で `true`** ＋ ガイドのワンショット旗 → OBS への自動追加とガイドがここで動く
- **終了で `false`** → OBS 側のソースは**非表示になるだけ**（削除されない・窓も閉じない）

⚠ 帰結＝**開催していない状態でアプリを再起動しても窓は復元されない**（意図した挙動）。

### 2. コーナー窓（`effect-overlay`）が「描くものが 1 つも無い窓」になった

配信イベントは 061l の時点から**ステージ窓にしか出さない**と決めていたので、
テンプレートが消えると空の透過窓が残るだけになる。⇒ **窓ごと廃止**した。
＝ `EffectOverlayApp` の `output` prop も `EffectOutput` の軸も消えている。

## 条件の保存値はどうなるか（移行コードを 1 行も書いていない）

⚠⚠ **061h から積み上げた「未知の kind は『出さない』へ倒す」という前方互換が、
そのまま後方互換としても効いた。** 旧ビルドが保存した `{"kind":"template", …}` は
`parseAssignment` の未知 kind として**安全側（出さない）へ落ちる**。
⚠ **これが移行コードを書かずに済んだ理由**である（061h の JSDoc が予告していたとおり）。

## ⏳ 残骸（意図的に放置）

依頼者の判断で**削除コードは書かない**（消すためだけのファイル削除コードを新規に書くのは本末転倒）:

- ディスク: `~/Library/Application Support/<bundle>/effects/`（macOS）
- DB: `effect_templates` テーブル（⚠ **新規環境ではそもそも作られない**）

⚠ どちらも**使われないまま残るだけ**で、手で消せる。

## 検証

`pnpm typecheck` / `lint` 緑／`pnpm test` **66 files・1565 tests 緑**（`check:css` / `check:version` も OK）／
sidecar `pnpm test` 全 PASS／`cargo test` **284 件緑**。

⚠ テスト件数は 1816 → **1565** へ減った（削除した機能ぶん）。⚠ **減ったのは検査対象が消えたからで、
検出力が落ちたわけではない**——残した経路のケースは 1 つも削っていない。

## ⏳ 未実施

- **security-review**（061p〜061t / 064a / 064b / 064d。⚠ **064d で 061c〜061t のレビュー範囲は
  大半が消滅した**——観点は docs/security.md の 064d 追補が正）

### ✅ 実機で確認したこと（2026-08-16・依頼者「問題ありませんでした」）

1. 「OBSエフェクト」画面に**取り込みのカードが無い**こと
2. 条件の `<select>` に **OBS のソースだけ**が並ぶこと（テンプレートの選択肢が無い）
3. **配信イベントの「開始」でステージ窓が開き、セットアップ用ガイドが出る**こと（⚠ 1 の作り直し）
4. ⚠ **OBS へ自動追加が効く**こと（「OBSへ自動で反映」ON のとき）
5. コメントで OBS のソースが鳴ること（064b の回帰）
