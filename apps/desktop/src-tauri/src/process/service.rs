use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::tools::model::Tool;

use super::model::LaunchToolResult;

/// 登録済み Tool の executablePath を検証し、shell を経由せず直接プロセスを起動する。
///
/// 検証項目（007）:
/// - executablePath が空でない
/// - 絶対パスである
/// - 実在する
/// - ディレクトリでない
/// - `.lnk` / `.bat` ではない（007 では非対応）
pub fn launch(tool: &Tool) -> AppResult<LaunchToolResult> {
    let path_str = tool.executable_path.trim();
    if path_str.is_empty() {
        return Err(AppError::Validation("実行ファイルパスが未設定です".into()));
    }

    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Validation(
            "実行ファイルパスが絶対パスではありません".into(),
        ));
    }
    if !path.exists() {
        return Err(AppError::PathNotFound(format!(
            "指定された実行ファイルが見つかりません: {path_str}"
        )));
    }

    // macOS の `.app` はバンドル＝ディレクトリだが、LaunchServices（`open`）経由で起動できる
    // 唯一の正規なアプリ実体。そのため `.app` バンドルだけは「起動可能」として扱い、
    // それ以外のディレクトリは従来どおり拒否する。Windows/Linux では常に false。
    #[cfg(target_os = "macos")]
    let is_app_bundle = path.is_dir()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("app"));
    #[cfg(not(target_os = "macos"))]
    let is_app_bundle = false;

    if path.is_dir() && !is_app_bundle {
        return Err(AppError::Validation(
            "指定されたパスはディレクトリです".into(),
        ));
    }

    // TODO(009+): 拒否対象が .lnk / .bat の2種のみ。
    //   現状の実装理由 / 意図: 007 仕様が「.lnk / .bat を起動対象にしない」と明示しており、
    //     スコープを最小化するため仕様どおり2種だけ拒否している。
    //   考慮すべき修正: .cmd も .bat と同様にコマンドインタプリタ経由で実行される（取りこぼし）。
    //     将来 spawn に引数を渡す実装を入れる際は .cmd を拒否リストへ追加するか、
    //     .exe / .app 等の「許可リスト方式」へ転換する（拒否リストは取りこぼしが起きやすいため）。
    // 007 では .lnk（ショートカット）/ .bat（バッチ）を起動対象にしない。
    // `.app` バンドルは上で起動可能と判定済みなので、この拒否チェックは通常ファイル経路のみに適用する。
    if !is_app_bundle {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if matches!(ext.as_deref(), Some("lnk") | Some("bat")) {
            return Err(AppError::Validation(
                "この形式のファイルは現在起動に対応していません".into(),
            ));
        }
    }

    // TODO(将来): 上の exists / is_dir 検証と、下の spawn の間にはパスが差し替わる TOCTOU の隙間がある。
    //   現状の実装理由 / 意図: 本アプリは単一ユーザー・権限昇格なし（起動プロセスもユーザー権限）で、
    //     パスは本人が Tool 登録した値。ここでの検証は権限境界のガードではなく「起動前の妥当性チェック」と
    //     割り切っており、実害のある攻撃面ではないため検証と起動をアトミックにしていない。
    //   考慮すべき修正: ネットワーク越し登録・共有 DB・マルチユーザー化が入ったら、
    //     開いた fd 経由の実行など検証と起動をアトミックに扱う方式を再検討する。

    // shell を経由せず executablePath を直接起動する。
    // 起動失敗の詳細（OS エラー文字列）は環境情報を含みうるため露出させず、固定メッセージに丸める。
    //
    // TODO(009): ここで得た `child`（std::process::Child）を保持せず、関数を抜けると drop している。
    //   現状の実装理由 / 意図: 007 の責務は「起動して PID を返す」だけで、停止・監視は 009 以降。
    //     Rust は Child を drop しても kill も wait もしないため、起動したプロセスはそのまま生き続ける
    //     （＝単体起動としては意図どおりの挙動）。
    //   考慮すべき修正:
    //     (1) PID 数値だけを返すと、対象プロセス終了後に OS が同じ PID を別プロセスへ再利用した場合、
    //         009 の停止処理が無関係なプロセスを kill する恐れがある。009 では Child ハンドル自体を
    //         State に保持するか、起動時刻＋実行ファイルパスでの本人性照合を併用し、
    //         security.md §6（stream-dock が起動した PID のみ停止）を厳密に満たす。
    //     (2) Child を wait しないため、Unix では子プロセス終了後にゾンビが残り得る。
    //         009 で try_wait() 等のリープ方針を併せて決める。
    //     (3) macOS の `.app` は下記のとおり `/usr/bin/open` 経由で起動するため、返る PID は
    //         起動した実アプリではなく即座に終了する `open` ヘルパのもの。009 の停止処理では
    //         この PID を停止対象に使えないので、macOS では実アプリ PID を別途取得する方式
    //         （open 前後の LaunchServices 差分・起動時刻＋バンドルパス照合・`open -W` 系の再設計など）
    //         を検討する。007 の要件「起動成功時に PID を取得できる」は満たすが値の質は 009 で見直す。
    //
    // TODO(将来/ハードニング): spawn した子プロセスは stream-dock の環境変数・stdio・cwd を継承する。
    //   現状の実装理由 / 意図: 本人権限で本人のツールを起動する MVP のため、継承で許容している。
    //   考慮すべき修正: 情報分離を強めるなら .env_clear() や
    //     .stdin/.stdout/.stderr(Stdio::null()) での分離を検討する。
    let child = if is_app_bundle {
        // macOS の `.app` はバンドルを直接 exec できないため、固定の絶対パス `/usr/bin/open` に
        // バンドルパスを配列引数（文字列連結なし・shell 非経由）で渡して LaunchServices 起動する。
        Command::new("/usr/bin/open")
            .arg(path)
            .spawn()
            .map_err(|_| AppError::LaunchFailed("プロセスの起動に失敗しました".into()))?
    } else {
        Command::new(path)
            .spawn()
            .map_err(|_| AppError::LaunchFailed("プロセスの起動に失敗しました".into()))?
    };

    Ok(LaunchToolResult {
        tool_id: tool.id.clone(),
        process_id: child.id(),
        started_at: chrono::Utc::now().to_rfc3339(),
    })
}
