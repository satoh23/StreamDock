# 060i オーバーレイのヘッダ行が縮まない不具合（課金カードの金額バッジ見切れ／chat 行の横はみ出し）

> 状態: ✅ 実装済み（2026-08-09）／✅ 幾何を Chrome headless で実測・修正前後の A/B 取得済み／
> ✅ 静的ガード (10-s) を新設・**ミューテーション 7/7 KILLED**（security-review で穴 1 件を是正）／
> ⚠ **実機（`pnpm tauri dev` ＋ OBS）での最終確認は未実施**（本人環境）。
> ⚠ 併せて **表示用金額の桁区切り**（本番だけ `20000 JPY` だった三者不一致）を本人判断で同梱した。

## 症状（本人報告・スクショあり）

OBS オーバーレイのスパチャカードで、**ユーザー名が長いとヘッダ右端の金額バッジが途中で切れる**
（`ぶいちゅーばー推し` ＋ `20,000 JPY`）。「他の表示不具合も起きているかもしれない」との指摘つきで、
実際に**同根の 2 件目**（chat 行）が見つかった。

## 根本原因（1 つ）

`apps/desktop/src/screens/comment-viewer/OverlayComment.module.css`

| 箇所 | 修正前 | 修正後 |
|---|---|---|
| `.item`（コメント 1 件の `<li>`） | `grid-template-columns: auto 1fr` | `auto minmax(0, 1fr)` |
| `.card`（課金カード） | `grid-template-columns: 1fr` | `minmax(0, 1fr)` |

**`1fr` は `minmax(auto, 1fr)` の糖衣。** min トラックサイジング関数が `auto` の間は、その列を張る
グリッドアイテム（`.cardHeader` / `.header` / `.row`）の `min-width: auto` が**自動最小サイズ＝内容ベース
最小**として生き続ける。`.cardName` / `.name` は `white-space: nowrap` なので min-content ＝**名前の全幅**。
＝ **名前が長いと列そのものがカード幅／窓幅を超えて広がる**。

その結果、**`.cardName` の `flex: 1 / min-width: 0 / text-overflow: ellipsis` は一度も発動できない**
（「ヘッダ幅＝カード幅」を前提にした宣言なので、列が広がる段階では出番が来ない）。溢れはヘッダの
右端＝**金額バッジ側**に出て `.card { overflow: hidden }` に切られる。

### 症状の出方が課金カードと chat で違う理由

⚠⚠ **唯一の差は「溢れたトラックをクリップするかどうか」だけ**（security-review 060i・Q-7 で訂正）。
**`<li>` の枠が広がらないのは課金カードも chat も同じ理由**——どちらも `.list`（縦積み flex）の flex
アイテムで、flex アイテムの自動最小サイズは**主軸だけ**の規則だから `min-width: auto` は**交差軸では 0**
に計算される。＝ 広がるのは常に**グリッド列**のほうである。

- **課金カード**: `.card` は `overflow: hidden` なので、溢れたトラックが**そこで切られる**
  → カード枠は正しい幅のまま右端が clip ＝ 金額バッジの見切れ。
- **chat 行**: `.item` は `overflow: visible` なので**切られない**。2 列目が `<li>` の外へ出る
  → **名前行のサイト名ピルと吹き出しの右側が窓の外へ出て切れる**。
- ⚠ `.card` が `overflow: hidden` ＝スクロールコンテナであることも自動最小サイズを 0 にするが、それは
  上と**重複する 2 つ目の理由**で、chat との差の説明にはならない（当初そう書いていたのを訂正した）。
- ⚠ しかも `.scroller` は `overflow-y: auto` の副作用で `overflow-x` も `auto` に計算され、横スクロール
  バーは `OverlayApp.module.css` の `::-webkit-scrollbar { width: 0 }` で消してあるので
  **溢れていること自体が見えない**（060c で `<ol>` の 2 層化を招いたのと同じ「黙って切れる」型）。

### 裏付け（同型の実装は同じバグを持っていない）

アプリ内コメビュの同型カード `CommentViewerApp.module.css` の `.item.itemTipCard` は **grid ではなく
block** ＋ `overflow: hidden`。ブロック幅がコンテナ幅に固定されるので `.tipHeader` の flex が
`.tipName` を正しく縮め、ellipsis が効く。**差分は `display: grid` ＋ `1fr` の一点**だった。
＝ 「アプリ内では正しく見えるのに OBS だけ崩れる」の説明もこれで付く。

なお本リポジトリは同じ問題を別画面で既に `minmax(0, …)` で解いている
（`CommentViewerApp.module.css` の視聴者一覧・「数値列は minmax(0, ...) で縮められるようにし、
名前/最終列は ellipsis で溢れを防ぐ（横スクロールを出さない）」）。今回はその既存パターンの適用。

## 実測（判定の正）

Chrome headless ＋ `repro/measure.html?mode=overlay&case=long&w=<窓幅>`（実物の `CommentList
variant="overlay"` と本番と同じ注入経路）。⚠ `chrome --window-size` は `--dump-dom` 経路で当てにならない
ため（400 を渡して 485px で描かれた）、窓幅は `?w=` で `#root`（本番で `.sd-overlay` の親）に与える。

### 課金カード（名前 9 字 `ぶいちゅーばー推し` ＋ `20,000 JPY`）

| 窓幅 | 素の `1fr` の `.cardHeader` 幅 | カード幅 | 金額バッジの溢れ | `minmax(0, 1fr)` |
|---|---|---|---|---|
| 400 | 363.67 | 376 | 収まる（余裕 12px） | 同じ（ellipsis 未発動） |
| 360 | 363.67 | 336 | **+17.67px 切れる** | 溢れ 0・ellipsis 発動（28px 分） |
| 320 | 363.67 | 296 | **+57.67px 切れる** | 溢れ 0・ellipsis 発動（68px 分） |
| 280 | 363.67 | 256 | **+97.67px 切れる** | 溢れ 0・ellipsis 発動（108px 分） |

⚠⚠ **素の `1fr` ではヘッダ幅が窓幅に関係なく 363.67px で一定** ＝「min-content に張り付いていて縮む
余地が無い」ことの直接の証拠。`minmax(0, 1fr)` 側は常にカード幅と一致する。
⚠ 既定窓 400px でも余裕は **12px** しかない。フォント 4 択（034e）で字幅の広いものを選ぶ・名前が
1 文字伸びる・窓を少し狭める、のどれか 1 つで溢れる＝本人報告はこの帯域で起きている。

### chat 行（名前 17 字・窓幅 320px）

| | 素の `1fr` | `minmax(0, 1fr)` |
|---|---|---|
| `.header` 幅 | 290.66（`<li>` は 296 のまま） | 216（＝列幅） |
| サイト名ピルの x 範囲 | 315〜378.66 ＝ **窓 320 の完全に外** | 240.34〜304 ＝ 窓内 |
| 吹き出しの右端 | 378.66（右 58.66px が窓の外） | 304（窓内） |
| `.scroller` | `scrollWidth 379` / `clientWidth 320` ＝ **59px の横スクロールが黙って発生** | `320 == 320` ＝ **横スクロールゼロ** |
| 名前の ellipsis | 未発動 | 発動（146.34px で丸める） |
| 吹き出しの高さ | 77 | **105.5** |

⚠ 最後の行が重要: **吹き出しの高さが増えたのは「本文が折り返されるようになった」ということ**——
それまでは折り返さずに窓の外へ伸びていた（＝本文が読めなくなっていた）。

## 併せて直したもの: 表示用金額の桁区切り

`apps/comment-sidecar/src/wire.ts` が `` `${amount} ${currency}` `` で組んでいたため、
**本番表示だけ `20000 JPY`** になっていた。dev-mock は `"20,000 JPY"`（ラベルを直接組む＝wire.ts を
通らない）、設定プレビューの見本は `"￥1,000"` で、**三者が食い違っていた**
＝「動作確認では正しく見えるのに本番だけ桁が読みにくい」状態。

- 修正は 1 箇所（`fmtMonetaryAmount`）。これで**全表示経路**（オーバーレイ課金カード／アプリ内課金
  カード／課金ティッカー／固定コメント帯／過去コメント）が揃う。
- ⚠⚠ **`maximumFractionDigits: 20` は必須**（既定は 3）。`amount` は `amount_micros / 1_000_000` 由来で
  理屈上小数 6 桁までありうるため、既定のままだと**丸めが入って監視した金額と違う値を表示する**。
  `monetaryAmount` は「監視済みの値をそのまま出す」文字列（`CommentList.tsx` の注記）なので、
  桁区切りを足すために丸めを持ち込んではならない。
- ⚠ 単位の綴りは変えていない（`BITS` だけ小文字 `bits`＝043a からの仕様）。
- ⚠ 読み上げ（`speechText.ts`）と集計は**この文字列を使わず数値 `monetary.amount` を見る**ので無影響。
- プレビュー見本も本番と同形（`"1,000 JPY"`）に直した——金額バッジは `white-space: nowrap` で
  ヘッダ右端を占める要素なので、**見本の綴りが短いと「本番では入らない幅」を「入る」と誤って見せる**。

## 変更したファイル

| ファイル | 変更 |
|---|---|
| `apps/desktop/src/screens/comment-viewer/OverlayComment.module.css` | `.item` / `.card` のトラックを `minmax(0, …)` へ＋理由と実測値の注記 |
| `apps/desktop/scripts/check-css-guards.mjs` | **(10-s)** 新設 |
| `apps/desktop/src/screens/comment-viewer/CommentList.test.tsx` | docstring の引用値を更新（アサーションではない） |
| `apps/comment-sidecar/src/wire.ts` | `fmtMonetaryAmount`（桁区切り・丸めなし） |
| `apps/comment-sidecar/scripts/test-comment-relay.mjs` | E 節（060i）4 ケース追加 |
| `apps/desktop/src/screens/comment-viewer/OverlayThemeCard.tsx` | プレビュー見本の金額表記 |
| `apps/desktop/repro/measure.tsx` | `?case=long` / `?w=` と 060i 用の幾何レポートを追加（調査用ハーネス） |

**触っていないもの**: `cssCompat.ts` の変換表、`overlayThemeReset.ts`、安定クラス契約、(10-n) の名簿、
`.cardName` / `.name` / `.source` / `.amountBadge` の宣言（今回の変更で本来の挙動に戻るため不要）。

## 静的ガード (10-s)

- **番号は (10-r) を飛ばしてある**——(10-r) は 060c 追修正⑥ 用に予約済み（実機確認が通ってから足す方針）。
- 検査内容: `.item` の 2 列目と `.card` の単一列が `minmax(0, …)` であること。**min 側が `0` である綴りを
  要求する**（`minmax(auto, 1fr)` と書いて「minmax だから OK」に見せる形も殺す）。
- ⚠⚠ **(10-n) では守れない**。あれは器ごとの「宣言してよいプロパティ**名**の集合」だけを見て**値を見ない**
  （`grid-template-columns` は既に両者の名簿に入っている）ので、1 トークンの差し戻しを素通りさせる。
- ⚠⚠ **jsdom はレイアウトを解決しないので vitest でも守れない**＝**ここが唯一の機械的な受け皿**。
- **ミューテーション 7/7 KILLED**（初版 5 種 ＋ security-review で見つかった 2 種）:
  `.item` を `1fr` へ／`.item` を `minmax(auto, 1fr)` へ／`.card` を `1fr` へ／`.card` を
  `minmax(auto, 1fr)` へ／`.card` のルールごと消す（＝検査の無効化）／
  **末尾に `.card { grid-template-columns: 1fr }` を追記**／**末尾に `.item { … auto 1fr }` を追記**。
- ⚠⚠ **後ろ 2 種は初版（`bodies.some`）では生存していた**（security-review 060i・Q-1・2026-08-09 に是正）。
  CSS はソース順で後勝ちなので、**同じセレクタの 2 本目を後ろに足すとバグが完全に再発する**のに緑のまま
  通っていた。判定を「`grid-template-columns` を宣言しているルールが**すべて**一致」へ変更した。
  ⚠ この CSS は `.card` が `.item` を後勝ちで打ち消す構造を既に採っている＝**ここで最も起きやすい編集**。

## 受容した限界

1. **極狭窓**: 窓を `min_inner_size` の 240px 近くまで狭めると、名前を 0 幅にしても固定要素だけで
   約 238px 必要（アイコン 44 ＋ gap 24 ＋ サイト名ピル ≈ 64 ＋ 金額ピル ≈ 86 ＋ padding 20）なので、
   `minmax(0, 1fr)` でも金額は切れる。既定 400px では収まるため受容した。
   ⚠ 対処（サイト名ピルの優先度付け・出し入れ）は **060g（保留中の表示項目トグル）と設計が重なる**ので
   持ち込まない。**再修正トリガー**: 本人が狭い窓で運用したいと判断したとき。
2. **既存 DB 行の表記混在**: `monetary_amount` は SQLite（`viewer_comments`）に保存済みで、修正前に
   記録された過去コメントは `20000 JPY` のまま表示される（`commentAmount()` は `monetaryAmount` を優先）。
   マイグレーションはしない——表示専用の見た目差で、数値集計は `amount` 列由来なので正確性に影響しない。
3. **`Intl` 依存**: sidecar は Node SEA バンドル。公式 Node は full-icu 同梱なので `toLocaleString("ja-JP")`
   は期待どおり動き、万一 ICU が縮小構成でもフォールバック先も 3 桁区切りなので破綻しない
   （`test-comment-relay.mjs` が期待値を固定している）。
4. **計測は Chrome（Blink）で実機 WKWebView ではない**。CSS Grid の `minmax(0, …)` は仕様どおりの挙動で
   WebKit 固有の差が出る類ではないが、**実機の A/B スクショは本人環境で未実施**。

## 対象外（既知の別件・今回は触っていない）

- 配信窓で**絶対長の高さ**を書くテーマがはみ出す件（060c 追修正④で実測済み・未修正の残課題）
- テーマの縦バーが本文中心より約 10px 上にずれる件（060c で見送り決定済み）
- `…renderer #content{padding-left:8px}` が変換も警告もされず落ちる件（060c 追修正⑥の副産物）
- `yt-live-chat-paid-message-renderer{display:none}` が未変換で課金カードを消す手段が無い件（060g の宿題）
- 設定プレビューのダミーを長い名前にすること——プレビューは**意匠の見本**なので崩れて見える形にしない。
  ⚠ ただし**「既定のダミーが短いから設定プレビューでは気付けなかった」のが本不具合の発見遅れの原因**なので、
  検証は `repro/measure.html?case=long` を使うこと（そのために `?case=long` を足した）。

## 検証

```sh
# 自動
pnpm typecheck && pnpm lint
pnpm --filter ./apps/desktop test              # vitest 1164 件 + check:css((10-s) 含む) + check:version
pnpm --filter ./apps/comment-sidecar test      # test-comment-relay.mjs の E 節
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# 幾何の実測（A/B の取り直し）
pnpm --filter ./apps/desktop dev
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=old --disable-gpu \
  --virtual-time-budget=2000 --user-data-dir=<tmp> --dump-dom \
  "http://localhost:1420/repro/measure.html?mode=overlay&case=long&w=320"
# ⚠ chrome は --dump-dom 後に終了しないことがある（DOM は出力済み）。出力が安定したら kill する。
```

### 実機（未実施・本人環境）

```sh
COMMENT_SIDECAR_MOCK=1 pnpm tauri dev
```
コメビュ窓 →「コメントをOBSに表示」でオーバーレイ窓（既定 400×720）を開き、dev-mock の
`seq % 20 === 1`（赤スパ ＋ `20,000 JPY` ＋ 290 字長文）の行で確認する。

1. 既定 400px 幅で金額バッジが全部出る／名前は `…` で丸まる
2. 窓を 300px 程度まで狭めても金額バッジが切れない
3. フォント 4 択を全部切り替えても 1・2 が保たれる
4. **非退行**: 短い名前の課金カード・chat 吹き出し・しっぽ・アイコン間隔が従来と同じ（スクショ A/B）
5. 固定コメント窓（`pinned-overlay`・同じ `variant="overlay"` を共有）でも 4 が保たれる
6. 金額表記が `20,000 JPY`（モックと本番で同形）
