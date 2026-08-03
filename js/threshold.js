export class ThresholdManager {
  constructor() {
    this.storageKey = 'gforce_thresholds';
    this.thresholds = [];
    this.load();
  }

  // 取得預設門檻
  _getDefaultThresholds() {
    return [
      { value: 0.3, color: '#8B5CF6', frequency: 830, enabled: true },
      { value: 0.2, color: '#3B82F6', frequency: 784, enabled: true },
      { value: 0.1, color: '#06B6D4', frequency: 698, enabled: true },
      { value: -0.1, color: '#F59E0B', frequency: 523, enabled: true },
      { value: -0.2, color: '#F97316', frequency: 440, enabled: true },
      { value: -0.3, color: '#EF4444', frequency: 349, enabled: true }
    ];
  }

  // 按 value 排序 (此處選擇由大到小降序排列)
  getThresholds() {
    return [...this.thresholds].sort((a, b) => b.value - a.value);
  }

  // 新增門檻
  addThreshold(value, color = '#FFFFFF', frequency = 500) {
    // 若已存在相同 value，不重複新增
    if (this.thresholds.find(t => t.value === value)) return;
    this.thresholds.push({ value, color, frequency, enabled: true });
    this.save();
  }

  // 移除門檻
  removeThreshold(value) {
    const initialLength = this.thresholds.length;
    this.thresholds = this.thresholds.filter(t => t.value !== value);
    if (this.thresholds.length !== initialLength) {
      this.save();
      return true;
    }
    return false;
  }

  // 更新門檻
  updateThreshold(value, updates) {
    const threshold = this.thresholds.find(t => t.value === value);
    if (threshold) {
      if (updates.color !== undefined) threshold.color = updates.color;
      if (updates.frequency !== undefined) threshold.frequency = updates.frequency;
      if (updates.enabled !== undefined) threshold.enabled = updates.enabled;
      this.save();
      return true;
    }
    return false;
  }

  // 重置為預設值
  resetToDefaults() {
    this.thresholds = this._getDefaultThresholds();
    this.save();
  }

  // hex 轉 rgb 輔助函數
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  // 顏色插值輔助函數
  _interpolateColor(color1, color2, factor) {
    const c1 = this._hexToRgb(color1);
    const c2 = this._hexToRgb(color2);
    if (!c1 || !c2) return color1;

    const r = Math.round(c1.r + factor * (c2.r - c1.r));
    const g = Math.round(c1.g + factor * (c2.g - c1.g));
    const b = Math.round(c1.b + factor * (c2.b - c1.b));
    return `rgb(${r}, ${g}, ${b})`;
  }

  // 返回 CSS 顏色 (只在門檻前後 +/- 0.02 變色，高度對比)
  getColorForG(gValue) {
    if (gValue >= 0.32) return '#FF00FF'; // Magenta
    if (gValue <= -0.32) return '#FF0000'; // Red

    const stops = [
      { v: 0.3, c: '#FF00FF' }, // 0.3G: Magenta
      { v: 0.2, c: '#00FFFF' }, // 0.2G: Cyan
      { v: 0.1, c: '#00FF00' }, // 0.1G: Lime Green
      { v: 0.0, c: '#1E293B' }, // 0.0G: 暗灰色 (平靜基準)
      { v: -0.1, c: '#FFFF00' }, // -0.1G: Yellow
      { v: -0.2, c: '#FF8800' }, // -0.2G: Orange
      { v: -0.3, c: '#FF0000' }  // -0.3G: Red
    ];

    for (const stop of stops) {
      if (Math.abs(gValue - stop.v) <= 0.025) {
        return stop.c;
      }
    }
    
    // 不在門檻區間內，返回預設深色背景
    return '#0F172A'; 
  }

  // 返回 CSS 背景樣式 (radial-gradient)
  getBackgroundStyle(gValue) {
    const centerColor = this.getColorForG(gValue);
    // 邊緣為深色背景，產生動態光暈效果
    return `radial-gradient(circle, ${centerColor} 0%, #111827 80%)`;
  }

  // 返回被跨越且最嚴重的單一門檻陣列 (最高嚴重度)
  checkCrossings(prevG, currentG) {
    let maxCrossed = null;

    for (const t of this.thresholds) {
      if (!t.enabled) continue;
      
      // 正 G 力門檻 (加速)：只在遠離 0 的方向跨越時觸發
      if (t.value > 0 && prevG < t.value && currentG >= t.value) {
        if (!maxCrossed || Math.abs(t.value) > Math.abs(maxCrossed.value)) {
          maxCrossed = t;
        }
      }
      // 負 G 力門檻 (煞車)：只在遠離 0 的方向跨越時觸發
      else if (t.value < 0 && prevG > t.value && currentG <= t.value) {
        if (!maxCrossed || Math.abs(t.value) > Math.abs(maxCrossed.value)) {
          maxCrossed = t;
        }
      }
    }

    return maxCrossed ? [maxCrossed] : [];
  }

  // 儲存到 localStorage
  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.thresholds));
    } catch (e) {
      console.warn('無法儲存門檻設定至 localStorage', e);
    }
  }

  // 從 localStorage 載入
  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        this.thresholds = JSON.parse(data);
      } else {
        this.resetToDefaults();
      }
    } catch (e) {
      console.warn('無法從 localStorage 讀取門檻設定', e);
      this.resetToDefaults();
    }
  }
}
