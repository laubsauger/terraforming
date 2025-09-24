export type MatKind = 'soil' | 'rock' | 'lava';

export interface HandState {
  kind: MatKind | null;
  massKg: number;   // current mass carried
  capKg: number;    // capacity
}

export function handRemainingFixed_pickup(hand: HandState): number {
  const remaining = Math.max(0, hand.capKg - hand.massKg);
  return Math.round(remaining * 1000); // fixed-point
}

export function handRemainingFixed_deposit(hand: HandState): number {
  return Math.round(Math.max(0, hand.massKg) * 1000);
}

export interface BrushOp {
  mode: number;          // 0=pickup, 1=deposit, 2=smooth
  kind: number;          // 0=soil, 1=rock, 2=lava
  center: [number, number]; // world meters (x,z)
  radius: number;        // meters
  strengthKgPerS: number;
  dt: number;
}

export interface SmoothOp {
  center: [number, number]; // world meters (x,z)
  radius: number;        // meters
  strength: number;      // smoothing strength (0-1)
  dt: number;
  mode?: number;         // 0=smooth, 1=smooth+raise, 2=smooth+lower (optional for compatibility)
}

export function materialKindToIndex(kind: MatKind | null): number {
  switch (kind) {
    case 'soil': return 0;
    case 'rock': return 1;
    case 'lava': return 2;
    default: return 0;
  }
}