param(
  [int]$Workers = 8,
  [int]$Fps = 120,
  [int]$Frames = 25032,
  [string]$Enc = 'hevc',
  [int]$Sc = 2,
  [switch]$NoAudio
)
$ErrorActionPreference = 'Stop'
$wd = 'D:\w1\mv'
Set-Location $wd
New-Item -ItemType Directory -Force out\seg | Out-Null
Remove-Item out\seg\seg_*.mp4 -ErrorAction SilentlyContinue
$outFile = 'out\world_execute_me_4k120.mp4'
Remove-Item -Force -ErrorAction SilentlyContinue $outFile

$sw = [Diagnostics.Stopwatch]::StartNew()
$procs = @()
for ($i = 0; $i -lt $Workers; $i++) {
  $f0 = [int][math]::Floor($i * $Frames / $Workers)
  $f1 = [int][math]::Floor(($i + 1) * $Frames / $Workers)
  $na = @('render4k.js','--f0',"$f0",'--f1',"$f1",'--fps',"$Fps",'--sc',"$Sc",'--enc',$Enc,'--out',"out\seg\seg_$i.mp4")
  Write-Host ("worker {0}: frames {1}..{2}" -f $i, $f0, $f1)
  $procs += Start-Process -FilePath 'node' -ArgumentList $na -WorkingDirectory $wd -PassThru
}
$procs | Wait-Process

$seg = Get-ChildItem 'out\seg\seg_*.mp4' -ErrorAction SilentlyContinue
if ($seg.Count -ne $Workers) { throw "only $($seg.Count)/$Workers segments produced" }
$small = $seg | Where-Object { $_.Length -lt 100000 }
if ($small) { throw ("suspiciously small segment: " + ($small.Name -join ',')) }
Write-Host ("render done in {0:N1} min  ({1} segments, {2:N0} MB total)" -f $sw.Elapsed.TotalMinutes, $seg.Count, (($seg | Measure-Object Length -Sum).Sum/1MB))

$list = Join-Path $wd 'out\seg\list.txt'
$lines = $seg | Sort-Object { [int]($_.BaseName -replace 'seg_','') } | ForEach-Object { "file '" + ($_.FullName -replace '\\','/') + "'" }
Set-Content -Path $list -Value $lines -Encoding ASCII
& ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i $list -c copy -movflags +faststart out\video_only.mp4
if ($LASTEXITCODE -ne 0) { throw 'concat failed' }

if ($NoAudio) { Move-Item -Force out\video_only.mp4 $outFile }
else {
  $m = @('-y','-hide_banner','-loglevel','error','-i','out\video_only.mp4','-i','audio_master.m4a','-c:v','copy','-c:a','aac','-b:a','320k','-shortest','-movflags','+faststart',$outFile)
  & ffmpeg @m
  if ($LASTEXITCODE -ne 0) { throw 'mux failed' }
}

$nb = (& ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 $outFile).Trim()
if ([int]$nb -ne $Frames) { throw "frame count mismatch: got $nb expected $Frames" }
$dur = (& ffprobe -v error -show_entries format=duration -of csv=p=0 $outFile).Trim()
Write-Host ("OK  frames=$nb  duration=$dur s  TOTAL {0:N1} min  size {1:N0} MB" -f $sw.Elapsed.TotalMinutes, ((Get-Item $outFile).Length/1MB))
