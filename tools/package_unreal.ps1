# Phone Twin - build the Windows package of ARKO_PROJECT (Shipping) and put the scans next to it.
#   powershell -ExecutionPolicy Bypass -File tools\package_unreal.ps1 [-Out D:\PhoneTwin_Package] [-SkipMaterial]
# 1) saves the GPU look material as an asset (editor command PhoneTwin.SaveMaterial; packaged games cannot build it)
# 2) RunUAT BuildCookRun (Shipping, Win64)  3) copies ARKO_PROJECT\PhoneTwinScans next to the game (read and written at run time)
# The package carries the relay key from ARKO_PROJECT\Config\DefaultGame.ini: give it only to the exhibition PC.
param(
	[string]$Project = "$PSScriptRoot\..\..\ARKO_PROJECT\ARKO_PROJECT.uproject",
	[string]$Engine = "D:\Unreal Projects\UE_5.5",
	[string]$Out = "D:\PhoneTwin_Package",
	[switch]$SkipMaterial,
	# shader compile workers at once: each takes up to ~1 GB, and all cores (32 here) ran the PC out of memory
	[int]$ShaderWorkers = 8
)
$ErrorActionPreference = 'Stop'
$Project = (Resolve-Path $Project).Path
$ProjDir = Split-Path $Project
if (Get-Process UnrealEditor -ErrorAction SilentlyContinue) { Write-Warning 'Close the Unreal editor first (its plugin DLLs are locked while it runs).'; exit 1 }

if (-not $SkipMaterial) {
	# -ExecCmds in the editor splits on ',' (not ';'), and the editor does not quit by itself: stop it once the log says saved
	$log = Join-Path $ProjDir 'Saved\Logs\ARKO_PROJECT.log'
	$t0 = Get-Date
	$p = Start-Process "$Engine\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" -PassThru -WindowStyle Hidden `
		-ArgumentList "`"$Project`" -ExecCmds=`"PhoneTwin.SaveMaterial,Quit`" -unattended -nosplash -nosound -nullrhi"
	$saved = $false
	for ($i = 0; $i -lt 600 -and -not $p.HasExited; $i++) {
		Start-Sleep -Seconds 1
		if ((Test-Path $log) -and (Get-Item $log).LastWriteTime -gt $t0 -and (Select-String -Path $log -Pattern 'immersive material saved' -Quiet)) { $saved = $true; break }
	}
	if (-not $p.HasExited) { Start-Sleep -Seconds 2; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
	if (-not $saved) { throw 'PhoneTwin.SaveMaterial did not report "saved" (see Saved\Logs\ARKO_PROJECT.log)' }
	Write-Host 'material saved: /Game/PhoneTwinRuntime/M_PhoneTwinImmersive'
}

$unused = [Math]::Max(0, [Environment]::ProcessorCount - $ShaderWorkers)
& "$Engine\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun "-project=$Project" -noP4 -platform=Win64 -clientconfig=Shipping `
	-build -cook -stage -pak -iostore -archive "-archivedirectory=$Out" -prereqs -nocompileeditor -utf8output -unattended "-UbtArgs=-NoUBA -MaxParallelActions=4" `
	"-AdditionalCookerOptions=-ini:Engine:[DevOptions.Shaders]:NumUnusedShaderCompilingThreads=$unused"
if ($LASTEXITCODE -ne 0) { throw "packaging failed ($LASTEXITCODE)" }

$game = Join-Path $Out 'Windows\ARKO_PROJECT'
robocopy (Join-Path $ProjDir 'PhoneTwinScans') (Join-Path $game 'PhoneTwinScans') /E /XF uwb_frame.json /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying the scans failed ($LASTEXITCODE)" }
$global:LASTEXITCODE = 0

$readme = @'
Phone Twin (ARKO_PROJECT) - Windows package

Run:  ARKO_PROJECT.exe   (first time: if Windows asks, allow network access for private networks)

1. The start screen asks for what changes from site to site:
   input device (phone app / UWB tag), scan, GitHub auto download, internet relay (room, key),
   TouchDesigner OSC address and port, UWB gateway port, vibration device IP, full screen.
   Press [시작]. The values are kept in %LOCALAPPDATA%\ARKO_PROJECT\Saved\PhoneTwinSetup.json
   (delete that file to start from the defaults again).
2. While running: F6 opens the start screen again. Other keys are listed on the HUD (1/2 input, V view, L look, ...).
3. Scans live in ARKO_PROJECT\PhoneTwinScans (new ones from GitHub are downloaded there while running).
   Collisions and sounds edited with the collision editor go to PhoneTwinScans\collisions and \sounds:
   copy those folders here after editing on the development PC.
4. Ports: UDP 7777 (phone), 8000 (UWB gateway OSC) in; 4210 / 4211 vibration and 7000 TouchDesigner out.
Do not share this folder publicly: it contains the relay key.
'@
Set-Content -Path (Join-Path $Out 'Windows\README_PhoneTwin.txt') -Value $readme -Encoding UTF8
Write-Host "done: $(Join-Path $Out 'Windows\ARKO_PROJECT.exe')"
