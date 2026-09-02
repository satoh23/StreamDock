# 099a: Windows のコード署名を **tauri のバンドル過程の中で** 行うためのラッパー。
#
# ## なぜラッパーが要るのか（tauri.conf.json から直接ツールを呼ばない理由）
#
# `bundle.windows.signCommand` は **tauri.conf.json に書いた文字列がそのまま実行される**。つまり:
#
#   1. あのファイルは**コミットされる**ので、資格情報を書くとリポジトリに混ざる。
#   2. さらに NSIS のアンインストーラ署名は、この署名コマンド文字列を `installer.nsi` の
#      `!define UNINSTALLERSIGNCOMMAND "..."` に**埋め込んでから** makensis に実行させる
#      （tauri-bundler の `windows/nsis/mod.rs`）。＝ 生成物の中間ファイルにも残る。
#
# ⇒ **資格情報は env（GitHub Secrets 由来）からしか渡さない**。ここがその受け口。
#    署名ツール（jsign）は `--storepass env:<変数名>` / `--keypass env:<変数名>` を公式サポートしており、
#    **パスワードと TOTP シークレットはコマンド行に一度も現れない**（`--alias`＝証明書 ID だけは引数になる。
#    ランナー内のプロセス引数に留まり、ログには出さない）。
#
# ## なぜ「署名しない」分岐が要るのか
#
# `signCommand` を設定した時点で tauri は `can_sign() == true` と判断し、**Secrets の有無に関係なく**
# このスクリプトを呼ぶ（`bundle/settings.rs`）。一方 README は「**Secrets 未設定なら未署名で配布**」を約束している。
# Tauri 公式の `--no-sign` は使えない——あれは **updater の minisign 署名まで止める**ため
# （`tauri-cli/src/bundle.rs` の `sign_updaters`）、`.exe.sig` が生成されず `Verify updater artifacts` が落ちる。
# ⇒ 「署名するかどうか」の判断は**このスクリプトが持つ**（`STREAMDOCK_WINDOWS_SIGNING`）。
#
# ## fail-closed
#
# tauri は署名コマンドの**終了コードだけ**を見て成否を判断する（`utils/mod.rs` の `output_ok`）。
# なので「署名すべき状況で署名できなかった」ときは**必ず非ゼロで終わる**こと。具体的には:
#
#   - 署名が有効なのに必須 env が欠けている        → exit 1（設定ミスを未署名で通さない）
#   - jsign が非ゼロで終わった                      → exit 1
#   - 署名後の `signtool verify /pa` が通らない      → exit 1（保険。署名したつもりで壊れている状態を出荷しない）
#
# 逆に「署名が無効」は**設定どおりの正常系**なので exit 0（未署名のまま続行）。
#
# ## 呼ばれる回数（1 ビルドあたり約 9 回）
#
# tauri は installer だけでなく、sidecar（`comment-sidecar-*.exe`）・本体 `StreamDock.exe`・
# NSIS プラグイン DLL 5 本・アンインストーラにも署名する。**`.exe` 1 本だけではない**。
#
# ## 呼ばれ方
#
#   pwsh -NoProfile -File scripts/sign-windows.ps1 <署名対象の絶対パス>
#
# ⚠⚠⚠ **この相対パスの基準は `src-tauri`（＝ tauri.conf.json のあるディレクトリ）**であって、
#   tauri-action に渡す `projectPath`（`apps/desktop`）ではない。tauri CLI は build の途中で
#   **`set_current_dir(dirs.tauri)`** を呼び、`src-tauri` へ移動してからバンドルするため
#   （`tauri-cli/src/build.rs`）。⇒ **本スクリプトは `src-tauri/scripts/` に置くこと。**
#   `frontendDist` / `icon` / `externalBin` と同じ「tauri.conf.json からの相対」で揃う。
#   ⚠ 最初 `apps/desktop/scripts/` に置いて CI が落ちた（2026-09-01・pwsh がファイルを開けない）。
#   なお実在する相対パスは tauri 側が**絶対パスへ変換**してから渡すので、別 cwd で走る
#   アンインストーラ署名（`!uninstfinalize`）でも壊れない。
#
# ## 使う env（すべて release.yml が Windows レグにだけ渡す）
#
#   STREAMDOCK_WINDOWS_SIGNING … '1' のときだけ署名する。それ以外は何もせず成功で返す
#   JSIGN_JAR                  … jsign の jar への絶対パス（release.yml が SHA-256 検証して配置する）
#   ES_USERNAME / ES_PASSWORD  … SSL.com アカウント
#   CREDENTIAL_ID              … eSigner の署名資格情報（証明書）ID
#   ES_TOTP_SECRET             … 自動署名用の TOTP シークレット
#
# ⚠ このスクリプトは**秘密を一切出力しない**。tauri は署名コマンドの stdout を `log::info!` で
#   そのまま CI ログへ流すため（`windows/sign.rs` の `sign_custom`）。
#   ⚠⚠ 逆に**失敗したときは stdout ごと捨てられる**（`output_ok` が Err を返し `failed to run pwsh` だけが残る）。
#   ⇒ 失敗の理由は GitHub Actions の**ジョブサマリ**にも書く（下の `Fail`）。

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ⚠ PowerShell 7.4 以降は、既定でネイティブコマンドの非ゼロ終了が $ErrorActionPreference='Stop' に従って
#   **例外**になる。そうなると下の `if ($LASTEXITCODE -ne 0)` に到達せず、こちらの説明的なエラーではなく
#   PowerShell の一般的な例外だけが残る（終了コードは非ゼロなので fail-closed 自体は保たれる）。
#   バージョン差で挙動が変わるのを避けるため、明示的に「終了コードで自分で判定する」側に倒す。
$PSNativeCommandUseErrorActionPreference = $false

function Write-Log([string] $message) {
    Write-Host "[sign-windows] $message"
}

function Fail([string] $message, [string] $detail = '') {
    # ⚠ `::error::` は 1 行しか扱えないので、注釈用は改行を畳む。
    Write-Host "::error::[sign-windows] $($message -replace "`r?`n", ' / ')"

    # ⚠⚠ tauri は署名コマンドが**失敗したときだけ** stdout を捨てる（`utils/mod.rs` の `output_ok` は
    #   非ゼロ終了で Err を返し、`failed to run pwsh` しか残さない。stdout の中身は既定の verbosity では出ない）。
    #   ＝ **失敗の理由が CI ログに残らない**。そこで GitHub Actions のジョブサマリへも書く（こちらは残る）。
    #   ⚠⚠⚠ **署名ツールの出力もここに入れる**——これが無いと「jsign が exit 1」までしか分からず、
    #     認証・OTP・証明書のどれが原因なのか切り分けられない（2026-09-02 に実際に困った）。
    if ($env:GITHUB_STEP_SUMMARY) {
        $lines = @("### ⚠ sign-windows.ps1", "", $message)
        if ($detail) {
            $lines += @("", '```', $detail, '```')
        }
        $lines | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
    }

    exit 1
}

# --- 1. 署名が無効なら何もしない（未署名ビルドは設計どおりの正常系） --------------------------------
if ($env:STREAMDOCK_WINDOWS_SIGNING -ne '1') {
    Write-Log "署名は無効（STREAMDOCK_WINDOWS_SIGNING != '1'）。未署名のまま続行する: $FilePath"
    exit 0
}

if (-not (Test-Path -LiteralPath $FilePath)) {
    Fail "署名対象が見つからない: $FilePath"
}

# --- 2. 必須 env の検査（欠けていたら落とす＝未署名で素通りさせない） ------------------------------
$missing = @(
    'JSIGN_JAR', 'ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET' |
        Where-Object { [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($_)) }
)

if ($missing.Count -gt 0) {
    Fail "署名が有効なのに必須の環境変数が空: $($missing -join ', ')"
}

if (-not (Test-Path -LiteralPath $env:JSIGN_JAR)) {
    Fail "JSIGN_JAR が指す jar が無い: $($env:JSIGN_JAR)"
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Fail "java が PATH に無い（jsign の実行に必要）"
}

# --- 3. 署名（SSL.com eSigner のクラウド HSM。ローカルからはハッシュしか出ない） ------------------
# `--replace`: 二重署名を作らず常に単一の署名にする（tauri は同じファイルに署名し直すことがある）。
# `--tsaurl` + `--tsmode RFC3161`: SSL.com の TSA。tauri.conf.json 側の timestampUrl / digestAlgorithm は
#   `signCommand` があると **一切参照されない**ので、設定を二重に持たずここで指定する。
try {
    # storepass は "ユーザー名|パスワード" 形式。**env 経由でしか渡さない**ためここで組み立てる
    # （release.yml 側に結合値を作らない・コマンド行にも出さない）。
    $env:JSIGN_STOREPASS = "$($env:ES_USERNAME)|$($env:ES_PASSWORD)"

    Write-Log "署名する: $FilePath"
    # ⚠ 出力は**捨てずに受け取る**。失敗したときに理由をジョブサマリへ載せるため（上の `Fail` を参照）。
    $output = (& java -jar $env:JSIGN_JAR `
        --storetype ESIGNER `
        --storepass 'env:JSIGN_STOREPASS' `
        --keypass 'env:ES_TOTP_SECRET' `
        --alias $env:CREDENTIAL_ID `
        --tsaurl 'http://ts.ssl.com' `
        --tsmode RFC3161 `
        --alg SHA-256 `
        --name 'StreamDock' `
        --replace `
        $FilePath 2>&1 | Out-String).Trim()
    $jsignExit = $LASTEXITCODE

    if ($output) { Write-Host $output }

    if ($jsignExit -ne 0) {
        Fail "jsign が失敗した（exit $jsignExit）: $FilePath" $output
    }
}
finally {
    Remove-Item Env:JSIGN_STOREPASS -ErrorAction SilentlyContinue
}

# --- 4. 保険: 署名が本当に載ったかを signtool で検証する -------------------------------------------
# jsign は終了コードを正しく返すのでここは二重の確認だが、「署名したつもりで壊れている」を
# public 側へ出さないための最後の関門なので、**通らなければ落とす**。
# signtool は Windows SDK 同梱（windows-latest には在る）。tauri 自身も sidecar の署名済み判定に使うため、
# 無い環境ではどのみちビルドが通らない。
$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" `
    -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1

if (-not $signtool) {
    Fail "signtool.exe が見つからない（署名の検証ができない）"
}

$verifyOutput = (& $signtool.FullName verify /pa $FilePath 2>&1 | Out-String).Trim()
$verifyExit = $LASTEXITCODE
if ($verifyExit -ne 0) {
    Fail "署名の検証に失敗した（signtool verify /pa が exit $verifyExit）: $FilePath" $verifyOutput
}

Write-Log "署名と検証に成功: $FilePath"
exit 0
