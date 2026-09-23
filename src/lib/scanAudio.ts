let scanAudioContext: AudioContext | null = null

export function enableScanAudio() {
  scanAudioContext ??= new AudioContext()
  void scanAudioContext.resume()
  return scanAudioContext
}

export function disableScanAudio() {
  void scanAudioContext?.suspend()
}

export function getScanAudio() {
  return scanAudioContext
}