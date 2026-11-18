$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testDirectory=Join-Path $tempRoot ('bewqueue-session-handoff-bin-'+[Guid]::NewGuid().ToString('N'))
$bin=Join-Path $root 'native\bin'
try {
  New-Item -ItemType Directory -Path $testDirectory | Out-Null
  foreach($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){Copy-Item -LiteralPath (Join-Path $bin $file) -Destination $testDirectory}
  $csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  & $csc /nologo /codepage:65001 /target:exe /platform:x64 /out:"$testDirectory\SessionHandoff.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$testDirectory\Microsoft.Web.WebView2.Core.dll" /r:"$testDirectory\Microsoft.Web.WebView2.WinForms.dll" "$root\tests\native\SessionHandoff.cs"
  if($LASTEXITCODE -ne 0){throw 'Session handoff probe compilation failed'}
  & "$testDirectory\SessionHandoff.exe"
  if($LASTEXITCODE -ne 0){throw 'Local CookieManager fixture handoff failed'}
} finally {
  $full=[IO.Path]::GetFullPath($testDirectory)
  if(![String]::Equals([IO.Path]::GetDirectoryName($full),$tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -notmatch '^bewqueue-session-handoff-bin-[0-9a-f]{32}$'){throw 'Unsafe probe output path'}
  if(Test-Path -LiteralPath $full){
    $resolved=(Resolve-Path -LiteralPath $full).Path
    if(![String]::Equals($resolved,$full,[StringComparison]::OrdinalIgnoreCase) -or ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe resolved probe output path'}
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}
