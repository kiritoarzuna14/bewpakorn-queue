$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'native\bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$package = Join-Path $env:TEMP 'bewpakorn-webview2-1.0.3537.50.nupkg'
Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.3537.50' -OutFile $package
if ((Get-FileHash $package -Algorithm SHA256).Hash -ne '5EA526BBD728ADDA0DA4D31219267E96460494A427E4894C4E09D9F320F4B9AA') { throw 'WebView2 package hash mismatch' }
$extract = Join-Path $env:TEMP ('bewpakorn-webview-' + [Guid]::NewGuid().ToString('N'))
try {
  $zip = "$extract.zip"; Copy-Item $package $zip; Expand-Archive $zip $extract
  Copy-Item "$extract\lib\net462\Microsoft.Web.WebView2.Core.dll", "$extract\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$extract\runtimes\win-x64\native\WebView2Loader.dll" $bin -Force
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  & $csc /nologo /target:exe /platform:x64 /optimize+ /out:"$bin\BewpakornQueueHost.exe" /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$bin\Microsoft.Web.WebView2.Core.dll" /r:"$bin\Microsoft.Web.WebView2.WinForms.dll" "$root\native\Host.cs" "$root\native\Login.cs"
  if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
  & "$bin\BewpakornQueueHost.exe" --self-test
  if ($LASTEXITCODE -ne 0) { throw 'Native self-test failed' }
  Write-Host 'Native host built and self-test passed.'
} finally { Remove-Item -LiteralPath $extract, "$extract.zip" -Recurse -Force -ErrorAction SilentlyContinue }
