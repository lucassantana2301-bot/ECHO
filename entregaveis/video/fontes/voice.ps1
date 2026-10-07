# Renders every narration line to its own WAV with the Daniel (pt-BR) OneCore voice.
$d = Split-Path -Parent $MyInvocation.MyCommand.Path
$lines = Get-Content -Raw -Encoding UTF8 "$d\script.json" | ConvertFrom-Json
New-Item -ItemType Directory -Force "$d\vo" | Out-Null
foreach ($l in $lines) {
  $ssml = "<speak version=`"1.0`" xmlns=`"http://www.w3.org/2001/10/synthesis`" xml:lang=`"pt-BR`"><prosody rate=`"-3%`" pitch=`"-3%`">$($l.say)</prosody></speak>"
  [System.IO.File]::WriteAllText("$d\vo\$($l.id).ssml", $ssml, (New-Object System.Text.UTF8Encoding($false)))
  & "$d\tts.ps1" -Ssml "$d\vo\$($l.id).ssml" -Out "$d\vo\$($l.id).wav" -Voice Daniel
}

