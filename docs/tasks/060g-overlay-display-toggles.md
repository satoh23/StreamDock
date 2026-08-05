# 060g 表示項目のユーザートグル（テーマより後に効く「表示設定層」）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [060](060-overlay-custom-css.md) を正とする。
>
> **必読前提**: [060d](060d-css-theme-management-ui.md)（注入の実装と `<style>` のライフサイクル）、
> [060f](060f-overlay-dom-alignment.md)（安定クラスの追加）、
> `apps/desktop/src/features/comment-viewer/overlaySettings.ts`（既存の localStorage 経由の設定）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝ [060f](060f-overlay-dom-alignment.md) 完了**（安定クラスの追加が前提）。

## 目的

**どのデザインを当てても、「何を表示するか」はユーザーが握る。**

依頼者の要件（2026-08-05）:

- **サイト名は、どのデザインでも表示 / 非表示を切り替えられること**
- **アイコンの表示 / 非表示も、ユーザーのトグルで操作できる方式でよい**（折衷案として採用）

## ⚠⚠ いまの非対称（これが本タスクの動機）

「サイト名を表示」トグル（既存・`OVERLAY_SHOW_SOURCE_KEY`）は `CommentList` の
`{showSource && <span … sd-comment-source>}` で**要素ごと出す / 出さない**を切り替えている。したがって:

| ユーザーの操作 | テーマが `display:none` を書いている場合 | 結果 |
|---|---|---|
| **OFF にする** | — | ✅ 効く（要素が存在しない） |
| **ON にする** | `.sd-comment-source{display:none}` | ❌ **潰される** |

⚠ **「消す」だけが効いて「出す」が効かない。** テーマは「その意匠にとって不要な項目」を消すために
`display:none` を書くのが自然なので、**ユーザーが後から出したくなっても出せない**。

## やること

### (1) ⚠⚠ 「表示設定層」を**テーマより後ろ**に注入する（本タスクの核心）

オーバーレイ窓（`OverlayApp`）の `<head>` へ、**テーマの `<style>` より後**に
もう 1 枚 `<style data-sd-overlay-display>` を置き、`!important` でユーザーの選択を確定させる。

```
<head>
  … CSS Modules（Vite が起動時に入れる）
  <style data-sd-overlay-theme>    ← 060d：ユーザーのテーマ
  <style data-sd-overlay-display>  ← 060g：ユーザーの表示設定（!important）  ← 常に最後
```

- ⚠ **中身は StreamDock が組み立てる固定文字列だけ**（`display: none !important` / `display: revert !important`）。
  **ユーザー入力を 1 バイトも混ぜない**——混ぜると「テーマとは別の CSS 注入経路」を作ったことになり、
  `docs/security.md` の「レビュー必須条件（オーバーレイへのユーザー CSS の注入）」に該当してしまう。
  ⚠ **本タスクをその区分に入れないための線引きなので、動的な値を入れたくなったら設計を見直すこと。**
- ⚠ **静的ガード (10-i) の allow-list に 3 本目が増える**（`createElement("style")` の場所）。
  **allow-list を更新する前に `docs/security.md` の「レビュー必須条件」を読むこと**（ガードのメッセージがそう指示している）。

### (2) 「アイコンを表示」トグルを新設する

既存の「サイト名を表示」と**完全に同型**にする（先例をなぞる＝新しい作法を作らない）:

| 追加物 | 置き場所 | 先例 |
|---|---|---|
| `OVERLAY_SHOW_ICON_KEY` | `overlaySettings.ts` | `OVERLAY_SHOW_SOURCE_KEY` |
| `loadOverlayShowIcon()` / `saveOverlayShowIcon()` | 同上 | `loadOverlayShowSource()` / `saveOverlayShowSource()` |
| state ＋ 保存 effect | `CommentViewerApp.tsx` | `overlayShowSource` |
| トグル UI | `SettingsView.tsx`（「OBSに表示」カード） | 「サイト名を表示」 |
| `storage` 購読 | `OverlayApp.tsx` / `PinnedOverlayApp.tsx` | `OVERLAY_SHOW_SOURCE_KEY` の分岐 |
| プレビューへの受け渡し | `OverlayThemeCard` の props | `overlayShowSource` |

⚠ **既定値は「表示する」**（現行の見た目を変えない）。⚠ `loadOverlayShowSource()` は
`=== "true"` 判定＝**未保存は false** なので、アイコン側は `!== "false"` にして**未保存を true** にすること
（既定値の向きが逆である点を実装時に間違えやすい）。

### (3) 表示設定層の中身

| 設定 | 生成する CSS |
|---|---|
| サイト名 OFF | `.sd-comment-source{display:none!important}` |
| サイト名 ON | `.sd-comment-source{display:revert!important}` |
| アイコン OFF | `.sd-comment-icon{display:none!important}` |
| アイコン ON | `.sd-comment-icon{display:revert!important}` |

⚠⚠ **アイコンを消したときのレイアウト**: `.row` は `gap: var(--icon-gap)`、`.header` は
`margin-left: calc(var(--icon-size) + var(--icon-gap))` を持つので、`display:none` だけだと
**名前行が 74px インデントされたまま**になる。表示設定層で `--sd-icon-size` / `--sd-icon-gap` も
`0px !important` にすること（⚠ **ユーザーのテーマがこの 2 変数で調整している場合、それも打ち消す**——
「アイコンを出さない」を選んだ以上それが正しい）。

⚠ **`display: revert` を使う理由**: `block` / `flex` を書くと元の表示形式（`.source` は inline 相当、
`.icon` は `display:flex`）を壊す。`revert` なら「作者スタイルを取り消して UA / 前段の値へ戻す」になる。
⚠ ただし `revert` は**同じ作者オリジン内の前段**へは戻らないので、テーマの `display:none` を
確実に打ち消すには `!important` が必要（`!important` 同士は後勝ちではなく詳細度勝負になるため、
**セレクタを 1 クラスに保つ**こと＝テーマ側が `.sd-comment .sd-comment-source` のように詳細度を上げると勝てなくなる）。
⚠⚠ **この限界を docs に明記すること。** 完全に勝たせたいならインライン `style` 属性しかないが、
それは `CommentList` を条件分岐だらけにするので採らない。**「素直に書かれたテーマには勝つ」で十分**とする。

### (4) `showSource` の描画分岐をどうするか

⚠ **要素は常に描き、表示設定層で制御する形へ寄せる**（＝ `{showSource && …}` をやめる）。理由:

- 「ON なのにテーマに消される」を塞ぐには、**要素が存在していないと `display:revert` が効かない**。
- ⚠ 副作用として **OFF のときも DOM には残る**。`aria-hidden` は付けず `display:none` に任せる
  （`display:none` は支援技術からも隠れる）。
- ⚠ **アイコンは別扱い**: `.sd-comment-icon` は `avatarDataUri()` のガードを通った data URI を
  `background-image` に載せる要素なので、**OFF のときも DOM に残ると不要な画像デコードが走る**。
  アイコンだけは**従来どおり条件レンダリング＋表示設定層の併用**にすること
  （OFF＝描かない／ON＝描いたうえで `display:revert!important`）。

## やらないこと

- 名前・本文・金額のトグル（要望が出てから。**トグルを増やすほど「テーマが決める」余地が減る**）。
- テーマごとに表示設定を持つ（＝設定がテーマに従属する形）。**表示はユーザーのもの**という本タスクの前提に反する。
- 本体コメビュ（`variant="default"`）への波及。

## 実装後に必要なレビュー

**軽レビューで足りる**見込み。⚠ ただし次のどちらかに触れたら **security-review へ格上げ**すること:

- 表示設定層の CSS に**ユーザー入力由来の値**を入れた（＝新しい注入経路になる）
- `createElement("style")` の allow-list（静的ガード **(10-i)**）を、レビュー必須条件を読まずに広げた

## 完了条件

- [ ] テーマが `.sd-comment-source{display:none}` と書いていても、**トグル ON で表示される**
- [ ] テーマが何も書いていなくても、**トグル OFF で消える**
- [ ] アイコンのトグルが同様に動き、**OFF のとき名前行のインデントが残らない**
- [ ] `<style data-sd-overlay-display>` が**常にテーマの `<style>` より後ろ**にある（テストで固定）
- [ ] 表示設定層の CSS に**ユーザー入力が 1 バイトも入らない**（テストで固定）
- [ ] 本体コメビュの見た目が 1px も変わらない
- [ ] `pnpm test` / `typecheck` / `lint` が緑。**Rust 差分ゼロ**
- [ ] ⚠ 実機確認（OBS 出力での見え方・固定コメント窓）
