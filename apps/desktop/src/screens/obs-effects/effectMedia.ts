import type { EffectTemplateMedia } from "../../features/obs-effects/bindings/EffectTemplateMedia";

/**
 * 061c: エフェクトテンプレートのメディアを**描画シンクで最後にもう一度検査する**ガード。
 *
 * ⚠⚠ **036a の `avatarDataUri` と同型の「最終防波堤」である。** Rust 側（`effect_template::service`）が
 * 検証済みの data URI しか返さないことは事実だが、**層が違うので両方に置くのが正しい**
 * （036a が「2 実装に分裂させると片方だけ緩む」と警告したのは*同じ層の同じ判断*を 2 つ書く場合の話で、
 * ここは「Rust が作る」と「webview が踏む」という別々の層である）。
 *
 * ⚠⚠ **Rust が完全な data URI を組み立て、ここが検査する、という向きが要点。**
 * `tools::icon` の `extract_app_icon` は `data:` を付けない生 base64 を返し frontend が組み立てるが、
 * その形をここで採ると **ガードが「自分で作った文字列」を検査するだけ**になり、何も守らない。
 * `get_effect_template_media` が完全な data URI を返すのはそのためである
 * （Rust 側 `model::EffectTemplateMedia` の注記が正）。
 *
 * ## 何を見ているか
 *
 * 1. **MIME の完全一致許可リスト**（`data:` 始まりだけでは足りない）。
 *    ⚠⚠ **`image/svg+xml` と `text/html` を足さないこと。** `<img>` の SVG は secure static mode で
 *    外部参照が仕様上禁止されるが、`filter:` / `mask:` は SVG を「リソース文書」として読むので
 *    その保証が及ばない（060b が `data:` のフラグメントを落とした理由と同じ構図）。
 *    ⚠ この一覧は Rust の `AssetKind::mime()` と**対になっている**。片方だけ増やすと
 *    「取り込めるのに描けない」（あるいはその逆）になるので、必ず両方を見ること。
 * 2. **base64 の文字集合**。ペイロードが `A-Za-z0-9+/` と末尾のパディングだけであることを確かめる。
 *    これで `"` や改行、`javascript:` の断片が混ざった値は通らない
 *    （`avatarDataUri` の `URL_STRING_BREAKOUT` に相当するが、**許可制なのでこちらが強い**）。
 *
 * ⚠ **長さの上限はここに置かない。** サイズの方針（1 ファイル 4MiB / 合計 5MiB）は Rust の
 * `effect_template::service` が唯一の持ち主で、TS 側に数字を複製すると**必ず片方が古くなる**
 * （060b の model.rs が「2 実装に分裂させない」と書いているのと同じ理由）。
 *
 * ⚠ 061d はこのガードが `undefined` を返したら**組み込み意匠へフォールバック**すること
 * （配信中に無反応になるより、素の表示でも出るほうがよい）。
 */

/** メディア（`<img>` / `<video>` の `src`）に許可する data URI の接頭辞。 */
const ALLOWED_MEDIA_PREFIXES = [
  "data:image/png;base64,",
  "data:image/apng;base64,",
  "data:image/gif;base64,",
  "data:image/webp;base64,",
  "data:video/webm;base64,",
] as const;

/** 音源（`<audio>` の `src`）に許可する data URI の接頭辞。 */
const ALLOWED_SOUND_PREFIXES = [
  "data:audio/wav;base64,",
  "data:audio/mpeg;base64,",
  "data:audio/ogg;base64,",
] as const;

/**
 * base64 の本体（RFC 4648 の標準アルファベット ＋ 末尾パディング）。
 *
 * ⚠ URL-safe 版（`-` / `_`）は**許可しない**——Rust 側は `STANDARD` エンジンで組むので、
 * 許すと「Rust が作らない形」を通すことになる（許可集合は狭いほどよい）。
 * ⚠ 本体は `*` ではなく **`+`**（061c security-review Q-6）。`*` だと `"="` だけのペイロードが
 * 通ってしまう（下の空チェックは長さ 0 しか見ないため）。Rust は必ず 1 文字以上を出力する。
 * ⚠ **ReDoS にならない形であること**——単一の文字クラス ＋ 量指定子 1 つで、入れ子の量指定子が無いので
 * 6.7MB のペイロードでも走査は線形である。**この正規表現を複雑にしないこと。**
 */
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

const asDataUri = (
  value: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const prefix = allowedPrefixes.find((p) => value.startsWith(p));
  if (prefix === undefined) return undefined;
  // ⚠ 空のペイロードは通さない（`data:image/png;base64,` だけの値は描けない＝壊れた表示になる）。
  // ⚠ 061c security-review Q-6: `slice` は 6.7MB でもコピーを作らない（V8 は長い文字列に対して
  //   SlicedString を返す）ので、ここを `startsWith` + 添字走査へ書き換える最適化は不要。
  const payload = value.slice(prefix.length);
  if (payload.length === 0 || !BASE64_BODY.test(payload)) return undefined;
  return value;
};

/** メディアの data URI として受け入れてよければその値、だめなら `undefined`。 */
export const effectMediaDataUri = (
  value: string | null | undefined,
): string | undefined => asDataUri(value, ALLOWED_MEDIA_PREFIXES);

/** 音源の data URI として受け入れてよければその値、だめなら `undefined`。 */
export const effectSoundDataUri = (
  value: string | null | undefined,
): string | undefined => asDataUri(value, ALLOWED_SOUND_PREFIXES);

/** 描画側が実際に使う形（両方を通したもの）。⚠ メディアが弾かれたら**エフェクト全体を出さない**。 */
export interface SafeEffectMedia {
  media: string;
  sound: string | undefined;
}

/**
 * `get_effect_template_media` の戻り値をガードに通す。
 *
 * ⚠ **メディアが弾かれたら `undefined`**（061d は組み込み意匠へフォールバックする）。
 * ⚠ **音源だけが弾かれた場合はメディアを出す**——音が鳴らないことは配信を壊さないが、
 * エフェクトが出ないことは「反応が無い」に見えるため。
 */
export const safeEffectMedia = (
  raw: EffectTemplateMedia | null | undefined,
): SafeEffectMedia | undefined => {
  const media = effectMediaDataUri(raw?.media);
  if (media === undefined) return undefined;
  return { media, sound: effectSoundDataUri(raw?.sound) };
};
