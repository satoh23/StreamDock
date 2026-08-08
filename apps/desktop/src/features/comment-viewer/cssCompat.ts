/**
 * 060a: 純正チャット（YouTube / Twitch）向けに書かれたユーザー CSS のセレクタを、StreamDock
 * オーバーレイの**安定クラス（`sd-*`）**へ機械的に書き換える純関数。React/CSS/DOM 非依存で、
 * `features/` の他モジュール（`connectionStatus.ts` 等）と同じく素の Node からも import できる。
 *
 * ## なぜ変換なのか（親 060 の決定）
 *
 * ユーザーの CSS は `yt-live-chat-text-message-renderer #message` / `.chat-line__no-background` の
 * ように**他社の DOM 形**で書かれている。StreamDock 側の DOM をその形に寄せる（カスタム要素名や
 * 重複 `id="message"` を持ち込む）と、意匠・アクセシビリティ・テストが他社仕様に人質を取られる。
 * **変換表なら StreamDock の DOM はきれいなままで、対応表が古くなっても StreamDock 側は壊れない。**
 *
 * ## ⚠ この module が「しないこと」
 *
 * - **`@import` と `url()` には触らない。** 外部参照の除去は 060b（Rust 側）、外部 `@import` の
 *   スナップショットは 060c の責務。**2 か所で同じ入力を触ると、片方だけ緩んだときに気づけない。**
 *   下の `scanPreludes()` は「セレクタ（プレリュード）以外を一切見ない」形なので、この分離は
 *   **祈りではなく構造**で担保されている（宣言部・文字列・コメントの中身に触る経路が存在しない）。
 * - **CSS の完全パースはしない**（新規依存ゼロ）。セレクタ部分の文字列置換に留める。
 * - **変換できなかったセレクタを消さない。** そのまま残し、`unmatched` に記録して呼び出し側へ返す。
 *   黙って効かないのが最悪なので、UI（060d）が「効かないセレクタ」を必ず出せるようにする。
 *
 * ## ⚠ 呼び出し元（060a 時点ではゼロ）
 *
 * **060a 時点でこの関数を呼ぶコードは存在しない**（import 元は `cssCompat.test.ts` のみ）。
 * 呼ぶのは **060d の注入処理**で、060b の決定により「**保存するのは変換前の CSS・変換は注入時に
 * frontend が毎回行う**」（変換表を更新すると取り込み済みテーマにも自動で効く）。
 * → **注入とプレビュー表示のたびに毎回走る**ので、**決定性**（同じ入力→同じ `rewritten`/`unmatched`）と
 * **冪等性**（2 回通しても壊れない）が機能要件。冪等性は `SELECTOR_TABLE` の `from` に sd 語彙を
 * 書かないことで成立し、`scripts/check-css-guards.mjs` の **(10-c)** が静的に守っている。
 *
 * 再修正トリガー: この関数の呼び出し元が増えたら、**呼ぶ側が 060b の外部参照除去を通した CSS を
 * 渡しているか**を必ず確認すること（安定クラス `.sd-comment-icon` は `background-image: url(…)` で
 * 外部画像を差せる的でもあり、塞ぐのは 060b の責務）。
 */

/** 変換表の 1 エントリ。 */
export interface SelectorRule {
  /**
   * 元セレクタ（純正チャット由来）。空白は `\s+` / `>` の両方を許す形へコンパイルされるので、
   * `renderer #message` と `renderer > #message` の双方に当たる。
   * ⚠ **sd 語彙（`sd-` を含む文字列）を書かないこと**——変換は注入のたびに毎回走るため、
   * 自分の出力に当たる表を書くと冪等性が壊れる（check-css-guards.mjs **(10-c)** が検査する）。
   */
  readonly from: string;
  /**
   * 変換先。⚠ **必ず実 DOM に存在する安定クラス**であること
   * （契約一覧との突き合わせを check-css-guards.mjs **(10-b)** が、その契約が `CommentList.tsx` に
   * 実在することを **(10-a)** が行う）。
   *
   * ⚠⚠ **書けるのは「1 要素の複合セレクタ」だけ**（`.sd-comment-text.sd-comment-in-chat`）。
   * **子孫結合子（空白 / `>`）を書いてはいけない**——合成したときに前置が二重に積まれて
   * 「絶対に当たらないセレクタ」になる（理由と実測は `SELECTOR_TABLE` の docstring）。
   * これは静的ガード **(10-l)** が機械で禁じている。(10-b) は `to` から**全クラストークン**を抜いて
   * 契約と突き合わせる形なので、複合でも検査は効く。
   * ⚠ 詳細度が `(0,1,0)` → `(0,2,0)` へ上がる点に注意——既定意匠（CSS Modules の単一クラス）には
   * 順序に依存せず勝つようになる代わりに、**同じテーマの中で後から `.sd-comment-text{…}` と
   * 書いた指定に勝ってしまう**（変換前は後勝ちだった）。060f で受容した既知の挙動。
   *
   * ⚠ `.sd-overlay`（窓ルート）は **060f で解禁した**。060a 時点は「060d のプレビューは全セレクタへ
   * `.sd-preview` を前置するので、窓ルートを指すセレクタはプレビュー側で当たらなくなる」を理由に
   * 禁じていたが、**060d は `.sd-overlay` を `.sd-preview` へ読み替える実装になった**
   * （`cssScope.ts` の `ROOT_LIKE_CS`）ため、この制約は既に解消されている
   * （実測: `.sd-overlay{…}` → `.sd-preview{…}` ／ `.sd-overlay.dark …` → `.sd-preview.dark …`）。
   * ⚠⚠ 代わりに別の注意が要る——`.sd-overlay` は `OverlayApp` の `height: 100%` のルート div なので、
   * そこに不透明な `background` を書いたテーマは **OBS の透過合成を実質的に壊す**
   * （窓自体は `html[data-overlay="1"]` の `:global` で透明なままだが、中の div が全面を塗る）。
   * ＝ **`body` を変換表に入れてはいけない理由と同じ症状**が、こちらの経路では成立する。
   * それでも入れているのは、`.sd-overlay` が CSS 変数（`--sd-*`）を上書きする**唯一の器**で
   * 的そのものが必要だから。脱出路は 060d の「既定のデザインに戻す」に委ねる。
   * ⚠ **ただしこれは「060f が開けた新しい穴」ではない**（security-review 2026-08-05 で受容妥当と判定）。
   * `.sd-overlay` は 060a が公開した契約クラスで、ユーザーは 060a 時点から `.sd-overlay{background:#fff}`
   * と**直接書けた**。060f が変えたのは能力ではなく**踏む確率**（StreamDock 語彙を知らない人が
   * 純正チャット向けテーマを貼るだけで踏める）だけである。しかも OBS 用に配られている純正テーマは
   * `yt-live-chat-app{background:transparent}` を書くのが定番なので、この変換は**透過を助ける**側に多く効く。
   * ＝ **ここから `.sd-overlay` を消しても窓は守れない**（消えるのは `--sd-*` の器だけで CSS 変数が全滅する）。
   * 「危なそうだから外す」判断をしないこと。
   * ⚠ `.sd-overlay` は `CommentList.tsx` ではなく `OverlayApp.tsx` に在るので、(10-b) 側は
   * `STABLE_CLASSES` とは別の `ROOT_CLASSES` として持っている（(10-a) の対象には入れない）。
   */
  readonly to: string;
  /** なぜこの対応なのか（表を読む人向け）。 */
  readonly why: string;
}

/**
 * 060a: セレクタ変換表（初期版）。**網羅は目指さない**——実サンプルが通るところから始め、
 * 要望が来たら足す（`unmatched` が「何が足りないか」の観測手段になる）。
 *
 * ⚠ **単独の `#message` / `#author-name` / `#img` は入れない。** これらは YouTube 内部の id だが、
 * セレクタとしては汎用すぎてユーザー自身の `#img` を壊しうる。**祖先付きの形だけ**を表に入れる
 * （`yt-img-shadow` は `yt-` 接頭辞を持つので単独でも安全）。
 *
 * ⚠ **適用順は定義順ではなく `from` の長い順**（下の `COMPILED` がソートする）＝表を書く人は
 * 順序を気にしなくてよい。`yt-live-chat-text-message-renderer` を先に当ててしまうと
 * `… #message` が `.sd-comment #message` に化けて壊れるため。
 *
 * ⚠ **だからこの表は意図的に「長さ順に並べていない」**（総論のエントリを各論より先に置いてある）。
 * 定義順が既に長さ順だと、`COMPILED` のソートを外す変異が**テストで殺せなくなる**（実測で生存した）。
 * 表を並べ替えるときも、長さ順には**しないこと**——ソートが効いていることの証拠がこの並びである。
 *
 * ## ⚠⚠⚠ 060f 追修正④(2026-08-08): この表の射程は **chat だけ**
 *
 * **課金カード（投げ銭カード）には安定クラスも `data-sd-*` も付いていない**（`CommentList.tsx` の
 * 課金分岐・静的ガード **(10-o)**）。したがって:
 *
 * - **課金カードを狙う `from` をここに書いてはいけない**（変換先が DOM に無い＝
 *   `rewritten` だけ加算されて当たらない＝ (10-b) が「最悪」と呼ぶ状態）。
 * - `yt-img-shadow` → `.sd-comment-icon` のような**共有要素の対応も、実際には chat にしか当たらない**。
 *
 * ⚠⚠⚠ **ただし「課金カードには到達できない」ではない**（security-review 2026-08-08 で実測・
 * **絶対表現を書かないこと**）。狭まったのは「**名指しできるか**」であって「到達できるか」ではない——
 * この表が持つ**器のエントリ**（`yt-live-chat-app` / `yt-live-chat-renderer` → `.sd-overlay`、
 * `yt-live-chat-item-list-renderer #items` → `.sd-comment-list`）は課金カードの**祖先**なので、
 * テーマが汎用/型セレクタと組み合わせれば届く（実測: `.sd-overlay *` が課金カードの中の **9 要素**に、
 * `.sd-comment-list > *` と `.sd-overlay li` が **`<li>` 自身**に当たる）。
 * ＝ 060f は「課金カードの名指し」を塞ぐと同時に「純正語彙 → 祖先」の経路を 1 つ開けている。
 * ⚠ **能力そのものは 060a 時点から `.sd-overlay li{…}` と直接書けた**ので区分は変わらないが、
 * 上がったのは**踏む確率**である（`.sd-overlay` を表に入れた判断と同じトレードオフ・`to` の docstring 参照）。
 * ⚠ 起票理由である `yt-live-chat-paid-message-renderer{display:none!important}` は**未変換のまま**なので
 * 実害は解消している。塞げていないのは「祖先＋汎用」だけで、そこまで保証したくなったら必要なのは
 * 目印の除去ではなく**構造の分離**（課金カードを shadow root か別の器へ出す）である。
 * ⚠ 既知の限界として `CommentList.selectorContract.test.tsx` が「当たるのが現状」を固定している。
 *
 * ⚠⚠ **なぜ「限定」ではなく「切り離し」になったのか**（060f は 3 巡ぶん限定で解こうとして失敗した）:
 * 060f 当初は「chat 専用のセレクタは chat 専用クラス（`.sd-comment-chat`）へ向け、共有要素は限定しない」
 * という設計だった。しかし配布テーマは
 * `yt-live-chat-paid-message-renderer{display:none!important}` のように**課金カードを名指しで消しにくる**
 * （純正チャットではスパチャがティッカーにも出るので「インライン側を消す」のが定番。StreamDock に
 * ティッカーは無いのでこの意図は成立しない）。＝ **目印クラスをどれだけ足しても防げない**ので、
 * 課金カードそのものをユーザー CSS の的から外した（2026-08-08 本人決定）。
 *
 * ⚠ `.sd-comment` / `.sd-comment-chat` は**どちらも chat の `<li>` だけ**を指すようになった。
 * ⚠ **限定の表し方は「同一要素の目印クラス」で、子孫セレクタにはしない**（次の節が理由）。
 *
 * ## ⚠⚠⚠ `to` は「1 要素の複合セレクタ」だけ —— 子孫結合子を書いてはいけない
 *
 * 060f の初版は `to` を**子孫セレクタ**（`.sd-comment-chat .sd-comment-text`）にしていたが、
 * security-review（2026-08-05）で **祖先側のエントリと合成されると前置が二重に積まれ、
 * 「絶対に当たらないセレクタ」になる**ことが実測された。トークン単位の置換である以上、表だけでは防げない。
 *
 * ```text
 * .chat-line__message .chat-line__message-body
 *   060f 初版: .sd-comment-chat .sd-comment-chat .sd-comment-text  → <li> の中に <li> が要る＝永久に当たらない
 *   現行     : .sd-comment-chat .sd-comment-text.sd-comment-in-chat → 当たる
 * span.chat-author__display-name
 *   060f 初版: span.sd-comment-chat .sd-comment-name               → 当たらない
 *   現行     : span.sd-comment-name.sd-comment-in-chat             → 当たる（名前は <span>）
 * ```
 *
 * ⚠⚠ この失敗は**黙っている**——`rewritten` は**加算され** `unmatched` は**空**なので、060d の UI が
 * 「M 個のルールを変換しました」と**積極的に誤報する**。この module の docstring が「黙って効かないのが
 * 最悪」と呼び、(10-b) が「変換されたのに効かない＝最悪の状態」と呼んでいる状態そのものだった
 * （しかも 3 件は 060f 以前に**効いていた**ものの回帰だった）。
 *
 * → **解決＝ `to` を「1 要素の複合セレクタ」に限り、限定は `sd-comment-in-chat` の
 * 目印クラスで表す**（2026-08-06）。合成しても構造が保存されるので、上のような二重前置が起きない。
 * ⚠ 対になっていた `sd-comment-in-tip` は 060f 追修正④で廃止（課金カードに安定クラスを付けなくなった）。
 * ⚠ **これは作法ではなく機械で守られている契約**——静的ガード **(10-l)** が `to` の空白 / `>` を禁じ、
 * `cssCompat.test.ts` の**全順序対（表の全エントリ × 全エントリ）の総当たりテスト**が「合成しても同じクラストークンが隣接して
 * 二重に現れない」ことを固定している。**どちらも消さないこと**（初版の欠陥はこの 2 つがあれば自動検出できた）。
 * ⚠ `compileFrom()` の**前方境界を厳しくする案は採らなかった**——上の失敗は空白区切りでも起きるので直らず、
 * かつ `span.chat-author__display-name` のような**正当で頻出の複合指定を未変換に落とす**副作用がある。
 * ⚠ 目印を `sd-comment-chat` 自身に兼ねさせなかったのも意図（`CommentList.tsx` の契約コメント参照）。
 *
 * ⚠ **残件（構造上そうなるもの・欠陥ではない）**: `to` が**完全に同じ**2 エントリを合成した形
 * （`yt-live-chat-app yt-live-chat-renderer` → `.sd-overlay .sd-overlay` ／
 * `.chat-line__message .chat-line__no-background` → `.sd-comment-chat .sd-comment-chat`）は当たらない。
 * StreamDock 側は「窓ルートが 1 枚」「コメント行が 1 枚」なので**入れ子が存在しない**＝表現しようがない。
 * 総当たりテストはこの「`to` が同一」のペアだけを除外している（除外理由はテスト側に書いてある）。
 *
 * ⚠⚠ **`body` / `html` / `:root` は絶対に入れない。** オーバーレイ窓の透過（OBS 合成の前提）は
 * `html[data-overlay="1"]` の背景透明化で成立しており、そこを的にすると窓が塗り潰せる。
 * ⚠ ただし**未変換の `body` は `unmatched` にも載らない**（`FOREIGN_SELECTOR_RE` は接頭辞ベースで、
 * 「sd 語彙でない全セレクタ」を載せる設計ではないため。実測済み・`cssCompat.test.ts` が固定）。
 * ＝ **「未変換だから警告で気付ける」とは限らない**ので、ここに足さない判断はコメントで守るしかない。
 */
export const SELECTOR_TABLE: readonly SelectorRule[] = [
  // --- YouTube 純正チャット -------------------------------------------------
  {
    from: "yt-live-chat-text-message-renderer",
    to: ".sd-comment-chat",
    why: "コメント 1 件（**テキストコメント専用**）。⚠ 060f で `.sd-comment`（chat と課金の両方に付く）から chat 専用クラスへ向け直した。⚠ 下の祖先付きエントリ（#message 等）より**後**に当たる（長い順ソート）。",
  },
  {
    from: "yt-live-chat-text-message-renderer #message",
    to: ".sd-comment-text.sd-comment-in-chat",
    why: "chat の本文。⚠⚠ 060f で DOM を `li > .row > p.sd-comment-body.sd-comment-text.sd-comment-in-chat` の 1 枚に畳んだので、取り込んだ CSS の吹き出しと `:before` / `:after` のしっぽが **StreamDock のしっぽと同じ要素・同じ疑似要素**に当たる（二重ではなく置き換えになる）。",
  },
  {
    from: "yt-live-chat-text-message-renderer #author-name",
    to: ".sd-comment-name.sd-comment-in-chat",
    why: "chat の投稿者名。課金カードのヘッダ名（同じ `.sd-comment-name`）には当てない。",
  },
  {
    from: "yt-live-chat-text-message-renderer #img",
    to: ".sd-comment-icon.sd-comment-in-chat",
    why: "chat の投稿者アイコン。祖先付きの形だけを変換する（単独 #img はユーザー自身の id を壊しうる）。",
  },
  // ⚠⚠⚠ 060f 追修正④(2026-08-08・本人決定): **課金系のエントリはここに置かない。**
  //   削除したのは 3 件——`yt-live-chat-paid-message-renderer` → `.sd-comment-tip` ／
  //   `yt-live-chat-paid-message-renderer #message` → `.sd-comment-text.sd-comment-in-tip` ／
  //   `.yt-live-chat-membership-item-renderer` → `.sd-comment-tip`。
  //
  //   理由＝ **課金カードをユーザー CSS の的から外した**（`CommentList.tsx` の課金分岐が安定クラスも
  //   `data-sd-*` も持たなくなった）ため、変換先が **DOM に存在しない**。残すと `rewritten` だけが
  //   加算されて当たらない＝ (10-b) が「最悪」と呼ぶ「**変換されたのに効かない**」状態になる。
  //
  //   ⚠⚠ **戻さないこと。** 配布テーマは `yt-live-chat-paid-message-renderer{display:none!important}`
  //   （純正チャットではスパチャがティッカーにも出るので「インライン側を消す」定番）を書くのが普通で、
  //   これを変換すると **StreamDock の課金カードが丸ごと消える**（2026-08-08 実機で発生）。
  //   ⚠ 削除後、これらのセレクタは未変換のまま残り **`unmatched` に出る**（`FOREIGN_SELECTOR_RE` が
  //   `yt-` 接頭辞を拾う）＝ ユーザーには「効きません」と見える。**それが正しい状態。**
  {
    from: "yt-img-shadow",
    to: ".sd-comment-icon",
    why: "アイコンの枠。yt- 接頭辞があるので単独でも他と衝突しない。⚠ **目印を付けない（＝ `.sd-comment-icon` のまま）**——060f 追修正④で課金カードから安定クラスが消えたので、目印なしでも**実際に当たるのは chat のアイコンだけ**。`-in-chat` を足しても意味が変わらないぶん、`from` が chat 専用ではない（YouTube では課金側にも出る要素）ことを字面に残しておく。",
  },
  {
    from: ".yt-live-chat-text-message-renderer",
    to: ".sd-comment-chat",
    why: "コメント 1 件（**クラス形**）。⚠⚠ 060f 追修正③（2026-08-08）で追加——依頼者の実サンプルの**看板デザイン**（吹き出し左端の縦バー）が `.yt-live-chat-text-message-renderer::before` で書かれており、**変換も警告もされず黙って消えていた**（実機で確認）。YouTube の Polymer は同名のクラスを子孫にも撒くので、実テーマではこちらの形が頻出する。⚠ **要素形（上）とは別エントリが必要**——要素形の前方境界 `(?<![A-Za-z0-9_.#-])` は `.` を弾く（弾かないと `.yt-…` が `..sd-comment-chat` に壊れる）。⚠ この `to` へ絶対配置で装飾を描くテーマのために、`overlayThemeReset.ts` が `.sd-comment` へ `position: relative` を与えている（無いと窓の左上へ飛ぶ）。",
  },
  {
    from: ".yt-live-chat-author-chip",
    to: ".sd-comment-name.sd-comment-in-chat",
    why: "投稿者名チップ（060f で追加。実サンプルで未変換だった）。⚠ クラス形なので `unmatched` にも載っていなかった（FOREIGN_SELECTOR_RE の lookbehind が `.yt-` を弾く）。",
  },
  {
    from: "yt-live-chat-app",
    to: ".sd-overlay",
    why: "窓ルート（全体の背景・書体）。⚠⚠ `.sd-overlay` は OverlayApp の height:100% のルート div なので、不透明な background を書かれると OBS の透過合成が実質的に壊れる（`to` の docstring を参照）。的として必要なので受容し、脱出路は「既定のデザインに戻す」。",
  },
  {
    from: "yt-live-chat-renderer",
    to: ".sd-overlay",
    why: "窓ルート（同上）。⚠ `yt-live-chat-item-list-renderer` とは別トークンなので巻き込まない（単語境界付き）。",
  },
  {
    from: "yt-live-chat-item-list-renderer #items",
    to: ".sd-comment-list",
    why: "一覧の器（`<ol>`）。⚠ `sd-comment-list` は overlay バリアントのときだけ DOM に出る（本体コメビュと `<ol>` を共有しているため）。",
  },
  // ⚠⚠ **`div#author-info` → `.sd-comment-header` は 060c 追修正(2026-08-09)で削除した。**
  //
  // 実機で外部テーマ（吹き出し系）を取り込んだら**全コメントの上に空の 16px の帯**が出た。原因:
  //   - YouTube の `div#author-info` は**課金カード（paid renderer）のヘッダ**で、
  //     **テキストコメントには存在しない**。
  //   - 実テーマは `#author-info{padding:8px 16px!important}` を書きつつ
  //     `yt-live-chat-paid-message-renderer{display:none}` で課金カードごと消す＝
  //     **YouTube では 1 度も効かない宣言**だった。
  //   - StreamDock ではそれが **chat の名前行**に当たり、しかも同じテーマが
  //     `.yt-live-chat-author-chip{display:none}`（→ `.sd-comment-name`）で名前を消すので、
  //     **中身が空なのに padding だけ残る帯**が 1 コメントごとに挿さった。
  //
  // ＝ 「chat と課金の両方に現れる役割」という 060f の読みが**そもそも誤り**だった（YouTube の
  // テキストコメントに `#author-info` は無い）。⚠ **戻さないこと。**
  // ⚠ `.sd-comment-header` は安定クラス契約としては**残す**（ユーザーは StreamDock 語彙で
  // `.sd-comment-header{…}` と直接書ける）。消したのは「純正語彙からの対応」だけである。
  // ⚠ 代わりに `#author-info` を [`FOREIGN_ID_NAMES`] へ足して**「効きません」と警告が出る**ようにした。

  // --- Twitch 純正チャット --------------------------------------------------
  {
    from: ".chat-line__message",
    to: ".sd-comment-chat",
    why: "コメント 1 件（chat 専用）。⚠ 060f で chat 限定へ。",
  },
  {
    from: ".chat-line__message-body",
    to: ".sd-comment-text.sd-comment-in-chat",
    why: "chat の本文。⚠ .chat-line__message より先に当たる（長い順ソート）。単語境界でも守られている。",
  },
  {
    from: ".chat-line__no-background",
    to: ".sd-comment-chat",
    why: "コメント 1 件（背景なし行・chat 専用）。⚠ 060f で chat 限定へ。",
  },
  {
    from: ".chat-author__display-name",
    to: ".sd-comment-name.sd-comment-in-chat",
    why: "chat の投稿者名。⚠ 060f で chat 限定へ。",
  },
];

/** `rewriteSelectors()` の戻り値。 */
export interface RewriteResult {
  /** 変換後の CSS。**変換できなかったセレクタは消さずそのまま残る。** */
  css: string;
  /**
   * セレクタに 1 箇所以上の変換が起きた**ルールの数**（`{ … }` ブロック 1 つ＝最大 1 件）。
   * 1 ルールのセレクタに 3 箇所の置換が起きても 1。060d の UI 文言
   * 「M 個のルールを StreamDock 用に変換しました」に**そのまま**落ちる粒度にしてある。
   *
   * ⚠ **「変換した」は「効く」を意味しない**（060a レビュー Q-1）。複合セレクタの一部だけが
   * 変換され、残りが純正チャットのままなら、そのルールは `rewritten` に数えられたうえで**当たらない**
   * （`…renderer #timestamp` → `.sd-comment #timestamp`）。裸 id ぶんは `unmatched` が拾うように
   * したので UI は両方を出せるが、**`rewritten` 単独を「成功件数」として見せないこと**。
   */
  rewritten: number;
  /**
   * 変換後もなお残っている**純正チャット由来のセレクタトークン**（重複排除・出現順）。
   *
   * ⚠ **「sd 語彙でない全セレクタ」ではない。** それだと `body` / `@media` / 擬似クラスが大量に載って
   * 警告が意味を失う（ユーザーが自分で sd 語彙に沿って書いた CSS でも警告だらけになる）。
   * 判定は `FOREIGN_SELECTOR_RE`＝**接頭辞ベース＋純正チャットの裸 id の列挙**。
   * 裸 id を**変換表**に入れない判断とは別物（`FOREIGN_ID_NAMES` の docstring を参照）。
   *
   * ⚠ 要素は**ルールではなくトークン**（例 `"yt-live-chat-paid-sticker-renderer"`）。
   * UI は「効かないセレクタ: …」と出せる＝ユーザーが何を直せばよいか分かる。
   * したがって `unmatched.length` は**種類数であってルール数ではない**（060d への申し送り）。
   *
   * ⚠⚠ **要素数も 1 要素の長さも入力次第で無制限**（060a レビュー S-1・実測）。
   * ここは**ユーザー CSS 由来の未署名文字列**なので、060d は**そのまま画面に出さず clamp すること**:
   *   - 要素数: 相異なる `.chat-*` を 2 万個含む CSS → `unmatched.length === 20000`
   *   - 1 要素の長さ: 引用符**なし**の属性値は `\[data-a-target[^\]]*\]` が `]` まで無制限に拾うため、
   *     5 万文字の 1 トークンになりうる。`[^\]]` は改行も制御文字も食う。
   *   - なお引用符**付き**（`[data-a-target="…"]`）は走査が文字列を除外するので載らない（実測）。
   * React が escape するので XSS にはならないが、長さ無制限の未署名文字列という点で
   * 055b review S-5 と同型。件数と 1 件あたりの長さの**両方**に上限を課すこと。
   */
  unmatched: string[];
}

/** 中に「規則」を持つアットルール（この中はセレクタとして走査を続ける）。 */
const GROUP_AT_RULES: ReadonlySet<string> = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "document",
]);

/**
 * 060a: 純正チャット由来の**裸の id**。⚠ **警告専用**で、`SELECTOR_TABLE` には入れない。
 *
 * ⚠⚠ **「変換しない理由」と「警告しない理由」は別物**（060a レビュー Q-1 で是正）。
 * 裸の id を**変換**表に入れないのは正しい——`#img` を `.sd-comment-icon` に化けさせると
 * ユーザー自身の `#img` を壊しうるため（だから表には祖先付きの形だけを入れてある）。
 * しかし**警告**にその理屈は移らない。**ユーザーは StreamDock の DOM に id を作れない**からで、
 * オーバーレイに存在する id は `index.html` の `#root` **ただ 1 つ**（実測）。
 * ＝注入された CSS に現れる `#root` 以外の裸 id は**証明可能に死んでいる**。
 *
 * これが無いと、実在のテーマで最も多い書き方が「黙って効かない」に落ちる（レビュー実測）:
 *   `…renderer #timestamp` → `.sd-comment #timestamp`（rewritten=1・警告なし・当たらない）
 *   `…renderer #chat-badges` / `#author-photo` / `> #content > #message` も同型。
 * `rewritten` が**加算されてしまう**ぶん、警告が無いと 060d の UI が「M 個変換しました」と
 * 積極的に誤報する。この module の docstring が「黙って効かないのが最悪」と書いている状態そのもの。
 *
 * ⚠ **総称的な id（`#content` / `#card` / `#header` / `#menu` 等）は意図的に入れていない。**
 * 将来 StreamDock 側がその名前の id を持つと誤検知に転ぶため（`(10-g)` が id 追加を検知して
 * ここへ差し戻す）。＝これらは「変換されないのに警告も出ない」バケツに残る**既知の取りこぼし**。
 * 再修正トリガー: 060c で実サンプルの外部 CSS を取り込んだとき、`unmatched` に出ないまま
 * 効いていないセレクタが観測されたら、その id をここへ足す（allow-list 方式へ広げてもよい）。
 *
 * ⚠ **060f で変換表を足したぶん、この取りこぼしが増えた**（security-review 2026-08-05・実測）:
 *   - `#author-info` / `#items` … 表にあるのは**祖先付き**の `div#author-info` /
 *     `yt-live-chat-item-list-renderer #items` だけなので、祖先を省いた形は変換も警告もされない。
 * ＝ **060f では足さない判断**。`items` はほぼ総称なので、ここへ足すと上の理屈
 * （将来 StreamDock がその id を持つと誤検知に転ぶ）に正面から反する。
 * 上の再修正トリガーと**同じタイミング（060c）でまとめて判断すること**。
 *
 * ✅ **060c 追修正(2026-08-09)＝上の再修正トリガーが実サンプルで発火したので `author-info` を足した。**
 * `div#author-info` の表エントリを削除した（理由は `SELECTOR_TABLE` の当該コメント）ため、
 * このままだと `#author-info` を書いたテーマが**変換も警告もされない**バケツに落ちる。
 * ⚠ `author-info` は総称 id ではない（`content` / `card` / `header` とは違う）ので、上の
 * 「将来 StreamDock がその id を持つと誤検知に転ぶ」懸念には当たらない。
 * ⚠ **`items` は引き続き足さない**（総称すぎる）。`yt-live-chat-item-list-renderer #items` は
 * 表に残っているので、祖先付きで書く限り変換される。
 * ⚠ 追修正④で課金系エントリを削除したので、`#card.yt-live-chat-membership-item-renderer` は
 * **完全に未変換**になった（＝ `.yt-` 接頭辞のため `unmatched` にも出ない・従来どおりの取りこぼし）。
 * 課金カードはそもそもユーザー CSS の的ではないので、これは**塞ぐ必要が無い**。
 */
const FOREIGN_ID_NAMES = [
  "message",
  "author-name",
  "author-photo",
  // 060c 追修正(2026-08-09): 表から `div#author-info` を削除したぶんをここで警告に回す（上の注記）。
  "author-info",
  "img",
  "chat-badges",
  "timestamp",
  "purchase-amount",
];

/**
 * 純正チャット由来と**断定できる**セレクタトークン。`unmatched` の判定にだけ使う。
 * 保守的（接頭辞ベース＋上の id 列挙）にしてあるのは、誤検知が 1 つ入るだけで「効かないセレクタ」の
 * 一覧がノイズに埋もれて誰も読まなくなるため。取りこぼしは実害が小さい（変換されないだけ）。
 *
 * ⚠ **`compileFrom()` と違い、CSS エスケープを完全には解釈しない**（060a レビュー Q-5）。
 * 裸 id だけは `(?<!\\)` を付けたが、クラス側の `.a\.chat-line__message`（`.` を含む 1 つのクラス名）は
 * ここでは `.chat-line__message` として拾われる＝**ユーザー自身のクラスに「効きません」と警告しうる**。
 * 変換のほうは正しく当てない（安全側）ので実害は警告文の誤りに限られる。エスケープ付きクラス名の
 * 実例が出てきたら、ここも `(?<!\\)` 相当を足す。
 *
 * ⚠ **大文字のセレクタは拾わない**（`YT-LIVE-CHAT-…`）。HTML では型セレクタは大小無視なので
 * 正当な入力だが、`i` を付けると `.CHAT-` 等まで拾って誤検知が増える。実例が出たら再検討する。
 */
const FOREIGN_SELECTOR_RE = new RegExp(
  [
    "(?<![A-Za-z0-9_.#-])ytd?-[A-Za-z0-9-]+", // yt-live-chat-*, yt-img-shadow, ytd-*
    "\\.(?:chat-|tw-|video-chat)[A-Za-z0-9_-]*", // .chat-line__*, .chat-author__*, .tw-*
    "\\[data-a-target[^\\]]*\\]", // Twitch の属性セレクタ
    // 裸の id（警告専用・上の FOREIGN_ID_NAMES の理由を参照）。`\` エスケープの直後には当てない。
    `(?<!\\\\)#(?:${FOREIGN_ID_NAMES.join("|")})(?![A-Za-z0-9_-])`,
  ].join("|"),
  "g",
);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 変換表の `from` を正規表現へコンパイルする。ここが**置換の安全性の全部**。
 *
 * - **単語境界（後ろ）**: 常に `(?![A-Za-z0-9_-])`＝`.chat-line__no-background2` のような
 *   **別クラスを巻き込まない**。
 * - **単語境界（前）**: `from` の形で出し分ける。
 *   - `.` / `#` 始まり（`.chat-line__message`）… 先頭の `.` 自体が境界なので**識別子文字の直後でも当てる**
 *     （`.foo.chat-line__message` という**複合セレクタは正当に当てたい**）。禁じるのは直前の `\` だけ
 *     ＝`\.` でエスケープされた「`.` を含むクラス名」の一部に当てないため。
 *   - 要素名始まり（`yt-live-chat-…`）… `.` `#` `-` と識別子文字を禁じる
 *     ＝`.my-yt-live-chat-x`（別クラス）や `.yt-live-chat-x`（同名のクラス）に当てない。
 * - **空白**: `\s+` と `>` の両方を許す（`renderer #message` / `renderer > #message`）。
 *   兄弟結合子（`~` `+`）は意味が変わるので許さない。
 */
function compileFrom(from: string): RegExp {
  const body = from.trim().split(/\s+/).map(escapeRe).join("(?:\\s*>\\s*|\\s+)");
  const startsWithSymbol = from.startsWith(".") || from.startsWith("#");
  const behind = startsWithSymbol ? "(?<!\\\\)" : "(?<![A-Za-z0-9_.#-])";
  return new RegExp(`${behind}${body}(?![A-Za-z0-9_-])`, "g");
}

/** 長い順にコンパイル済みの表（module 初期化時に 1 回だけ）。 */
const COMPILED: readonly { re: RegExp; to: string }[] = [...SELECTOR_TABLE]
  .sort((a, b) => b.from.length - a.from.length)
  .map((r) => ({ re: compileFrom(r.from), to: r.to }));

/** セレクタ（プレリュード）の中で、コメント・文字列を除いた「置換してよい」範囲。 */
interface PreludeSegment {
  start: number;
  end: number;
}

/** 1 ルール（`{ … }` 1 つ）のプレリュード。カンマ束ね・コメント混在で segment が複数になりうる。 */
interface PreludeRule {
  segments: PreludeSegment[];
}

/** 文字列リテラルの終端の次の位置を返す（改行での不正終端も CSS 仕様どおりそこで閉じる）。 */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    const c = css[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === "\n") return i;
    i++;
  }
  return css.length;
}

/** プレリュードがアットルールなら、その名前（小文字）を返す。通常セレクタなら null。 */
function atRuleName(prelude: string): string | null {
  const head = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
  const m = /^@([A-Za-z-]+)/.exec(head);
  return m ? m[1].toLowerCase() : null;
}

/**
 * CSS を 1 パス走査し、「セレクタとして置換してよい範囲」だけを列挙する。
 *
 * **CSS パーサは持ち込まない**（新規依存ゼロ）が、`check-css-guards.mjs` (6-b) が使っている素朴な
 * 「ブレースを跨げない正規表現でルールを列挙する」方式は**採らない**——宣言内の文字列
 * （`content: "}"`）や閉じブレースを含む CSS コメントでブロック分割が壊れ、そこから先の
 * 全セレクタを取り違えるため。状態機械なら:
 *
 * - コメント・文字列は**中身を一切見ずに素通り**する ＝ `url()` の中身も `@import` の URL も
 *   構造上触れない（060b / 060c との責務分離が祈りではなく構造で成立する）
 * - `{` の中身は「宣言」として素通りし、**グループ規則（@media 等）の中だけ**セレクタ走査を続ける
 *   ＝ `@font-face` / `@keyframes` の中身（`from` / `to` / `50%`）を誤ってセレクタ扱いしない
 * - `@` で始まるプレリュードは**そもそも置換対象にしない**（`@media (…)` を書き換えない・
 *   `@import "…";` は `;` で捨てる）
 *
 * ⚠ **CSS Nesting（`&`）は非対応**。ネストしたセレクタは「宣言ブロックの中」として素通りするので、
 * 変換されないだけで壊れはしない（`unmatched` にも載らない）。
 * 再修正トリガー: ユーザーの CSS でネストが一般化したら、宣言ブロック内のセレクタ検出を足す。
 */
function scanPreludes(css: string): PreludeRule[] {
  const rules: PreludeRule[] = [];
  /** 親スコープが規則リストだったか（`}` で復帰するため積む）。 */
  const stack: boolean[] = [];
  let inRuleList = true;
  let rawStart = 0;
  let segStart = 0;
  let segs: PreludeSegment[] = [];
  let i = 0;

  const pushSeg = (end: number): void => {
    if (end > segStart) segs.push({ start: segStart, end });
  };
  const resetPrelude = (at: number): void => {
    rawStart = at;
    segStart = at;
    segs = [];
  };

  while (i < css.length) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      const next = e === -1 ? css.length : e + 2;
      if (inRuleList) {
        pushSeg(i);
        segStart = next;
      }
      i = next;
      continue;
    }

    if (c === '"' || c === "'") {
      const next = skipString(css, i);
      if (inRuleList) {
        pushSeg(i);
        segStart = next;
      }
      i = next;
      continue;
    }

    if (c === "{") {
      let childIsRuleList = false;
      if (inRuleList) {
        pushSeg(i);
        const name = atRuleName(css.slice(rawStart, i));
        // アットルールのプレリュード自体は置換しない（@media (…) を書き換えない）。
        if (name === null) rules.push({ segments: segs });
        else childIsRuleList = GROUP_AT_RULES.has(name);
      }
      stack.push(inRuleList);
      inRuleList = childIsRuleList;
      i++;
      resetPrelude(i);
      continue;
    }

    if (c === "}") {
      inRuleList = stack.length > 0 ? (stack.pop() as boolean) : true;
      i++;
      resetPrelude(i);
      continue;
    }

    // `@import "…";` / `@charset "…";` のような文で終わるアットルール。プレリュードごと捨てる。
    if (c === ";" && inRuleList) {
      i++;
      resetPrelude(i);
      continue;
    }

    i++;
  }

  return rules;
}

/** 1 segment に変換表を適用する（長い順・境界付き）。 */
function rewriteSegment(text: string): { out: string; hit: boolean } {
  let out = text;
  let hit = false;
  for (const { re, to } of COMPILED) {
    re.lastIndex = 0;
    out = out.replace(re, () => {
      hit = true;
      return to;
    });
  }
  return { out, hit };
}

/**
 * 060a: 純正チャット向け CSS のセレクタを StreamDock の安定クラスへ書き換える。
 *
 * - 変換できなかったセレクタは**そのまま残す**（消さない）。
 * - `@import` / `url()` / 宣言部 / 文字列 / コメントの中身は**一切変更しない**。
 * - 壊れた CSS（`{` が閉じない等）でも throw せず、変換できた範囲だけ返す（無害に劣化する）。
 *
 * ⚠ **否定の中では意味が反転しうる**（060a レビュー Q-4）。トークン単位の置換である以上、
 * 「効かなくする」ではなく「壊す」ケースがここ。実例は考えにくいので据え置く。
 * ⚠ **060f で挙動が変わった**（security-review 2026-08-05 で指摘）——
 * `.sd-comment:not(.chat-line__message)` は 060a 時点は `.sd-comment:not(.sd-comment)`＝
 * **何にも当たらない自己否定**だったが、いまは `.sd-comment:not(.sd-comment-chat)`＝
 * **課金カードにだけ当たる**（`:is()` のほうは重複するだけで無害）。挙動としては改善側。
 * ⚠ **060f 初版では別の失敗モードが 1 つ増えていたが、解消済み**（レビュー指摘 Q-6・2026-08-08 で
 * 陳腐化を訂正）。当時は `to` が**子孫結合子**を持っていたため、結合子を書けない文脈
 * （`::slotted()` / `::part()` の引数）へ入ると**セレクタ全体が無効**になり、カンマで束ねられた
 * 無関係なセレクタまで一緒に落ちた。→ **`to` を「1 要素の複合セレクタ」に限る修正（2026-08-06）で
 * まとめて消えている**（現在の 15 エントリはすべて結合子なし・静的ガード **(10-l)** が機械で禁じている）。
 * ＝ **これは未対処の課題ではない。** (10-l) を外すと復活するので、外さないこと。
 * 再修正トリガー: ユーザーの CSS で `:not()` に純正チャットのセレクタを書く例が出たら、
 * `:not(…)` の中は置換対象から外す（プレリュード内の擬似クラス引数を別 segment に切る）。
 */
export function rewriteSelectors(css: string): RewriteResult {
  const rules = scanPreludes(css);
  const foreign = new Set<string>();
  let out = "";
  let cursor = 0;
  let rewritten = 0;

  for (const rule of rules) {
    let hit = false;
    for (const seg of rule.segments) {
      out += css.slice(cursor, seg.start);
      const r = rewriteSegment(css.slice(seg.start, seg.end));
      out += r.out;
      if (r.hit) hit = true;
      // 変換**後**のセレクタに残っている外来トークンだけを拾う（変換できたものは消えている）。
      FOREIGN_SELECTOR_RE.lastIndex = 0;
      for (const m of r.out.matchAll(FOREIGN_SELECTOR_RE)) foreign.add(m[0]);
      cursor = seg.end;
    }
    if (hit) rewritten++;
  }
  out += css.slice(cursor);

  return { css: out, rewritten, unmatched: [...foreign] };
}
