import counting from './counting.js';
import verified from './verified.js';
import outward from './outward.js';
import reading from './reading.js';

export const families = [counting, verified, outward, reading];

export function byName(name) {
  return families.find((family) => family.name === name) ?? null;
}
