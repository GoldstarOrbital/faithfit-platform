/** Normalizes vendor-specific payloads into the biometric_data schema. */
function normalizeToBiometricRow({ userId, time, heartRate, hrv, steps, movement, gps, stressLevel }) {
  return {
    time: time instanceof Date ? time.toISOString() : time,
    user_id: userId,
    heart_rate: heartRate ?? null,
    hrv: hrv ?? null,
    steps: steps ?? null,
    movement: movement ?? null,
    gps: gps ?? null, // expects GeoJSON Point / WKT compatible with PostGIS GEOGRAPHY
    stress_level: stressLevel ?? null,
  };
}

module.exports = { normalizeToBiometricRow };
