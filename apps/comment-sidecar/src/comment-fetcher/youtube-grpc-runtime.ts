// 032c-d コミット2: YouTube streamList 用の StreamListRuntime を、**SEA 対応（proto-under-SEA）**と
// **gRPC チャネルガード（§1 二層 fail-closed の(b)）**を付けて構築する。
//
// - proto-under-SEA（スパイク1）: SEA 単一実行ファイルでは隣接 `stream_list.proto` を実ファイルとして読めない。
//   proto を文字列同梱（stream-list-proto.ts）→起動時に OS の一時ディレクトリへ一度だけ書き出し→その一時
//   パスを `loadSync` に渡す（`import.meta.url` 依存を排除。開発/SEA の双方で同一経路）。
// - gRPC チャネルガード: gRPC は `fetch`/`ws` を通らないため host-guard を独立に適用する。channel 生成前に
//   `assertAllowedGrpcTarget(target)` で www.googleapis.com:443 のみ許可（それ以外は throw）。
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STREAM_LIST_PROTO } from "../../vendor/comment-fetcher/src/adapters/youtube/client/stream-list-proto.js";
import type { StreamListRuntime } from "../../vendor/comment-fetcher/src/adapters/youtube/client/api.client.js";
import { assertAllowedGrpcTarget } from "../host-guard.js";

// proto を一時ファイルへ展開したパス（プロセス内で一度だけ書き出してキャッシュする）。
let cachedProtoPath: string | null = null;

// 一時ファイルのクリーンアップ（unlink）は敢えて行わない。意図と安全性:
//  - 書き出す内容は STREAM_LIST_PROTO（gRPC スキーマ定義）で、**ユーザーデータでも秘密でもない**（§9 の対象外・
//    OS 一時領域への scratch 書込に過ぎない）。
//  - cachedProtoPath メモ化により **1 sidecar 起動につき小さな .proto を 1 個だけ**書く。書込先は mkdtempSync が
//    作る一意ディレクトリ（既定 0700・他ユーザーから読めない）で、掃除は OS の一時領域清掃に委ねる。
//  どうなったら修正検討: proto に機微情報が載る／sidecar を高頻度で再起動して temp が肥大する運用が出てきたら、
//  process.on("exit") で rmSync するか固定パス上書きに寄せる（現状は非機密・1 プロセス 1 個のため据え置き）。
function ensureProtoFile(): string {
  if (cachedProtoPath !== null) {
    return cachedProtoPath;
  }
  const dir = mkdtempSync(join(tmpdir(), "streamdock-yt-grpc-"));
  const protoPath = join(dir, "stream_list.proto");
  writeFileSync(protoPath, STREAM_LIST_PROTO, "utf8");
  cachedProtoPath = protoPath;
  return protoPath;
}

// DI に注入するガード付き runtime。api.client.ts はこの getProtoPath / createClient を経由する。
export const guardedStreamListRuntime: StreamListRuntime = {
  loadSync: protoLoader.loadSync,
  loadPackageDefinition: grpc.loadPackageDefinition,
  createSsl: grpc.credentials.createSsl,
  Metadata: grpc.Metadata,
  getProtoPath: ensureProtoFile,
  createClient: (ServiceCtor, target, credentials) => {
    // fail-closed: www.googleapis.com:443 以外の gRPC target は接続前に throw する。
    assertAllowedGrpcTarget(target);
    return new ServiceCtor(target, credentials) as grpc.Client;
  },
};

/**
 * proto-under-SEA の gate（スパイク1）。起動時に proto を一時展開して `loadSync`→`loadPackageDefinition`
 * が通ることを確認する（実ネットワークは張らない）。SEA でここが失敗するなら proto 同梱方式の見直しが必要。
 */
export function selfCheckStreamListProto(): { ok: boolean; error?: string } {
  try {
    const packageDefinition = protoLoader.loadSync(ensureProtoFile(), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    grpc.loadPackageDefinition(packageDefinition);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
