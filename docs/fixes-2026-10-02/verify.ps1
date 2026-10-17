param([switch]$UseCachedNet8References)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $taskRoot
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot 'bin/dotnet-home'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$taskBuildArgs = @()
$taskRestoreArgs = @('-p:NuGetAudit=false')
if ($UseCachedNet8References) {
    $taskPackages = Join-Path $env:USERPROFILE '.nuget/packages'
    if (-not (Test-Path -LiteralPath (Join-Path $taskPackages 'microsoft.netcore.app.ref/8.0.20'))) {
        throw '本机不存在 .NET 8.0.20 缓存，请使用普通 .NET restore/build。'
    }
    $taskTargets = Join-Path $PSScriptRoot 'bin/cached-framework.targets'
    New-Item -ItemType Directory -Force -Path (Split-Path $taskTargets) | Out-Null
    '<Project><ItemGroup><KnownFrameworkReference Update="@(KnownFrameworkReference)" TargetingPackVersion="8.0.20" /></ItemGroup></Project>' | Set-Content -LiteralPath $taskTargets -Encoding utf8
    $taskBuildArgs = @('-p:UseAppHost=false', "-p:CustomBeforeMicrosoftCommonTargets=$taskTargets")
    $taskRestoreArgs += @('--source', $taskPackages, "-p:RestorePackagesPath=$taskPackages")
}
node --experimental-vm-modules docs/fixes-2026-10-02/client-regression.cjs
if ($LASTEXITCODE -ne 0) { throw '客户端回归失败' }
dotnet restore docs/fixes-2026-10-02/server-regression.csproj @taskRestoreArgs @taskBuildArgs
if ($LASTEXITCODE -ne 0) { throw '.NET 还原失败' }
dotnet build server/EmojiDelta.Server.csproj --no-restore @taskBuildArgs
if ($LASTEXITCODE -ne 0) { throw '服务端构建失败' }
dotnet run --project docs/fixes-2026-10-02/server-regression.csproj --no-restore @taskBuildArgs
if ($LASTEXITCODE -ne 0) { throw '服务端回归失败' }
