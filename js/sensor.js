import { HybridOptimalFilter } from './filter.js';

/** 3D vector helpers. */
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

const Mat3 = {
  multiplyVec: (m, v) => ({
    x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
    y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
    z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z
  })
};

export class SensorManager {
  constructor() {
    this.onData = null;
    this.onStatusChange = null;
    this.onCalibrationComplete = null;
    this.isListening = false;
    this.lastTimestamp = -1;
    this.lastPauseTime = 0;
    this.boundHandleMotion = this.handleMotion.bind(this);
    this.boundHandleVisibility = this.handleVisibility.bind(this);
    this.filterLong = new HybridOptimalFilter();
    this.filterLat = new HybridOptimalFilter();
    this.gyroCompensationEnabled = true;
    this.dynamicPitch = 0;
    this.dynamicRoll = 0;
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
    this.isCalibrating = false;
    this.calibrationBuffer = [];
  }

  async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        return (await DeviceMotionEvent.requestPermission()) === 'granted';
      } catch (err) {
        console.error(err);
        return false;
      }
    }
    return 'DeviceMotionEvent' in window;
  }

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

  stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    window.removeEventListener('devicemotion', this.boundHandleMotion);
    document.removeEventListener('visibilitychange', this.boundHandleVisibility);
    if (this.onStatusChange) this.onStatusChange('idle');
  }

  handleVisibility() {
    if (document.hidden) {
      this.lastPauseTime = performance.now();
      if (this.onStatusChange) this.onStatusChange('suspended');
    } else if (this.onStatusChange) {
      this.onStatusChange('listening');
    }
  }

  handleMotion(event) {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null) return;

    const currentTimestamp = performance.now();
    let dt = this.lastTimestamp === -1 ? 0 : (currentTimestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = currentTimestamp;
    let gapFlag = false;
    if (dt > 1) {
      gapFlag = true;
      dt = 0.016;
    }
    if (dt <= 0) dt = 0.016;

    const rawVec = { x: accel.x, y: accel.y, z: accel.z };
    if (this.isCalibrating) this.calibrationBuffer.push(rawVec);

    const rot = event.rotationRate;
    if (this.gyroCompensationEnabled && rot && rot.alpha !== null) {
      const rawGyro = {
        x: (rot.beta || 0) * (Math.PI / 180),
        y: (rot.gamma || 0) * (Math.PI / 180),
        z: (rot.alpha || 0) * (Math.PI / 180)
      };
      let gyroPitchRate = rawGyro.x;
      let gyroRollRate = rawGyro.y;
      if (this.isCalibrated()) {
        const vehicleGyro = Mat3.multiplyVec(this.calibRecord.rotationMatrix, rawGyro);
        gyroPitchRate = vehicleGyro.x;
        gyroRollRate = vehicleGyro.y;
      }
      this.dynamicPitch += gyroPitchRate * dt;
      this.dynamicRoll += gyroRollRate * dt;
      const decay = Math.exp(-2 * dt);
      this.dynamicPitch *= decay;
      this.dynamicRoll *= decay;
    }

    let gLong = 0;
    let gLat = 0;
    let gVert = 0;
    if (this.isCalibrated()) {
      const vehicleVec = Mat3.multiplyVec(this.calibRecord.rotationMatrix, rawVec);
      const rawGLong = vehicleVec.y / 9.80665;
      const rawGLat = vehicleVec.x / 9.80665;
      if (this.gyroCompensationEnabled) {
        gLong = rawGLong - Math.sin(this.dynamicPitch);
        gLat = rawGLat - Math.sin(this.dynamicRoll);
      } else {
        gLong = rawGLong;
        gLat = rawGLat;
      }
      gVert = vehicleVec.z / 9.80665 - 1;
    } else {
      gLat = rawVec.x / 9.80665;
      gLong = -rawVec.z / 9.80665;
      gVert = rawVec.y / 9.80665 - 1;
    }

    const filteredGLong = this.filterLong.filter(gLong, dt);
    const filteredGLat = this.filterLat.filter(gLat, dt);
    if (this.onData) {
      this.onData({
        timestamp: currentTimestamp, dt,
        rawX: rawVec.x, rawY: rawVec.y, rawZ: rawVec.z,
        gLong, gLat, gVert, filteredGLong, filteredGLat,
        accelMs2Long: filteredGLong * 9.80665,
        accelMs2Lat: filteredGLat * 9.80665,
        gapFlag
      });
    }
  }

  /** Step 1: stationary gravity calibration. */
  startGravityCalibration(durationMs = 2000) {
    return new Promise((resolve, reject) => {
      this.isCalibrating = true;
      this.calibrationBuffer = [];
      setTimeout(() => {
        this.isCalibrating = false;
        if (this.calibrationBuffer.length === 0) {
          reject(new Error('未收到任何資料'));
          return;
        }

        const meanVec = this.calibrationBuffer.reduce((acc, val) => Vec3.add(acc, val), { x: 0, y: 0, z: 0 });
        meanVec.x /= this.calibrationBuffer.length;
        meanVec.y /= this.calibrationBuffer.length;
        meanVec.z /= this.calibrationBuffer.length;

        let varianceSum = 0;
        this.calibrationBuffer.forEach(val => {
          const dx = val.x - meanVec.x;
          const dy = val.y - meanVec.y;
          const dz = val.z - meanVec.z;
          varianceSum += dx * dx + dy * dy + dz * dz;
        });
        const stdDev = Math.sqrt(varianceSum / this.calibrationBuffer.length);
        const stabilityWarning = stdDev > 0.15;
        const gMag = Vec3.mag(meanVec);
        const slopeWarning = Math.abs(gMag - 9.81) > 0.3;
        const zHat = Vec3.normalize(meanVec);
        const tiltPitch = Math.atan2(meanVec.x, meanVec.z) * (180 / Math.PI);
        const tiltRoll = Math.atan2(meanVec.y, meanVec.z) * (180 / Math.PI);

        let tempXHat = { x: 0, y: 1, z: 0 };
        if (Math.abs(Vec3.dot(tempXHat, zHat)) > 0.95) tempXHat = { x: 0, y: 0, z: -1 };
        tempXHat = Vec3.normalize(Vec3.sub(tempXHat, Vec3.scale(zHat, Vec3.dot(tempXHat, zHat))));
        const tempYHat = Vec3.cross(zHat, tempXHat);
        const R = [
          [-tempYHat.x, -tempYHat.y, -tempYHat.z],
          [tempXHat.x, tempXHat.y, tempXHat.z],
          [zHat.x, zHat.y, zHat.z]
        ];

        this.calibRecord.gravityVector = meanVec;
        this.calibRecord.rotationMatrix = R;
        this.calibRecord.gravityMagnitude = gMag;
        this.calibRecord.tiltPitch = tiltPitch;
        this.calibRecord.tiltRoll = tiltRoll;
        this.calibRecord.stabilityWarning = stabilityWarning;
        this.calibRecord.slopeWarning = slopeWarning;
        this.calibRecord.step1Complete = true;
        this.calibRecord.step2Complete = false;
        resolve({ success: true, stabilityWarning, slopeWarning, tiltPitch, tiltRoll, gravityMagnitude: gMag });
      }, durationMs);
    });
  }

  /** Step 2: determine the forward axis from straight-line acceleration. */
  startForwardCalibration(durationMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.calibRecord.step1Complete) {
        reject(new Error('必須先完成重力校正 (Step 1)'));
        return;
      }

      this.isCalibrating = true;
      this.calibrationBuffer = [];
      setTimeout(() => {
        this.isCalibrating = false;
        try {
          if (this.calibrationBuffer.length === 0) {
            reject(new Error('未收到任何資料'));
            return;
          }

          // gravityVector is the measured gravity (about 9.81 m/s²), not a unit vector.
          // Normalize it before projecting gravity out of each acceleration sample.
          const zHat = Vec3.normalize(this.calibRecord.gravityVector);
          let sumHoriz = { x: 0, y: 0, z: 0 };
          this.calibrationBuffer.forEach(a => {
            const dot = Vec3.dot(a, zHat);
            const zProj = Vec3.scale(zHat, dot);
            sumHoriz = Vec3.add(sumHoriz, Vec3.sub(a, zProj));
          });

          // Vec3 exposes mag(), not magnitude(). The previous call threw inside this
          // timer callback, leaving the awaiting UI promise unsettled forever.
          const magHoriz = Vec3.mag(sumHoriz) / this.calibrationBuffer.length;
          if (magHoriz < 0.05) {
            resolve({ success: false, error: 'Insufficient forward acceleration' });
            return;
          }

          let xHat = Vec3.normalize(sumHoriz);
          xHat = Vec3.normalize(Vec3.sub(xHat, Vec3.scale(zHat, Vec3.dot(xHat, zHat))));
          const yHat = Vec3.cross(zHat, xHat);
          const R = [
            [-yHat.x, -yHat.y, -yHat.z],
            [xHat.x, xHat.y, xHat.z],
            [zHat.x, zHat.y, zHat.z]
          ];

          this.calibRecord.forwardVector = xHat;
          this.calibRecord.rotationMatrix = R;
          this.calibRecord.step2Complete = true;
          this.calibRecord.timestamp = new Date().toISOString();
          if (this.onCalibrationComplete) this.onCalibrationComplete(this.calibRecord);
          resolve({ success: true, ...this.calibRecord });
        } catch (err) {
          reject(err);
        }
      }, durationMs);
    });
  }

  getCalibrationRecord() {
    return this.calibRecord;
  }

  isCalibrated() {
    return this.calibRecord.step1Complete;
  }

  setFilter(filter) {
    if (filter) {
      this.filterLong = filter;
      this.filterLat = new HybridOptimalFilter();
      this.filterLat.setMode(filter.getMode());
      this.filterLat.setSmoothingStrength(filter.smoothingStrength || 0.5);
    }
  }
}
