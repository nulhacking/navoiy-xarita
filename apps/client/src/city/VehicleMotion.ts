/** Road bicycle: roughly 5.4 metres of travel per complete pedal revolution. */
export const BICYCLE_METRES_PER_RADIAN = .86;

export function angleDifference(target: number, current: number): number {
  return Math.atan2(Math.sin(target-current), Math.cos(target-current));
}

export function approach(value: number, target: number, rate: number, dt: number): number {
  return value + Math.max(-rate*dt, Math.min(rate*dt, target-value));
}

/** Bicycle yaw law, capped by tyre lateral acceleration (6 m/s²). */
export function yawRate(speed: number, steering: number): number {
  const bicycle = speed / 2.7 * Math.tan(steering);
  const grip = 6 / Math.max(1, Math.abs(speed));
  return Math.max(-grip, Math.min(grip, bicycle));
}
