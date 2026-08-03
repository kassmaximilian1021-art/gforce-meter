export class StorageManager {
  constructor() {
    this.dbName = 'gforce-meter-db';
    this.dbVersion = 1;
    this.db = null;
    
    this.buffer = [];
    this.flushIntervalId = null;
    this.sessionId = null;
    this.isRecordingSession = false;
  }

  // 開啟 IndexedDB
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 建立 sessions 儲存區
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        
        // 建立 datapoints 儲存區
        if (!db.objectStoreNames.contains('datapoints')) {
          const dpStore = db.createObjectStore('datapoints', { autoIncrement: true });
          dpStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this._setupEventListeners();
        resolve();
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  _setupEventListeners() {
    // 處理頁面隱藏或關閉時的資料寫入
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.buffer.length > 0) {
        this.flushBuffer();
      }
    });

    window.addEventListener('pagehide', () => {
      if (this.buffer.length > 0) {
        this.flushBuffer();
      }
    });
  }

  // 開始紀錄並返回 sessionId (UUID)
  startSession(calibrationRecord) {
    this.sessionId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);
    this.isRecordingSession = true;
    this.buffer = [];
    
    const sessionMeta = {
      id: this.sessionId,
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      dataPointCount: 0,
      calibrationRecord: calibrationRecord,
      status: 'recording',
      gaps: []
    };

    // 寫入 Session Metadata
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    store.put(sessionMeta);

    // 每秒定時批次寫入緩衝區資料
    this.flushIntervalId = setInterval(() => this.flushBuffer(), 1000);
    // 定期 flush
    if (this.flushIntervalId) clearInterval(this.flushIntervalId);
    this.flushIntervalId = setInterval(() => {
      this.flushBuffer().catch(e => console.error('Auto flush error:', e));
    }, 1000);

    return this.sessionId;
  }

  // 加入記憶體緩衝
  addDataPoint(data) {
    if (!this.isRecordingSession) return;
    this.buffer.push({
      sessionId: this.sessionId,
      ...data
    });
    
    // 緩衝區達到一定大小也觸發寫入 (約 1 秒的資料量)
    if (this.buffer.length >= 60) {
      this.flushBuffer().catch(e => console.error('Buffer flush error:', e));
    }
  }

  // 批次寫入 IndexedDB
  async flushBuffer() {
    if (this.buffer.length === 0 || !this.db) return;

    const itemsToFlush = [...this.buffer];
    this.buffer = [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['datapoints', 'sessions'], 'readwrite');
      const dpStore = transaction.objectStore('datapoints');
      const sessionStore = transaction.objectStore('sessions');

      // 寫入所有資料點
      itemsToFlush.forEach(item => {
        dpStore.add(item);
      });

      // 更新 session 的資料點總數
      const getReq = sessionStore.get(this.sessionId);
      getReq.onsuccess = () => {
        const session = getReq.result;
        if (session) {
          session.dataPointCount += itemsToFlush.length;
          sessionStore.put(session);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  }

  // flush + 標記結束
  async endSession() {
    if (!this.isRecordingSession || !this.sessionId) return;

    clearInterval(this.flushIntervalId);
    this.flushIntervalId = null;
    await this.flushBuffer(); // 將剩餘緩衝區資料寫入

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const getReq = store.get(this.sessionId);

      getReq.onsuccess = () => {
        const session = getReq.result;
        if (session) {
          session.endTime = new Date().toISOString();
          session.status = 'completed';
          const start = new Date(session.startTime).getTime();
          const end = new Date(session.endTime).getTime();
          session.duration = end - start;
          
          store.put(session);
        }
      };

      transaction.oncomplete = () => {
        this.isRecordingSession = false;
        this.sessionId = null;
        resolve();
      };
      transaction.onerror = (e) => reject(e.target.error);
    });
  }

  isRecording() {
    return this.isRecordingSession;
  }

  getSessionId() {
    return this.sessionId;
  }

  // 標記中斷缺口
  markGap(startTime, endTime) {
    if (!this.isRecordingSession || !this.sessionId || !this.db) return;
    
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const getReq = store.get(this.sessionId);

    getReq.onsuccess = () => {
      const session = getReq.result;
      if (session) {
        const gap = { startTime, endTime: endTime || new Date().toISOString(), duration: 0 };
        // 使用 Date 物件計算時間差，處理 ISO 字串
        if (startTime && gap.endTime) {
          gap.duration = (new Date(gap.endTime) - new Date(startTime)) / 1000;
        }
        session.gaps.push(gap);
        store.put(session);
      }
    };
  }

  // 尋找未完成的 session
  async checkUnfinishedSession() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(null);
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result;
        const unfinished = sessions.find(s => s.status === 'recording');
        resolve(unfinished ? unfinished.id : null);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // 恢復 session
  async recoverSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const getReq = store.get(sessionId);

      getReq.onsuccess = () => {
        const session = getReq.result;
        if (session) {
          session.status = 'recovered';
          store.put(session);
          
          this.sessionId = sessionId;
          this.isRecordingSession = true;
          this.buffer = [];
          if (this.flushIntervalId) clearInterval(this.flushIntervalId);
          this.flushIntervalId = setInterval(() => {
            this.flushBuffer().catch(e => console.error('Auto flush error:', e));
          }, 1000);
          resolve(true);
        } else {
          resolve(false);
        }
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  async getSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getSessionData(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['datapoints'], 'readonly');
      const store = transaction.objectStore('datapoints');
      const index = store.index('sessionId');
      const request = index.getAll(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'datapoints'], 'readwrite');
      const sessionStore = transaction.objectStore('sessions');
      const dpStore = transaction.objectStore('datapoints');
      const dpIndex = dpStore.index('sessionId');
      
      sessionStore.delete(sessionId);
      
      const req = dpIndex.openKeyCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          dpStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteAllSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'datapoints'], 'readwrite');
      transaction.objectStore('sessions').clear();
      transaction.objectStore('datapoints').clear();
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e.target.error);
    });
  }

  // 取得儲存空間估算量
  async getStorageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return { used: estimate.usage, quota: estimate.quota };
    }
    return { used: 0, quota: 0 };
  }

  // 產生 CSV 內容並回傳 Blob (避免記憶體 OOM)
  async generateCSVBlob(sessionId) {
    const sessions = await this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) throw new Error('找不到指定的 Session');

    const cal = session.calibrationRecord || {};

    // 格式化 Duration
    const durMs = session.duration || 0;
    const hrs = Math.floor(durMs / 3600000).toString().padStart(2, '0');
    const mins = Math.floor((durMs % 3600000) / 60000).toString().padStart(2, '0');
    const secs = Math.floor((durMs % 60000) / 1000).toString().padStart(2, '0');
    const ms = (durMs % 1000).toString().padStart(3, '0');

    const chunks = [];
    let header = `# G-Force Meter - Vehicle Test Log\n`;
    header += `# App Version: 1.0.0\n`;
    header += `# Session ID: ${session.id}\n`;
    header += `# Recording Start: ${session.startTime}\n`;
    header += `# Recording End: ${session.endTime || 'Ongoing'}\n`;
    header += `# Duration: ${hrs}:${mins}:${secs}.${ms}\n`;
    
    header += `# --- Calibration Record ---\n`;
    header += `# Calibration Time: ${cal.timestamp || ''}\n`;
    header += `# Gravity Vector: x=${cal.gravityVector?.x||''}, y=${cal.gravityVector?.y||''}, z=${cal.gravityVector?.z||''}\n`;
    header += `# Forward Vector: x=${cal.forwardVector?.x||''}, y=${cal.forwardVector?.y||''}, z=${cal.forwardVector?.z||''}\n`;
    header += `# Tilt Pitch: ${cal.tiltPitch||''}°, Roll: ${cal.tiltRoll||''}°\n`;
    header += `# Gravity Magnitude: ${cal.gravityMagnitude||''} m/s²\n`;
    header += `# Slope Warning: ${cal.slopeWarning ? 'yes' : 'no'}\n`;
    header += `# Filter Mode: ${cal.filterMode||'hybrid'}\n`;
    header += `# --- Data ---\n`;
    header += `Elapsed(s),Timestamp,G_Long_Filtered,G_Lat_Filtered,G_Long_Raw,G_Lat_Raw,Accel_Long(m/s²),Accel_Lat(m/s²),Status\n`;
    header += `RECORDING_START,${session.startTime},,,,,,,,\n`;
    
    chunks.push(header);

    // 使用 Cursor 逐筆讀取以避免 OOM
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(['datapoints'], 'readonly');
      const store = tx.objectStore('datapoints');
      const index = store.index('sessionId');
      const request = index.openCursor(IDBKeyRange.only(sessionId));

      let batch = '';
      let count = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const pt = cursor.value;
          batch += `${pt.elapsed || ''},${pt.timestamp || ''},${pt.gLongFiltered || ''},${pt.gLatFiltered || ''},${pt.gLongRaw || ''},${pt.gLatRaw || ''},${pt.accelLong || ''},${pt.accelLat || ''},${pt.status || 'normal'}\n`;
          count++;
          
          if (count >= 1000) {
            chunks.push(batch);
            batch = '';
            count = 0;
          }
          cursor.continue();
        } else {
          if (batch.length > 0) chunks.push(batch);
          resolve();
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });

    let footer = '';
    if (session.gaps && session.gaps.length > 0) {
      session.gaps.forEach(gap => {
         footer += `--- GAP: suspended ${gap.startTime} to ${gap.endTime}, duration: ${gap.duration}s ---\n`;
      });
    }

    if (session.endTime) {
      footer += `RECORDING_END,${session.endTime},,,,,,,,\n`;
    }
    
    chunks.push(footer);

    return new Blob(chunks, { type: 'text/csv;charset=utf-8' });
  }

  // 下載 CSV
  async downloadCSV(sessionId) {
    const blob = await this.generateCSVBlob(sessionId);
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `gforce_session_${dateStr}.csv`;
    a.href = url;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // 分享 CSV
  async shareCSV(sessionId) {
    try {
      const blob = await this.generateCSVBlob(sessionId);
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `gforce_session_${dateStr}.csv`;
      
      const file = new File([blob], filename, { type: 'text/csv' });
      
      // 1. 嘗試分享 File
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'G-Force Session Data',
          text: 'Vehicle test log data from G-Force Meter'
        });
        return true;
      }
      
      // 2. 嘗試分享 URL
      const blobUrl = URL.createObjectURL(blob);
      if (navigator.share) {
        await navigator.share({
          title: 'G-Force Session Data',
          text: 'Vehicle test log data from G-Force Meter',
          url: blobUrl
        });
        return true;
      }
      
      throw new Error('不支援的分享方式');
    } catch (e) {
      console.warn('分享失敗或不支援，退回使用下載功能', e);
      // 3. 退回下載
      await this.downloadCSV(sessionId);
      return false;
    }
  }
}
