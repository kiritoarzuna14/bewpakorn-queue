$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'native\bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$package = Join-Path $env:TEMP 'bewpakorn-webview2-1.0.3537.50.nupkg'
if (!(Test-Path $package) -or (Get-FileHash $package -Algorithm SHA256).Hash -ne '5EA526BBD728ADDA0DA4D31219267E96460494A427E4894C4E09D9F320F4B9AA') { Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.3537.50' -OutFile $package }
if ((Get-FileHash $package -Algorithm SHA256).Hash -ne '5EA526BBD728ADDA0DA4D31219267E96460494A427E4894C4E09D9F320F4B9AA') { throw 'WebView2 package hash mismatch' }
$extract = Join-Path $env:TEMP ('bewpakorn-webview-' + [Guid]::NewGuid().ToString('N'))
try {
  $zip = "$extract.zip"; Copy-Item $package $zip; Expand-Archive $zip $extract
  Copy-Item "$extract\lib\net462\Microsoft.Web.WebView2.Core.dll", "$extract\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$extract\runtimes\win-x64\native\WebView2Loader.dll" $bin -Force
  Copy-Item "$extract\LICENSE.txt" (Join-Path $bin "WebView2-LICENSE.txt") -Force
  Copy-Item "$extract\NOTICE.txt" (Join-Path $bin "WebView2-NOTICE.txt") -Force
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  & $csc /nologo /codepage:65001 /target:exe /platform:x64 /optimize+ /out:"$bin\BewpakornQueueHost.exe" /r:System.Web.Extensions.dll /r:System.Web.dll /r:System.Management.dll /r:System.Security.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$bin\Microsoft.Web.WebView2.Core.dll" /r:"$bin\Microsoft.Web.WebView2.WinForms.dll" "$root\native\Host.cs" "$root\native\Login.cs" "$root\native\LoginFormScripts.cs" "$root\native\Pools.cs" "$root\native\Launch.cs" "$root\native\LaunchTests.cs" "$root\native\SelfTests.cs"
  if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
  & "$bin\BewpakornQueueHost.exe" --self-test
  if ($LASTEXITCODE -ne 0) { throw 'Native self-test failed' }
  Write-Host 'Native host built and self-test passed.'
} finally {
  $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $target = [IO.Path]::GetFullPath($extract)
  if (!$target.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notmatch '^bewpakorn-webview-[0-9a-f]{32}$') { throw 'Unsafe temporary extraction path' }
  if (Test-Path -LiteralPath $target) {
    $resolved = (Resolve-Path -LiteralPath $target).Path
    if ($resolved -ne $target -or ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe resolved extraction path' }
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  if (Test-Path -LiteralPath "$target.zip") { Remove-Item -LiteralPath "$target.zip" -Force }
}

