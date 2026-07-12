/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 027: "true" で完了フラグを無視し毎起動チュートリアルを表示（開発用・`.env.local`）。 */
  readonly VITE_SHOW_TUTORIAL?: string;
}
