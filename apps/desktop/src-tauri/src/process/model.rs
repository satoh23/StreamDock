use serde::Serialize;
use ts_rs::TS;

/// Tool 単体起動の結果（API 戻り値）。JSON は camelCase。
/// 007 では processId を返すのみ（起動記録の永続化は 009 以降）。
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct LaunchToolResult {
    pub tool_id: String,
    // TODO(009): PID 数値のみでは PID 再利用により停止対象を誤る恐れがある（詳細は service::launch の spawn 箇所）。
    //   現状の実装理由 / 意図: 007 は起動結果として PID を返すだけ（停止・永続化は 009 以降）。
    //   考慮すべき修正: 009 の停止処理では Child ハンドル保持、または起動時刻＋パスでの本人性照合を併用する。
    //   また macOS の `.app` は `/usr/bin/open` 経由で起動するため、この値は実アプリではなく
    //   即座に終了する `open` ヘルパの PID になる。009 では macOS で実アプリ PID を取得する方式を要検討。
    pub process_id: u32,
    pub started_at: String,
}
