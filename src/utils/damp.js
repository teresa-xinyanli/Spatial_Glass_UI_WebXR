export function damp(current, target, lambda, deltaTime) {
  return current + (target - current) * (1 - Math.exp(-lambda * deltaTime));
}

export function dampVector3(vector, target, lambda, deltaTime) {
  const factor = 1 - Math.exp(-lambda * deltaTime);
  vector.lerp(target, factor);
}

export function dampQuaternion(quaternion, target, lambda, deltaTime) {
  const factor = 1 - Math.exp(-lambda * deltaTime);
  quaternion.slerp(target, factor);
}
