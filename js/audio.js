export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.enabled = true;
    this.lastPlayTime = new Map();
  }

  // Initialize and resume audio from a direct user gesture (required by iOS/PWA).
  async initFromUserGesture() {
    try {
      if (!this.audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        this.audioContext = new AudioContext();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      return this.audioContext.state === 'running';
    } catch (err) {
      console.warn('AudioContext initialization failed:', err);
      return false;
    }
  }

  // Resume audio after it was suspended by the browser or PWA lifecycle.
  async ensureReady() {
    if (!this.audioContext) {
      return false;
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn('AudioContext resume failed:', err);
      }
    }

    return this.audioContext.state === 'running';
  }

  // Play a threshold crossing beep. It first attempts to restore audio readiness.
  playThresholdCrossing(thresholdValue, frequency) {
    if (!this.enabled) return;

    this.ensureReady().then((ready) => {
      if (!ready) return;

      const nowReal = performance.now();
      const nowAudio = this.audioContext.currentTime;

      const lastTime = this.lastPlayTime.get(thresholdValue) || 0;
      if (nowReal - lastTime < 500) return;
      this.lastPlayTime.set(thresholdValue, nowReal);

      const isSevere = Math.abs(thresholdValue) > 0.3;

      this._playBeep(frequency, nowAudio);
      if (isSevere) {
        this._playBeep(frequency, nowAudio + 0.15);
      }
    }).catch(() => {});
  }

  _playBeep(frequency, startTime) {
    if (!this.audioContext || this.audioContext.state !== 'running') return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(1, startTime + 0.01);
    gainNode.gain.setValueAtTime(1, startTime + 0.09);
    gainNode.gain.linearRampToValueAtTime(0, startTime + 0.19);

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  isReady() {
    return this.audioContext !== null && this.audioContext.state === 'running';
  }
}
