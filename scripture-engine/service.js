/**
 * Orchestration layer: wires the pure pipeline to Postgres (scripture_triggers log),
 * feature flags (scripture.personalization opt-in), and the event bus (verse.triggered).
 * This file is intentionally thin - business logic lives in pipeline.js.
 */
const { runPipeline } = require('./pipeline');
const { isEnabled } = require('../shared/feature-flags');
const { EventProducer } = require('../eventbus/producer');

class ScriptureTriggerService {
  constructor({ db, producer = new EventProducer({ clientId: 'scripture-engine' }) } = {}) {
    this.db = db; // expects { query(sql, params) } - e.g. pg.Pool
    this.producer = producer;
  }

  async handleBiometricEvent(event) {
    const user = await this._loadUserContext(event.user_id);
    const candidateVerses = await this._loadCandidateVerses();

    const result = runPipeline({
      rawSnapshot: {
        heart_rate: event.heart_rate,
        hrv: event.hrv,
        movement: event.movement,
        stress_level: event.stress_level,
        workout_type: user.activeWorkoutType,
      },
      candidateVerses,
      userHistory: user.scriptureHistory,
      userPreferences: user.preferences,
      personalizationEnabled: isEnabled('scripture.personalization') && user.preferences.personalization_opt_in === true,
      verseTextLookup: (youversionId) => this._lookupCachedVerseText(youversionId),
    });

    await this._logTrigger(event.user_id, result);
    await this.producer.publish('verse.triggered', {
      user_id: event.user_id,
      verse_id: result.verse.id,
      youversion_id: result.verse.youversion_id,
      trigger_type: result.context,
      payload: result.payload,
    });

    return result;
  }

  async _loadUserContext(userId) {
    if (!this.db) return { activeWorkoutType: null, scriptureHistory: [], preferences: {} };
    // TODO: real queries against workouts (active), scripture_triggers (history), user_profiles (prefs)
    return { activeWorkoutType: null, scriptureHistory: [], preferences: {} };
  }

  async _loadCandidateVerses() {
    if (!this.db) return [];
    const { rows } = await this.db.query(
      `SELECT sv.id, sv.reference, sv.youversion_id, sv.themes
       FROM scripture_verses sv LIMIT 200`
    );
    return rows;
  }

  async _lookupCachedVerseText(youversionId) {
    if (!this.db) return null;
    const { rows } = await this.db.query(
      `SELECT text FROM scripture_verses WHERE youversion_id = $1 LIMIT 1`, [youversionId]
    );
    return rows[0] || null;
  }

  async _logTrigger(userId, result) {
    if (!this.db) return;
    await this.db.query(
      `INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot, timestamp)
       VALUES (uuid_generate_v4(), $1, $2, $3, $4, now())`,
      [userId, result.verse.id, result.context, JSON.stringify(result.snapshot)]
    );
  }
}

module.exports = { ScriptureTriggerService };
