# 046c 固定コメントオーバーレイの長文見切れ修正（窓の高さ＋自動縮小フィット）

> 状態: **実装済み（2026-07-29）**。046b の E2E で出た不具合の追修正。実装記録は [`docs/progress.md`](../progress.md) の 046c 節を正とする。
>
> **必読前提**: 親 [046](046-pinned-comment-overlay.md)、[046b](046b-pinned-overlay-window.md)（この窓の生い立ち）、
> 「2026-07-28 (OBS オーバーレイの横幅: 640 を試して 400 へ差し戻し)」節（ジオメトリの教訓）。
>
> **security-review は不要（軽レビュー）**: 新規コマンド・capability・外部通信・ファイル操作・プロセス操作・依存はいずれもゼロ。
> Rust の変更は窓サイズの数値定数 1 つのみ。localStorage の保存範囲・保存項目・キーも不変（§9 追補〈046a〉に影響しない）。

## 不具合

`COMMENT_SIDECAR_MOCK=1` の E2E で、dev-mock の `LONG_CHAT_TEXT`（290 字・`dev-mock.ts:143`）を固定すると、
OBS 上で「毎回コメントを丁寧に拾ってくれるところも**大好**」＝先頭から約 166 字目、**全体の約 57%** で本文が切れる。

## 原因（CSS のクリップではない）

`-webkit-line-clamp` / `max-height` はリポジトリ全体で 0 ヒットで、**本文は DOM に全部出ている**
（`CommentList.test.tsx:303-306` が 290 字で検証済み）。**窓の高さが足りず、溢れた分が黙って切れていた**。

```
#root (height:100%)                                ← theme.css:270-276
└ div.root   height:100%                           ← OverlayApp.module.css:13-19
  └ ol.list  flex:1; min-height:0; overflow-y:auto ← CommentViewerApp.module.css:247-257
    └ li.item  flex-shrink:0                       ← OverlayComment.module.css:14-30（043c）
      └ p.text  font-size:19px; line-height:1.5    ← クリップ指定なし
```

1. `pinned-overlay` は `inner_size(480, 320)`。既存 `comment-overlay` の 720 の半分以下だった。
2. `.root` と `ol.list` がどちらも窓高に固定される。
3. `li.item` は `flex-shrink:0` なので縮まず、素直に `ol` を溢れる。
4. `followMode` 既定 `"off"` ＝ `useFollowScroll` がスクロール位置に触れない → `scrollTop=0` のまま → **下側が切れる**。
5. スクロールバーは `:global(html[data-overlay="1"] ol)::-webkit-scrollbar { width:0; height:0 }` で完全非表示のため、
   **溢れていること自体が視覚的に分からない**。

**実測見積り**（480px 幅）: 横クローム 133px（`ol` padding 24 ＋ `li` padding 8 ＋ アイコン 44 ＋ gap 28 ＋
吹き出し padding 24 ＋ border 5）→ 本文幅 ≈347px → 19px フォントで ≈18 字/行 → 290 字 ≈17 行 ≈484px ＋
縦クローム ≈70px ＝ **≈554px 必要 vs 320px** ＝ 約 57%。**報告の切れ位置と一致する。**

`docs/progress.md` の 046b 節は高さ 320 の根拠を「投げ銭カード＋長文（290 字）が収まる余裕」と記録していたが、
**この見積り自体が誤っていた**のが直接原因（046c で訂正済み）。

## 方針（依頼者の決定）

**「窓 560 化」が主役、「自動縮小フィット」は保険。**

- 窓の既定高さを **320 → 560**（290 字が等倍で収まる高さ）。
- それでも収まらない長文は**表示全体を縮小して必ず全文を出す。UX 上の縮小下限は設けない**。
- 既存 `comment-overlay` の見た目・挙動は**一切変えない**（共有 CSS 3 本と `OverlayApp.tsx` は差分ゼロ）。

## 変更ファイル

| ファイル | 変更 |
|---|---|
| `apps/desktop/src-tauri/src/lib.rs` | `open_pinned_overlay_window` の `.inner_size(480, 320)` → `(480, 560)`。JSDoc に実測見積りと「下げるとフィットが常時発動する」警告 |
| `apps/desktop/src/features/comment-viewer/overlayFit.ts`（新規） | 純粋ソルバ `fitScale` / `quantizeScale`。**DOM を知らない** |
| `apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.module.css`（新規） | クリップ用ラッパ `.fit { height:100%; overflow:hidden }` のみ |
| `apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.tsx` | `.fit` で包む／`useLayoutEffect` で測定・適用／`window.resize` に rAF コアレスで追従 |
| `apps/desktop/src/features/comment-viewer/overlayFit.test.ts`（新規） | ソルバの単体テスト 12 件 |
| `apps/desktop/src/screens/comment-viewer/PinnedOverlayApp.test.tsx` | 046c describe 5 件 ＋ レイアウト偽装ヘルパ |

## 設計判断

### スケーリング手法＝`transform: scale(k)` ＋ `width`/`height: ${100/k}%`

- **サイズ補正が本体**。transform はレイアウトに影響しないので、補正が無いと `ol` の `clientHeight`/`scrollHeight`
  が一切変わらず**収まり判定が永久に動かない**（クリップ済みの絵が縮むだけ）。補正すると内容が `W/k × H/k` で
  レイアウトされ、本文が広い幅で再フローして行数が減る＝縮小が効率よく効く。
- **却下: `zoom`** — macOS の WKWebView（レガシー実装）と Chromium 128+ で「`clientHeight` が zoom 適用後か否か」が
  非対称。測定ループの解釈がエンジン依存になり、クロスプラットフォームで最も避けたい性質。
- **却下: ルート font-size ＋ em 化** — `OverlayComment.module.css` の全 px 改変＝既存 overlay に波及する。
- **却下: `-webkit-line-clamp` で「…」省略** — 全文を出すという要件に反する（依頼者の選択）。

### 収束の保証（下限なしでも止まる）

transform 方式では **CSS のフォントサイズは 19px のまま不変**。k を下げるとレイアウト幅 `W/k` が広がって行数は
単調非増加、収容量 `available = H/k` は厳密単調増加。よって `content/available` は k について厳密単調で、
k→0 では本文が 1 行に収まる。**下限を設けなくても必ず収まる。**

実装では加えて `next = min(k * sqrt(available/content), k - 0.02)` として**毎回必ず 1 段は下げる**ので、
measure が非単調・敵対的でも停止する（テストで固定）。

`MIN_FIT_SCALE = 0.1` は **UX の下限ではなく数値ガード**（`100/k` が発散して巨大レイアウトを組むのを防ぐ）。
480px 窓なら k=0.1 はレイアウト幅 4800px ＝ 約 24,000 字相当で、Twitch 500 字 / YouTube 200 字の本文上限に対し
**40 倍以上の余裕**があり、実運用で到達しない。

### 測定まわり

- 測定対象は `rootRef.current.querySelector("ol")`。`CommentList` は共有コンポーネントで ref を受け取らないため。
  **既存 CSS が同じ理由で `ol` 要素セレクタを使っている**前例（`OverlayApp.module.css` の scrollbar 消し）に揃えた。
- `scrollHeight` / `clientHeight` に統一し、**`getBoundingClientRect()` は使わない**（transform 適用後の視覚値を
  返すため、変換前の値と混ぜると二重補正になる）。
- **`ResizeObserver` は使わない**: ①再測定が要る非同期要因が無い（オーバーレイのフォントは全て OS 標準＝FOUT 無し、
  `toPinned` が avatar を落とすので画像ロードも無い）②`.root` を observe すると自分でサイズを変えるたび再通知＝
  自己ループ。しかもこの窓は `background_throttling(Disabled)` なので裏に回っても回り続け、配信中の CPU を焼く。
- `transform`/`width`/`height` は `useLayoutEffect` の**排他所有**で、JSX の `style` には載せない
  （載せると React の内部前回値と実 DOM がズレたとき diff が一致して書き込みがスキップされる事故が起きる）。
- **等倍のときは 3 プロパティを一切書かない**（`scale(1)` すら残さない）＝短文では 046b 時点と DOM が完全に同一。

### クリップ用ラッパが要る理由

縮小時、`.root` の**レイアウトボックス**は `W/k × H/k` のまま（transform は視覚のみ）。`#root` は窓サイズちょうどで
`overflow` 指定が無いため、**ドキュメントがスクロール可能になり透過窓に body スクロールバーが出うる**。
既存のスクロールバー消しは `ol` 限定なので防げない。046b は「新規 CSS ファイルゼロ」で作ったが、
共有 CSS を触らずに済ませるにはこの 1 枚が唯一の手段なので**意図的に増やした**。

## 依存している前提（壊すと機能が黙って死ぬ）

- **`li.item { flex-shrink: 0 }`**（`OverlayComment.module.css` の 043c 追修正）。これが外れると `li` が縦圧縮されて
  `scrollHeight === clientHeight` になり、カードが潰れたまま「収まっている」と誤判定して**恒久 no-op** になる。
- **`transform` は `position:fixed` の包含ブロックを作る**。現状この窓に fixed 要素は無い
  （`CommentContextMenu` は `onPin` 未指定でレンダリングされない）が、足すときは要注意。
- **レイヤー昇格させない**。`will-change: transform` / `translateZ(0)` / `backface-visibility` を足すと
  ラスタ倍率が固定されて**確実にボケる**。2D `scale()` 単体ならテキストはベクタ描画でシャープ。

## 完了条件

- 290 字の長文を固定して OBS に出したとき、**本文が最後まで表示される**（「大好」で切れない）。
- 短いコメントの見た目が 046b 時点から変わらない。
- 既存 `comment-overlay` の表示・044a の自動追加が従来どおり。
- 新規宛先/API/capability/依存の追加が無い。`csp: null` 不変。

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# 既存 comment-overlay 非退行の証明（出力ゼロが期待値）
git diff --stat -- apps/desktop/src/screens/comment-viewer/OverlayApp.tsx \
                   apps/desktop/src/screens/comment-viewer/OverlayApp.module.css \
                   apps/desktop/src/screens/comment-viewer/OverlayComment.module.css \
                   apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css \
                   apps/desktop/src/screens/comment-viewer/CommentList.tsx
```

**実機**（`COMMENT_SIDECAR_MOCK=1 pnpm tauri dev`）。dev-mock は `seq % 20 === 19` で `LONG_CHAT_TEXT`、
`seq % 20 === 1`（youtube）で `LONG_SUPERCHAT_TEXT` を 1800ms 間隔で流す。`PinnedOverlayApp` は WS に繋がないので、
**コメビュ本体で該当コメントを右クリック→固定**して確認する。

- `LONG_CHAT_TEXT`（290 字）→ 等倍のまま全文表示（560 化だけで足りることの確認）
- `LONG_SUPERCHAT_TEXT`（290 字・`20,000 JPY` カード）→ 全文表示（k は 1 かわずかに <1）
- 窓を縦 300px 程度に手で縮める → 縮小が発動して全文が残る／戻すと復帰する
- 窓を縦 900px に広げる → 等倍に戻り**拡大はしない**
- k≈0.6 の状態で本文とスパチャカードの**にじみ・ドロップシャドウ**を目視
- **透過が保たれ、body スクロールバーが出ない**
- フォント切替・サイト名トグルで再計算が走る
- 短いコメントの見た目が従来と変わらない
- **Windows（098 VM）**: とくにスクロールバーとにじみ（エンジン差が出うるのはこの 2 点）

## フォールバック（にじみが実機で許容できなかった場合）

`PinnedOverlayApp.module.css` に**要素セレクタ**で本文だけ上書きする:

```css
.scaled p { font-size: calc(var(--pinned-text-scale, 1) * 19px); }
```

（`.scaled p` は詳細度 (0,1,1) で共有の `.text` (0,1,0) に勝つ。「モジュール跨ぎは要素セレクタ」の既存前例に乗る）

- 利点: ネイティブに小さいフォントで描かれる＝**にじみゼロ**。`100/k` 補正もクリップ用ラッパも不要になる。
- 欠点: アイコン 44px・名前・padding が縮まず**プロポーションが崩れる**。
- `overlayFit.ts` は measure の中身が変わるだけで**そのまま再利用できる**ので切替コストは小さい。
