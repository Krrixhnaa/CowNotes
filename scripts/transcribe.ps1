param([string]$wavFile)

if (-not (Test-Path $wavFile)) {
    exit 0
}

try {
    Add-Type -AssemblyName System.Speech
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $engine.SetInputToWaveFile($wavFile)
    $res = $engine.Recognize()
    if ($res -and $res.Text) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $res.Text
    }
    $engine.Dispose()
} catch {
    exit 0
}
