import { useEffect, useState } from "react";
import { Button } from "../../components/primitives";
import { Select } from "../../components/Select";
import {
  loadObsSourceList,
  OBS_SOURCE_LIST_KEY,
  type ObsSourceEntry,
} from "../../features/comment-viewer/overlaySettings";
import {
  addKeywordCondition as addKeywordConditionRaw,
  DEFAULT_EFFECT_ASSIGNMENT,
  isUsableKeyword,
  KEYWORD_CONDITION_MAX,
  KEYWORD_MAX_LENGTH,
  loadEffectConditions,
  removeCondition as removeConditionRaw,
  sanitizeKeywordInput,
  setConditionEffect as setConditionEffectRaw,
  updateKeywordCondition as updateKeywordConditionRaw,
  type EffectAssignment,
  type EffectConditions,
  type GachaDefinition,
  type EffectKeywordMatch,
} from "./effectAssignments";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";
import {
  effectSelectAssignment,
  effectSelectValue,
  gachaSelectValue,
  isGachaMissingFromList,
  isObsSourceMissingFromList,
  NONE_VALUE,
  OBS_SOURCE_PREFIX,
} from "./effectSelectValue";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d-2: **イベント種別ごとのエフェクトの割り当て**（main 窓の「OBSエフェクト」画面）。
 * ⚠ **061i(5) で画面上の呼び方は「エフェクトを表示する条件」になった**（動作の主語になったため。
 * 061j でキーワード条件が入ると「イベントごと」では表現できなくなる）。⚠ **保存形（`EffectAssignments`）と
 * 値の意味は 061i では 1 ミリも変えていない**——変えるのは 061j。
 *
 * ⚠⚠ **ここが「たぬえさ3 より簡単に」の分かれ目**（061d の (2)）。行は
 * `MONETARY_EVENT_TYPES` から**最初から全部並んでいて**、各行でエフェクトを選ぶだけ。
 * 「条件を追加」ボタンで行を増やす形にしない。
 *
 * ⚠ **金額の閾値による出し分けはまだ作らない**（種別だけで動かして実機の手応えを見る）。
 * **再修正トリガー＝「高額だけ豪華にしたい」と言われたとき**——そのときは
 * スーパーチャットの行を `monetaryTone` のティアで 3 行に割る形にする。
 * ⚠ **063（ガチャ）も同じ表に乗る**（`EffectAssignment` の union に 3 本目を足す）。
 *
 * ## 壊れ方（⑪ → ⚠ 061h で反転）
 *
 * ⚠⚠ **実在しないテンプレート id を指す割り当ては「表示しない」として表示し、警告を出す。**
 * ⚠ 061d-2 はここを**「組み込み」として表示**していた（壊れても何かは出る、という方針）。
 * 061h で組み込みを廃止したので、**受け皿が「表示しない」しか無い**——かつ
 * 「壊れているのに何かが出て『動いている』ように見える」ほうが今の運用では害が大きい。
 * ⚠ **保存値は書き換えない**——`list_effect_templates` が一時的に失敗しただけ／061c の
 * 「読めない行は黙って落とす」に当たっただけ、という場合に**ユーザーの設定が黙って消える**ため。
 * 書き換えるのは**削除操作のときだけ**（`useEffectTemplates.runDelete`）。
 * ⚠⚠ **061d-2 レビュー S-1: 警告を出してよいのは `listState === "ready"` のときだけ。**
 * 一覧は非同期に届くので、`templates` が空なだけで警告を出すと
 * ①**毎回、画面を開いた一瞬だけ**「見つかりません」が点滅する
 * ②一覧の取得に失敗したときは**恒久的に**出て、隣のカードの「一覧を読み込めませんでした」と
 *   矛盾した 2 文が並ぶ（＝「テンプレートが消えた」とユーザーに誤解させ、不要な復帰操作へ誘導する）。
 * **「保存値は触らない」を表示側でも守る**＝ 一覧が読めていないなら「無い」と断言しない。
 *
 * ## ⚠⚠ 061p: 説明文を削り、復帰導線（「すべて「表示しない」に戻す」）を削除した
 *
 * 061p の指示は「**説明が長すぎる**（IT に詳しくない人は読まない）」「**このボタンは要らない**」で、
 * このカードは **note が 7 本**あった（移行案内・バースト・音・優先順位・テスト表示の勧め ほか）。
 * ⇒ **カード見出しの説明 2 行 ＋ キーワード欄の 1 行**まで削っている。
 * ⚠⚠ **消した文のうち「黙って何も起きない／黙って何かが起きる」を防いでいたもの**は、
 * 061a 以来の規律に従い**見出しの説明へ畳んで残した**（＝条件を 1 つ設定すると窓が自動で開く）。
 * ⚠⚠⚠ **064e でその 1 文を削除した**——064d で挙動ごと消えて**嘘になっていた**ため
 * （経緯の全文は下の `<h3>` 直上のコメントが正）。**「情報を減らした」のではなく「嘘を消した」。**
 * ⚠ **音が配信に載る旨（061d-2 security-review S-1）と専用フォルダの案内（061c S-3）は
 * [`EffectTemplateCard`] 側へ集約**した（テンプレートを取り込む場所に置くほうが目に入る）。
 * ⚠⚠ **復帰導線を消した代償**——壊れたテンプレート（巨大・真っ黒・画面全体を覆う）を割り当てると
 * 配信画面が読めなくなり、エフェクト窓は**透過・最背面・非フォーカスで何も操作できない**。
 * 061p 以降の脱出路は「**条件を 1 行ずつ『エフェクトを出さない』へ戻す**」だけである
 * （同じ 061p で「ウィンドウを閉じる」も消えた）。⚠ **再修正トリガー＝実機で戻せなくなったとき**
 * （そのときは `clearAllEffectConditions` ごと復活させる・`effectAssignments.ts` の注記が正）。
 */

/**
 * ⚠⚠ **061j (0): `<select>` の値の組み立ては [`effectSelectValue`] へ切り出した**
 * （061h 申し送り ⑦-c の返済。理由の全文は `effectSelectValue.ts` の module JSDoc が正）。
 * ⚠ **ここで `template:<id>` を組み立て直さないこと**——組み立てが 2 か所になると、
 * 「選択肢に無い id を明示的に落とす」規則が片方だけ緩む（そして DOM からは観測できない）。
 */

/**
 * 061j: 条件 1 行の「**どのエフェクトを出すか**」。
 *
 * ⚠⚠ **イベント条件の行とキーワード条件の行が 1 実装を共有する。** 選択肢の中身・順序・
 * 値の意味を 2 か所に書くと、**片方だけ 061h ⑦-c の偶然に戻る**（そして DOM からは観測できない）。
 * ⚠ **選択肢の中身と順序は 1 文字も変えていない**（061h 申し送り ⑦-c ／ 061i の判断）。
 */
function ConditionEffectSelect({
  effect,
  obsSources,
  gachas,
  ariaLabel,
  onChange,
}: {
  effect: EffectAssignment;
  /** 064b: 064a で取得済みの OBS ソース（`null` ＝ **まだ 1 度も取っていない**）。 */
  obsSources: readonly ObsSourceEntry[] | null;
  /** 063d: 名前付きのガチャの一覧。⚠ **常に読めている**ので `null` を取らない（OBS ソースとの違い）。 */
  gachas: readonly GachaDefinition[];
  ariaLabel: string;
  onChange: (effect: EffectAssignment) => void;
}) {
  // ⚠⚠ 断言してよいのは
  //   **一覧を 1 度でも取れているとき**（`obsSources !== null`）だけである——
  //   未取得のまま「見つかりません」と出すと、**設定は正しいのに壊れて見える**
  //   （OBS の一覧は 064a の「OBS のソースを取得」でしか更新されない）。
  const obsMissing =
    obsSources !== null && isObsSourceMissingFromList(effect, obsSources);
  // ⚠⚠ 063d: **ガチャの一覧は常に読めている**（localStorage）ので、OBS ソースと違って
  //   「まだ取っていない」状態が無い＝ **そのまま断言してよい**。
  const gachaMissing = isGachaMissingFromList(effect, gachas);
  return (
    <>
      <Select
        value={effectSelectValue(effect, obsSources ?? [])}
        ariaLabel={ariaLabel}
        // ⚠⚠ **値の分解は [`effectSelectAssignment`] が持つ**（061j (0) の規律＝
        //   組み立てと分解を 1 モジュールに閉じる）。⚠ ここで `startsWith` / `slice` を書かないこと
        //   ——OBS のソース名は `:` を含みうるので、分解が 2 か所になると片方だけ壊れる。
        onChange={(e) => onChange(effectSelectAssignment(e.target.value))}
      >
        {/* ⚠ 呼び方は「エフェクトを出さない」（「なし」にしない＝UX の決定）。
            ⚠⚠ **先頭は必ずこれ**（061h ⑦-c ／ 061i の判断）。 */}
        <option value={NONE_VALUE}>エフェクトを出さない</option>
        {/* ⚠⚠ **OBS 側に置いてあるソース**（064d 以降、選べるのはこれだけ）。
            ⚠ 名前はユーザー自身が OBS で付けた文字列なので、そのままテキストノードとして描く。 */}
        {(obsSources ?? []).map((source) => (
          <option
            key={`${OBS_SOURCE_PREFIX}${source.name}`}
            value={`${OBS_SOURCE_PREFIX}${source.name}`}
          >
            {source.name}
          </option>
        ))}
        {/* ⚠⚠ **063d: ガチャは「一覧に登録されたぶんだけ」選択肢になる**（063a は固定 1 個だった）。
            ⚠ **末尾に足す**——061h ⑦-c 以来「先頭は必ず『エフェクトを出さない』」で、
            既存の選択肢の**順序を 1 つも動かさない**（`effectSelectValue` の JSDoc が正）。
            ⚠ OBS ソースの一覧の**後ろ**に置くのは、一覧が増減しても位置が動かないため。 */}
        {gachas.map((gacha) => (
          <option key={gachaSelectValue(gacha.id)} value={gachaSelectValue(gacha.id)}>
            ガチャ: {gacha.name}
          </option>
        ))}
        {/* ⚠⚠⚠ 063d: **一覧に無いガチャを指しているときは、その値ぶんの `<option>` を自前で出す。**
            出さないと**ブラウザが先頭（＝「エフェクトを出さない」）を選び**、
            「消えたガチャを指していた」という事実そのものが画面から消える
            （061h ⑦-c で踏んだ "ask for a reset" とまったく同じ罠）。
            ⚠ **黙って別のガチャへ化けさせない**——`GachaPrizeTable` の OBS ソース列と同じ手である。 */}
        {gachaMissing && effect.kind === "gacha" && (
          <option value={gachaSelectValue(effect.gachaId)}>
            ガチャ（削除されました）
          </option>
        )}
      </Select>
      {obsMissing && (
        // ⚠⚠ 064b: OBS 側で**名前を変えた／消した**ときに気付ける唯一の場所。
        //   ⚠ 発火は sidecar の実在照合で落ちるだけ（＝配信中は無言）なので、ここに出さないと
        //   「設定したのに鳴らない」の理由がどこからも読めない。
        <p className={styles.errorText}>
          OBS にこの名前のソースが見つかりません。名前を変えた場合は選び直してください。
        </p>
      )}
      {/* ⚠⚠⚠ 063d: **景品の表はここから外した。** 063a は条件行の下に開いていたが、
          ガチャ本体が一覧（`GachaLibraryCard`）へ移ったので、**編集の入口は 1 か所**にする。
          ⚠ 条件行に開いたままにすると、同じガチャを 2 条件に割り当てたとき
          **同じ表が 2 か所に開き、どちらを直しても両方変わることが画面から読めない**。
          ⚠ **ここに表を戻さないこと。** */}
      {gachaMissing && (
        // ⚠⚠ 063d 穴 R: ガチャを消したときに気付ける唯一の場所（064b の OBS ソースと同じ手）。
        //   ⚠ 発火は `select` が落とすだけ（＝配信中は無言）なので、ここに出さないと
        //   「設定したのに鳴らない」の理由がどこからも読めない。
        <p className={styles.errorText}>
          このガチャは削除されています。下の「ガチャ」から選び直してください。
        </p>
      )}
    </>
  );
}

/**
 * 061j: **未確定のキーワード行**（まだ localStorage に無い行）。
 *
 * ⚠⚠ **これがある理由＝判断 9（空文字を保存しない）と「条件を追加」ボタンの衝突を解くため。**
 * 追加ボタンで生えた直後の行はキーワードが空なので、素直に保存すると**保存層がその場で落として
 * 行が生えない**。⇒ **非空になって初めて永続化する**（048 の数値入力と同じ形）。
 * ⚠ **同時に 1 本だけ**（2 本目を作れると「未確定が溜まる」状態ができる）。
 */
interface DraftKeywordRow {
  text: string;
  match: EffectKeywordMatch;
  effect: EffectAssignment;
}

export function EffectAssignmentCard({
  gachas,
}: {
  /**
   * 063d: 名前付きのガチャの一覧（表示と参照切れの判定に使う）。
   *
   * ⚠⚠ **`obsSources` と違って localStorage を自分で読まない。** 一覧を書き換えるのは
   * **同じ窓の [`GachaLibraryCard`]** で、⚠ `storage` イベントは**他窓の書換でしか飛ばない**＝
   * 自分で読むと「ガチャを作ったのに条件の選択肢に出てこない」になる。
   * ⇒ **状態は `ObsEffectsScreen` が持ち、両方へ配る**（064f の `obsSources` と同じ役割分担）。
   */
  gachas: readonly GachaDefinition[];
}) {
  /**
   * 064d: **条件はこのカードが持つ**（旧: `useEffectTemplates` の戻り値を `ObsEffectsScreen` が配っていた）。
   *
   * ⚠⚠ **あの hook はテンプレートの一覧・取り込み・削除と条件を 1 つにまとめたもの**で、
   * 「テンプレートを削除したら、それを指す条件を『出さない』へ戻す」という**継ぎ目**が存在理由だった。
   * 064d で取り込み機能ごと消えたので、その継ぎ目そのものが無くなった。
   * ⇒ **条件の唯一の消費者はこのカード**なので、ここに閉じる（画面を跨ぐ配線を残さない）。
   * ⚠ **書き換えは必ず `commitConditions` を通す**（061j 申し送り＝保存と state を 1 か所で揃える）。
   */
  const [conditions, setConditions] = useState<EffectConditions>(() =>
    loadEffectConditions(),
  );
  /**
   * ⚠⚠ **条件を書き換える経路はすべてここを通す。** 純関数側（`effectAssignments.ts`）は
   * **保存して読み直した結果**を返すので、戻り値をそのまま state にすると
   * 「画面に出ている値」と「保存されている値」が構造的に一致する。
   * ⚠ **ここを通さずに `setConditions` を呼ばないこと**（片方だけ古くなる）。
   */
  const commitConditions = (next: EffectConditions) => setConditions(next);
  const setConditionEffect = (id: string, effect: EffectAssignment) =>
    commitConditions(setConditionEffectRaw(id, effect));
  const addKeywordCondition = (
    when: { text: string; match: EffectKeywordMatch },
    effect: EffectAssignment,
  ) => commitConditions(addKeywordConditionRaw(when, effect));
  const updateKeywordCondition = (
    id: string,
    when: { text: string; match: EffectKeywordMatch },
  ) => commitConditions(updateKeywordConditionRaw(id, when));
  const removeCondition = (id: string) =>
    commitConditions(removeConditionRaw(id));

  /**
   * ⚠⚠ **061j（穴 α）: 入力中の生文字列はここに持ち、`onChange` では保存しない。**
   *
   * 048（読み上げ最大文字数）が同じ判断をしている:
   * > **確定は blur と Enter のみ**（`onChange` 即時にしない）… 親 state が変わらない＝
   * > **1 打鍵ごとに localStorage へ書かない**
   *
   * ⚠ **061j では代償が 048 より大きい**——`EFFECT_ASSIGNMENTS_KEY` が変わると
   * **エフェクト窓の `storage` 購読が `warmTemplates()` を回し、`list_effect_templates` の invoke が
   * 打鍵ごとに 1 本飛ぶ**（＋ キャッシュの `clearFailures` / `retain` / `prime` が毎回走る）。
   * ⚠ `<select>`（当て方・エフェクト）は**1 操作で確定する**ので `onChange` 即時のままでよい
   *   （イベント条件の行と同じ挙動＝規則を 2 通りにしない）。
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftRow, setDraftRow] = useState<DraftKeywordRow | null>(null);

  /**
   * 064b: 割り当て先に出す **OBS 側のソース**（`null` ＝ **まだ 1 度も取っていない**）。
   *
   * ⚠⚠ **この窓は OBS へ直接繋げない**ので、一覧はコメビュ窓が取って localStorage へ書いたものを読む
   * （064a の `ObsSourceCard` と同じ経路・同じ非対称）。⚠ **取り直しのボタンはあちらが持つ**
   * ——同じ操作を 2 か所に置くと、どちらが正か分からなくなる（061p の「画面の情報量を減らす」）。
   * ⚠ `null` と空配列を区別するのが要点。「見つかりません」と断言してよいのは**取れているとき**だけ。
   */
  const [obsSources, setObsSources] = useState<readonly ObsSourceEntry[] | null>(
    () => loadObsSourceList()?.sources ?? null,
  );

  // ⚠ コメビュ窓が一覧を書き戻したら追従する（`ObsSourceCard` と同じ購読）。
  // ⚠ `storage` は**他窓での書換**でだけ飛ぶので、この購読が拾うのは常にコメビュ窓の書き込みである。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === OBS_SOURCE_LIST_KEY || e.key === null) {
        setObsSources(loadObsSourceList()?.sources ?? null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const eventConditions = conditions.filter((c) => c.when.type === "event");
  const keywordConditions = conditions.filter((c) => c.when.type === "keyword");
  const canAddKeyword =
    draftRow === null && keywordConditions.length < KEYWORD_CONDITION_MAX;

  /**
   * 既存のキーワード行を確定する。
   *
   * ⚠ **空になったら直前の確定値へ戻す**（048 の「空 / NaN は直前の確定値へ戻す」と同じ）。
   *   ＝ 打ち間違いでユーザーの条件が消えない。⚠ **空を保存する経路をここで作らない。**
   * ⚠ 空判定は [`isUsableKeyword`]（＝正規化の持ち主に聞く）。ここで `text.trim() === ""` と
   *   書いても**いまは同じ結果**だが、空判定の規則を 2 か所に書かないために述語へ寄せている。
   */
  const commitKeyword = (id: string, match: EffectKeywordMatch) => {
    const raw = drafts[id];
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (raw === undefined) return;
    const text = sanitizeKeywordInput(raw);
    if (!isUsableKeyword(text)) return;
    updateKeywordCondition(id, { text, match });
  };

  /** 未確定行を確定する。⚠ **空のままなら永続化しない**（行はそのまま残るので打ち直せる）。 */
  const commitDraftRow = () => {
    if (draftRow === null) return;
    const text = sanitizeKeywordInput(draftRow.text);
    if (!isUsableKeyword(text)) {
      // ⚠ 詰めた結果は入力欄へ書き戻す（「打ったら短くなった」が見える・048 の規律）。
      setDraftRow({ ...draftRow, text });
      return;
    }
    addKeywordCondition({ text, match: draftRow.match }, draftRow.effect);
    setDraftRow(null);
  };

  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        {/* ⚠ 061i(5): 「イベントごとのエフェクト」→「**エフェクトを表示する条件**」。
            061i で「条件が 1 件でもあればエフェクト窓を開く」という**動作の主語**になったので、
            画面の呼び方も「条件」へ揃える（前提ステータスの「表示する条件」行と同じ語）。
            ⚠ 061j でキーワード条件（自由テキスト）が入ると「イベントごと」では**表現できなくなる**
            ——先に語のほうを合わせておく。 */}
        <h3>エフェクトを表示する条件</h3>
        {/* ⚠⚠⚠ **064e: 2 文目「条件を 1 つでも設定すると、配信画面用のウィンドウが自動で開きます」を
            削除した。⚠ 意匠の都合ではなく、064d 以降この文が「嘘」だったからである。**

            061i〜061j: あの文が正しかったのは、`useEffectTemplates` が
            **「条件が 0 → 1 件になったら `STAGE_OVERLAY_ENABLED_KEY` を立てる」**という
            派生値を持っていた間だけ。⚠⚠ **064d でその hook ごと消し、旗の意味を
            「いま配信イベントでステージ窓を使っているか」へ移した**（書き手は `ObsEffectsScreen` の
            開始／終了ハンドラ 1 か所）。⇒ **条件をいくつ作っても窓は 1 ミリも開かない。**
            ⚠ 064d の見落としで、064e まで画面に残っていた。

            ⚠ 061p が「⚠ **消さないこと**」と書いていた根拠（表示トグル廃止後に
            「いつ窓が開くのか」を説明する唯一の場所）は、**その挙動ごと無くなったので失効している。**
            ⚠⚠ **いま「窓が開く契機」を説明しているのは [`StreamEventTab`] の
            「『開始』を押すと、配信画面用のウィンドウ（…）が…」1 か所**である（＝実際に開く場所）。 */}
        <p>どのコメントで、どのエフェクトを出すかを決めます。</p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠⚠ **061p: ここにあった note 7 本をすべて削除した**（指示＝説明が長すぎる）。
            消したのは①「選ばなければ何も出ない」②窓が自動で開く説明（→ 見出しの説明へ移設）
            ③「割り当てる前にテスト表示で確かめられる」④061h の移行案内（旧「組み込み」の保存値）
            ⑤バースト時に間引かれる旨⑥音が配信に載る旨（→ [`EffectTemplateCard`] へ移設）
            ⑦「1 コメントに出るのは 1 つだけ」。
            ⚠⚠ **④は「以前のバージョンから更新した人が、自分で変えていないのに何も出なくなる」を
            知らせる唯一の文だった。** 061h から数バージョン経ており、元々「行き渡ったら消す」と
            書いてあった文なので、061p の削除でその予定を前倒ししている（＝消し忘れではない）。
            ⚠ **再修正トリガー＝旧版からの更新で「何も出ない」という問い合わせが出たとき。** */}
        <div className={styles.assignmentList}>
          {eventConditions.map((condition) => {
            const eventType =
              condition.when.type === "event" ? condition.when.eventType : "";
            const label = EFFECT_EVENT_LABEL[eventType] ?? eventType;
            return (
              <div key={condition.id} className={styles.assignmentRow}>
                <span className={styles.assignmentLabel}>{label}</span>
                <ConditionEffectSelect
                  effect={condition.effect}
                  obsSources={obsSources}
                  gachas={gachas}
                  ariaLabel={`${label}のエフェクト`}
                  onChange={(effect) => setConditionEffect(condition.id, effect)}
                />
              </div>
            );
          })}
        </div>

        {/* --- 061j: キーワード条件（自由テキスト） ------------------------------------------ */}

        <h4 className={styles.subHeading}>コメントの言葉で出す</h4>
        {/* ⚠⚠ **061p: ここの note 3 本を 1 本へ畳んだ**（大文字小文字・全角半角／文字は出ない／
            連呼のクールダウン）。⚠ 残した 1 行に**上限と正規化**だけを入れているのは、
            上限が「＋ が押せなくなる理由」で、正規化が「打った言葉と当たり方が違う」の唯一の説明だから。
            ⚠ 消した 2 つ（金額やイベント名の文字が出ない／連呼時のクールダウン）は
            **黙って起きても実害が「出ない・遅れる」に留まる**ので落とした。 */}
        <p className={styles.note}>
          コメントに入っていたらエフェクトを出す言葉を、{KEYWORD_CONDITION_MAX}
          個まで登録できます（大文字・小文字や全角・半角は区別しません）。
        </p>

        <div className={styles.keywordList}>
          {keywordConditions.map((condition, index) => {
            if (condition.when.type !== "keyword") return null;
            const { text, match } = condition.when;
            const n = index + 1;
            // ⚠ 入力中は下書き、確定後は保存値。⚠ **`??` で分ける**（空文字の下書きを保存値で
            //   上書きしないため＝ `||` にすると「全部消して打ち直す」ができなくなる）。
            const shown = drafts[condition.id] ?? text;
            return (
              <div key={condition.id} className={styles.keywordRow}>
                <span className={`${layout.field} ${styles.keywordText}`}>
                  <input
                    type="text"
                    value={shown}
                    aria-label={`キーワード ${n}`}
                    // ⚠ ブラウザの補助であって保証ではない（048 の `min` / `max` と同じ位置づけ）。
                    //   実際の上限は確定時の `sanitizeKeywordInput` と保存層が担う。
                    maxLength={KEYWORD_MAX_LENGTH}
                    placeholder="例: 草"
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [condition.id]: e.target.value,
                      }))
                    }
                    onBlur={() => commitKeyword(condition.id, match)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitKeyword(condition.id, match);
                    }}
                  />
                </span>
                <Select
                  value={match}
                  ariaLabel={`キーワード ${n} の当て方`}
                  onChange={(e) => {
                    // ⚠ `<select>` は 1 操作で確定するので即 commit（打鍵の問題が無い）。
                    //   ⚠ 入力中の下書きがあれば**一緒に確定する**（当て方だけ保存されて
                    //   キーワードが古いまま、というズレを作らない）。
                    const nextMatch =
                      e.target.value === "exact" ? "exact" : "contains";
                    const raw = drafts[condition.id];
                    const nextText =
                      raw === undefined ? text : sanitizeKeywordInput(raw);
                    if (raw !== undefined && isUsableKeyword(nextText)) {
                      setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[condition.id];
                        return next;
                      });
                    }
                    updateKeywordCondition(condition.id, {
                      text: isUsableKeyword(nextText) ? nextText : text,
                      match: nextMatch,
                    });
                  }}
                >
                  <option value="contains">この言葉を含む</option>
                  <option value="exact">この言葉と完全に一致</option>
                </Select>
                <ConditionEffectSelect
                  effect={condition.effect}
                  obsSources={obsSources}
                  gachas={gachas}
                  ariaLabel={`キーワード ${n} のエフェクト`}
                  onChange={(effect) => setConditionEffect(condition.id, effect)}
                />
                <Button
                  type="button"
                  onClick={() => removeCondition(condition.id)}
                >
                  削除
                </Button>
              </div>
            );
          })}

          {draftRow !== null && (
            // ⚠⚠ **未確定行**（まだ保存されていない）。⚠ 条件の件数にも派生値にも数えない。
            <div className={styles.keywordRow}>
              <span className={`${layout.field} ${styles.keywordText}`}>
                <input
                  type="text"
                  value={draftRow.text}
                  aria-label={`キーワード ${keywordConditions.length + 1}`}
                  maxLength={KEYWORD_MAX_LENGTH}
                  placeholder="例: 草"
                  autoFocus
                  onChange={(e) =>
                    setDraftRow({ ...draftRow, text: e.target.value })
                  }
                  onBlur={commitDraftRow}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitDraftRow();
                  }}
                />
              </span>
              <Select
                value={draftRow.match}
                ariaLabel={`キーワード ${keywordConditions.length + 1} の当て方`}
                onChange={(e) =>
                  setDraftRow({
                    ...draftRow,
                    match: e.target.value === "exact" ? "exact" : "contains",
                  })
                }
              >
                <option value="contains">この言葉を含む</option>
                <option value="exact">この言葉と完全に一致</option>
              </Select>
              <ConditionEffectSelect
                effect={draftRow.effect}
                obsSources={obsSources}
                gachas={gachas}
                ariaLabel={`キーワード ${keywordConditions.length + 1} のエフェクト`}
                onChange={(effect) => setDraftRow({ ...draftRow, effect })}
              />
              <Button type="button" onClick={() => setDraftRow(null)}>
                削除
              </Button>
            </div>
          )}
        </div>

        <div className={styles.rowActions}>
          {/* ⚠⚠ **061p: 文字ボタン（「条件を追加」）から ＋ アイコンへ変えた**（指示）。
              ⚠⚠ **アクセシブル名は「条件を追加」のまま**（`aria-label`）——グリフだけの
              ボタンは**読み上げで「プラス」としか読まれず、何が増えるのか分からない**。
              ⚠ **`aria-hidden` を付けたグリフを子に置く**（読み上げが `aria-label` と
              二重に読まないように）。⚠ **名前を変えないこと**——`getByRole("button", …)` で
              引いている検査があり、名前を変えると「押せるが誰も押さない」状態を検知できなくなる。 */}
          <Button
            type="button"
            aria-label="条件を追加"
            onClick={() =>
              setDraftRow({
                text: "",
                match: "contains",
                effect: DEFAULT_EFFECT_ASSIGNMENT,
              })
            }
            disabled={!canAddKeyword}
          >
            <span className={styles.iconGlyph} aria-hidden="true">
              ＋
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
}
