export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.enabled = true;
    this.lastPlayTime = new Map(); // 記錄各門檻最後播放時間，用於防抖動
  }

  // 必須在使用者 tap 事件中呼叫 (iOS Safari 限制)
  initFromUserGesture() {
    if (!this.audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  // 播放對應門檻的提示音
  playThresholdCrossing(thresholdValue, frequency) {
    if (!this.enabled || !this.isReady()) return;

    const nowReal = performance.now();
    const nowAudio = this.audioContext.currentTime;
    
    // 防抖動 (debounce)：同一門檻 500ms 內不重複播放 (使用實際時間避免 context freeze)
    const lastTime = this.lastPlayTime.get(thresholdValue) || 0;
    if (nowReal - lastTime < 500) return;
    this.lastPlayTime.set(thresholdValue, nowReal);

    const isSevere = Math.abs(thresholdValue) > 0.3; // 超過 ±0.3G 為嚴重門檻
    
    this._playBeep(frequency, nowAudio);
    if (isSevere) {
      // 雙音：150ms 後播放第二聲
      this._playBeep(frequency, nowAudio + 0.15); 
    }
  }

  _playBeep(frequency, startTime) {
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
      // 若剛喚醒，不保證立即能播，但可以嘗試繼續
    }

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // 加速或減速對應頻率已在傳入時決定
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);

    // 短促清脆提示音 (attack 10ms, sustain 80ms, decay 100ms)
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(1, startTime + 0.01); // attack 10ms
    gainNode.gain.setValueAtTime(1, startTime + 0.09); // sustain 80ms (0.01 + 0.08)
    gainNode.gain.linearRampToValueAtTime(0, startTime + 0.19); // decay 100ms

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2); // 總長度約 200ms
  }

  // 開關音效
  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  // AudioContext 是否已 resume
  isReady() {
    return this.audioContext !== null && this.audioContext.state === 'running';
  }
}
