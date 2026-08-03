/**
 * 濾波器模組
 * 包含中值濾波、低通濾波、卡爾曼濾波、簡單滑動平均，以及混合最佳化濾波。
 */

/**
 * 1. MedianFilter — 中值突波剔除
 * 內部維護一個循環緩衝區，用於剔除坑洞或減速帶造成的瞬間脈衝雜訊。
 */
export class MedianFilter {
  /**
   * @param {number} windowSize - 滑動窗口大小
   */
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
    this.buffer = [];
    this.index = 0;
  }

  /**
   * 將新值加入緩衝區並返回中位數
   * @param {number} value - 輸入值
   * @returns {number} 中值濾波後的值
   */
  filter(value) {
    if (this.buffer.length < this.windowSize) {
      this.buffer.push(value);
    } else {
      this.buffer[this.index] = value;
      this.index = (this.index + 1) % this.windowSize;
    }

    // 複製緩衝區並排序以取得中位數
    const sorted = [...this.buffer].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2.0;
    } else {
      return sorted[mid];
    }
  }

  /**
   * 重置內部緩衝區
   */
  reset() {
    this.buffer = [];
    this.index = 0;
  }
}

/**
 * 2. LowPassFilter2ndOrder — 二階 Butterworth 低通濾波
 * 由於 dt 不固定，需要根據實際 dt 計算濾波係數。
 */
export class LowPassFilter2ndOrder {
  /**
   * @param {number} cutoffHz - 截止頻率 (Hz)
   */
  constructor(cutoffHz = 5.0) {
    this.cutoffHz = cutoffHz;
    this.lastDt = -1;
    this.thresholdDt = 0.005; // 若 dt 變化超過 5ms，則重新計算係數

    // 濾波器狀態
    this.x1 = 0; // 上一次的輸入
    this.x2 = 0; // 上上一次的輸入
    this.y1 = 0; // 上一次的輸出
    this.y2 = 0; // 上上一次的輸出

    // 濾波器係數
    this.a0 = 1; this.a1 = 0; this.a2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    
    this.initialized = false;
  }

  /**
   * 動態調整截止頻率
   * @param {number} hz - 新的截止頻率
   */
  setCutoff(hz) {
    this.cutoffHz = hz;
    this.lastDt = -1; // 強制下次 filter 時重新計算係數
  }

  /**
   * 計算雙線性轉換係數
   * @param {number} dt - 取樣間隔 (秒)
   */
  _calculateCoefficients(dt) {
    const w0 = 2 * Math.PI * this.cutoffHz * dt;
    const alpha = Math.sin(w0) / Math.sqrt(2); // Q = 1/sqrt(2) for Butterworth

    const a0 = 1 + alpha;
    this.b0 = ((1 - Math.cos(w0)) / 2) / a0;
    this.b1 = (1 - Math.cos(w0)) / a0;
    this.b2 = ((1 - Math.cos(w0)) / 2) / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;

    this.lastDt = dt;
  }

  /**
   * 套用低通濾波
   * @param {number} value - 輸入值
   * @param {number} dt - 實際取樣間隔 (秒)
   * @returns {number} 濾波後的值
   */
  filter(value, dt) {
    if (dt <= 0) return value; // 避免除以零

    // 檢查是否需要重新計算係數
    if (Math.abs(dt - this.lastDt) > this.thresholdDt || !this.initialized) {
      this._calculateCoefficients(dt);
    }

    if (!this.initialized) {
      this.x1 = this.x2 = value;
      this.y1 = this.y2 = value;
      this.initialized = true;
      return value;
    }

    const output = this.b0 * value + this.b1 * this.x1 + this.b2 * this.x2
                 - this.a1 * this.y1 - this.a2 * this.y2;

    // 更新狀態
    this.x2 = this.x1;
    this.x1 = value;
    this.y2 = this.y1;
    this.y1 = output;

    return output;
  }

  /**
   * 重置內部緩衝
   */
  reset() {
    this.initialized = false;
    this.lastDt = -1;
    this.x1 = this.x2 = 0;
    this.y1 = this.y2 = 0;
  }
}

/**
 * 3. AdaptiveKalmanFilter — 自適應卡爾曼濾波
 */
export class AdaptiveKalmanFilter {
  /**
   * @param {number} baseQ - 基礎過程雜訊共變異
   * @param {number} baseR - 測量雜訊共變異
   */
  constructor(baseQ = 0.1, baseR = 1.0) {
    this.baseQ = baseQ;
    this.baseR = baseR;
    this.adaptFactor = 10.0; // 自適應倍率

    this.x = 0; // 狀態估計
    this.p = 1.0; // 誤差共變異
    this.initialized = false;
  }

  /**
   * 套用自適應卡爾曼濾波
   * @param {number} measurement - 測量值
   * @param {number} dt - 取樣間隔 (秒)
   * @returns {number} 濾波後的值
   */
  filter(measurement, dt) {
    if (!this.initialized) {
      this.x = measurement;
      this.p = 1.0;
      this.initialized = true;
      return this.x;
    }

    // 計算 innovation (預測誤差)
    const innovation = Math.abs(measurement - this.x);
    
    // 自適應邏輯：動態調整 Q 值
    // 預測誤差越大，Q 越大，濾波器更信任新測量值 (反應變快)
    // 過程雜訊隨時間累積，所以乘以 dt
    const q = this.baseQ * (1 + this.adaptFactor * (innovation * innovation)) * dt;

    // 狀態預測 (靜態模型)
    let p_pred = this.p + q;

    // 更新
    const k = p_pred / (p_pred + this.baseR);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * p_pred;

    return this.x;
  }

  /**
   * 重置濾波器
   */
  reset() {
    this.initialized = false;
    this.x = 0;
    this.p = 1.0;
  }
}

/**
 * 4. SimpleMovingAverage — 簡單滑動平均
 */
export class SimpleMovingAverage {
  /**
   * @param {number} windowSize - 滑動窗口大小
   */
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
    this.buffer = [];
    this.sum = 0;
  }

  /**
   * 計算並返回簡單滑動平均
   * @param {number} value - 輸入值
   * @returns {number} 濾波後的值
   */
  filter(value) {
    this.buffer.push(value);
    this.sum += value;
    
    if (this.buffer.length > this.windowSize) {
      this.sum -= this.buffer.shift();
    }
    
    return this.sum / this.buffer.length;
  }

  /**
   * 重置內部狀態
   */
  reset() {
    this.buffer = [];
    this.sum = 0;
  }
}

/**
 * 5. HybridOptimalFilter — 最佳混合三階段濾波
 */
export class HybridOptimalFilter {
  constructor() {
    this.mode = 'hybrid'; // 預設模式
    this.smoothingStrength = 0.5; // 0.0 ~ 1.0

    this.medianFilter = new MedianFilter(5);
    this.lpf = new LowPassFilter2ndOrder(5.0);
    this.kalman = new AdaptiveKalmanFilter(0.1, 1.0);
    this.sma = new SimpleMovingAverage(5);
    
    this.setSmoothingStrength(this.smoothingStrength);
  }

  /**
   * 套用選定的濾波器
   * @param {number} value - 原始測量值
   * @param {number} dt - 取樣間隔 (秒)
   * @returns {number} 濾波後的值
   */
  filter(value, dt) {
    switch (this.mode) {
      case 'hybrid':
        let v1 = this.medianFilter.filter(value);
        let v2 = this.lpf.filter(v1, dt);
        let v3 = this.kalman.filter(v2, dt);
        return v3;
      case 'kalman':
        return this.kalman.filter(value, dt);
      case 'lpf':
        return this.lpf.filter(value, dt);
      case 'sma':
        return this.sma.filter(value);
      case 'raw':
      default:
        return value;
    }
  }

  /**
   * 設定濾波模式
   * @param {string} mode - 'hybrid', 'kalman', 'lpf', 'sma', 'raw'
   */
  setMode(mode) {
    this.mode = mode;
    this.reset();
  }

  /**
   * 設定平滑強度並自動調整各濾波器參數
   * @param {number} value - 強度 (0.0=高響應 ~ 1.0=高平滑)
   */
  setSmoothingStrength(value) {
    this.smoothingStrength = Math.max(0, Math.min(1, value));

    // 1. LPF Cutoff (3Hz ~ 10Hz): 強度越高，截止頻率越低
    const cutoff = 10.0 - (this.smoothingStrength * 7.0); 
    this.lpf.setCutoff(cutoff);

    // 2. Kalman R 值: 強度越高，越不信任測量值，R 越大
    const baseR = 0.1 + (this.smoothingStrength * 2.0);
    this.kalman.baseR = baseR;
    
    // 3. SMA Window Size: 強度越高，窗口越大 (3 ~ 15)
    const smaWindow = Math.floor(3 + (this.smoothingStrength * 12));
    this.sma.windowSize = smaWindow;
    this.medianFilter.windowSize = Math.floor(3 + (this.smoothingStrength * 6));
  }

  /**
   * 獲取當前模式
   * @returns {string} 當前濾波模式
   */
  getMode() {
    return this.mode;
  }

  /**
   * 重置所有內部濾波器
   */
  reset() {
    this.medianFilter.reset();
    this.lpf.reset();
    this.kalman.reset();
    this.sma.reset();
  }
}
