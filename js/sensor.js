  /** Step 2: determine the forward axis from straight-line acceleration. */
  startForwardCalibration(durationMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.calibRecord.step1Complete) {
        reject(new Error('必須先完成重力校正 (Step 1)'));
        return;
      }

      this.isCalibrating = true;
      this.calibrationBuffer = [];

      const timeoutId = setTimeout(() => {
        this.isCalibrating = false;

        try {
          if (this.calibrationBuffer.length === 0) {
            reject(new Error('未收到任何資料'));
            return;
          }

          const zHat = Vec3.normalize(this.calibRecord.gravityVector);
          if (Vec3.mag(zHat) === 0) {
            resolve({ success: false, error: 'Invalid gravity vector' });
            return;
          }

          // Estimate forward by summing repeated horizontal acceleration samples.
          // Requiring 0.02 m/s² of mean horizontal acceleration is less sensitive
          // to short or low-acceleration forward runs while still rejecting no-motion data.
          let sumHoriz = { x: 0, y: 0, z: 0 };
          let validCount = 0;

          this.calibrationBuffer.forEach(a => {
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) return;

            const dot = Vec3.dot(a, zHat);
            const zProj = Vec3.scale(zHat, dot);
            const horizontal = Vec3.sub(a, zProj);

            // Remove sensor noise and gravity components that were not exactly projected out.
            if (Vec3.mag(horizontal) < 0.02) return;

            sumHoriz = Vec3.add(sumHoriz, horizontal);
            validCount++;
          });

          if (validCount < 20) {
            resolve({
              success: false,
              error: 'Insufficient forward acceleration',
              validSamples: validCount
            });
            return;
          }

          const meanHoriz = Vec3.scale(sumHoriz, 1 / validCount);
          const magHoriz = Vec3.mag(meanHoriz);
          if (magHoriz < 0.02) {
            resolve({
              success: false,
              error: 'Insufficient forward acceleration',
              validSamples: validCount
            });
            return;
          }

          let xHat = Vec3.normalize(meanHoriz);
          xHat = Vec3.normalize(Vec3.sub(xHat, Vec3.scale(zHat, Vec3.dot(xHat, zHat))));
          if (Vec3.mag(xHat) === 0) {
            resolve({ success: false, error: 'Could not determine forward axis' });
            return;
          }

          const yHat = Vec3.normalize(Vec3.cross(zHat, xHat));
          const R = [
            [-yHat.x, -yHat.y, -yHat.z],
            [xHat.x, xHat.y, xHat.z],
            [zHat.x, zHat.y, zHat.z]
          ];

          this.calibRecord.forwardVector = xHat;
          this.calibRecord.rotationMatrix = R;
          this.calibRecord.step2Complete = true;
          this.calibRecord.timestamp = new Date().toISOString();

          if (this.onCalibrationComplete) {
            this.onCalibrationComplete(this.calibRecord);
          }

          resolve({ success: true, ...this.calibRecord });
        } catch (err) {
          reject(err);
        }
      }, durationMs);

      // Keep a handle on the timeout only for future cancellation/debugging.
      this.forwardCalibrationTimeout = timeoutId;
    });
  }
