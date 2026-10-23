$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$text=[Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 200) { throw 'Text must contain 1-200 characters.' }
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
$stream=New-Object System.IO.MemoryStream
try {
    $voice=$speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-TW' } | Select-Object -First 1
    if (-not $voice) { throw 'No enabled zh-TW Windows voice installed.' }
    $speaker.SelectVoice($voice.VoiceInfo.Name)
    $format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(17000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $speaker.SetOutputToAudioStream($stream,$format)
    $speaker.Speak($text)
    $speaker.SetOutputToNull()
    $pcm=$stream.ToArray()
    $output=[Console]::OpenStandardOutput()
    $output.Write($pcm,0,$pcm.Length)
    $output.Flush()
} finally { $speaker.Dispose(); $stream.Dispose() }
