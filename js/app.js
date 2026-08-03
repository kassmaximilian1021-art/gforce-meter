// ====================================
// app.js — 主程式邏輯
// 整合所有模組：感測器、濾波、音效、門檻、存儲、圖表
// 所有使用者介面文字使用日文+英文
// ====================================

import { HybridOptimalFilter } from './filter.js';
import { SensorManager } from './sensor.js';
import { AudioManager } from './audio.js';
import { ThresholdManager } from './threshold.js';
import { StorageManager } from './storage.js';
import { ChartManager } from './chart.js';

// ==========================================
// 全域狀態
// ==========================================
const state = {
  sensorActive: false,       // 感測器是否已啟動
  recording: false,          // 是否正在錄製 CSV
  disclaimerAccepted: false, // 是否已接受免責聲明
  prevGLong: 0,              // 上一幀的縱向 G（用於門檻穿越偵測）
  prevGLat: 0,               // 上一幀的橫向 G
  startTime: null,           // 錄製開始時間
  sampleRate: 60,            // 目標取樣率 (Hz)
  sampleCounter: 0,          // 取樣計數器（用於降頻）
  wakeLock: null,            // Screen Wake Lock 引用
  elapsedDisplay: 0,         // 顯示用的經過時間
};

// ==========================================
// 模組實例化
// ==========================================
const filter = new HybridOptimalFilter();
const sensor = new SensorManager();
const audio = new AudioManager();
const threshold = new ThresholdManager();
const storage = new StorageManager();
let chart = null; // 等 DOM 就緒後初始化

// ==========================================
// DOM 元素快取
// ==========================================
const dom = {};

function cacheDomElements() {
  // 免責聲明
  dom.disclaimerModal = document.getElementById('disclaimer-modal');
  dom.btnDisclaimerAgree = document.getElementById('btn-disclaimer-agree');

  // 感測器初始化
  dom.sensorInitScreen = document.getElementById('sensor-init-screen');
  dom.btnEnableSensor = document.getElementById('btn-enable-sensor');

  // 主介面
  dom.app = document.getElementById('app');
  dom.gforceSection = document.getElementById('gforce-section');
  dom.bottomBar = document.getElementById('bottom-bar');

  // G 力顯示
  dom.gforceValue = document.getElementById('gforce-value');
  dom.gforceLatValue = document.getElementById('gforce-lat-value');
  dom.gforceVertValue = document.getElementById('gforce-vert-value');
  dom.gforceAccelValue = document.getElementById('gforce-accel-value');
  dom.gforceBarFill = document.getElementById('gforce-bar-fill');
  dom.gforceBarIndicator = document.getElementById('gforce-bar-indicator');

  // 狀態列
  dom.statusLabel = document.getElementById('status-label');
  dom.statusDotSensor = document.getElementById('status-dot-sensor');
  dom.statusDotRecording = document.getElementById('status-dot-recording');

  // 圖表
  dom.chartTimeLabel = document.getElementById('chart-time-label');

  // 控制按鈕
  dom.btnRecord = document.getElementById('btn-record');
  dom.btnSettings = document.getElementById('btn-settings');
  dom.btnHistory = document.getElementById('btn-history');

  // 設定面板
  dom.settingsOverlay = document.getElementById('settings-overlay');
  dom.settingsPanel = document.getElementById('settings-panel');
  dom.btnSettingsClose = document.getElementById('btn-settings-close');

  // 校正
  dom.btnCalGravity = document.getElementById('btn-cal-gravity');
  dom.btnCalForward = document.getElementById('btn-cal-forward');
  dom.calStep1Dot = document.getElementById('cal-step1-dot');
  dom.calStep2Dot = document.getElementById('cal-step2-dot');
  dom.calibrationRecord = document.getElementById('calibration-record');
  dom.calibrationRecordContent = document.getElementById('calibration-record-content');
  dom.calibratingOverlay = document.getElementById('calibrating-overlay');
  dom.calibratingText = document.getElementById('calibrating-text');
  dom.calibratingSubtext = document.getElementById('calibrating-subtext');

  // 濾波器
  dom.filterSelector = document.getElementById('filter-selector');
  dom.smoothingSlider = document.getElementById('smoothing-slider');
  dom.smoothingValue = document.getElementById('smoothing-value');

  // 取樣率
  dom.sampleRateSelector = document.getElementById('sample-rate-selector');

  // 門檻
  dom.thresholdList = document.getElementById('threshold-list');
  dom.thresholdAddInput = document.getElementById('threshold-add-input');
  dom.btnThresholdAdd = document.getElementById('btn-threshold-add');
  dom.btnThresholdReset = document.getElementById('btn-threshold-reset');

  // 音效
  dom.toggleAudio = document.getElementById('toggle-audio');

  // 歷史面板
  dom.historyOverlay = document.getElementById('history-overlay');
  dom.historyPanel = document.getElementById('history-panel');
  dom.btnHistoryClose = document.getElementById('btn-history-close');
  dom.sessionList = document.getElementById('session-list');
  dom.historyEmpty = document.getElementById('history-empty');

  // 存儲
  dom.storageSessionsCount = document.getElementById('storage-sessions-count');
  dom.storageUsed = document.getElementById('storage-used');
  dom.storageBarFill = document.getElementById('storage-bar-fill');
  dom.btnClearAllSessions = document.getElementById('btn-clear-all-sessions');

  // GAP 警告
  dom.gapWarning = document.getElementById('gap-warning');
  dom.gapWarningText = document.getElementById('gap-warning-text');

  // Toast
  dom.toast = document.getElementById('toast');

  // 恢復 Modal
  dom.recoveryModal = document.getElementById('recovery-modal');
  dom.btnRecoveryDiscard = document.getElementById('btn-recovery-discard');
  dom.btnRecoveryRecover = document.getElementById('btn-recovery-recover');

  // Wake Lock
  dom.wakeLockVideo = document.getElementById('wake-lock-video');
}

// ==========================================
// 初始化
// ==========================================
async function init() {
  cacheDomElements();

  // 初始化存儲模組
  await storage.init();

  // 設定感測器的濾波器
  sensor.setFilter(filter);

  // 綁定事件
  bindEvents();

  // 渲染門檻列表
  renderThresholdList();

  // 更新存儲使用量顯示
  updateStorageDisplay();

  // 防止重新整理時資料遺失
  setupBeforeUnload();

  // 註冊 Service Worker
  registerServiceWorker();

  // 檢查未完成的 Session
  checkUnfinishedSession();
}

// ==========================================
// 事件綁定
// ==========================================
function bindEvents() {
  // 免責聲明同意
  dom.btnDisclaimerAgree.addEventListener('click', handleDisclaimerAgree);

  // 啟動感測器
  dom.btnEnableSensor.addEventListener('click', handleEnableSensor);

  // 錄製按鈕
  dom.btnRecord.addEventListener('click', handleRecordToggle);

  // 設定面板
  dom.btnSettings.addEventListener('click', () => openPanel('settings'));
  dom.btnSettingsClose.addEventListener('click', () => closePanel('settings'));
  dom.settingsOverlay.addEventListener('click', () => closePanel('settings'));

  // 歷史面板
  dom.btnHistory.addEventListener('click', () => {
    openPanel('history');
    renderSessionList();
  });
  dom.btnHistoryClose.addEventListener('click', () => closePanel('history'));
  dom.historyOverlay.addEventListener('click', () => closePanel('history'));

  // 校正
  dom.btnCalGravity.addEventListener('click', handleGravityCalibration);
  dom.btnCalForward.addEventListener('click', handleForwardCalibration);

  // 濾波模式
  dom.filterSelector.addEventListener('click', handleFilterModeChange);

  // 平滑度滑桿
  dom.smoothingSlider.addEventListener('input', handleSmoothingChange);

  // 取樣率
  dom.sampleRateSelector.addEventListener('click', handleSampleRateChange);

  // 門檻管理
  dom.btnThresholdAdd.addEventListener('click', handleThresholdAdd);
  dom.thresholdAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleThresholdAdd();
  });
  dom.btnThresholdReset.addEventListener('click', handleThresholdReset);

  // 音效開關
  dom.toggleAudio.addEventListener('click', handleAudioToggle);

  // 刪除所有資料
  dom.btnClearAllSessions.addEventListener('click', handleClearAllSessions);

  // 感測器回調
  sensor.onData = handleSensorData;
  sensor.onStatusChange = handleSensorStatusChange;

  // 恢復 Modal
  dom.btnRecoveryDiscard.addEventListener('click', handleRecoveryDiscard);
  dom.btnRecoveryRecover.addEventListener('click', handleRecoveryRecover);

  // 視窗大小變更 (chart 內部已自行處理)
  // window.addEventListener('resize', handleResize);
}

// ==========================================
// 免責聲明處理
// ==========================================
function handleDisclaimerAgree() {
  state.disclaimerAccepted = true;
  dom.disclaimerModal.classList.remove('visible');

  // 顯示主應用程式
  dom.app.classList.remove('hidden');

  // 初始化音效（必須在使用者手勢中呼叫）
  audio.initFromUserGesture();
}

// ==========================================
// 感測器啟動
// ==========================================
async function handleEnableSensor() {
  if (dom.btnEnableSensor.disabled) return;
  dom.btnEnableSensor.disabled = true;
  
  try {
    const granted = await sensor.requestPermission();
    if (granted) {
      // 初始化圖表（此時 Canvas 已在 DOM 中）
      dom.sensorInitScreen.classList.add('hidden');
      dom.gforceSection.classList.remove('hidden');
      dom.bottomBar.classList.remove('hidden');

      // 初始化 ChartManager
      chart = new ChartManager('timeline-canvas');
      chart.setThresholdLines(threshold.getThresholds().map(t => ({
        value: t.value,
        color: t.color
      })));

      // 短暫延遲後 resize 確保尺寸正確
      setTimeout(() => {
        chart.resize();
      }, 100);

      // 開始監聽感測器
      sensor.startListening();
      state.sensorActive = true;

      // 啟動螢幕常亮
      acquireWakeLock();

      showToast('Sensors activated / センサーが有効になりました ✅');
    } else {
      dom.btnEnableSensor.disabled = false;
      showToast('Sensor permission denied / センサーの許可が拒否されました ❌');
    }
  } catch (err) {
    dom.btnEnableSensor.disabled = false;
    console.error('感測器權限錯誤:', err);
    showToast('Sensor error / センサーエラー ❌');
  }
}

// ==========================================
// 感測器資料處理（核心即時迴路）
// ==========================================
function handleSensorData(data) {
  const gLong = data.filteredGLong || 0;
  const gLat = data.filteredGLat || 0;
  const gVert = data.gVert || 0;

  // 檢查門檻穿越並播放音效 (不受 UI 取樣率影響，維持在 60Hz 避免漏掉極短瞬間的峰值)
  checkThresholdCrossings(gLong);

  // 更新上一幀 G 值 (必須在 60Hz 執行)
  state.prevGLong = gLong;
  state.prevGLat = gLat;

  // 取樣率降頻 (只針對 UI 更新與儲存)
  state.sampleCounter++;
  const skipFactor = Math.max(1, Math.round(60 / state.sampleRate));
  if (state.sampleCounter % skipFactor !== 0) return;

  const gLong = data.filteredGLong || 0;
  const gLat = data.filteredGLat || 0;
  const gVert = data.gVert || 0;
  const accelMs2 = Math.sqrt(
    (data.accelMs2Long || 0) ** 2 + (data.accelMs2Lat || 0) ** 2
  );

  // 更新 G 力數字顯示
  updateGForceDisplay(gLong, gLat, gVert, accelMs2);

  // 更新動態背景顏色
  updateDynamicBackground(gLong);

  // 更新 G 力指示條
  updateGForceBar(gLong);

  // 更新圖表
  if (chart) {
    const elapsed = data.timestamp ? (data.timestamp - (state.startTime || data.timestamp)) / 1000 : 0;
    chart.addDataPoint(
      performance.now() / 1000,
      gLong,
      gLat
    );
  }

  // 如果正在錄製，寫入存儲
  if (state.recording) {
    const elapsed = (performance.now() - state.recordStartPerf) / 1000;
    dom.chartTimeLabel.textContent = formatElapsed(elapsed);

    storage.addDataPoint({
      timestamp: new Date().toISOString(),
      elapsed: elapsed,
      gLongRaw: data.gLong || 0,
      gLatRaw: data.gLat || 0,
      gLongFiltered: gLong,
      gLatFiltered: gLat,
      accelLong: data.accelMs2Long || 0,
      accelLat: data.accelMs2Lat || 0,
      status: data.gapFlag ? 'gap_end' : 'normal'
    });
  }

  }
}

// ==========================================
// 感測器狀態變化
// ==========================================
let gapWarningTimeout = null;

function handleSensorStatusChange(status) {
  switch (status) {
    case 'listening':
      dom.statusDotSensor.className = 'status-dot active';
      dom.statusLabel.textContent = state.recording
        ? '● REC / 記録中'
        : 'Active / アクティブ';
      // 隱藏 GAP 警告
      if (gapWarningTimeout) clearTimeout(gapWarningTimeout);
      gapWarningTimeout = setTimeout(() => {
        dom.gapWarning.classList.remove('visible');
      }, 5000);
      break;
    case 'suspended':
      dom.statusDotSensor.className = 'status-dot warning';
      dom.statusLabel.textContent = 'Suspended / 一時停止';
      // 如果正在錄製，標記 GAP 並 flush 資料
      if (state.recording) {
        if (gapWarningTimeout) clearTimeout(gapWarningTimeout);
        storage.markGap(new Date().toISOString(), null);
        storage.flushBuffer();
        dom.gapWarning.classList.add('visible');
        dom.gapWarningText.textContent =
          '⚠ Recording interrupted / 記録が中断されました';
      }
      break;
    case 'error':
      dom.statusDotSensor.className = 'status-dot warning';
      dom.statusLabel.textContent = 'Error / エラー';
      break;
    default:
      dom.statusDotSensor.className = 'status-dot';
      dom.statusLabel.textContent = 'Idle / 待機中';
  }
}

// ==========================================
// G 力數字更新
// ==========================================
function updateGForceDisplay(gLong, gLat, gVert, accelMs2) {
  dom.gforceValue.textContent = formatG(gLong);
  dom.gforceLatValue.textContent = formatG(gLat);
  dom.gforceVertValue.textContent = formatG(gVert);
  dom.gforceAccelValue.textContent = accelMs2.toFixed(2);
}

function formatG(value) {
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(2);
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

// ==========================================
// 動態背景顏色
// ==========================================
let lastBgColor = '';
function updateDynamicBackground(gLong) {
  const color = threshold.getColorForG(gLong);
  if (color === lastBgColor) return;
  lastBgColor = color;
  
  const bgStyle = threshold.getBackgroundStyle(gLong);

  document.documentElement.style.setProperty('--dynamic-bg', color);
  document.documentElement.style.setProperty('--dynamic-glow', color);

  // 更新主要 G 力數字的發光色
  if (dom.gforceValue) {
    dom.gforceValue.style.textShadow = `0 0 40px ${color}`;
  }
}

// ==========================================
// G 力指示條
// ==========================================
function updateGForceBar(gLong) {
  // 將 G 力映射到 0~100% 位置 (-1G=0%, 0G=50%, +1G=100%)
  const clampedG = Math.max(-1, Math.min(1, gLong));
  const percent = (clampedG + 1) / 2 * 100;

  // 更新指示球位置
  dom.gforceBarIndicator.style.left = `${percent}%`;
  dom.gforceBarIndicator.style.background = threshold.getColorForG(gLong);

  // 更新填充條（從中心向外擴展）
  const color = threshold.getColorForG(gLong);
  if (gLong >= 0) {
    dom.gforceBarFill.style.left = '50%';
    dom.gforceBarFill.style.width = `${(clampedG / 1) * 50}%`;
  } else {
    const width = (Math.abs(clampedG) / 1) * 50;
    dom.gforceBarFill.style.left = `${50 - width}%`;
    dom.gforceBarFill.style.width = `${width}%`;
  }
  dom.gforceBarFill.style.background = color;
}

// ==========================================
// 門檻穿越偵測與音效
// ==========================================
function checkThresholdCrossings(gLong) {
  const crossings = threshold.checkCrossings(state.prevGLong, gLong);
  if (crossings.length > 0 && audio.isEnabled() && audio.isReady()) {
    for (const t of crossings) {
      audio.playThresholdCrossing(t.value, t.frequency);
    }
  }
}

// ==========================================
// 錄製控制
// ==========================================
function handleRecordToggle() {
  if (state.recording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!state.sensorActive) {
    showToast('Please enable sensors first / 先にセンサーを有効にしてください');
    return;
  }

  state.recording = true;
  state.recordStartPerf = performance.now();
  state.startTime = Date.now();

  // 開始存儲 Session
  const calRecord = sensor.getCalibrationRecord();
  storage.startSession(calRecord);

  // 更新 UI
  dom.btnRecord.classList.add('recording');
  dom.btnRecord.innerHTML = '⏹ Stop Recording / 記録停止';
  dom.statusDotRecording.className = 'status-dot recording';
  dom.statusLabel.textContent = '● REC / 記録中';

  showToast('Recording started / 記録を開始しました ⏺');
}

async function stopRecording() {
  state.recording = false;

  // 結束 Session
  storage.endSession();

  // 更新 UI
  dom.btnRecord.classList.remove('recording');
  dom.btnRecord.innerHTML = '⏺ Start Recording / 記録開始';
  dom.statusDotRecording.className = 'status-dot';
  dom.statusLabel.textContent = 'Active / アクティブ';
  dom.chartTimeLabel.textContent = '0.0s';

  // 更新存儲顯示
  await updateStorageDisplay();

  showToast('Recording saved / 記録を保存しました ✅');
}

// ==========================================
// 校正處理
// ==========================================
async function handleGravityCalibration() {
  if (!state.sensorActive) {
    showToast('Please enable sensors first / 先にセンサーを有効にしてください');
    return;
  }

  // 顯示校正中覆蓋層
  dom.calibratingOverlay.classList.add('visible');
  dom.calibratingText.textContent = 'Step 1: Gravity Calibration / 重力校正中...';
  dom.calibratingSubtext.textContent =
    'Please keep the vehicle stationary on level ground.\n車両を平坦な場所で静止させてください。';

  try {
    const result = await sensor.startGravityCalibration(2000);

    dom.calibratingOverlay.classList.remove('visible');

    if (result.success) {
      dom.calStep1Dot.classList.add('done');
      dom.calStep1Dot.textContent = '✓';
      dom.btnCalForward.disabled = false;

      // 顯示校正結果
      let info = `✅ Gravity calibration complete / 重力校正完了\n`;
      info += `Tilt: Pitch ${result.tiltPitch?.toFixed(1) || '?'}°, Roll ${result.tiltRoll?.toFixed(1) || '?'}°\n`;
      info += `Time: ${new Date().toLocaleString()}`;

      if (result.slopeWarning) {
        info += `\n⚠️ Slope detected! / 傾斜を検出！`;
        showToast('⚠ Slope detected / 傾斜を検出しました');
      }
      if (result.stabilityWarning) {
        info += `\n⚠️ Vibration detected / 振動を検出！`;
        showToast('⚠ Vehicle not stable / 車両が安定していません');
      }

      updateCalibrationDisplay(info);
      showToast('Gravity calibration complete / 重力校正完了 ✅');
    } else {
      showToast('Gravity calibration failed / 重力校正失敗 ❌');
    }
  } catch (err) {
    dom.calibratingOverlay.classList.remove('visible');
    console.error('重力校正錯誤:', err);
    showToast('Calibration error / 校正エラー ❌');
  }
}

async function handleForwardCalibration() {
  if (!state.sensorActive) return;

  dom.calibratingOverlay.classList.add('visible');
  dom.calibratingText.textContent = 'Step 2: Forward Direction / 前進方向設定中...';
  dom.calibratingSubtext.textContent =
    'Drive straight forward for 5 seconds.\n5秒間直進してください。';

  try {
    const result = await sensor.startForwardCalibration(5000);

    dom.calibratingOverlay.classList.remove('visible');

    if (result.success) {
      dom.calStep2Dot.classList.add('done');
      dom.calStep2Dot.textContent = '✓';

      const calRecord = sensor.getCalibrationRecord();
      let info = `✅ Full calibration complete / 完全校正完了\n`;
      info += `Time: ${calRecord?.timestamp || new Date().toISOString()}\n`;
      info += `Tilt: Pitch ${calRecord?.tiltPitch?.toFixed(1) || '?'}°, Roll ${calRecord?.tiltRoll?.toFixed(1) || '?'}°\n`;
      info += `Gravity: [${calRecord?.gravityVector?.x?.toFixed(3) || '?'}, ${calRecord?.gravityVector?.y?.toFixed(3) || '?'}, ${calRecord?.gravityVector?.z?.toFixed(3) || '?'}]`;

      updateCalibrationDisplay(info);
      showToast('Full calibration complete / 完全校正完了 ✅');
    } else {
      showToast('Forward calibration failed / 前進校正失敗 ❌');
    }
  } catch (err) {
    dom.calibratingOverlay.classList.remove('visible');
    console.error('前進校正錯誤:', err);
    showToast('Calibration error / 校正エラー ❌');
  }
}

function updateCalibrationDisplay(text) {
  dom.calibrationRecord.classList.remove('hidden');
  dom.calibrationRecordContent.textContent = text;
}

// ==========================================
// 濾波模式
// ==========================================
function handleFilterModeChange(e) {
  const btn = e.target.closest('.filter-option');
  if (!btn) return;

  const mode = btn.dataset.mode;
  filter.setMode(mode);

  // 同步橫向軸濾波器的模式（sensor 內部的 filterLat）
  if (sensor.filterLat) {
    sensor.filterLat.setMode(mode);
  }

  // 更新 UI
  dom.filterSelector.querySelectorAll('.filter-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ==========================================
// 平滑度滑桿
// ==========================================
function handleSmoothingChange() {
  const value = dom.smoothingSlider.value / 100;
  dom.smoothingValue.textContent = value.toFixed(2);
  filter.setSmoothingStrength(value);
}

// ==========================================
// 取樣率
// ==========================================
function handleSampleRateChange(e) {
  const btn = e.target.closest('.sample-rate-option');
  if (!btn) return;

  state.sampleRate = parseInt(btn.dataset.rate, 10);

  dom.sampleRateSelector.querySelectorAll('.sample-rate-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ==========================================
// 門檻管理
// ==========================================
function renderThresholdList() {
  const thresholds = threshold.getThresholds();
  dom.thresholdList.innerHTML = '';

  for (const t of thresholds) {
    const item = document.createElement('div');
    item.className = 'threshold-item';
    item.innerHTML = `
      <input type="color" class="threshold-color-swatch" value="${t.color}" data-value="${t.value}">
      <span class="threshold-value-display">${t.value > 0 ? '+' : ''}${t.value.toFixed(2)}G</span>
      <span class="threshold-freq">${t.frequency}Hz</span>
      <button class="threshold-remove" data-value="${t.value}" title="Remove / 削除">&times;</button>
    `;
    dom.thresholdList.appendChild(item);
  }

  // 綁定刪除與顏色變更事件
  dom.thresholdList.querySelectorAll('.threshold-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = parseFloat(btn.dataset.value);
      threshold.removeThreshold(value);
      threshold.save();
      renderThresholdList();
      updateChartThresholds();
    });
  });

  dom.thresholdList.querySelectorAll('.threshold-color-swatch').forEach(input => {
    input.addEventListener('change', () => {
      const value = parseFloat(input.dataset.value);
      threshold.updateThreshold(value, { color: input.value });
      threshold.save();
      renderThresholdList();
      updateChartThresholds();
    });
  });
}

function handleThresholdAdd() {
  const inputVal = dom.thresholdAddInput.value.trim();
  if (!inputVal) return;

  const value = parseFloat(inputVal);
  if (isNaN(value)) {
    showToast('Invalid value / 無効な値です');
    return;
  }

  // 檢查是否已存在
  const existing = threshold.getThresholds().find(t => Math.abs(t.value - value) < 0.001);
  if (existing) {
    showToast('Threshold already exists / 閾値は既に存在します');
    return;
  }

  threshold.addThreshold(value);
  threshold.save();
  renderThresholdList();
  updateChartThresholds();
  dom.thresholdAddInput.value = '';

  showToast(`Threshold ${value > 0 ? '+' : ''}${value.toFixed(2)}G added / 閾値を追加しました`);
}

function handleThresholdReset() {
  threshold.resetToDefaults();
  threshold.save();
  renderThresholdList();
  updateChartThresholds();
  showToast('Thresholds reset / 閾値をリセットしました');
}

function updateChartThresholds() {
  if (chart) {
    chart.setThresholdLines(threshold.getThresholds().map(t => ({
      value: t.value,
      color: t.color
    })));
  }
}

// ==========================================
// 音效開關
// ==========================================
function handleAudioToggle() {
  const isOn = dom.toggleAudio.classList.toggle('active');
  audio.setEnabled(isOn);
}

// ==========================================
// 面板開關
// ==========================================
function openPanel(panel) {
  if (panel === 'settings') {
    dom.settingsPanel.classList.add('open');
    dom.settingsOverlay.classList.add('visible');
  } else if (panel === 'history') {
    dom.historyPanel.classList.add('open');
    dom.historyOverlay.classList.add('visible');
  }
}

function closePanel(panel) {
  if (panel === 'settings') {
    dom.settingsPanel.classList.remove('open');
    dom.settingsOverlay.classList.remove('visible');
  } else if (panel === 'history') {
    dom.historyPanel.classList.remove('open');
    dom.historyOverlay.classList.remove('visible');
  }
}

// ==========================================
// 歷史紀錄
// ==========================================
async function renderSessionList() {
  try {
    const sessions = await storage.getSessions();

    if (!sessions || sessions.length === 0) {
      dom.sessionList.innerHTML = '';
      dom.historyEmpty.classList.remove('hidden');
      return;
    }

    dom.historyEmpty.classList.add('hidden');
    dom.sessionList.innerHTML = '';

    // 按時間倒序排列
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';

      const startDate = new Date(session.startTime);
      const duration = session.duration
        ? formatDuration(session.duration)
        : 'N/A';

      item.innerHTML = `
        <div class="session-item-header">
          <span class="session-item-date">${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()}</span>
          <span class="session-item-duration">${duration}</span>
        </div>
        <div class="session-item-meta">
          ${session.dataPointCount || 0} data points / データポイント
          ${session.status === 'recovered' ? ' (Recovered / 復旧済)' : ''}
        </div>
        <div class="session-item-actions">
          <button class="btn btn-ghost btn-download" data-id="${session.id}">💾 Download</button>
          <button class="btn btn-ghost btn-share" data-id="${session.id}">📤 Share</button>
          <button class="btn btn-ghost btn-delete" data-id="${session.id}" style="color: var(--accent-red);">🗑</button>
        </div>
      `;

      dom.sessionList.appendChild(item);
    }

    // 綁定按鈕事件
    dom.sessionList.querySelectorAll('.btn-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        await storage.downloadCSV(btn.dataset.id);
        showToast('CSV downloaded / CSVをダウンロードしました ✅');
      });
    });

    dom.sessionList.querySelectorAll('.btn-share').forEach(btn => {
      btn.addEventListener('click', async () => {
        const success = await storage.shareCSV(btn.dataset.id);
        if (success) {
          showToast('CSV shared / CSVを共有しました ✅');
        }
      });
    });

    dom.sessionList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await storage.deleteSession(btn.dataset.id);
        renderSessionList();
        updateStorageDisplay();
        showToast('Session deleted / セッションを削除しました');
      });
    });

  } catch (err) {
    console.error('歷史紀錄載入錯誤:', err);
  }
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ==========================================
// 存儲使用量顯示
// ==========================================
async function updateStorageDisplay() {
  try {
    const sessions = await storage.getSessions();
    const count = sessions ? sessions.length : 0;
    dom.storageSessionsCount.textContent = `${count} sessions / セッション`;

    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const usedMB = ((est.usage || 0) / 1024 / 1024).toFixed(1);
      const quotaMB = ((est.quota || 0) / 1024 / 1024).toFixed(0);
      const percent = est.quota ? ((est.usage / est.quota) * 100).toFixed(1) : 0;
      dom.storageUsed.textContent = `${usedMB} MB`;
      dom.storageBarFill.style.width = `${Math.min(100, percent)}%`;
    }
  } catch (err) {
    console.error('存儲估算錯誤:', err);
  }
}

async function handleClearAllSessions() {
  if (state.recording) {
    showToast('Stop recording first / 先に記録を停止してください');
    return;
  }

  await storage.deleteAllSessions();
  await updateStorageDisplay();
  showToast('All data deleted / 全データを削除しました');
}

// ==========================================
// 未完成 Session 恢復
// ==========================================
async function checkUnfinishedSession() {
  try {
    const sessionId = await storage.checkUnfinishedSession();
    if (sessionId) {
      dom.recoveryModal.classList.add('visible');
      dom.recoveryModal.dataset.sessionId = sessionId;
    }
  } catch (err) {
    console.error('恢復檢查錯誤:', err);
  }
}

async function handleRecoveryRecover() {
  const sessionId = dom.recoveryModal.dataset.sessionId;
  if (sessionId) {
    await storage.recoverSession(sessionId);
    showToast('Session recovered / セッションを復旧しました ✅');
  }
  dom.recoveryModal.classList.remove('visible');
}

async function handleRecoveryDiscard() {
  const sessionId = dom.recoveryModal.dataset.sessionId;
  if (sessionId) {
    await storage.deleteSession(sessionId);
  }
  dom.recoveryModal.classList.remove('visible');
}

// ==========================================
// 螢幕常亮 (Wake Lock)
// ==========================================
async function acquireWakeLock() {
  try {
    // 優先嘗試 Wake Lock API
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        // 在 release 時，不能直接 request (如果仍在背景會 Throw Error)
        // 交由 visibilitychange 事件來恢復
      });
      return;
    }
  } catch (err) {
    console.warn('Wake Lock API 不可用，使用 fallback:', err);
  }

  // Fallback: 播放無聲影片防止螢幕鎖定
  try {
    const video = dom.wakeLockVideo;
    // 建立極小的 base64 無聲影片
    video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA' +
      'NBtZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4' +
      'yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub' +
      '3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MDo' +
      'weGxldiBlc3Bhc2VkX3F1YW50PTEgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZX' +
      'Q9LTIgdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVy' +
      'YXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAgc2' +
      'NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTI' +
      'zLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAw';
    video.play().catch(() => { /* 忽略自動播放限制 */ });
  } catch (err) {
    console.warn('Wake lock fallback 失敗:', err);
  }
}

// ==========================================
// 防止重新整理
// ==========================================
function setupBeforeUnload() {
  // beforeunload (PC/Android 有效，iOS Safari 不可靠)
  window.addEventListener('beforeunload', (e) => {
    if (state.recording || state.sensorActive) {
      e.preventDefault();
      e.returnValue = 'The data will be lost if the site is reloaded. Are you sure to reload the page?';
      return e.returnValue;
    }
  });

  // visibilitychange (iOS Safari 較可靠)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (state.recording) {
        storage.flushBuffer();
      }
    } else if (document.visibilityState === 'visible') {
      if (state.sensorActive) {
        acquireWakeLock(); // 回到前景時嘗試恢復 Wake Lock
      }
    }
  });

  // pagehide (iOS Safari 最可靠)
  window.addEventListener('pagehide', () => {
    if (state.recording) {
      storage.flushBuffer();
    }
  });
}

// ==========================================
// Service Worker 註冊
// ==========================================
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service Worker 註冊失敗:', err);
    }
  }
}

// ==========================================
// Toast 通知
// ==========================================
let toastTimer = null;
function showToast(message, duration = 2500) {
  if (toastTimer) clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('visible');
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('visible');
  }, duration);
}

// ==========================================
// 視窗大小變更 (由 chart 模組內部自行處理)
// ==========================================

// ==========================================
// 啟動應用程式
// ==========================================
document.addEventListener('DOMContentLoaded', init);
