param([string]$In, [string]$Out)
$In = $In -replace "/", "\\"; $Out = $Out -replace "/", "\\"
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $p = $ppt.Presentations.Open($In, $true, $false, $false)   # read-only, no window
  $p.SaveAs($Out, 32)                                          # ppSaveAsPDF
  $p.Close()
} finally { $ppt.Quit() }
if (!(Test-Path $Out)) { throw "PDF not written: $Out" }
"pdf: $Out"
