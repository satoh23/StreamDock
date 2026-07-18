import type { Provider } from "../provider.js";

export type AuthorizationLostEvent = {
  provider: Provider;
  reason: string;
  occurredAt: number;
  cause?: unknown;
};

export type AuthorizationLostListener = (event: AuthorizationLostEvent) => void;

/**
 * refresh 失敗などの認可喪失イベントを auth 内部で中継する軽量 notifier。
 * listener 登録機構をこの小さな実装に閉じ、単体テストではインスタンスを DI で差し替える。
 */
export class AuthorizationLostNotifier {
  private readonly listeners = new Set<AuthorizationLostListener>();

  /**
   * 通知先の関数を登録する。
   * 戻り値の関数を呼ぶと、その通知先を登録解除する。
   */
  subscribe(listener: AuthorizationLostListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 登録済みの通知先すべてに、同じイベントを順番に渡す。
   */
  emit(event: AuthorizationLostEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
