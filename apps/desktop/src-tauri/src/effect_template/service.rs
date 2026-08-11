//! 061c: エフェクトテンプレートの検証・保存・取り出し。
//!
//! ## §5 例外（`app_data_dir/effects/` への書き込み）の実体はここ
//!
//! ⚠⚠ **保存先の組み立てにユーザー入力を 1 バイトも結合しない。** パスは
//! 「`app_data_dir()` → `join(EFFECTS_DIR)` → `join(<uuid v4>)` → `join("media.<拡張子>")`」の固定形だけで、
//! 元ディレクトリ名も元ファイル名も `manifest.name` もパスに使わない。
//! ⚠ **拡張子は許可リストの定数**であって、ユーザー入力の一部ではない（[`AssetKind::extension`] が返すのは
//! `&'static str` で、入力から作った文字列ではない）。したがって**パストラバーサルが構造的に成立しない**。
//! 多層防御として、パスへ結合する直前に必ず [`is_managed_dir_name`] / [`is_managed_asset_name`] を通す。
//!
//! ⚠⚠ **元ディレクトリを列挙しない（`read_dir` を 1 度も呼ばない）。**
//! `manifest.json` を読み、`media` と `sound` を**名指しで**読むだけである。
//! ＝「参照されていないファイルがコピーされる」経路が**構造的に存在しない**（件数上限ではなく構造で担保する）。
//! `.html` や実行ファイルを同梱されても、それを指すコードが 1 行も無い。
//! 契約テスト `never_enumerates_the_source_directory` が `read_dir(` の不在を固定している。
//!
//! ## ⚠⚠ 060b と結論が分かれる 1 点（symlink）
//!
//! **保存先については 060b と同じ**——組み立てにユーザー入力が 1 バイトも入らないので、
//! **`canonicalize` は呼ばない**（060b のモジュールヘッダの論証がそのまま効く＝防げるものが 1 つも無く、
//! ネットワークボリューム・権限まわりの失敗経路が増えるだけ）。
//!
//! ⚠⚠ **一方、テンプレート内のアセットのシンボリックリンクは拒否する。ここは 060b と逆である。**
//! 060b の「リンク越しに読めるのはユーザーが元々読めるファイルだけ＝**特権境界を跨がない**」という論証は、
//! **読むファイルを選ぶのがユーザー本人（dialog）だったから**成立していた。
//! 061c で `manifest.media` を決めるのは**テンプレートを配った第三者**で、ユーザーが選んだのは
//! ディレクトリだけである。`main.png` を `~/Pictures/private.jpg` へのシンボリックリンクにした
//! テンプレートを配れば、**ユーザーが意図していない画像が配信画面に出る**。
//! ＝ 060b の受容根拠は 061c の**読み込み元**には及ばない。
//!
//! ⚠ **拒否するのはテンプレート内のファイルだけで、選ばれたディレクトリ自体のシンボリックリンクは拒否しない。**
//! そちらを選ぶのはユーザー本人なので 060b の論証がそのまま効き、Dropbox / iCloud を
//! シンボリックリンクしている正当な構成も壊れない。
//!
//! ⚠⚠ **既知の限界（受容・061c security-review S-3）＝ symlink 拒否は上の目的を半分しか閉じない。**
//! 「ユーザーが意図していない画像が配信画面に出る」は**リンク無しでも作れる**——`manifest.media` に
//! 「**選ばれたディレクトリに既に在る別のファイル名**」を書けばよい。フォルダ包みでない zip を
//! `~/Downloads` へ直接展開して `~/Downloads` を選ぶと、`"media": "スクリーンショット….png"` が
//! 単一ファイル名規則も symlink 拒否も UNC 拒否も**すべて満たしたまま**通る。
//! ⚠ **構造的に塞げない**（ディレクトリを列挙しない設計上、どのファイルが「テンプレート同梱」かを
//! 区別する材料が無い。列挙する形にするのは §5 の安全策②に反する）。
//! ⇒ 攻撃者が読ませられるのは**ユーザーが選んだディレクトリ直下に既に在るメディア形式のファイル**
//! だけ、という範囲で**受容する**。緩和は 061d の UI 側で行う
//! （「テンプレート専用のフォルダを選ぶ」案内＋**取り込み後のプレビュー必須**）。
//! **再修正トリガー＝ zip 展開を実装するとき**——そのときは「同梱ファイルの集合」が分かるので、
//! `media` / `sound` をその集合の中に限定できる（構造で閉じられるようになる）。
//!
//! ⚠ **symlink を拒否しても canonicalize は足さない理由**: `media` / `sound` は
//! [`is_template_asset_name`] により**単一のファイル名**でなければならないので、
//! 結合したパスの構成要素は「選ばれたディレクトリ ＋ 1 要素」しかない。
//! 「途中の要素がシンボリックリンク」という形が構造的に存在しないため、
//! canonicalize が葉の `symlink_metadata` に足せるものが無い。
//!
//! ⚠ **既知の限界（受容・security-review 061c）＝ハードリンクは検出できない。**
//! ハードリンクは実ファイルと**原理的に区別できない**（`symlink_metadata` も通常ファイルと報告する）。
//! ただし **配布経路で成立しない**——ハードリンクはファイルシステムを跨げず、
//! zip / tar / ダウンロードで運べないので、「第三者がディレクトリを配る」という 061c の脅威モデルでは
//! 作れない。作るには**攻撃者が既にそのマシンでコードを実行できている**必要があり、その時点で
//! 他の手段も等しく開いている。⚠ `nlink > 1` で拒否する案は採らない
//! （重複排除ストレージ等で正当なファイルも落ちるうえ、Windows に移植可能な std API が無い）。
//!
//! ## 検証（§8・frontend を信用しない）
//!
//! `dir` は dialog 由来の生パス（⚠ **アプリ定義コマンドは ACL 対象外なので dialog 由来である保証は無い**）、
//! `manifest.json` は第三者が書いた JSON、メディアは第三者が用意したバイト列。**すべてここで検証する。**

use std::path::{Path, PathBuf};

use base64::Engine;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::util::{is_network_path, now_rfc3339, reject_control_chars, require_non_empty};

use super::manifest;
use super::model::{EffectManifest, EffectTemplateMedia, EffectTemplateRecord};
use super::repository::{self, TemplateRow};

/// `app_data_dir` 直下の管理ディレクトリ名。
const EFFECTS_DIR: &str = "effects";

/// テンプレートの定義ファイル名（**コンパイル時定数**。ユーザー入力から作らない）。
const MANIFEST_FILE_NAME: &str = "manifest.json";

/// `manifest.json` の上限（64KiB）。
///
/// 宣言的レイアウトの JSON は実測想定で 1KB 未満。⚠ 上限が無いと、巨大な JSON を読んだ時点で
/// メモリを食う（060b の `MAX_CSS_BYTES` と同じ発想で、**読む前に `metadata` で落とす**）。
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

/// メディア 1 ファイルの上限（4MiB）。
///
/// 値の根拠: エフェクト窓は **960×360**（061a の `open_effect_overlay_window`）で表示は 5 秒
/// （061b の `EFFECT_DISPLAY_MS`）。その尺・その解像度の alpha 付き WebM は実測想定 0.5〜2MB で、
/// GIF / APNG も同程度。4MiB は倍以上の余裕がある。
///
/// ⚠⚠ **上限が要るのは「ディスク」ではなく「webview」の都合である。** 供給は data URI なので、
/// 4MiB は base64 で **約 5.3MB の文字列**になり、それを `<video>` / `<img>` がデコードする。
/// エフェクト窓は **OBS がキャプチャし続けている透過窓**なので、デコードでフレームが落ちると
/// **配信にそのまま出る**。⚠ 061b は同時表示 3 件（`EFFECT_MAX_CONCURRENT`）なので、
/// 最悪 3 本ぶんが同時に載りうる。
/// ⚠ **061d への申し送り**: data URI は「割り当て時／画面表示時」に**先読み**して持ち、
/// 発火の瞬間に `get_effect_template_media` を呼ばないこと。
/// **再修正トリガー＝ 061d の実機確認でカクついたら、①この上限を下げる ②先読みを必須にする、の順。**
const MAX_MEDIA_BYTES: u64 = 4 * 1024 * 1024;

/// 音源 1 ファイルの上限（2MiB）。
///
/// 値の根拠: 2 秒の 44.1kHz ステレオ 16bit WAV ≒ 350KB。圧縮形式（mp3 / ogg）はさらに小さい。
const MAX_SOUND_BYTES: u64 = 2 * 1024 * 1024;

/// 1 テンプレートの合計上限（5MiB）。
///
/// ⚠⚠ **個別上限の和（6MiB）にしないのが要点。** 和にすると
/// 「個別を通れば合計も必ず通る」＝**この検査が構造的に到達不能**になり、
/// 効いていない安全装置がソース上に残る（安心の錯覚を作る）。
///
/// 5MiB という値の単位は「**1 回のエフェクトで webview へ載る base64 の総量**」である。
/// 供給は data URI なので 5MiB は約 6.7MB の文字列になり、061b の同時表示 3 件
/// （`EFFECT_MAX_CONCURRENT`）ぶんが最悪同時に載る。制約はディスクではなく**描画側**にあるので、
/// 個別ではなく**エフェクト単位の合計**で切るのが正しい。
///
/// 帰結＝メディア単体なら 4MiB まで使えるが、**2MiB の音源を足すとメディアは 3MiB までになる**。
const MAX_TOTAL_BYTES: u64 = 5 * 1024 * 1024;

/// 登録できるテンプレートの件数上限。
///
/// ⚠ **無制限にディスクが増える経路を作らないため**。取り込みコマンドはアプリ定義コマンドなので
/// **全 5 窓から呼べる**（ACL 対象外）＝上限は構造側に持たせる。
/// ⚠ ディスクの天井は 64 × [`MAX_TOTAL_BYTES`] ＝ **320MiB**（060h がテーマ 200 件 × 5MiB ≒ 1GB を
/// 問題視したのと同じ観点）。**この値を緩めるときは、メディア込みの総量で再評価すること。**
const MAX_TEMPLATES: u32 = 64;

/// `manifest.media` / `manifest.sound` に書けるファイル名の長さ上限（文字数）。
const MAX_ASSET_NAME_CHARS: usize = 100;

/// ⚠ Windows の予約デバイス名（`COM1.png` は**シリアルポートに解決する**）。
///
/// 判定は「最初の `.` より前」を **trim してから** ASCII 大文字化して比較する。Windows では
/// 拡張子が付いていてもデバイスとして解決されるため、**開いた瞬間にハングしうる**（可用性の問題）。
///
/// ⚠⚠ **列は Microsoft のファイル名規則の全量に合わせてある**（061c security-review S-2）。
/// 当初は `CON` / `PRN` / `AUX` / `NUL` / `COM1`〜`COM9` / `LPT1`〜`LPT9` の 22 件だけで、
/// **`COM0` / `LPT0`・上付き数字版（`COM¹` `COM²` `COM³` `LPT¹` `LPT²` `LPT³`）・
/// `CONIN$` / `CONOUT$` が漏れていた**。⚠ 上付き数字は `to_ascii_uppercase()` が触らないので、
/// 大文字化では吸収できず**リストに実体を置く**しかない。
/// ⚠ **不完全な許可/拒否リストは「守られている」と誤読させる**ので、足すときは全量で見直すこと。
const WINDOWS_RESERVED_STEMS: [&str; 32] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM0", "COM1", "COM2", "COM3", "COM4",
    "COM5", "COM6", "COM7", "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT0", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³",
];

// --- アセットの種別（拡張子 → MIME → マジックバイトを 1 つの表で結ぶ）-----------------------------

/// 取り込めるアセットの種別。
///
/// ⚠⚠ **拡張子・MIME・マジックバイトを 1 つの enum に束ねているのが要点。**
/// 別々の表にすると「拡張子は許すが MIME の対応が無い」「MIME だけ増やす」といった食い違いが作れる。
/// ⚠⚠ **`.svg` を足さないこと。** `<img>` の SVG は secure static mode で外部参照が仕様上禁止されるが、
/// `filter:` / `mask:` は SVG を「リソース文書」として読むのでその保証が及ばない
/// （060b が `data:` のフラグメントを落とした理由と同じ構図）。docs/security.md §8 の 061c 節が正。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssetKind {
    Png,
    Apng,
    Gif,
    Webp,
    Webm,
    Wav,
    Mp3,
    Ogg,
}

impl AssetKind {
    /// 管理下のファイル名に使う拡張子。**`&'static str`＝ユーザー入力から作った文字列ではない。**
    fn extension(self) -> &'static str {
        match self {
            AssetKind::Png => "png",
            AssetKind::Apng => "apng",
            AssetKind::Gif => "gif",
            AssetKind::Webp => "webp",
            AssetKind::Webm => "webm",
            AssetKind::Wav => "wav",
            AssetKind::Mp3 => "mp3",
            AssetKind::Ogg => "ogg",
        }
    }

    /// data URI に載せる MIME。**許可リストから決まる定数**で、ユーザー入力を 1 バイトも載せない。
    fn mime(self) -> &'static str {
        match self {
            AssetKind::Png => "image/png",
            AssetKind::Apng => "image/apng",
            AssetKind::Gif => "image/gif",
            AssetKind::Webp => "image/webp",
            AssetKind::Webm => "video/webm",
            AssetKind::Wav => "audio/wav",
            AssetKind::Mp3 => "audio/mpeg",
            AssetKind::Ogg => "audio/ogg",
        }
    }

    /// 拡張子（ASCII 大小無視）から種別を引く。
    fn from_extension(ext: &str, slot: AssetSlot) -> Option<AssetKind> {
        let lower = ext.to_ascii_lowercase();
        let kind = match lower.as_str() {
            "png" => AssetKind::Png,
            "apng" => AssetKind::Apng,
            "gif" => AssetKind::Gif,
            "webp" => AssetKind::Webp,
            "webm" => AssetKind::Webm,
            "wav" => AssetKind::Wav,
            "mp3" => AssetKind::Mp3,
            "ogg" => AssetKind::Ogg,
            _ => return None,
        };
        (kind.slot() == slot).then_some(kind)
    }

    fn slot(self) -> AssetSlot {
        match self {
            AssetKind::Png | AssetKind::Apng | AssetKind::Gif | AssetKind::Webp | AssetKind::Webm => {
                AssetSlot::Media
            }
            AssetKind::Wav | AssetKind::Mp3 | AssetKind::Ogg => AssetSlot::Sound,
        }
    }

    /// 拡張子と中身が最低限一致しているか（**マジックバイト**）。
    ///
    /// ⚠⚠ **これは形式の検証ではない。** 防いでいるのは「`.png` と名乗る HTML / 実行ファイル」という
    /// **素朴な偽装だけ**で、**正しい形式の悪意あるファイルは素通りする**
    /// （最後の砦は OS のメディアデコーダで、そこは我々の管轄外）。
    ///
    /// ⚠ **弾けなかった場合の被害**: `<img src="data:image/png;base64,<HTML>">` は
    /// **HTML として解釈されない**——`<img>` はソースを文書としてパースしないので、
    /// `csp: null` であってもスクリプトは動かない（デコードに失敗して壊れるだけ）。
    /// 例外になりうるのは SVG だけなので、[`AssetKind`] に `.svg` を足さないこと。
    ///
    /// ⚠ **`.apng` の `acTL` チャンクは見ない**（PNG と同一シグネチャのまま通す）。
    /// `acTL` の有無で変わるのは「動くか動かないか」だけで**安全性に関係が無く**、
    /// チャンク走査を足すとそこが新しいバグ面になる。静止 PNG を `.apng` と名付けても動かないだけである。
    fn matches_magic(self, bytes: &[u8]) -> bool {
        const PNG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        const EBML: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];
        match self {
            // APNG は PNG と**同一のシグネチャ**（上記の理由で区別しない）。
            AssetKind::Png | AssetKind::Apng => bytes.starts_with(&PNG),
            AssetKind::Gif => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            AssetKind::Webp => riff_with_form(bytes, b"WEBP"),
            AssetKind::Wav => riff_with_form(bytes, b"WAVE"),
            // ⚠ EBML だけでは `.mkv`（Matroska）も通ってしまうので、DocType の `webm` まで見る。
            AssetKind::Webm => {
                bytes.starts_with(&EBML)
                    && bytes[..bytes.len().min(64)]
                        .windows(4)
                        .any(|w| w == b"webm")
            }
            // ID3 タグ付き、または MPEG のフレーム同期（11 bit すべて 1）。
            AssetKind::Mp3 => {
                bytes.starts_with(b"ID3")
                    || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
            }
            AssetKind::Ogg => bytes.starts_with(b"OggS"),
        }
    }
}

/// `RIFF....<form>` 形（WebP / WAV に共通）。
fn riff_with_form(bytes: &[u8], form: &[u8; 4]) -> bool {
    bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == form
}

/// テンプレートが持つアセットの枠。**1 テンプレートにつき最大 1 つずつ。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssetSlot {
    Media,
    Sound,
}

impl AssetSlot {
    /// 管理下のファイル名の語幹。**固定文字列**（元ファイル名は使わない）。
    fn stem(self) -> &'static str {
        match self {
            AssetSlot::Media => "media",
            AssetSlot::Sound => "sound",
        }
    }

    fn max_bytes(self) -> u64 {
        match self {
            AssetSlot::Media => MAX_MEDIA_BYTES,
            AssetSlot::Sound => MAX_SOUND_BYTES,
        }
    }

    /// エラー文言に出す上限の表記（⚠ ユーザー入力は 1 バイトも補間しない・§9）。
    fn limit_label(self) -> &'static str {
        match self {
            AssetSlot::Media => "4MB",
            AssetSlot::Sound => "2MB",
        }
    }
}

// --- 純粋な検証（テストの主対象）-----------------------------------------------------------------

/// uuid v4 の文字列表現（ハイフン付き 36 文字）か。
///
/// 大文字の 16 進も通すのは、厳密一致ではなく**「パス片になりうる文字が入っていない」ことの保証**が
/// 目的だから（`/` `\` `.` `:` はいずれも通らない）。060b の `is_theme_id` と同じ規則。
fn is_template_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// 管理ディレクトリ配下のディレクトリ名として妥当か（`<uuid v4>` 完全一致）。
///
/// ⚠⚠ **`remove_dir_all` の安全策の 1 本目**。`../`・絶対パス・区切り文字入り・空はすべて false になる。
/// 保存時（自分で採番した id）にも、読み出し・削除時（DB から来た値）にも通す。
///
/// ⚠ 可視性はモジュール内に閉じている（061c security-review Q-6）。この 3 つの純関数は
/// `service` の中だけで使い、外へ出さない——外から呼べると「検証だけ通して結合は別の場所でやる」
/// 形が書けてしまい、「結合は 1 か所」という契約テストの前提が崩れる。
fn is_managed_dir_name(dir_name: &str) -> bool {
    is_template_id(dir_name)
}

/// 管理ディレクトリ配下の実ファイル名として妥当か（`media.<拡張子>` / `sound.<拡張子>` 完全一致）。
///
/// ⚠⚠ **管理ディレクトリの外へ出る唯一の可能性を潰す純関数**（060b の `is_managed_file_name` と同型）。
/// 保存時にも、読み出し時（DB の manifest から来た値）にも通す。
fn is_managed_asset_name(file_name: &str) -> bool {
    let Some((stem, ext)) = file_name.split_once('.') else {
        return false;
    };
    let slot = match stem {
        "media" => AssetSlot::Media,
        "sound" => AssetSlot::Sound,
        _ => return false,
    };
    // ⚠ 拡張子が更に `.` を含む形（`media.png.exe`）はここで落ちる（`from_extension` が None を返す）。
    AssetKind::from_extension(ext, slot).is_some()
}

/// `manifest.media` / `manifest.sound` に書けるファイル名か。
///
/// ⚠⚠ **061c で最も重要な純関数。** ここが「単一のファイル名でなければならない」を強制するので、
/// `<選ばれたディレクトリ>/<この名前>` を結合してもディレクトリの外へ出られない。
/// 落とすもの: 空 / 100 文字超 / 制御文字（**NUL を含む**）/ `/` / `\` / `:` /
/// `..` を含むもの / 先頭が `.`（`.` `..` と隠しファイルをまとめて落とす）/
/// **Windows の予約デバイス名**。
///
/// ⚠ 拡張子の許可リストはここでは見ない（枠ごとに違うため [`AssetSlot`] 側で見る）。
fn is_template_asset_name(name: &str) -> bool {
    if name.is_empty() || name.chars().count() > MAX_ASSET_NAME_CHARS {
        return false;
    }
    if name.chars().any(char::is_control) {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return false;
    }
    if name.starts_with('.') || name.contains("..") {
        return false;
    }
    // ⚠ Windows のドライブレター無しでも `COM1.png` はデバイスに解決する（macOS では踏めない・098 へ）。
    // ⚠⚠ **前後の空白を落としてから比較する**（061c security-review S-2）。Windows は名前部の
    // 末尾空白を除去してからデバイス判定するため、`"CON .png"` も `CON` に解決しうる。
    // trim せずに比較すると `"CON "` が予約名と一致せず素通りしていた。
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase();
    if WINDOWS_RESERVED_STEMS.contains(&stem.as_str()) {
        return false;
    }
    true
}

/// 名前から拡張子（最後の `.` 以降）を取り出す。⚠ `is_template_asset_name` を通した後に呼ぶこと。
fn extension_of(name: &str) -> Option<&str> {
    name.rsplit_once('.').map(|(_, ext)| ext).filter(|e| !e.is_empty())
}

// --- パス -----------------------------------------------------------------------------------

/// 管理ディレクトリ（`app_data_dir/effects/`）。**`app_data_dir()` を呼ぶ唯一の場所**。
pub fn effects_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::storage("アプリの保存先を解決できませんでした。"))?;
    Ok(base.join(EFFECTS_DIR))
}

/// 1 テンプレートの管理ディレクトリ。**ディレクトリ名を結合する唯一の場所**。
fn managed_dir(root: &Path, dir_name: &str) -> AppResult<PathBuf> {
    if !is_managed_dir_name(dir_name) {
        // ⚠ 「見つからない」に寄せる（何が起きたかを攻撃者に教えない・§9）。
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    }
    Ok(root.join(dir_name))
}

/// 管理ディレクトリ配下の実ファイルパス。**管理下のファイル名を結合する唯一の場所**。
fn managed_asset_path(template_dir: &Path, file_name: &str) -> AppResult<PathBuf> {
    if !is_managed_asset_name(file_name) {
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    }
    Ok(template_dir.join(file_name))
}

/// dialog 由来の生ディレクトリパスを検証する（§7 / §8）。
///
/// ⚠ **シンボリックリンクのディレクトリは拒否しない**（モジュール doc の理由。選ぶのはユーザー本人）。
fn validate_source_dir(raw_dir: &str) -> AppResult<PathBuf> {
    let trimmed = raw_dir.trim();
    require_non_empty(trimmed, "テンプレートのフォルダが選択されていません")?;
    reject_control_chars(trimmed, "フォルダのパスに制御文字は使用できません")?;

    // ⚠⚠ **UNC / ネットワークパスは触る前に拒否する**（060b security-review S-4 と同型）。
    // `import_effect_template` はアプリ定義コマンド＝**ACL 対象外で全 5 窓から呼べる**ので、
    // `dir` が dialog 由来である保証は無い（Rust からは確かめようがない）。Windows で
    // `\\evil.example\share` を渡されると、下の `fs::metadata` の時点で
    // **OS が攻撃者ホストへ SMB 接続し、既定設定では NTLM でユーザー/マシンの資格情報ハッシュが飛ぶ**。
    // ⚠⚠ **061c は 060b より効く**——こちらは**ディレクトリの中のファイルも読む**ので、
    // 拒否が外れると 1 回の取り込みで接続が複数回起きる。
    // ⚠ macOS の `/Volumes/...`（マウント済み共有）は拒否しない——ユーザーが既にマウントした先だけが
    // 見えるので、**新しい宛先を作らない**。
    // ⚠⚠ 判定は `util::is_network_path` に集約してある（061c security-review S-1）。
    // `starts_with("\\\\") || starts_with("//")` を直接書くと、**Windows が `/` と `\` を等価な
    // 区切りとして扱う**ため `\/server\share` / `/\server/share` という混在形が素通りする。
    if is_network_path(trimmed) {
        return Err(AppError::validation(
            "ネットワーク上のフォルダは取り込めません。ローカルにコピーしてから選んでください。",
        ));
    }

    let path = PathBuf::from(trimmed);
    let metadata = std::fs::metadata(&path)
        .map_err(|_| AppError::path_not_found("指定されたフォルダが見つかりません。"))?;
    if !metadata.is_dir() {
        return Err(AppError::validation("フォルダを選んでください。"));
    }
    Ok(path)
}

// --- 取り込み -------------------------------------------------------------------------------

/// 読み終えた 1 アセット。
struct LoadedAsset {
    kind: AssetKind,
    bytes: Vec<u8>,
}

impl LoadedAsset {
    /// 管理下のファイル名（`media.<拡張子>` / `sound.<拡張子>`）。**元ファイル名は 1 バイトも使わない。**
    fn managed_name(&self) -> String {
        format!("{}.{}", self.kind.slot().stem(), self.kind.extension())
    }
}

/// 検証済みの取り込み元（読み終えた manifest とアセット）。
pub struct ImportSource {
    manifest: EffectManifest,
    media: LoadedAsset,
    sound: Option<LoadedAsset>,
}

/// 取り込み元のディレクトリを検証して読む。
///
/// ⚠⚠ **DB ロックを取る前に呼ぶこと**（060b security-review 指摘と同じ理由）。`dir` はユーザーが
/// dialog で選んだ場所＝**ネットワークボリューム上にありうる**。ここを `db.lock()` の内側で行うと、
/// 応答しないボリュームを掴んだときに**アプリ全体の DB コマンド（コメント記録・プリセット起動・ログ）が
/// まとめて止まる**。読み込みだけをロックの外へ出しておけば、詰まるのはこの取り込み 1 本で済む。
///
/// 検証の順序（**fail-closed**。1 つでも落ちたら 1 バイトも保存しない）:
/// ①パスの形（制御文字 → **UNC** → 実在 → ディレクトリ）
/// ②`manifest.json`（symlink 拒否 → 64KiB 上限 → UTF-8）
/// ③スキーマ（`deny_unknown_fields` → `schemaVersion` → 範囲 → 変数の allow-list）
/// ④アセット名（**単一ファイル名規則**）→ ⑤拡張子の許可リスト
/// → ⑥**symlink 拒否**・単体サイズ上限 → ⑦**マジックバイト** → ⑧合計サイズ上限
pub fn read_import_source(raw_dir: &str) -> AppResult<ImportSource> {
    let dir = validate_source_dir(raw_dir)?;
    let manifest_text = read_manifest_text(&dir)?;
    let manifest = manifest::parse_manifest(&manifest_text)?;

    let media = read_template_asset(&dir, &manifest.media, AssetSlot::Media)?;
    let sound = match manifest.sound.as_deref() {
        Some(name) => Some(read_template_asset(&dir, name, AssetSlot::Sound)?),
        None => None,
    };

    // ⚠ 合計上限。data URI 化したときに **1 回のエフェクトで webview へ載る総量**そのものなので、
    //   個別上限とは別の意味を持つ（定数の注記が正）。
    let total = media.bytes.len() as u64 + sound.as_ref().map_or(0, |s| s.bytes.len() as u64);
    if total > MAX_TOTAL_BYTES {
        return Err(AppError::validation(
            "テンプレート全体のファイルサイズが大きすぎます。メディアと音源の合計を 5MB 以内にしてください。",
        ));
    }

    Ok(ImportSource {
        manifest,
        media,
        sound,
    })
}

/// `manifest.json` を読む。
///
/// ⚠ ファイル名は[コンパイル時定数][MANIFEST_FILE_NAME]なので、ここにユーザー入力は入らない。
/// ⚠ それでも **symlink は拒否する**（`manifest.json` をリンクにして管理外のファイルを読ませる形を塞ぐ）。
fn read_manifest_text(dir: &Path) -> AppResult<String> {
    let path = dir.join(MANIFEST_FILE_NAME);
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| {
        AppError::path_not_found(
            "選んだフォルダに manifest.json がありません。StreamDock 形式のテンプレートか確認してください。",
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::validation(
            "manifest.json はシンボリックリンクではなく実ファイルにしてください。",
        ));
    }
    // 読む前に落とす（巨大ファイルをメモリへ載せない）。
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(AppError::validation(
            "manifest.json が大きすぎます。64KB 以内にしてください。",
        ));
    }
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::path_not_found("manifest.json を読み取れませんでした。"))?;
    // ⚠ metadata を見てから read するまでにファイルが伸びうる（TOCTOU）ので、実バイト長で取り直す。
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(AppError::validation(
            "manifest.json が大きすぎます。64KB 以内にしてください。",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        AppError::unsupported_file_type(
            "manifest.json を UTF-8 として読み取れません。テキストファイルか確認してください。",
        )
    })
}

/// `manifest` が名指ししたアセットを 1 つ読む。
///
/// ⚠⚠ **`manifest` 由来の名前をパスへ結合する唯一の場所**。結合の前に
/// [`is_template_asset_name`]（単一ファイル名規則）と拡張子の許可リストを通し、
/// 結合の後に **symlink 拒否**・サイズ上限・マジックバイトを通す。
///
/// ⚠ この「symlink 拒否 → サイズ上限 → マジックバイト」は [`read_managed_data_uri`]（出口）と
/// **意図的に同じ形で 2 か所に書いてある**（061c security-review Q-4 で共通化を見送った）。
/// 共通化しないのは、契約テストが `symlink_metadata` の**出現回数**でリンク拒否を固定しており、
/// ヘルパへ畳むと出現回数が減って**その固定が弱くなる**ため。入口と出口は「読む対象」も
/// 「エラー文言の宛先」も違うので、1 関数に寄せる利得より固定を保つ利得が大きい。
/// **再修正トリガー＝この 3 段が 3 か所目に増えたとき**（そのときは共通化し、契約テストを
/// 「ヘルパの呼び出し回数」で固定し直すこと）。
fn read_template_asset(dir: &Path, raw_name: &str, slot: AssetSlot) -> AppResult<LoadedAsset> {
    if !is_template_asset_name(raw_name) {
        // ⚠ **入力そのものを文言に載せない**（§9）。
        return Err(AppError::validation(
            "manifest.json の media / sound は、同じフォルダ内のファイル名だけを指定してください（フォルダ区切りや .. は使えません）。",
        ));
    }
    let Some(kind) = extension_of(raw_name).and_then(|ext| AssetKind::from_extension(ext, slot))
    else {
        return Err(AppError::unsupported_file_type(match slot {
            AssetSlot::Media => "メディアは .png / .apng / .gif / .webp / .webm のいずれかにしてください。",
            AssetSlot::Sound => "音源は .wav / .mp3 / .ogg のいずれかにしてください。",
        }));
    };

    // ⚠⚠⚠ **リンク拒否を実際に担っているのは `symlink_metadata` を使っていること自体である。**
    // `metadata`（リンクを辿る）へ変えると、リンク先が実ファイルなら下の `is_file()` が true になり、
    // **リンク越しに管理外のファイルを読んでしまう**。＝ **この 1 語が壁**であり、
    // 契約テストが出現回数（4 か所）を固定しているのはそのためである。
    // ⚠ 検証の経緯（ミューテーション M5 が equivalent mutant として生存した件）は
    //   `docs/progress.md` の 061c 節が正。
    let path = dir.join(raw_name);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| AppError::path_not_found("manifest.json が参照しているファイルがありません。"))?;
    // ⚠⚠ **ここが 060b と結論が分かれる 1 点**（モジュール doc の論証）。
    // `manifest.media` を決めるのは第三者なので、リンク越しに管理外を読ませる形を許さない。
    // ⚠ この分岐は下の `!is_file()` と**拒否結果としては重複している**（`symlink_metadata` の
    //   `is_file()` はリンクに対して false）。残しているのは**文言のため**で、
    //   「リンクは使えない」と言えるのはここだけである（`!is_file()` は「ファイルではない」しか言えない）。
    if metadata.file_type().is_symlink() {
        return Err(AppError::validation(
            "テンプレート内のファイルはシンボリックリンクにできません。実ファイルを同梱してください。",
        ));
    }
    if !metadata.is_file() {
        return Err(AppError::validation(
            "manifest.json が参照しているのはファイルではありません。",
        ));
    }
    // 読む前に落とす（4GB のファイルをメモリへ載せない）。
    if metadata.len() > slot.max_bytes() {
        return Err(AppError::validation(format!(
            "テンプレートのファイルが大きすぎます。{} 以内にしてください。",
            slot.limit_label()
        )));
    }

    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::path_not_found("テンプレートのファイルを読み取れませんでした。"))?;
    // ⚠ TOCTOU（`symlink_metadata` の後にファイルが伸びうる）。実バイト長で取り直す。
    if bytes.len() as u64 > slot.max_bytes() {
        return Err(AppError::validation(format!(
            "テンプレートのファイルが大きすぎます。{} 以内にしてください。",
            slot.limit_label()
        )));
    }
    if !kind.matches_magic(&bytes) {
        return Err(AppError::unsupported_file_type(
            "拡張子とファイルの中身が一致していません。テンプレートの同梱ファイルを確認してください。",
        ));
    }
    Ok(LoadedAsset { kind, bytes })
}

/// 読み終えた取り込み元を登録する（**DB ロックを取ってから**呼ぶ）。
///
/// ⚠ **保存するのは manifest が参照したファイルだけ**（そもそも他のファイルを読んでいない）。
/// ⚠ **`manifest.json` 自体はコピーしない**——検証済みの正規化 JSON が DB に入るので、
/// 管理ディレクトリに置く必要が無い。＝管理ディレクトリに入りうるのは**最大 2 ファイル**。
pub fn store_template(
    root: &Path,
    conn: &Connection,
    source: &ImportSource,
) -> AppResult<EffectTemplateRecord> {
    if repository::count(conn)? >= MAX_TEMPLATES {
        return Err(AppError::validation(
            "登録できるテンプレートの上限に達しています。不要なテンプレートを削除してください。",
        ));
    }

    // ディレクトリ名は**アプリが採番した id**。元ディレクトリ名も `name` も使わない（§5）。
    let id = uuid::Uuid::new_v4().to_string();
    let template_dir = managed_dir(root, &id)?;

    // ⚠ 保存する manifest では `media` / `sound` を**管理下の名前へ書き換える**
    //   ＝元ファイル名は DB にも frontend にも 1 バイトも残らない（§5 / §9）。
    let mut manifest = source.manifest.clone();
    manifest.media = source.media.managed_name();
    manifest.sound = source.sound.as_ref().map(LoadedAsset::managed_name);
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|_| AppError::storage("テンプレートの情報を保存できませんでした。"))?;

    std::fs::create_dir_all(&template_dir)
        .map_err(|_| AppError::storage("テンプレートの保存先を用意できませんでした。"))?;

    // ⚠ **書き込み → INSERT の順**（060b と同じ）。INSERT に失敗したら書いたディレクトリを掃除する。
    // 逆順にしないのは、失敗したときに残るものの質が違うから——孤児**ディレクトリ**は不可視で無害だが、
    // 孤児**DB 行**は一覧に出て開けない「可視の故障」になる。
    let write_result = write_managed_asset(&template_dir, &manifest.media, &source.media.bytes)
        .and_then(|()| match (&manifest.sound, &source.sound) {
            (Some(file_name), Some(asset)) => {
                write_managed_asset(&template_dir, file_name, &asset.bytes)
            }
            _ => Ok(()),
        });
    if let Err(e) = write_result {
        remove_managed_dir(root, &id);
        return Err(e);
    }

    let now = now_rfc3339();
    let row = TemplateRow {
        id: id.clone(),
        name: manifest.name.clone(),
        dir_name: id.clone(),
        manifest_json,
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(e) = repository::insert(conn, &row) {
        remove_managed_dir(root, &id);
        return Err(AppError::from(e));
    }
    to_record(&row)
}

/// 管理ディレクトリへ 1 ファイル書く。**`std::fs::write(` が現れるのはここだけ**である。
///
/// ⚠ 契約テスト `exactly_one_place_writes_and_one_place_removes` が出現回数 1 で固定している
/// （060b の `write_sanitized_asset` と同じ発想＝「保存経路が 2 本に分かれて片方だけ緩む」形を作らない）。
/// ⚠ `file_name` は**呼び出し側がアプリ採番の語幹＋許可リストの拡張子から組む**（ユーザー入力は 1 バイトも
/// 入らない）。結合の直前に [`managed_asset_path`] が完全一致を検査する（多層防御）。
fn write_managed_asset(template_dir: &Path, file_name: &str, bytes: &[u8]) -> AppResult<()> {
    let path = managed_asset_path(template_dir, file_name)?;
    std::fs::write(&path, bytes)
        .map_err(|_| AppError::storage("テンプレートを保存できませんでした。"))?;
    Ok(())
}

/// 管理ディレクトリを 1 つ丸ごと消す。**`std::fs::remove_dir_all(` が現れるのはここだけ**である。
///
/// ⚠⚠ **§5 で最も危険な操作なので、安全策を 5 点で固めている**（docs/security.md §5 の 061c 例外節が正）:
/// 1. `dir_name` が **uuid v4 完全一致**であること（[`is_managed_dir_name`]）
/// 2. パス結合は [`managed_dir`] の 1 か所だけ
/// 3. 消す直前に **`symlink_metadata` で「シンボリックリンクではない実ディレクトリ」**であることを確認する
///    （`std::fs::remove_dir_all` は Rust 1.68 以降 openat ベースでリンクを辿らないが、
///    **明示しておくとテストで固定できる**）
/// 4. **DB 行が先・実体は best-effort**（呼び出し側の順序）
/// 5. **DB に無いディレクトリは消さない**——`effects/` を列挙して掃除する経路を作らない
///    （列挙して消す形こそが `remove_dir_all` を最も危険にする）
///
/// ⚠ 失敗しても `Err` を返さない。残るのは不可視の孤児ディレクトリだけで、
/// ユーザーが取れる行動が変わらないため（060b の best-effort 削除と同じ判断）。
fn remove_managed_dir(root: &Path, dir_name: &str) {
    let Ok(path) = managed_dir(root, dir_name) else {
        return;
    };
    let Ok(metadata) = std::fs::symlink_metadata(&path) else {
        return; // 既に無い（冪等）。
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return; // ⚠ ディレクトリに化けていないものには触らない。
    }
    let _ = std::fs::remove_dir_all(&path);
}

// --- 取り出し・削除 ---------------------------------------------------------------------------

/// DB 行 → frontend DTO。**保存済み manifest を検証し直す**（DB を信用しない）。
///
/// ⚠ 自分で書いた JSON なので通常は必ず通るが、DB を直接書き換えられた場合に
/// `fontSize: 99999` のような値がそのまま frontend へ出るのを防ぐ。
///
/// ⚠⚠ **`name` も `manifest` 側から取る**（061c security-review S-4）。`name` 列は挿入時に
/// `manifest.name` を写しただけの値で、**列を直接書き換えられると検証を素通りする**
/// （`parse_manifest` が trim・空拒否・制御文字拒否・80 文字上限を通すのは JSON 側の `name` だけ）。
/// 同じ関数の中に「DB を信用しない値」と「信用する値」を混在させない。
fn to_record(row: &TemplateRow) -> AppResult<EffectTemplateRecord> {
    let manifest = manifest::parse_manifest(&row.manifest_json)?;
    Ok(EffectTemplateRecord {
        id: row.id.clone(),
        name: manifest.name.clone(),
        duration_ms: manifest.duration_ms,
        layout: manifest.layout,
        text: manifest.text,
        has_sound: manifest.sound.is_some(),
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    })
}

/// 取り込み済みテンプレートの一覧（新しい順）。
///
/// ⚠ **読めない行は黙って落とす**（`Err` にしない）。DB を直接壊された場合に一覧ごと出せなくなると、
/// **正常なテンプレートまで使えなくなる＝配信が止まる**。可用性を優先するこの判断は変えない。
///
/// ⚠⚠ **ただし「入れ直せば直る」わけではない**（061c security-review Q-2 で記述を訂正）。
/// 落ちた行は **id が frontend へ届かない**ので `delete_effect_template` を呼べず、
/// **行もディレクトリも残り続ける**（件数上限 64 を食う）。ユーザーは同じテンプレートを
/// 入れ直して使えるが、壊れた行そのものは UI から掃除できない。
/// **再修正トリガー＝実際に壊れた行が報告されたとき。** そのときは戻り値に「読めなかった件数」を
/// 足し、061d が「壊れたテンプレートが N 件あります」と復帰導線を出せるようにすること
/// （`effects/` を列挙して掃除する経路は §5 の安全策⑤に反するので作らない）。
pub fn list(conn: &Connection) -> AppResult<Vec<EffectTemplateRecord>> {
    let rows = repository::list(conn)?;
    Ok(rows.iter().filter_map(|row| to_record(row).ok()).collect())
}

/// テンプレートのメディアを **data URI** で返す（061d の描画元）。
///
/// ⚠ **frontend からパスを受け取らない。** `id` で DB を引き、DB の `dir_name` と
/// manifest の `media` / `sound` を [`managed_dir`] / [`managed_asset_path`] に通してから読む。
/// id 自体も形を検査する（3 段の防御）。
///
/// ⚠⚠ **完全な data URI を組み立てて返す**（`tools::icon` の生 base64 とはあえて形を違える）。
/// frontend が組み立てる形にすると、描画シンクのガードが**自分で作った文字列を検査するだけ**になり
/// 無意味になる。理由は `model::EffectTemplateMedia` の注記が正。
pub fn read_media(root: &Path, conn: &Connection, id: &str) -> AppResult<EffectTemplateMedia> {
    if !is_template_id(id) {
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    }
    let row = repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found("テンプレートが見つかりません。"))?;
    let manifest = manifest::parse_manifest(&row.manifest_json)?;
    let template_dir = managed_dir(root, &row.dir_name)?;

    let (media, media_bytes) = read_managed_data_uri(&template_dir, &manifest.media, AssetSlot::Media)?;
    let sound = match manifest.sound.as_deref() {
        Some(name) => Some(read_managed_data_uri(&template_dir, name, AssetSlot::Sound)?),
        None => None,
    };

    // ⚠⚠ **合計上限は出口でも見る**（061c security-review S-5）。[`MAX_TOTAL_BYTES`] の単位は
    // 「1 回のエフェクトで webview へ載る base64 の総量」＝**まさにここで確定する量**なので、
    // 入口（取り込み）でしか見ないと、その定数を守る検査が出口に無いことになる。
    // ディスク上のファイルを差し替えられた場合に、合計 6MiB を webview へ渡さない（fail-closed）。
    let total = media_bytes + sound.as_ref().map_or(0, |(_, bytes)| *bytes);
    if total > MAX_TOTAL_BYTES {
        return Err(AppError::unsupported_file_type(
            "テンプレートのファイルが壊れています。取り込み直してください。",
        ));
    }
    Ok(EffectTemplateMedia {
        media,
        sound: sound.map(|(uri, _)| uri),
    })
}

/// 管理下の 1 ファイルを読んで data URI にする。**戻りは（data URI, 生バイト長）**。
///
/// ⚠ **保存時と同じ検査（サイズ上限・マジックバイト）をもう一度通す。** 自分で書いたファイルなので
/// 通常は必ず通るが、ディスク上のファイルを差し替えられた場合に webview へ渡す前で止まる
/// （fail-closed）。061d は読み込み失敗時に組み込み意匠へフォールバックする。
///
/// ⚠ 生バイト長も返すのは、呼び出し側（[`read_media`]）が**合計上限**を見るため
/// （base64 文字列の長さから逆算すると端数の扱いが規則の 2 実装になる）。
fn read_managed_data_uri(
    template_dir: &Path,
    file_name: &str,
    slot: AssetSlot,
) -> AppResult<(String, u64)> {
    let path = managed_asset_path(template_dir, file_name)?;
    let Some(kind) = extension_of(file_name).and_then(|ext| AssetKind::from_extension(ext, slot))
    else {
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    };
    // ⚠⚠ **出口側でもリンクを辿らない。** `std::fs::read` はシンボリックリンクを**辿る**ので、
    // 管理ディレクトリの中身を差し替えられた場合に、リンク先の任意ファイルを data URI にして
    // webview へ渡してしまう。⚠ そこへ書ける相手は既に DB も書けるので**権限は増えない**が、
    // 「**テンプレートのアセットではリンクを 1 か所も辿らない**」という不変条件を
    // 入口と出口で同じ形にしておくほうが、後から読む人が判断を間違えない。
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| AppError::not_found("テンプレートのファイルを読み取れませんでした。"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::not_found("テンプレートのファイルを読み取れませんでした。"));
    }
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::not_found("テンプレートのファイルを読み取れませんでした。"))?;
    if bytes.len() as u64 > slot.max_bytes() || !kind.matches_magic(&bytes) {
        return Err(AppError::unsupported_file_type(
            "テンプレートのファイルが壊れています。取り込み直してください。",
        ));
    }
    let uri = format!(
        "data:{};base64,{}",
        kind.mime(),
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    Ok((uri, bytes.len() as u64))
}

/// テンプレートを削除する（DB 行とディレクトリ実体の両方）。
///
/// ⚠ **DB 行を先に消す**（060b と同じ理由）。逆順にすると、行の削除に失敗したときに
/// 「一覧に出るのに開けないテンプレート」が残る（可視の故障）。この順なら残りうるのは
/// 孤児ディレクトリだけ（不可視・無害）。2 回目の削除は行が 0 件なので `NotFound`。
pub fn delete(root: &Path, conn: &Connection, id: &str) -> AppResult<()> {
    if !is_template_id(id) {
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    }
    // ⚠ 行を消す**前**に取り出す（消した後では dir_name が分からない＝永久孤児になる）。
    let dir_name = repository::get(conn, id)?.map(|row| row.dir_name);
    if repository::delete(conn, id)? == 0 {
        return Err(AppError::not_found("テンプレートが見つかりません。"));
    }
    if let Some(dir_name) = dir_name {
        remove_managed_dir(root, &dir_name);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 061c の検証・保存まわりの仕様テストと、**ソース文字列の契約テスト**。
    //!
    //! 契約テストは `overlay_theme::service` / `audio::service` / `obs_config` の先例と同型で、
    //! **テストでは踏めないセキュリティ不変条件を機械的に守る**ためのもの。
    //! ⚠ needle は必ず `format!` で実行時に組む（`include_str!` は自ファイルを読むので、
    //! 検索文字列を直書きすると自己ヒットで判定が骨抜きになる）。

    use super::*;
    use crate::error::ErrorCode;

    // --- テスト用の足場 -------------------------------------------------------------------------

    fn conn() -> Connection {
        let conn = match Connection::open_in_memory() {
            Ok(conn) => conn,
            Err(e) => panic!("in-memory SQLite を開けない: {e}"),
        };
        if let Err(e) = repository::init(&conn) {
            panic!("init に失敗: {e}");
        }
        conn
    }

    /// テスト専用の一時ディレクトリ（`Drop` で片付ける）。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join("stream-dock-effect-template-test")
                .join(uuid::Uuid::new_v4().to_string());
            if let Err(e) = std::fs::create_dir_all(&path) {
                panic!("一時ディレクトリを作れない: {e}");
            }
            TempDir(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn as_arg(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
        fn write(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            if let Err(e) = std::fs::write(&path, contents) {
                panic!("テスト用ファイルを書けない: {e}");
            }
            path
        }
        fn entries(&self) -> Vec<String> {
            entries_of(&self.0)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn entries_of(dir: &Path) -> Vec<String> {
        let Ok(read_dir) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = read_dir
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    // --- 各形式の最小限のサンプル（マジックバイトが一致するもの）-----------------------------------

    fn png_bytes() -> Vec<u8> {
        let mut v = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0u8; 8]);
        v
    }
    fn gif_bytes() -> Vec<u8> {
        b"GIF89a\x01\x00\x01\x00".to_vec()
    }
    fn webp_bytes() -> Vec<u8> {
        let mut v = b"RIFF".to_vec();
        v.extend_from_slice(&[0u8; 4]);
        v.extend_from_slice(b"WEBP");
        v
    }
    fn webm_bytes() -> Vec<u8> {
        let mut v = vec![0x1A, 0x45, 0xDF, 0xA3];
        v.extend_from_slice(&[0u8; 8]);
        v.extend_from_slice(b"webm");
        v
    }
    fn wav_bytes() -> Vec<u8> {
        let mut v = b"RIFF".to_vec();
        v.extend_from_slice(&[0u8; 4]);
        v.extend_from_slice(b"WAVE");
        v
    }
    fn mp3_bytes() -> Vec<u8> {
        b"ID3\x03\x00\x00\x00".to_vec()
    }
    fn ogg_bytes() -> Vec<u8> {
        b"OggS\x00\x02\x00\x00".to_vec()
    }

    /// `media` / `sound` を差し替えられる manifest を作る。
    fn manifest_json(media: &str, sound: Option<&str>) -> String {
        let sound_line = match sound {
            Some(s) => format!(r#""sound": "{s}","#),
            None => String::new(),
        };
        format!(
            r#"{{
                "schemaVersion": 1,
                "name": "きらきら",
                "media": "{media}",
                {sound_line}
                "durationMs": 5000,
                "layout": {{ "anchor": "center", "width": 640, "height": 360 }},
                "text": {{ "template": "{{name}} さんが {{amount}}", "anchor": "bottom", "fontSize": 32 }}
            }}"#
        )
    }

    /// 正常なテンプレートディレクトリ（`manifest.json` ＋ `main.png` ＋ `sound.wav`）。
    fn valid_template() -> TempDir {
        let dir = TempDir::new();
        dir.write(
            "manifest.json",
            manifest_json("main.png", Some("sound.wav")).as_bytes(),
        );
        dir.write("main.png", &png_bytes());
        dir.write("sound.wav", &wav_bytes());
        dir
    }

    /// コマンド層と**同じ 2 段**（ロック外で読む → ロック内で登録する）を 1 行で呼ぶテスト用の合成。
    /// ⚠ 本番の順序を変えたらここも合わせること（テストだけ旧経路を使い続けないため）。
    fn import_from_dir(
        root: &Path,
        conn: &Connection,
        raw_dir: &str,
    ) -> AppResult<EffectTemplateRecord> {
        let source = read_import_source(raw_dir)?;
        store_template(root, conn, &source)
    }

    // --- 取り込みの基本形 ------------------------------------------------------------------------

    #[test]
    fn importing_copies_only_the_files_the_manifest_references() {
        // ⚠⚠ **本タスクの中心。** 元ディレクトリに `.html` や README を同梱しても、
        //   管理ディレクトリに入るのは manifest が名指しした 2 つだけであること。
        let source = valid_template();
        source.write("evil.html", b"<script>alert(1)</script>");
        source.write("README.txt", b"hello");
        source.write("unused.png", &png_bytes());
        let managed = TempDir::new();
        let conn = conn();

        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("正常なテンプレートの取り込みに失敗: {e}"),
        };

        assert_eq!(record.name, "きらきら");
        assert_eq!(record.duration_ms, 5000);
        assert!(record.has_sound);

        // 管理ディレクトリは 1 つだけ、名前は id 由来。
        assert_eq!(managed.entries(), vec![record.id.clone()]);
        // ⚠⚠ **中身は media.png と sound.wav ちょうど。**
        //   `manifest.json` すらコピーされない（検証済み JSON は DB にある）。
        let template_dir = managed.path().join(&record.id);
        assert_eq!(
            entries_of(&template_dir),
            vec!["media.png".to_string(), "sound.wav".to_string()],
            "⚠ 参照されていないファイルがコピーされている（または manifest.json が混ざっている）"
        );
        // 元ファイル名もテンプレート名も実ファイル名に現れない（§5）。
        for name in entries_of(&template_dir) {
            assert!(is_managed_asset_name(&name), "管理外のファイル名: {name}");
            assert!(!name.contains("main"));
            assert!(!name.contains("きらきら"));
        }

        // 一覧にも出る。
        let listed = list(&conn).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, record.id);
    }

    #[test]
    fn a_template_without_sound_is_accepted_and_reports_no_sound() {
        let source = TempDir::new();
        source.write("manifest.json", manifest_json("main.webm", None).as_bytes());
        source.write("main.webm", &webm_bytes());
        let managed = TempDir::new();
        let conn = conn();

        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("音源なしテンプレートの取り込みに失敗: {e}"),
        };
        assert!(!record.has_sound);
        assert_eq!(
            entries_of(&managed.path().join(&record.id)),
            vec!["media.webm".to_string()]
        );
    }

    #[test]
    fn the_media_is_returned_as_a_data_uri_whose_mime_comes_from_the_allowlist() {
        let source = valid_template();
        let managed = TempDir::new();
        let conn = conn();
        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };

        let media = match read_media(managed.path(), &conn, &record.id) {
            Ok(m) => m,
            Err(e) => panic!("メディアを読めない: {e}"),
        };
        // ⚠ **完全な data URI**（frontend が組み立てる形にしない＝描画ガードが意味を持つため）。
        assert!(
            media.media.starts_with("data:image/png;base64,"),
            "data URI になっていない: {}",
            &media.media[..media.media.len().min(40)]
        );
        assert_eq!(
            media.sound.as_deref().map(|s| s.starts_with("data:audio/wav;base64,")),
            Some(true)
        );
        // base64 部が正しく復号でき、書いたバイト列と一致する。
        let payload = media.media.trim_start_matches("data:image/png;base64,");
        assert_eq!(
            base64::engine::general_purpose::STANDARD.decode(payload).ok(),
            Some(png_bytes())
        );
    }

    // --- ⚠⚠ パストラバーサル -----------------------------------------------------------------------

    #[test]
    fn a_traversal_shaped_media_name_never_escapes_the_chosen_directory() {
        // ⚠⚠ 061c の中心的な検査。`<選ばれたディレクトリ>/<manifest.media>` の結合は
        //   **単一ファイル名規則**だけで閉じている（canonicalize は使わない）。
        let outside = TempDir::new();
        outside.write("victim.png", &png_bytes());

        for evil in [
            "../victim.png",
            "../../etc/passwd.png",
            "sub/main.png",
            "sub\\main.png",
            "/etc/passwd.png",
            "C:\\Windows\\x.png",
            "\\\\evil.example\\share\\x.png",
            ".hidden.png",
            ".",
            "..",
            "",
            "a\u{0}b.png",
            "a\nb.png",
            "CON.png",
            "COM1.png",
            "nul.png",
            &"a".repeat(MAX_ASSET_NAME_CHARS + 1),
        ] {
            let source = TempDir::new();
            source.write("manifest.json", manifest_json(evil, None).as_bytes());
            source.write("main.png", &png_bytes());
            let managed = TempDir::new();
            let conn = conn();

            let err = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
                Ok(_) => panic!("トラバーサル形の media を通した: {evil:?}"),
                Err(e) => e,
            };
            assert!(
                matches!(
                    err.code,
                    ErrorCode::ValidationError | ErrorCode::UnsupportedFileType
                ),
                "{evil:?} -> {:?}",
                err.code
            );
            // ⚠ 1 バイトも保存されていないこと。
            assert!(managed.entries().is_empty(), "{evil:?}: 孤児が残った");
            assert!(list(&conn).unwrap_or_default().is_empty(), "{evil:?}");
        }
        assert!(outside.path().join("victim.png").exists());
    }

    #[test]
    fn only_the_allowlisted_extensions_are_accepted_per_slot() {
        // media の許可リスト。
        for (name, bytes, ok) in [
            ("main.png", png_bytes(), true),
            ("main.apng", png_bytes(), true),
            ("main.gif", gif_bytes(), true),
            ("main.webp", webp_bytes(), true),
            ("main.webm", webm_bytes(), true),
            ("main.PNG", png_bytes(), true), // 拡張子は ASCII 大小無視
            // ⚠⚠ `.svg` は**意図的に許可しない**（`<img>` の secure static mode に依存する形を作らない）。
            ("main.svg", b"<svg/>".to_vec(), false),
            ("main.html", b"<html>".to_vec(), false),
            ("main.exe", b"MZ".to_vec(), false),
            ("main.wav", wav_bytes(), false), // 音源は media 枠に入れられない
            ("main", png_bytes(), false),
            ("main.", png_bytes(), false),
            ("main.png.exe", png_bytes(), false),
        ] {
            let source = TempDir::new();
            source.write("manifest.json", manifest_json(name, None).as_bytes());
            source.write(name, &bytes);
            let managed = TempDir::new();
            let conn = conn();
            assert_eq!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                ok,
                "media={name}"
            );
        }

        // sound の許可リスト。
        for (name, bytes, ok) in [
            ("s.wav", wav_bytes(), true),
            ("s.mp3", mp3_bytes(), true),
            ("s.ogg", ogg_bytes(), true),
            ("s.png", png_bytes(), false), // 画像は sound 枠に入れられない
            ("s.aiff", b"FORM".to_vec(), false),
        ] {
            let source = TempDir::new();
            source.write(
                "manifest.json",
                manifest_json("main.png", Some(name)).as_bytes(),
            );
            source.write("main.png", &png_bytes());
            source.write(name, &bytes);
            let managed = TempDir::new();
            let conn = conn();
            assert_eq!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                ok,
                "sound={name}"
            );
        }
    }

    #[test]
    fn adversarial_names_that_only_look_like_separators_stay_inside_the_chosen_directory() {
        // ⚠⚠ **055e の教訓**＝「自分のガードの主張を裏返す変異」だけでは、
        // **ガードが見ていない領域**の穴は見つからない。ここは
        // 「区切り文字に**見える**が OS は区切りとして扱わない文字」「多重拡張子」「format 文字」を
        // **実際に通して**、①受け入れられること ②それでも管理ディレクトリの外へ出ないこと、を確かめる。
        //
        // ⚠ `char::is_control` は **Cc しか見ない**ので U+202E（RTL override・Cf）は素通りする。
        //   それでよい理由＝パス解決には影響せず、しかも**保存名は `media.<拡張子>` へ捨てられる**ので
        //   第三者が名付けた文字列がディスクにもエラーにも残らない。
        for weird in [
            "a\u{FF0F}b.png",  // 全角ソリダス（U+FF0F）
            "a\u{2044}b.png",  // FRACTION SLASH（U+2044）
            "a\u{202E}b.png",  // RTL override（Cf なので char::is_control では弾けない）
            "a.b.c.png",       // 多重拡張子（最後の `.` 以降だけを見る）
            "main.PNG",        // 拡張子は ASCII 大小無視
        ] {
            let source = TempDir::new();
            source.write("manifest.json", manifest_json(weird, None).as_bytes());
            source.write(weird, &png_bytes());
            let managed = TempDir::new();
            let conn = conn();

            let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
                Ok(r) => r,
                Err(e) => panic!("正当な（見た目が紛らわしいだけの）名前を拒否した: {weird:?} -> {e}"),
            };
            // ⚠ 管理ディレクトリは **1 つだけ・中身は media.png ちょうど**。
            //   第三者が付けた名前はディスク上に 1 バイトも残らない。
            assert_eq!(managed.entries(), vec![record.id.clone()], "{weird:?}");
            assert_eq!(
                entries_of(&managed.path().join(&record.id)),
                vec!["media.png".to_string()],
                "{weird:?}: 元の名前が保存名に漏れている／余分なファイルがある"
            );
        }
    }

    // --- ⚠⚠ symlink（060b と結論が分かれる 1 点）-----------------------------------------------------

    #[cfg(unix)]
    #[test]
    fn a_symlinked_asset_is_refused_but_a_symlinked_source_directory_is_accepted() {
        // ⚠⚠ **060b は「symlink を拒否しない」と決めているが、061c の読み込み元には及ばない。**
        //   `manifest.media` を決めるのは第三者なので、`main.png` を管理外のファイルへの
        //   リンクにすれば「ユーザーが意図していない画像が配信に出る」。
        let outside = TempDir::new();
        let victim = outside.write("private.png", &png_bytes());

        let source = TempDir::new();
        source.write("manifest.json", manifest_json("main.png", None).as_bytes());
        if let Err(e) = std::os::unix::fs::symlink(&victim, source.path().join("main.png")) {
            panic!("テスト用 symlink を作れない: {e}");
        }
        let managed = TempDir::new();
        let conn = conn();
        let err = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(_) => panic!("⚠ シンボリックリンクのアセットを取り込んだ（管理外のファイルが配信に出る）"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert!(managed.entries().is_empty(), "孤児が残った");

        // ⚠ `manifest.json` 自体のリンクも拒否する。
        let source2 = TempDir::new();
        let real_manifest = outside.write("m.json", manifest_json("main.png", None).as_bytes());
        if let Err(e) = std::os::unix::fs::symlink(&real_manifest, source2.path().join("manifest.json"))
        {
            panic!("テスト用 symlink を作れない: {e}");
        }
        source2.write("main.png", &png_bytes());
        assert!(
            import_from_dir(managed.path(), &conn, &source2.as_arg()).is_err(),
            "⚠ シンボリックリンクの manifest.json を読んだ"
        );

        // ⚠⚠ **選ばれたディレクトリ自体の symlink は拒否しない**（選ぶのはユーザー本人＝
        //   060b の論証がそのまま効く。Dropbox / iCloud をリンクしている構成を壊さない）。
        let real = valid_template();
        let link_parent = TempDir::new();
        let link = link_parent.path().join("linked-template");
        if let Err(e) = std::os::unix::fs::symlink(real.path(), &link) {
            panic!("テスト用 symlink を作れない: {e}");
        }
        assert!(
            import_from_dir(managed.path(), &conn, &link.to_string_lossy()).is_ok(),
            "⚠ シンボリックリンクのフォルダを拒否した（正当な構成が壊れる）"
        );
    }

    // --- UNC / ネットワークパス --------------------------------------------------------------------

    #[test]
    fn network_paths_are_refused_before_the_filesystem_is_touched() {
        // ⚠⚠ 060b security-review S-4 と同型。`import_effect_template` は ACL 対象外＝全 5 窓から
        // 任意文字列で呼べる。Windows で UNC を渡されると `fs::metadata` の時点で SMB 接続が起き、
        // 既定設定では NTLM で資格情報ハッシュが飛ぶ（ユーザー操作ゼロの egress）。
        // ⚠ 061c は**ディレクトリの中のファイルも読む**ので、外れると接続が 1 回では済まない。
        for bad in [
            r"\\evil.example\share",
            r"\\evil.example\share\tpl",
            r"\\?\UNC\evil.example\share",
            "//evil.example/share",
            // ⚠⚠ 061c security-review S-1: Windows は `/` と `\` を等価な区切りとして扱うので、
            // 混在形も UNC として解決される（`starts_with` 2 本の旧実装では素通りしていた）。
            r"\/evil.example\share",
            r"/\evil.example/share",
            r"\/evil.example\share\tpl",
        ] {
            let err = match read_import_source(bad) {
                Ok(_) => panic!("ネットワークパスを通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError, "{bad:?}");
            // ⚠ 入力を持ち帰らない（そもそもディスクへ触っていない）。
            let json = serde_json::to_string(&err).unwrap_or_default();
            assert!(!json.contains("evil.example"), "入力を持ち帰っている: {json}");
        }
        // ローカルの絶対パスは通る（過剰に弾いていないこと）。
        let source = valid_template();
        assert!(read_import_source(&source.as_arg()).is_ok());
    }

    #[test]
    fn source_paths_must_be_existing_directories() {
        let source = valid_template();
        assert!(read_import_source(&source.as_arg()).is_ok());

        // 存在しない / 空 / 制御文字 / ファイルを指している。
        assert!(read_import_source("").is_err());
        assert!(read_import_source("   ").is_err());
        assert!(read_import_source("/no/such/dir-9f2b").is_err());
        let file = source.path().join("manifest.json");
        let err = match read_import_source(&file.to_string_lossy()) {
            Ok(_) => panic!("ファイルパスを通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    #[test]
    fn a_directory_without_a_manifest_is_refused() {
        let source = TempDir::new();
        source.write("main.png", &png_bytes());
        assert!(read_import_source(&source.as_arg()).is_err());
    }

    // --- マジックバイト ----------------------------------------------------------------------------

    #[test]
    fn the_magic_bytes_must_match_the_declared_extension() {
        // ⚠ 防いでいるのは「`.png` と名乗る HTML」という**素朴な偽装だけ**である
        //   （正しい形式の悪意あるファイルは素通りする＝最後の砦は OS のデコーダ）。
        for (name, bytes) in [
            ("main.png", b"<html><script>x</script>".to_vec()),
            ("main.gif", png_bytes()),
            ("main.webp", wav_bytes()), // RIFF だが form が WAVE
            ("main.webm", vec![0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]), // EBML だが webm ではない（.mkv）
        ] {
            let source = TempDir::new();
            source.write("manifest.json", manifest_json(name, None).as_bytes());
            source.write(name, &bytes);
            let managed = TempDir::new();
            let conn = conn();
            let err = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
                Ok(_) => panic!("中身が一致しないファイルを通した: {name}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::UnsupportedFileType, "{name}");
            assert!(managed.entries().is_empty(), "{name}: 孤児が残った");
        }

        // 音源側も同じ。
        let source = TempDir::new();
        source.write(
            "manifest.json",
            manifest_json("main.png", Some("s.wav")).as_bytes(),
        );
        source.write("main.png", &png_bytes());
        source.write("s.wav", b"not a wav at all");
        let managed = TempDir::new();
        let conn = conn();
        assert!(import_from_dir(managed.path(), &conn, &source.as_arg()).is_err());
        assert!(managed.entries().is_empty(), "孤児が残った");
    }

    // --- サイズ上限（境界値ちょうど）----------------------------------------------------------------

    /// マジックバイトが一致したまま指定バイト数にする。
    fn png_of(len: usize) -> Vec<u8> {
        let mut v = png_bytes();
        v.resize(len.max(v.len()), 0);
        v
    }
    fn wav_of(len: usize) -> Vec<u8> {
        let mut v = wav_bytes();
        v.resize(len.max(v.len()), 0);
        v
    }

    #[test]
    fn the_per_file_size_limits_are_enforced_at_their_exact_boundaries() {
        for (len, ok) in [
            (MAX_MEDIA_BYTES as usize, true),
            (MAX_MEDIA_BYTES as usize + 1, false),
        ] {
            let source = TempDir::new();
            source.write("manifest.json", manifest_json("main.png", None).as_bytes());
            source.write("main.png", &png_of(len));
            let managed = TempDir::new();
            let conn = conn();
            assert_eq!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                ok,
                "media len={len}"
            );
            if !ok {
                assert!(managed.entries().is_empty(), "孤児が残った");
            }
        }
        for (len, ok) in [
            (MAX_SOUND_BYTES as usize, true),
            (MAX_SOUND_BYTES as usize + 1, false),
        ] {
            let source = TempDir::new();
            source.write(
                "manifest.json",
                manifest_json("main.png", Some("s.wav")).as_bytes(),
            );
            source.write("main.png", &png_bytes());
            source.write("s.wav", &wav_of(len));
            let managed = TempDir::new();
            let conn = conn();
            assert_eq!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                ok,
                "sound len={len}"
            );
        }
    }

    #[test]
    fn the_total_size_limit_is_enforced_at_its_exact_boundary() {
        // ⚠⚠ **合計上限は個別上限の和ではない**（和にすると到達不能な検査になる）。
        //   ここが「個別は通るのに合計で落ちる」を実際に踏むケースである。
        let media_len = MAX_MEDIA_BYTES as usize;
        for (sound_len, ok) in [
            (MAX_TOTAL_BYTES as usize - media_len, true),
            (MAX_TOTAL_BYTES as usize - media_len + 1, false),
        ] {
            let source = TempDir::new();
            source.write(
                "manifest.json",
                manifest_json("main.png", Some("s.wav")).as_bytes(),
            );
            source.write("main.png", &png_of(media_len));
            source.write("s.wav", &wav_of(sound_len));
            let managed = TempDir::new();
            let conn = conn();
            // 個別上限は両方とも通っている（＝落ちるとしたら合計上限だけ）。
            assert!(media_len as u64 <= MAX_MEDIA_BYTES);
            assert!(sound_len as u64 <= MAX_SOUND_BYTES);
            assert_eq!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                ok,
                "total={}",
                media_len + sound_len
            );
        }
    }

    #[test]
    fn the_manifest_size_limit_is_enforced() {
        let source = TempDir::new();
        source.write("main.png", &png_bytes());
        // 64KiB を超える manifest（`name` を膨らませる）。
        let padding = "a".repeat(MAX_MANIFEST_BYTES as usize);
        source.write(
            "manifest.json",
            format!(
                r#"{{ "schemaVersion": 1, "name": "x", "media": "main.png", "durationMs": 1000,
                      "layout": {{ "anchor": "top", "width": 100, "height": 100 }},
                      "_pad": "{padding}" }}"#
            )
            .as_bytes(),
        );
        let err = match read_import_source(&source.as_arg()) {
            Ok(_) => panic!("巨大な manifest.json を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    // --- 件数上限 ---------------------------------------------------------------------------------

    #[test]
    fn the_template_count_is_capped() {
        let source = valid_template();
        let managed = TempDir::new();
        let conn = conn();
        for index in 0..MAX_TEMPLATES {
            assert!(
                import_from_dir(managed.path(), &conn, &source.as_arg()).is_ok(),
                "{index} 件目の取り込みに失敗"
            );
        }
        let err = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(_) => panic!("上限を超えて取り込めた"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
        // ⚠ 上限で弾いたときに孤児ディレクトリを作っていないこと。
        assert_eq!(managed.entries().len(), MAX_TEMPLATES as usize);
    }

    #[test]
    fn a_failed_insert_takes_the_directory_it_wrote_with_it() {
        // ⚠ 「書き込み → INSERT」の順にした以上、INSERT が落ちたときに**孤児ディレクトリを残さない**ことが
        // その順序を選んだ理由そのもの。SELECT は通るまま INSERT だけを拒否するトリガーを張る。
        let source = valid_template();
        let managed = TempDir::new();
        let conn = conn();
        let trigger = conn.execute_batch(
            "CREATE TRIGGER refuse_insert BEFORE INSERT ON effect_templates
             BEGIN SELECT RAISE(ABORT, 'refused by test'); END;",
        );
        assert!(trigger.is_ok());

        let err = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(_) => panic!("INSERT が失敗するはずが成功した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::StorageFailed);
        assert!(
            managed.entries().is_empty(),
            "INSERT 失敗後に孤児ディレクトリが残った: {:?}",
            managed.entries()
        );
    }

    // --- 削除 -------------------------------------------------------------------------------------

    #[test]
    fn deleting_removes_both_the_row_and_the_directory_and_repeats_safely() {
        let source = valid_template();
        let managed = TempDir::new();
        let conn = conn();
        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        assert_eq!(managed.entries().len(), 1);

        assert!(delete(managed.path(), &conn, &record.id).is_ok());
        assert!(managed.entries().is_empty(), "ディレクトリ実体が消えていない");
        assert!(list(&conn).unwrap_or_default().is_empty());

        // 二重削除は NotFound（落ちない）。
        let err = match delete(managed.path(), &conn, &record.id) {
            Ok(()) => panic!("二重削除が成功した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn deleting_succeeds_even_when_the_directory_is_already_gone() {
        let source = valid_template();
        let managed = TempDir::new();
        let conn = conn();
        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        assert!(std::fs::remove_dir_all(managed.path().join(&record.id)).is_ok());
        assert!(delete(managed.path(), &conn, &record.id).is_ok());
    }

    #[test]
    fn unknown_or_malformed_ids_are_not_found_rather_than_touching_the_disk() {
        let managed = TempDir::new();
        let conn = conn();
        for id in [
            "",
            "..",
            "../../etc/passwd",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301", // 形は正しいが未登録
            "not-a-uuid",
        ] {
            assert_eq!(
                read_media(managed.path(), &conn, id).err().map(|e| e.code),
                Some(ErrorCode::NotFound),
                "id={id:?}"
            );
            assert_eq!(
                delete(managed.path(), &conn, id).err().map(|e| e.code),
                Some(ErrorCode::NotFound),
                "id={id:?}"
            );
        }
    }

    #[test]
    fn a_tampered_dir_name_in_the_database_never_escapes_the_managed_directory() {
        // ⚠⚠ §5 の多層防御を**出口側**（読み・削除）で表明する。
        // 保存する `dir_name` は id 由来なので通常この状態にはならないが、`managed_dir` は
        // 「DB から来た値をパスへ結合する直前」に立っている最後の砦なので、**それが実際に効くこと**を固定する。
        //
        // ⚠ 絶対パスを入れるのが最も強い検査: Rust の `Path::join` は**絶対パスを渡すと元のパスを捨てる**ので、
        // `managed_dir` の検証を外すと `root.join("/外部/victim")` が丸ごと外部パスになり、
        // **`remove_dir_all` が管理ディレクトリの外を消す**（＝任意ディレクトリ削除）。
        let managed = TempDir::new();
        let outside = TempDir::new();
        let victim_dir = outside.path().join("victim");
        assert!(std::fs::create_dir_all(&victim_dir).is_ok());
        assert!(std::fs::write(victim_dir.join("keep.txt"), b"keep").is_ok());
        let conn = conn();

        for (index, evil_dir_name) in [
            victim_dir.to_string_lossy().to_string(), // 絶対パス（join が元パスを捨てる）
            "../victim".to_string(),
            "..".to_string(),
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301/../../victim".to_string(),
        ]
        .into_iter()
        .enumerate()
        {
            let id = format!("3f2504e0-4f89-41d3-9a0c-0305e82c33{index:02}");
            let row = TemplateRow {
                id: id.clone(),
                name: "汚染された行".to_string(),
                dir_name: evil_dir_name.clone(),
                manifest_json: manifest_json("media.png", None),
                created_at: now_rfc3339(),
                updated_at: now_rfc3339(),
            };
            assert!(
                repository::insert(&conn, &row).is_ok(),
                "テスト用の汚染行を入れられない"
            );

            // 読めない（中身が返らない。⚠ 返ると任意ファイル読み取りになる）。
            let err = match read_media(managed.path(), &conn, &id) {
                Ok(m) => panic!("管理ディレクトリ外を読んだ: {evil_dir_name:?} -> {m:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::NotFound, "{evil_dir_name:?}");

            // 削除しても外部ディレクトリは消えない（DB 行だけが消える）。
            assert!(
                delete(managed.path(), &conn, &id).is_ok(),
                "汚染行の削除は成功する（行は消してよい）: {evil_dir_name:?}"
            );
            assert!(
                victim_dir.join("keep.txt").exists(),
                "⚠⚠ 管理ディレクトリ外を remove_dir_all で消した: {evil_dir_name:?}"
            );
        }

        assert!(managed.entries().is_empty(), "{:?}", managed.entries());
        assert!(list(&conn).unwrap_or_default().is_empty(), "汚染行が残っている");
    }

    #[test]
    fn a_tampered_manifest_in_the_database_cannot_widen_the_readable_file_set() {
        // ⚠ `manifest.media` は DB から来る値でもある。`managed_asset_path` の完全一致検査が
        //   出口側で効くこと（`is_managed_asset_name` を外すと任意ファイル読み取りになる）。
        let managed = TempDir::new();
        let outside = TempDir::new();
        outside.write("victim.png", &png_bytes());
        let conn = conn();

        let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301".to_string();
        let victim = outside.path().join("victim.png").to_string_lossy().to_string();
        for evil_media in [victim.as_str(), "../../victim.png", "main.png", "media.svg"] {
            let _ = repository::delete(&conn, &id);
            let row = TemplateRow {
                id: id.clone(),
                name: "汚染された行".to_string(),
                dir_name: id.clone(),
                // ⚠ `parse_manifest` は通る形にしておく（落ちる場所を `managed_asset_path` に絞るため）。
                manifest_json: manifest_json(&evil_media.replace('\\', "/"), None),
                created_at: now_rfc3339(),
                updated_at: now_rfc3339(),
            };
            assert!(repository::insert(&conn, &row).is_ok());
            assert!(
                read_media(managed.path(), &conn, &id).is_err(),
                "管理外のファイル名を読んだ: {evil_media:?}"
            );
        }
    }

    #[test]
    fn a_tampered_name_column_cannot_reach_the_frontend_unvalidated() {
        // ⚠ 061c security-review S-4。`to_record` は `manifest` 側の（検証済みの）`name` を使う。
        // `name` 列を直接書き換えても、frontend へ出るのは `parse_manifest` を通った値であること。
        let conn = conn();
        let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301".to_string();
        let row = TemplateRow {
            id: id.clone(),
            name: "列だけ書き換えた値\u{0}制御文字入り".to_string(),
            dir_name: id.clone(),
            manifest_json: manifest_json("media.png", None),
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };
        assert!(repository::insert(&conn, &row).is_ok());

        let listed = list(&conn).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].name, "きらきら",
            "⚠ 検証を通っていない `name` 列がそのまま frontend へ出ている"
        );
    }

    #[test]
    fn the_total_size_limit_is_also_enforced_when_the_media_is_read_back() {
        // ⚠⚠ 061c security-review S-5。MAX_TOTAL_BYTES の単位は「1 回のエフェクトで webview へ
        // 載る base64 の総量」＝**出口で確定する量**なので、入口だけで見ていると
        // ディスクを差し替えられたときに 6MiB が webview へ渡る。
        let media_len = MAX_MEDIA_BYTES as usize;
        let source = TempDir::new();
        source.write(
            "manifest.json",
            manifest_json("main.png", Some("s.wav")).as_bytes(),
        );
        source.write("main.png", &png_of(media_len));
        source.write("s.wav", &wav_bytes()); // 取り込み時は合計が上限内
        let managed = TempDir::new();
        let conn = conn();
        let record = match import_from_dir(managed.path(), &conn, &source.as_arg()) {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        assert!(read_media(managed.path(), &conn, &record.id).is_ok());

        // 管理ディレクトリの音源だけを差し替える（単体上限 2MiB は通るが、合計は 5MiB を超える）。
        let over = MAX_TOTAL_BYTES as usize - media_len + 1;
        assert!(over as u64 <= MAX_SOUND_BYTES, "単体上限は通る前提のテスト");
        let sound_path = managed.path().join(&record.id).join("sound.wav");
        if let Err(e) = std::fs::write(&sound_path, wav_of(over)) {
            panic!("テスト用の差し替えができない: {e}");
        }

        let err = match read_media(managed.path(), &conn, &record.id) {
            Ok(_) => panic!("⚠⚠ 合計上限を超えた data URI を webview へ渡した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);
    }

    // --- §9（エラーに第三者の文字列を載せない）--------------------------------------------------------

    #[test]
    fn errors_never_carry_the_template_name_or_the_full_path_back_to_the_caller() {
        let marker = "SECRET-MARKER-9f2b";
        let source = TempDir::new();
        // テンプレート名とアセット名の両方にマーカーを入れる。
        source.write(
            "manifest.json",
            manifest_json(&format!("../{marker}.png"), None)
                .replace("きらきら", marker)
                .as_bytes(),
        );
        let err = match read_import_source(&source.as_arg()) {
            Ok(_) => panic!("トラバーサル形の media を通した"),
            Err(e) => e,
        };
        let json = serde_json::to_string(&err).unwrap_or_default();
        assert!(!json.contains(marker), "エラーが入力を持ち帰っている: {json}");
        assert!(
            !json.contains(&source.path().to_string_lossy().to_string()),
            "フルパスが露出している: {json}"
        );
    }

    // --- 純関数（直接の担保）-----------------------------------------------------------------------

    #[test]
    fn only_single_file_names_are_accepted_as_template_assets() {
        for good in ["main.png", "きらきら.webm", "a-b_c.1.gif", "MAIN.PNG"] {
            assert!(is_template_asset_name(good), "正当な名前を拒否した: {good}");
        }
        for bad in [
            "",
            ".",
            "..",
            "../a.png",
            "a/b.png",
            "a\\b.png",
            "C:a.png",
            ".hidden.png",
            "a..b.png",
            "CON.png",
            "com1.PNG",
            "nul",
            "a\u{0}.png",
            "a\n.png",
            &"a".repeat(MAX_ASSET_NAME_CHARS + 1),
            // ⚠⚠ 061c security-review S-2。当初 22 件のリストから漏れていた予約デバイス名。
            // Windows で開くとデバイスに解決し、**開いた瞬間にハングしうる**（可用性）。
            "COM0.png",   // MS のファイル名規則は COM0 / LPT0 も挙げる
            "LPT0.png",
            "COM\u{00B9}.png", // 上付き 1（`to_ascii_uppercase` では吸収できない）
            "COM\u{00B2}.gif",
            "COM\u{00B3}.webp",
            "LPT\u{00B9}.png",
            "CONIN$.png",  // CreateFile が特別扱いするコンソールデバイス
            "CONOUT$.png",
            "CON .png",    // ⚠ Windows は名前部の末尾空白を除去してからデバイス判定する
            " CON.png",    // 念のため先頭空白も落とす（fail-closed）
            "com0.PNG",    // ASCII は大小無視
        ] {
            assert!(!is_template_asset_name(bad), "管理外の名前を通した: {bad:?}");
        }
    }

    #[test]
    fn only_uuid_named_directories_and_fixed_asset_names_are_treated_as_managed() {
        assert!(is_managed_dir_name("3f2504e0-4f89-41d3-9a0c-0305e82c3301"));
        assert!(is_managed_dir_name("3F2504E0-4F89-41D3-9A0C-0305E82C3301"));
        for bad in [
            "",
            "..",
            "../evil",
            "/etc",
            "C:\\evil",
            "sub/3f2504e0-4f89-41d3-9a0c-0305e82c3301",
            "3f2504e0-4f89-41d3-9a0c-0305e82c330",   // 1 文字短い
            "3f2504e0-4f89-41d3-9a0c-0305e82c33011", // 1 文字長い
            "3f2504e0_4f89-41d3-9a0c-0305e82c3301",  // 区切りが違う
            "3f2504e0-4f89-41d3-9a0c-0305e82c330g",  // 16 進でない
            "配信用",
        ] {
            assert!(!is_managed_dir_name(bad), "管理下と誤判定した: {bad:?}");
        }

        for good in ["media.png", "media.webm", "sound.wav", "sound.ogg"] {
            assert!(is_managed_asset_name(good), "管理下の名前を拒否した: {good}");
        }
        for bad in [
            "",
            "media",
            "media.svg",
            "media.wav",  // media 枠に音源の拡張子は入らない
            "sound.png",  // sound 枠に画像の拡張子は入らない
            "media.png.exe",
            "../media.png",
            "/etc/passwd",
            "main.png",
        ] {
            assert!(!is_managed_asset_name(bad), "管理下と誤判定した: {bad:?}");
        }
    }

    #[test]
    fn the_magic_byte_table_accepts_each_format_and_rejects_the_others() {
        let samples: [(AssetKind, Vec<u8>); 8] = [
            (AssetKind::Png, png_bytes()),
            (AssetKind::Apng, png_bytes()),
            (AssetKind::Gif, gif_bytes()),
            (AssetKind::Webp, webp_bytes()),
            (AssetKind::Webm, webm_bytes()),
            (AssetKind::Wav, wav_bytes()),
            (AssetKind::Mp3, mp3_bytes()),
            (AssetKind::Ogg, ogg_bytes()),
        ];
        for (kind, bytes) in &samples {
            assert!(kind.matches_magic(bytes), "{kind:?} の正常な先頭バイトを拒否した");
            assert!(!kind.matches_magic(b""), "{kind:?} が空バイト列を通した");
            assert!(
                !kind.matches_magic(b"<html><body>x</body></html>"),
                "{kind:?} が HTML を通した"
            );
        }
        // ⚠ APNG は PNG と**同一シグネチャ**（`acTL` は見ない＝安全性に関係しないため）。
        assert!(AssetKind::Apng.matches_magic(&png_bytes()));
        // ⚠ mp3 はフレーム同期でも通る（ID3 が無い実ファイルが存在するため）。
        assert!(AssetKind::Mp3.matches_magic(&[0xFF, 0xFB, 0x90, 0x00]));
        assert!(!AssetKind::Mp3.matches_magic(&[0xFF, 0x0B, 0x90, 0x00]));
    }

    // --- 契約テスト（ソース文字列で不変条件を固定する）---------------------------------------------

    const MOD_RS: &str = include_str!("mod.rs");
    const MODEL_RS: &str = include_str!("model.rs");
    const MANIFEST_RS: &str = include_str!("manifest.rs");
    const SERVICE_RS: &str = include_str!("service.rs");
    const REPOSITORY_RS: &str = include_str!("repository.rs");
    const COMMANDS_RS: &str = include_str!("commands.rs");

    /// `effect_template` モジュールの**本番コード**（コメントとテスト自身を除いたもの）。
    ///
    /// ⚠ この 2 段の除去が無いと契約テストは原理的に無意味になる（`overlay_theme` / `audio` の教訓）:
    /// - `include_str!` は自分自身も読むので、**禁止語をこのテストに書いた時点で自己ヒットする**
    ///   → `#[cfg(test)]` 以降を切り落とし、needle は `format!` で実行時に組む。
    /// - 禁止 API は「使わない理由」を doc コメントで説明したい → 行コメントを剥がしてから照合する。
    ///
    /// ⚠ `effect_template/` にファイルを足したら、ここの一覧にも足すこと
    /// （足し忘れは `the_contract_covers_every_file_in_the_module` が検出する）。
    fn production_sources() -> Vec<(&'static str, String)> {
        let test_marker = format!("#[cfg({})]", "test");
        [
            ("mod.rs", MOD_RS),
            ("model.rs", MODEL_RS),
            ("manifest.rs", MANIFEST_RS),
            ("service.rs", SERVICE_RS),
            ("repository.rs", REPOSITORY_RS),
            ("commands.rs", COMMANDS_RS),
        ]
        .into_iter()
        .map(|(name, raw)| {
            let head = raw.split(&test_marker).next().unwrap_or(raw);
            let code = head
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            (name, code)
        })
        .collect()
    }

    fn production_source(file: &str) -> String {
        production_sources()
            .into_iter()
            .find(|(name, _)| *name == file)
            .map(|(_, code)| code)
            .unwrap_or_else(|| panic!("effect_template/{file} が production_sources() の一覧に無い"))
    }

    fn assert_absent(needle: &str, why: &str) {
        for (name, code) in production_sources() {
            assert!(
                !code.contains(needle),
                "effect_template/{name} に {needle:?} が現れた。{why}"
            );
        }
    }

    /// ⚠ **needle は呼び出し側の「引数の変数名」まで含む**（`validate_source_dir(raw_dir)` 等）。
    /// 定義側と区別して**呼ばれていること**を固定するために必要だが、代償として
    /// **引数名を変えるだけのリファクタでもここが落ちる**。そのとき理由文だけを読むと
    /// 「検証が外された」と誤診断するので、**メッセージ側に「引数名を変えただけならテストの needle を直す」と
    /// 明記してある**（060b レビュー Q-2 の対処）。
    fn assert_present_in(file: &str, needle: &str, why: &str) {
        assert!(
            production_source(file).contains(needle),
            "effect_template/{file} から {needle:?} が消えた。{why}\n\
             ⚠ 呼び出し自体は残っていて**引数の変数名を変えただけ**なら、\
             検証は外れていない——このテストの needle を新しい変数名に合わせること。"
        );
    }

    #[test]
    fn the_contract_covers_every_file_in_the_module() {
        // ⚠ `production_sources()` は `include_str!` の手書き一覧なので、ファイルを足しても
        // 自動では検査対象に入らない。数を固定して、足した瞬間にここが落ちるようにする。
        // **落ちたら一覧にそのファイルを足すこと**（数だけ直して通してはいけない）。
        assert_eq!(
            production_sources().len(),
            6,
            "effect_template/ のファイル構成が変わった。production_sources() の一覧を確認すること"
        );
    }

    #[test]
    fn exposes_exactly_four_single_purpose_commands() {
        // §3: 汎用の読み書きコマンドを作らない。⚠ アプリ定義コマンドは ACL 対象外＝**全 5 窓から呼べる**。
        // 守っているのは数そのものではなく「**単一目的のコマンドしか無い・増やすときは必ずここが落ちる**」。
        let code = production_source("commands.rs");
        assert_eq!(
            code.matches(&format!("#[tauri::{}]", "command")).count(),
            4,
            "effect_template のコマンド数が 4 でない（増やすなら §3 の再評価と security-review が要る）"
        );
        // ⚠ ユーザーが選ぶフォルダはネットワークボリューム上にありうる。同期コマンドはメインスレッドで
        // 走るので、取り込みだけは非同期にして UI を止めない（overlay_theme と同じ判断）。
        // 他の 3 本は DB 操作か app_data_dir（常にローカル）配下の読み書きだけなので同期のまま。
        assert_eq!(
            code.matches(&format!("pub {} fn", "async")).count(),
            1,
            "取り込みコマンドが同期に戻された（遅い I/O でメインスレッドが止まる）"
        );
    }

    #[test]
    fn takes_no_arbitrary_path_or_content_from_the_frontend() {
        // §3 の禁止例（`write_file(path, content)` 型）を機械的に止める。
        let code = production_source("commands.rs");
        assert_eq!(
            code.matches(&format!("{}: String", "dir")).count(),
            1,
            "フォルダのパスを受け取るコマンドは import 1 本だけであること"
        );
        // ⚠⚠ **本文を受け取るコマンドは 1 本も無い**（060b は `css: String` を 3 本まで解禁しているが、
        // 061c は取り込み元がファイルだけなので本文を受け取る理由が無い）。
        // ⚠ 増やすときは §3 の再評価と security-review が要る（このテストが落ちること自体がその合図）。
        for banned in ["path", "content", "bytes", "data", "css", "media", "sound"] {
            assert!(
                !code.contains(&format!("{banned}: String")),
                "commands.rs が {banned}: String を受け取っている（汎用の読み書き経路になる）"
            );
        }
        assert_absent(
            &format!("Path{}", "Buf::from(raw"),
            "生の frontend 入力から直接パスを組み立てないこと（validate_source_dir を通す）。",
        );
    }

    #[test]
    fn the_storage_path_is_built_only_from_the_app_data_dir() {
        // §5: 保存先の組み立てにユーザー入力が結合されていないことを構造で固定する。
        let code = production_source("service.rs");
        assert_eq!(
            code.matches(&format!("app_data{}()", "_dir")).count(),
            1,
            "app_data_dir() を呼ぶ場所は effects_dir() の 1 か所だけであること"
        );
        assert_eq!(
            code.matches(&format!("{}(EFFECTS_DIR)", "join")).count(),
            1,
            "EFFECTS_DIR を結合する場所は effects_dir() の 1 か所だけであること"
        );
        assert_eq!(
            code.matches(&format!("root.{}(dir_name)", "join")).count(),
            1,
            "ディレクトリ名を結合する場所は managed_dir() の 1 か所だけであること"
        );
        assert_eq!(
            code.matches(&format!("template_dir.{}(file_name)", "join"))
                .count(),
            1,
            "管理下のファイル名を結合する場所は managed_asset_path() の 1 か所だけであること"
        );
        // ⚠⚠ **manifest 由来の名前をパスへ結合する場所は 1 か所だけ**（read_template_asset）。
        assert_eq!(
            code.matches(&format!("dir.{}(raw_name)", "join")).count(),
            1,
            "manifest 由来の名前を結合する場所は read_template_asset() の 1 か所だけであること"
        );
        assert_absent(
            &format!("{}(&manifest.name)", "join"),
            "§5: テンプレート名をパスへ結合しない（ディレクトリ名は id 由来）。",
        );
    }

    #[test]
    fn never_enumerates_the_source_directory() {
        // ⚠⚠ **「参照されているファイルだけコピーする」の構造的な担保。**
        // `manifest.json` を読み、`media` と `sound` を名指しで読むだけなので、
        // ディレクトリを列挙するコードは 1 行も要らない。ここが在ると
        // 「ついでに全部コピーする」実装がいつでも書ける状態になる。
        assert_absent(
            &format!("read_{}(", "dir"),
            "⚠⚠ 元ディレクトリを列挙しないこと（.html や実行ファイルが紛れ込む経路を作らない）。",
        );
        assert_absent(
            &format!("{}_entries(", "read"),
            "⚠ 同上（ディレクトリ列挙の別名 API も使わない）。",
        );
    }

    #[test]
    fn exactly_one_place_writes_and_one_place_removes() {
        // ⚠⚠ 「保存経路が 2 本に分かれて片方だけ緩む」形を構造的に作れなくする（060b の
        // `exactly_one_place_sanitizes_and_exactly_one_place_writes` と同じ発想）。
        // ⚠ needle を呼び出し形にせず**出現回数**で見るので、引数名のリファクタでは動かない。
        let code = production_source("service.rs");
        assert_eq!(
            code.matches(&format!("std::fs::{}(", "write")).count(),
            1,
            "ファイル書き込みが 1 か所でない（§5: 書けるのは write_managed_asset だけであること）"
        );
        assert_eq!(
            code.matches(&format!("std::fs::{}(", "remove_dir_all")).count(),
            1,
            "⚠⚠ 再帰削除が 1 か所でない（§5 で最も危険な操作。安全策 5 点は remove_managed_dir にある）"
        );
        // ⚠ 再帰削除の直前に「symlink ではない実ディレクトリ」を確認していること。
        assert_present_in(
            "service.rs",
            &format!("{}.file_type().is_symlink()", "metadata"),
            "⚠⚠ symlink 拒否／実ディレクトリ確認が外された。",
        );
    }

    #[test]
    fn every_validation_is_actually_wired_in() {
        // ⚠ 「禁止 API の不在」だけでは検証を**削除する**方向の退行を検出できない（audio レビューの教訓）。
        // 守りたい不変条件のうち「在ること」で表すものをここで固定する。
        assert_present_in(
            "service.rs",
            &format!("{}(raw_dir)", "validate_source_dir"),
            "取り込み元パスの検証（制御文字・UNC・実在・ディレクトリ）が外された（§7 / §8）。",
        );
        assert_present_in(
            "service.rs",
            &format!("manifest::{}(&manifest_text)", "parse_manifest"),
            "⚠⚠ manifest のスキーマ検証が外された（未知フィールド・範囲・差し込み変数）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(raw_name)", "is_template_asset_name"),
            "⚠⚠ 単一ファイル名規則が外された（パストラバーサルが成立する）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(dir_name)", "is_managed_dir_name"),
            "⚠⚠ 管理ディレクトリ名の検証が外された（remove_dir_all が外へ出る）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(file_name)", "is_managed_asset_name"),
            "管理下のファイル名の検証が外された（任意ファイル読み取りになる）。",
        );
        assert_present_in(
            "service.rs",
            &format!("kind.{}(&bytes)", "matches_magic"),
            "マジックバイト検査が外された（`.png` と名乗る HTML が素通りする）。",
        );
        // ⚠ `symlink_metadata` は 4 か所（manifest / 取り込み時のアセット / 読み出し時のアセット /
        // 再帰削除の直前）で使う。`metadata` へ戻す変異＝**リンクを辿る**変異なので、
        // **出現回数で固定する**（ミューテーションで実測: `is_symlink()` 分岐を消すだけでは
        // 振る舞いが変わらない＝ equivalent mutant で、壁になっているのはこの 1 語のほう）。
        assert_eq!(
            production_source("service.rs")
                .matches(&format!("std::fs::{}(", "symlink_metadata"))
                .count(),
            4,
            "⚠⚠ symlink_metadata の呼び出し数が変わった（`metadata` へ戻すとリンクを辿る＝管理外を読む）"
        );
        assert_present_in(
            "manifest.rs",
            &format!("{}(&text.template)", "validate_template_string"),
            "⚠⚠ 差し込み変数の allow-list が外された（`{text}` で本文を配信へ出せる）。",
        );
    }

    #[test]
    fn never_reaches_the_network_and_never_executes_third_party_code() {
        // §1: 本モジュールはローカルファイルの取り込みだけを行う。`manifest.json` に URL フィールドは無い。
        for banned in ["reqwest", "ureq", "TcpStream", "hyper::"] {
            assert_absent(banned, "§1: effect_template から外部通信を行わない。");
        }
        // 親 061 の決定: HTML / CSS / JS を受け付けない（第三者コードを実行しない）。
        for banned in ["Command::new", "std::process"] {
            assert_absent(banned, "第三者が同梱したファイルを実行しないこと。");
        }
    }

    #[test]
    fn has_no_panicking_paths_outside_the_shared_db_lock_idiom() {
        // ⚠ `commands.rs` の `db.lock().expect("db mutex poisoned")` は**リポジトリ全体の標準イディオム**で、
        // ここだけ別の書き方にする理由が無い。そこで**本番ロジックの 5 ファイルは panic 経路ゼロ**、
        // `commands.rs` はそのイディオムだけを許して出現数を固定する、という 2 段の形にしてある。
        let why = "effect_template の本番ロジックは panic 経路を持たない（全経路を AppResult に落とす）。";
        for file in ["mod.rs", "model.rs", "manifest.rs", "service.rs", "repository.rs"] {
            let code = production_source(file);
            for needle in [
                format!("unwrap{}", "()"),
                format!(".{}(", "expect"),
                format!("{}!(", "panic"),
                format!("{}!(", "unreachable"),
                format!("{}!(", "todo"),
            ] {
                assert!(
                    !code.contains(needle.as_str()),
                    "effect_template/{file} に {needle:?} が現れた。{why}"
                );
            }
        }
        let commands = production_source("commands.rs");
        let expects = commands.matches(&format!(".{}(", "expect")).count();
        let db_lock_expects = commands
            .matches(&format!(".{}(\"db mutex poisoned\")", "expect"))
            .count();
        assert_eq!(
            expects, db_lock_expects,
            "commands.rs に DbState の標準イディオム以外の expect が現れた。{why}"
        );
        let command_count = commands.matches(&format!("#[tauri::{}]", "command")).count();
        assert!(
            db_lock_expects <= command_count,
            "commands.rs の expect がコマンド数を超えた（1 コマンドで複数回ロックを取っていないか）"
        );
        assert_eq!(
            commands.matches(&format!("unwrap{}", "()")).count(),
            0,
            "commands.rs に unwrap() が現れた"
        );
    }

    #[test]
    fn the_import_reads_its_files_before_taking_the_db_lock() {
        // ⚠ 060b security-review 指摘と同じ理由。ユーザーが選ぶフォルダはネットワークボリューム上に
        // ありうるので、DB ロックの内側で読むと**アプリ全体の DB コマンドが止まる**。
        // この順序は目で見ないと分からないので、ソース上の出現順で固定する。
        let code = production_source("commands.rs");
        let read_at = code.find(&format!("{}(&dir", "service::read_import_source"));
        let lock_at = code.find(&format!("db.{}()", "lock"));
        match (read_at, lock_at) {
            (Some(read_at), Some(lock_at)) => assert!(
                read_at < lock_at,
                "取り込みのファイル読み込みが DB ロックの内側に入った（遅い I/O が全 DB コマンドを止める）"
            ),
            _ => panic!("commands.rs から read_import_source / db.lock の呼び出しが見つからない"),
        }
    }

    #[test]
    fn the_manifest_never_gains_a_url_field() {
        // §1: **外部取得の経路を最初から作らない**という親 061 の決定を、形式レベルで固定する。
        // ⚠ `manifest.json` に URL を書ける形が入ると、それを取りに行くコードは 1 行で足せてしまう。
        let code = production_source("model.rs");
        for banned in ["url: ", "href: ", "src: ", "endpoint: "] {
            assert!(
                !code.contains(banned),
                "model.rs に {banned:?} が現れた。manifest に URL フィールドを作らないこと（§1）"
            );
        }
    }
}
