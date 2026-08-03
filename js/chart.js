/**
 * 環形緩衝區，用於高效存儲固定數量的最新資料點。
 */
class RingBuffer {
  /**
   * 初始化環形緩衝區
   * @param {number} capacity - 緩衝區容量
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0; // 下一個寫入位置
    this.isFull = false;
  }

  /**
   * 加入新資料
   * @param {any} item - 要存儲的資料
   */
  push(item) {
    this.buffer[this.head] = item;
    this.head++;
    if (this.head >= this.capacity) {
      this.head = 0;
      this.isFull = true;
    }
  }

  /**
   * 取得指定索引的資料 (0 = 最舊的可用資料)
   * @param {number} index - 索引值
   * @returns {any} 資料
   */
  get(index) {
    if (index < 0 || index >= this.length) return undefined;
    if (!this.isFull) {
      return this.buffer[index];
    }
    const realIndex = (this.head + index) % this.capacity;
    return this.buffer[realIndex];
  }

  /**
   * 取得最近的 N 筆資料 (0 = 最舊, 越後面越新)
   * @param {number} count - 數量
   * @returns {Array} 最新資料陣列
   */
  getLatest(count) {
    const len = this.length;
    const resultCount = Math.min(count, len);
    const result = new Array(resultCount);
    const startIndex = len - resultCount;
    for (let i = 0; i < resultCount; i++) {
      result[i] = this.get(startIndex + i);
    }
    return result;
  }

  /**
   * 目前存儲的資料數量
   */
  get length() {
    return this.isFull ? this.capacity : this.head;
  }

  /**
   * 清空緩衝區
   */
  clear() {
    this.head = 0;
    this.isFull = false;
  }
}

/**
 * 圖表管理器，負責繪製時間軸折線圖與 G-G 摩擦圓。
 */
export class ChartManager {
  /**
   * 初始化圖表管理器
   * @param {string} timelineCanvasId - 時間軸折線圖 Canvas ID
   */
  constructor(timelineCanvasId) {
    this.timelineCanvas = document.getElementById(timelineCanvasId);
    
    // 效能最佳化：設定 alpha: false 告訴瀏覽器背景不會透明
    this.timelineCtx = this.timelineCanvas.getContext('2d', { alpha: false });

    this.timeWindow = 30; // 預設顯示最近 30 秒
    this.thresholds = [];
    
    // 假設 60 FPS，存儲 timeWindow 秒的資料，保留一些餘裕
    this.timelineBuffer = new RingBuffer(this.timeWindow * 60 + 300);

    this.animationFrameId = null;
    
    // 處理視窗大小改變
    this.handleResize = this.resize.bind(this);
    window.addEventListener('resize', this.handleResize);
    
    // 初始調整大小並啟動繪製迴圈
    this.resize();
    this.renderLoop = this.renderLoop.bind(this);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  }

  /**
   * 新增一筆感測器資料
   * @param {number} elapsed - 經過時間 (秒)
   * @param {number} gLong - 縱向 G 力 (加減速)
   * @param {number} gLat - 橫向 G 力 (轉向)
   */
  addDataPoint(elapsed, gLong, gLat) {
    const data = { elapsed, gLong, gLat };
    this.timelineBuffer.push(data);
  }

  /**
   * 清除所有資料與畫面
   */
  clear() {
    this.timelineBuffer.clear();
  }

  /**
   * 設定時間軸的顯示範圍 (秒)
   * @param {number} seconds - 顯示秒數
   */
  setTimeWindow(seconds) {
    this.timeWindow = seconds;
    // 重建緩衝區以適應新容量（保留舊資料可另做處理，此處簡化為直接重建/擴充）
    const newCapacity = seconds * 60 + 300;
    if (newCapacity > this.timelineBuffer.capacity) {
      const oldLen = this.timelineBuffer.length;
      const oldData = this.timelineBuffer.getLatest(oldLen);
      this.timelineBuffer = new RingBuffer(newCapacity);
      for (let i = 0; i < oldLen; i++) {
        this.timelineBuffer.push(oldData[i]);
      }
    }
  }

  /**
   * 設定參考門檻線
   * @param {Array<{value: number, color: string}>} thresholds 
   */
  setThresholdLines(thresholds) {
    this.thresholds = thresholds;
  }

  /**
   * 根據容器大小重新調整 Canvas 解析度，確保高清晰度
   */
  resize() {
    const dpr = window.devicePixelRatio || 1;

    // Timeline
    const tRect = this.timelineCanvas.parentElement.getBoundingClientRect();
    this.timelineCanvas.width = tRect.width * dpr;
    this.timelineCanvas.height = tRect.height * dpr;
    this.timelineCanvas.style.width = `${tRect.width}px`;
    this.timelineCanvas.style.height = `${tRect.height}px`;

    this.timelineCtx.scale(dpr, dpr);

    this._forceRedraw = true;
  }

  /**
   * 銷毀圖表管理器，釋放資源
   */
  destroy() {
    window.removeEventListener('resize', this.handleResize);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * 內部的繪製迴圈，綁定到 requestAnimationFrame
   */
  renderLoop() {
    // 效能最佳化：只有在有新資料寫入或強制重繪時才更新畫面
    if (this.timelineBuffer.head !== this._lastDrawnHead || this._forceRedraw) {
      this.render();
      this._lastDrawnHead = this.timelineBuffer.head;
      this._forceRedraw = false;
    }
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  }

  /**
   * 執行一次畫面繪製
   */
  render() {
    this.drawTimeline();
  }

  /**
   * 繪製時間軸折線圖
   */
  drawTimeline() {
    const ctx = this.timelineCtx;
    const width = parseFloat(this.timelineCanvas.style.width);
    const height = parseFloat(this.timelineCanvas.style.height);

    // 繪製深色背景
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, width, height);

    const len = this.timelineBuffer.length;
    if (len === 0) return;

    // 取得最新一筆資料以決定顯示的時間範圍
    const latestData = this.timelineBuffer.get(len - 1);
    const maxTime = latestData.elapsed;
    const minTime = Math.max(0, maxTime - this.timeWindow);

    // 動態計算 Y 軸範圍 (至少 -1.0 ~ 1.0)
    let maxG = 1.0;
    
    // 過濾出可見範圍內的資料點，並找出最大 G 力值
    const visibleData = [];
    for (let i = len - 1; i >= 0; i--) {
      const d = this.timelineBuffer.get(i);
      if (d.elapsed < minTime) break;
      visibleData.push(d);
      maxG = Math.max(maxG, Math.abs(d.gLong), Math.abs(d.gLat));
    }
    visibleData.reverse(); // 轉回依照時間由舊到新排序

    // 增加一點邊距
    const gRange = maxG * 1.2;
    
    const paddingTop = 20;
    const paddingBottom = 20;
    const paddingLeft = 10;
    const paddingRight = 40; // 右側留給數值標籤

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const centerY = paddingTop + plotHeight / 2;

    // 座標轉換函式
    const timeToX = (t) => paddingLeft + ((t - minTime) / this.timeWindow) * plotWidth;
    const gToY = (g) => centerY - (g / gRange) * (plotHeight / 2);

    // 繪製背景網格
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    // 橫向網格 (每 0.1G 或 0.5G 依範圍而定，此處簡化每 0.5G 一條主要)
    const stepG = gRange > 2 ? 1 : 0.5;
    for (let g = -Math.ceil(gRange); g <= Math.ceil(gRange); g += stepG) {
      const y = gToY(g);
      if (y >= paddingTop && y <= height - paddingBottom) {
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - paddingRight, y);
      }
    }
    // 縱向網格 (每 5 秒)
    const startSec = Math.ceil(minTime / 5) * 5;
    for (let t = startSec; t <= maxTime; t += 5) {
      const x = timeToX(t);
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, height - paddingBottom);
    }
    ctx.stroke();

    // 繪製 0G 中心線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(paddingLeft, centerY);
    ctx.lineTo(width - paddingRight, centerY);
    ctx.stroke();

    // 繪製門檻線
    ctx.setLineDash([5, 5]);
    this.thresholds.forEach(th => {
      ctx.strokeStyle = th.color;
      ctx.globalAlpha = 0.4;
      const y = gToY(th.value);
      if (y >= paddingTop && y <= height - paddingBottom) {
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - paddingRight, y);
        ctx.stroke();
      }
      const yNeg = gToY(-th.value);
      if (yNeg >= paddingTop && yNeg <= height - paddingBottom) {
        ctx.beginPath();
        ctx.moveTo(paddingLeft, yNeg);
        ctx.lineTo(width - paddingRight, yNeg);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);

    if (visibleData.length > 1) {
      // 繪製橫向 G (gLat) - 亮黃色
      ctx.beginPath();
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      visibleData.forEach((d, i) => {
        const x = timeToX(d.elapsed);
        const y = gToY(d.gLat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 繪製縱向 G (gLong) - 亮青色
      ctx.beginPath();
      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      visibleData.forEach((d, i) => {
        const x = timeToX(d.elapsed);
        const y = gToY(d.gLong);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 繪製標籤
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // 底部時間標籤
    for (let t = startSec; t <= maxTime; t += 5) {
      const x = timeToX(t);
      ctx.fillText(`${t}s`, x, height - paddingBottom + 5);
    }

    // 右側當前數值
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lastX = width - paddingRight + 5;
    
    // gLat 標籤
    ctx.fillStyle = '#FBBF24';
    ctx.shadowColor = '#FBBF24';
    ctx.shadowBlur = 4;
    ctx.fillText(`${latestData.gLat.toFixed(2)}`, lastX, gToY(latestData.gLat));
    
    // gLong 標籤
    ctx.fillStyle = '#06B6D4';
    ctx.shadowColor = '#06B6D4';
    ctx.shadowBlur = 4;
    ctx.fillText(`${latestData.gLong.toFixed(2)}`, lastX, gToY(latestData.gLong));
    ctx.shadowBlur = 0; // 重置
  }

}
