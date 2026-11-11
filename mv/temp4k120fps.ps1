Set-Location D:\w1\mv
$r='render.js'; $t=Get-Content $r -Raw -Encoding UTF8
$t=$t -replace 'const cv = createCanvas\(L\.W, L\.H\);','const SC = +(process.env.SC || 1); const cv = createCanvas(L.W * SC, L.H * SC);'
$t=$t -replace 'ctx\.setTransform\(1, 0, 0, 1, 0, 0\);','ctx.setTransform(SC, 0, 0, SC, 0, 0);'
$t=$t -replace "'-s', L\.W \+ 'x' \+ L\.H","'-s', (L.W * SC) + 'x' + (L.H * SC)"
$t=$t -replace "'-preset','medium','-crf','17'","'-preset','fast','-crf','20'"
[System.IO.File]::WriteAllText((Resolve-Path $r), $t, (New-Object System.Text.UTF8Encoding($false)))
$env:SC=2
node render.js --from 0 --to 208.60 --fps 120 --audio audio_master.m4a --out out/world_execute_me_4k120.mp4 -c:v hevc_nvenc -cq 22