$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$testDirectory=Join-Path $root 'work-login-surface'
New-Item -ItemType Directory -Force $testDirectory | Out-Null
$bin=Join-Path $root 'native\bin'
foreach($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){Copy-Item -LiteralPath (Join-Path $bin $file) -Destination $testDirectory -Force}
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /codepage:65001 /target:exe /platform:x64 /out:"$testDirectory\LoginSurface.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$bin\Microsoft.Web.WebView2.Core.dll" /r:"$bin\Microsoft.Web.WebView2.WinForms.dll" "$root\tests\native\LoginSurface.cs" "$root\native\LoginFormScripts.cs"
if($LASTEXITCODE -ne 0){throw 'Surface test compilation failed'}
& "$testDirectory\LoginSurface.exe"
if($LASTEXITCODE -ne 0){throw 'Login surface is not verified; no customer login was attempted.'}
