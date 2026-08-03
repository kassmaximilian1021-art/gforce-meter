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

  // 返回 CSS 顏色 (插值)
  getColorForG(gValue) {
    // 0G 區域 (-0.1~+0.1) 保持 emerald green
    if (gValue > -0.1 && gValue < 0.1) {
      return '#10B981'; // 翡翠綠
    }

    // 定義所有色彩節點進行插值（包含極端值）
    const colorStops = [
      { v: 0.4, c: '#7C3AED' }, // 深紫
      { v: 0.3, c: '#8B5CF6' },
      { v: 0.2, c: '#3B82F6' },
      { v: 0.1, c: '#06B6D4' },
      { v: 0.1, c: '#10B981' }, // 平滑過渡至 0G 區
      { v: -0.1, c: '#10B981' },
      { v: -0.1, c: '#F59E0B' },
      { v: -0.2, c: '#F97316' },
      { v: -0.3, c: '#EF4444' },
      { v: -0.4, c: '#DC2626' }  // 深紅
    ];

    if (gValue >= 0.4) return '#7C3AED';
    if (gValue <= -0.4) return '#DC2626';

    // 尋找對應區間
    for (let i = 0; i < colorStops.length - 1; i++) {
      const upper = colorStops[i];
      const lower = colorStops[i + 1];
      if (gValue <= upper.v && gValue >= lower.v) {
        if (upper.v === lower.v) return upper.c;
        const factor = (gValue - lower.v) / (upper.v - lower.v);
        return this._interpolateColor(lower.c, upper.c, factor);
      }
    }
    
    return '#10B981';
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
