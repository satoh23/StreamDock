import type { Provider } from "../../provider.js";

/**
 * refresh 処理だけに絞った依存境界。
 * `RefreshAccessTokenUsecase` 全体ではなく必要な操作だけに依存し、差し替え可能な設計にしてテストしやすくする。
 */
export interface RefreshAccessTokenPort {
  refresh(provider: Provider): Promise<string>;
}
