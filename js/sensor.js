import { HybridOptimalFilter } from './filter.js';

/**
 * 三維向量輔助工具
 */
const Vec3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }),
  mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  normalize: (v) => {
    const m = Vec3.mag(v);
    return m === 0 ? { x: 0, y: 0, z: 0 } : Vec3.scale(v, 1 / m);
  }
};

/**
 * 矩陣輔助工具
 */
const Mat3 = {
  // 將向量 v 乘上旋轉矩陣 m
  multiplyVec: (m, v) => ({
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z
  })
};

export class SensorManager {
  constructor() {
    // 回呼屬性
    this.onData = null;
    this.onStatusChange = null;
    this.onCalibrationComplete = null;

    // 內部狀態
    this.isListening = false;
    this.lastTimestamp = -1;
    this.lastPauseTime = 0;
    this.boundHandleMotion = this.handleMotion.bind(this);
    this.boundHandleVisibility = this.handleVisibility.bind(this);
    
    // 濾波器實例 (針對縱向、橫向獨立實例)
    this.filterLong = new HybridOptimalFilter();
    this.filterLat = new HybridOptimalFilter();

    // 陀螺儀動態傾角補償 (Pitch / Roll)
    this.gyroCompensationEnabled = true;
    this.dynamicPitch = 0;
    this.dynamicRoll = 0;

    // 校正狀態
    this.calibRecord = {
      timestamp: null,
      gravityVector: null,
      forwardVector: null,
      rotationMatrix: null,
      tiltPitch: 0,
      tiltRoll: 0,
      gravityMagnitude: 0,
      slopeWarning: false,
      stabilityWarning: false,
      step1Complete: false,
      step2Complete: false
    };

    // 收集資料用的緩衝
    this.isCalibrating = false;
    this.calibrationBuffer = [];
  }

  /**
   * 請求 iOS 的 DeviceMotion 權限
   * @returns {Promise<boolean>} 授權結果
   */
  async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        return result === 'granted';
      } catch (err) {
        console.error(err);
        return false;
      }
    }
    // 非 iOS 瀏覽器直接回傳 true
    return 'DeviceMotionEvent' in window;
  }

  /**
   * 開始監聽感測器
   */
  startListening() {
    if (this.isListening) return;
    
    this.isListening = true;
    this.lastTimestamp = -1;
    this.filterLong.reset();
    this.filterLat.reset();
    
    window.addEventListener('devicemotion', this.boundHandleMotion);
    document.addEventListener('visibilitychange', this.boundHandleVisibility);
    
    if (this.onStatusChange) this.onStatusChange('listening');
  }

  /**
   * 停止監聽感測器
   */
  stopListening() {
    if (!this.isListening) return;

    this.isListening = false;
    window.removeEventListener('devicemotion', this.boundHandleMotion);
    document.removeEventListener('visibilitychange', this.boundHandleVisibility);

    if (this.onStatusChange) this.onStatusChange('idle');
  }

  /**
   * 處理 visibilitychange 事件，支援應用程式在背景暫停時的處理
   */
  handleVisibility() {
    if (document.hidden) {
      this.lastPauseTime = performance.now();
      if (this.onStatusChange) this.onStatusChange('suspended');
    } else {
      // 回到前景，不做任何事，保留 lastTimestamp 讓下次 handleMotion 算出巨大的 dt 從而觸發 gapFlag
      if (this.onStatusChange) this.onStatusChange('listening');
    }
  }

  /**
   * 處理 DeviceMotion 事件
   */
  handleMotion(event) {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null) return;

    const currentTimestamp = performance.now();
    
    // 計算實際 dt
    let dt = 0;
    if (this.lastTimestamp !== -1) {
      dt = (currentTimestamp - this.lastTimestamp) / 1000.0;
    }
    this.lastTimestamp = currentTimestamp;

    // 防止異常的 dt 值 (例如應用程式回到前景)
    // 偵測中斷缺口：dt > 1 秒表示可能被暫停過
    let gapFlag = false;
    if (dt > 1.0) {
      gapFlag = true;
      dt = 0.016; // 重置為預設約 60fps
    }
    if (dt <= 0) dt = 0.016;
    
    const rawVec = { x: accel.x, y: accel.y, z: accel.z };

    // 如果正在校正階段，收集資料
    if (this.isCalibrating) {
      this.calibrationBuffer.push(rawVec);
    }

    // 讀取陀螺儀角速度 (deg/s)
    const rot = event.rotationRate;
    if (this.gyroCompensationEnabled && rot && rot.alpha !== null) {
      // 將角速度 (deg/s) 轉為 rad/s
      const rawGyro = { 
        x: (rot.beta || 0) * (Math.PI / 180),
        y: (rot.gamma || 0) * (Math.PI / 180),
        z: (rot.alpha || 0) * (Math.PI / 180)
      };
      
      let gyroPitchRate = rawGyro.x;
      let gyroRollRate = rawGyro.y;
      
      if (this.isCalibrated()) {
         // 將 gyro 旋轉到車體座標 (x=lateral, y=longitudinal, z=vertical)
         const vehicleGyro = Mat3.multiplyVec(this.calibRecord.rotationMatrix, rawGyro);
         gyroPitchRate = vehicleGyro.x; // 繞 x 軸旋轉是 Pitch
         gyroRollRate = vehicleGyro.y;  // 繞 y 軸旋轉是 Roll
      }

      // 互補濾波估算動態 Pitch / Roll 傾角 (以靜止校正為基準)
      this.dynamicPitch += gyroPitchRate * dt;
      this.dynamicRoll += gyroRollRate * dt;

      // 時間相關衰減項：高通濾波特性，避免陀螺儀漂移 (drift) 累積
      const decay = Math.exp(-2.0 * dt);
      this.dynamicPitch *= decay;
      this.dynamicRoll *= decay;
    }

    let gLong = 0;
    let gLat = 0;
    let gVert = 0;

    if (this.isCalibrated()) {
      // 套用旋轉矩陣 R 轉換到車體座標
      const vehicleVec = Mat3.multiplyVec(this.calibRecord.rotationMatrix, rawVec);
      
      // x=lateral, y=longitudinal, z=vertical
      let rawGLong = vehicleVec.y / 9.80665;
      let rawGLat = vehicleVec.x / 9.80665;
      
      // 扣除因為點頭 (Pitch) 與側傾 (Roll) 洩漏進來的重力分量 sin(theta)
      if (this.gyroCompensationEnabled) {
        gLong = rawGLong - Math.sin(this.dynamicPitch);
        gLat = rawGLat - Math.sin(this.dynamicRoll);
      } else {
        gLong = rawGLong;
        gLat = rawGLat;
      }
      
      gVert = (vehicleVec.z / 9.80665) - 1.0; // 減去 1G 靜止重力
    } else {
      // 如果未校正：假設手機直立，top 朝車頭
      gLat = rawVec.x / 9.80665;
      gLong = -rawVec.z / 9.80665; 
      gVert = (rawVec.y / 9.80665) - 1.0;
    }

    // 進行濾波
    const filteredGLong = this.filterLong.filter(gLong, dt);
    const filteredGLat = this.filterLat.filter(gLat, dt);

    if (this.onData) {
      this.onData({
        timestamp: currentTimestamp,
        dt,
        rawX: rawVec.x,
        rawY: rawVec.y,
        rawZ: rawVec.z,
        gLong,
        gLat,
        gVert,
        filteredGLong,
        filteredGLat,
        accelMs2Long: filteredGLong * 9.80665,
        accelMs2Lat: filteredGLat * 9.80665,
        gapFlag
      });
    }
  }

  /**
   * Step 1: 靜止重力校正
   * @param {number} durationMs - 收集時長
   * @returns {Promise<object>} 校正結果
   */
  startGravityCalibration(durationMs = 2000) {
    return new Promise((resolve, reject) => {
      this.isCalibrating = true;
      this.calibrationBuffer = [];

      setTimeout(() => {
        this.isCalibrating = false;
        if (this.calibrationBuffer.length === 0) {
          return reject(new Error('未收到任何資料'));
        }

        // 1. 計算平均向量
        const meanVec = this.calibrationBuffer.reduce(
          (acc, val) => Vec3.add(acc, val), 
          {x: 0, y: 0, z: 0}
        );
        meanVec.x /= this.calibrationBuffer.length;
        meanVec.y /= this.calibrationBuffer.length;
        meanVec.z /= this.calibrationBuffer.length;

        // 2. 計算標準差 σ
        let varianceSum = 0;
        this.calibrationBuffer.forEach(val => {
          const dx = val.x - meanVec.x;
          const dy = val.y - meanVec.y;
          const dz = val.z - meanVec.z;
          varianceSum += (dx*dx + dy*dy + dz*dz);
        });
        const stdDev = Math.sqrt(varianceSum / this.calibrationBuffer.length);
        const stabilityWarning = stdDev > 0.15;

        // 3. 檢查重力大小
        const gMag = Vec3.mag(meanVec);
        const slopeWarning = Math.abs(gMag - 9.81) > 0.3;

        // 4. 計算 upward 單位向量 ẑ
        const zHat = Vec3.normalize(meanVec);

        // 5. 計算傾角
        const tiltPitch = Math.atan2(meanVec.x, meanVec.z) * (180 / Math.PI);
        const tiltRoll = Math.atan2(meanVec.y, meanVec.z) * (180 / Math.PI);

        // 6. 建立暫時的旋轉矩陣 (假設手機上方為臨時前方)
        let tempXHat = { x: 0, y: 1, z: 0 }; 
        if (Math.abs(Vec3.dot(tempXHat, zHat)) > 0.95) {
           tempXHat = { x: 0, y: 0, z: -1 }; // 如果手機平放，改用螢幕法線當作前方
        }
        // 正交化
        tempXHat = Vec3.normalize(Vec3.sub(tempXHat, Vec3.scale(zHat, Vec3.dot(tempXHat, zHat))));
        const tempYHat = Vec3.cross(zHat, tempXHat);

        const R = [
          [-tempYHat.x, -tempYHat.y, -tempYHat.z],
          [ tempXHat.x,  tempXHat.y,  tempXHat.z],
          [ zHat.x,  zHat.y,  zHat.z]
        ];

        // 記錄結果
        this.calibRecord.gravityVector = meanVec;
        this.calibRecord.rotationMatrix = R;
        this.calibRecord.gravityMagnitude = gMag;
        this.calibRecord.tiltPitch = tiltPitch;
        this.calibRecord.tiltRoll = tiltRoll;
        this.calibRecord.stabilityWarning = stabilityWarning;
        this.calibRecord.slopeWarning = slopeWarning;
        this.calibRecord.step1Complete = true;
        this.calibRecord.step2Complete = false; // 需要重新執行 Step 2

        resolve({ success: true, stabilityWarning, slopeWarning, tiltPitch, tiltRoll, gravityMagnitude: gMag });
      }, durationMs);
    });
  }

  /**
   * Step 2: 直線前進校正
   * @param {number} durationMs - 收集時長
   * @returns {Promise<object>} 校正結果
   */
  startForwardCalibration(durationMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.calibRecord.step1Complete) {
        return reject(new Error('必須先完成重力校正 (Step 1)'));
      }

      this.isCalibrating = true;
      this.calibrationBuffer = [];

      setTimeout(() => {
        this.isCalibrating = false;
        if (this.calibrationBuffer.length === 0) {
          return reject(new Error('未收到任何資料'));
        }

        const zHat = this.calibRecord.gravityVector;
        let sumHoriz = {x: 0, y: 0, z: 0};

        // 提取並加總水平加速度
        this.calibrationBuffer.forEach(a => {
          const dot = Vec3.dot(a, zHat);
          const zProj = Vec3.scale(zHat, dot);
          const aHoriz = Vec3.sub(a, zProj);
          sumHoriz = Vec3.add(sumHoriz, aHoriz);
        });

        // 簡化 PCA：取平均方向為 forward
        const magHoriz = Vec3.magnitude(sumHoriz) / this.calibrationBuffer.length;
        if (magHoriz < 0.05) {
          // 沒有足夠的水平加速度，無法判定前進方向
          resolve({ success: false, error: 'Insufficient forward acceleration' });
          return;
        }

        let xHat = Vec3.normalize(sumHoriz);

        // 確保正交性
        const dotXZ = Vec3.dot(xHat, zHat);
        xHat = Vec3.normalize(Vec3.sub(xHat, Vec3.scale(zHat, dotXZ)));

        // yHat = zHat cross xHat
        const yHat = Vec3.cross(zHat, xHat);

        // 建立旋轉矩陣 (轉置，將世界座標轉為車體座標)
        // 車體座標: x=lateral(左右), y=longitudinal(前後), z=vertical(上下)
        // [ xHat.x, xHat.y, xHat.z ]
        // [ yHat.x, yHat.y, yHat.z ]
        // [ zHat.x, zHat.y, zHat.z ]
        
        // 由於 xHat 代表前方，yHat 代表左側，將其對應：
        // 讓車體的 X 軸 = -yHat (向右為正)
        // 讓車體的 Y 軸 = xHat (向前為正)
        // 讓車體的 Z 軸 = zHat (向上為正)

        const R = [
          [-yHat.x, -yHat.y, -yHat.z], // Lateral (X)
          [ xHat.x,  xHat.y,  xHat.z], // Longitudinal (Y)
          [ zHat.x,  zHat.y,  zHat.z]  // Vertical (Z)
        ];

        this.calibRecord.forwardVector = xHat;
        this.calibRecord.rotationMatrix = R;
        this.calibRecord.step2Complete = true;
        this.calibRecord.timestamp = new Date().toISOString();

        if (this.onCalibrationComplete) {
          this.onCalibrationComplete(this.calibRecord);
        }

        resolve({ success: true, ...this.calibRecord });
      }, durationMs);
    });
  }

  /**
   * 獲取校正紀錄
   */
  getCalibrationRecord() {
    return this.calibRecord;
  }

  /**
   * 是否已完成基本的重力校正 (允許轉換座標系)
   */
  isCalibrated() {
    return this.calibRecord.step1Complete;
  }

  /**
   * 覆寫濾波器配置 (如果需要自訂參數)
   * @param {HybridOptimalFilter} filter - 要共用的濾波器實例，通常需要為長寬各準備一個
   */
  setFilter(filter) {
    if (filter) {
      this.filterLong = filter;
      this.filterLat = new HybridOptimalFilter();
      this.filterLat.setMode(filter.getMode());
      this.filterLat.setSmoothingStrength(filter.smoothingStrength || 0.5);
    }
  }
}
