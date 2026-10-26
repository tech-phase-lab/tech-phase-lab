import type { Temperature, ThermometerIndex } from './thermometer.ts';

export type ThermometerSnapshot = {
 asOf: string;
 validUntil?: number;
 nas100: Temperature | {status: 'unavailable'; reason: string};
 sox: Temperature | {status: 'unavailable'; reason: string};
 vix: {status: 'ready'; asOf: string; level: number; percentile: number} | {status: 'unavailable'; reason: string};
};
export const temperatureLabels = {
 ja: ['冷えている', 'やや冷え', '平常', 'やや熱い', '熱い'],
 en: ['Cool', 'Slightly cool', 'Normal', 'Slightly hot', 'Hot'],
} as const;
/** Only the selected index may populate its gauge. Missing data never borrows another index. */
export function gaugeReading(snapshot: ThermometerSnapshot | undefined, index: ThermometerIndex) {
 const reading = snapshot?.[index];
 if (!reading || reading.status !== 'ready' || reading.index !== index || reading.asOf !== snapshot?.asOf ||
     !Number.isFinite(reading.score) || reading.score < 0 || reading.score > 100 ||
     reading.band !== Math.min(4, Math.floor(reading.score / 20)) ||
     !Number.isFinite(reading.drawdownPercent) || !Number.isFinite(reading.deviationPercent)) return null;
 return reading;
}
export function gaugeStatus(snapshot: ThermometerSnapshot | undefined, index: ThermometerIndex, en: boolean) {
 const reading = snapshot?.[index];
 if (!reading || reading.status === 'unavailable' && reading.reason === 'not-configured') return en ? 'Coming soon.' : '準備中です。';
 if (reading.status === 'unavailable' && reading.reason === 'insufficient-history') return en ? 'Waiting for sufficient history.' : '判定に必要な履歴が不足しています。';
 if (reading.status === 'unavailable' && reading.reason === 'stale-data') return en ? 'Waiting for confirmed closing data.' : '確定終値の更新を待っています。';
 return en ? 'The reading is currently unavailable.' : '現在の判定を取得できません。';
}

/** The same boundary clears all readings on both screens, without inventing a date. */
export function expireThermometerSnapshot(snapshot: ThermometerSnapshot | undefined, now: number): ThermometerSnapshot | undefined {
 if (!snapshot || snapshot.validUntil === undefined || Number.isFinite(snapshot.validUntil) && now < snapshot.validUntil) return snapshot;
 const absent = {status:'unavailable' as const,reason:'stale-data'};
 return {asOf:snapshot.asOf,validUntil:snapshot.validUntil,nas100:absent,sox:absent,vix:absent};
}
