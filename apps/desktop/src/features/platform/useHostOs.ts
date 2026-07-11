import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** ホスト OS 名（Rust `std::env::consts::OS` 由来。判定不能時は null）。 */
export type HostOs = "macos" | "windows" | "linux" | string | null;

/**
 * 021: カスタムタイトルバーの出し分けに使うホスト OS を Rust `host_os` コマンドから一度だけ取得する。
 * macOS はネイティブ信号機を避ける左余白、Windows は自作 min/max/close の表示に用いる。
 */
export function useHostOs(): HostOs {
  const [hostOs, setHostOs] = useState<HostOs>(null);

  useEffect(() => {
    let active = true;
    invoke<string>("host_os")
      .then((os) => {
        if (active) setHostOs(os);
      })
      .catch(() => {
        // 取得失敗時は null のまま（信号機余白なし・制御ボタン非表示にフォールバック）。
      });
    return () => {
      active = false;
    };
  }, []);

  return hostOs;
}
