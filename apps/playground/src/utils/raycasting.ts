import * as THREE from 'three';
import type { Engine } from '@terraforming/engine';

export interface RaycastResult {
  point: THREE.Vector3;
  terrainHeight: number;
  normal: THREE.Vector3;
  distance: number;
}

interface RaycastCache {
  frameTime: number;
  mouseX: number;
  mouseY: number;
  result: RaycastResult | null;
}

// Shared raycaster instance
const sharedRaycaster = new THREE.Raycaster();
// Cache to avoid multiple raycasts per frame
let raycastCache: RaycastCache | null = null;

/**
 * Perform a raycast from camera through mouse position to terrain
 * Results are cached per frame to avoid duplicate calculations
 */
export function raycastToTerrain(
  engine: Engine,
  canvasElement: HTMLCanvasElement,
  mousePosition: { x: number; y: number }
): RaycastResult | null {
  const camera = engine.getCamera();
  const terrainMesh = engine.getTerrainMesh();

  if (!camera || !terrainMesh || !canvasElement) {
    return null;
  }

  // Check cache first - if same frame and mouse position, return cached result
  const currentFrame = performance.now();
  if (raycastCache &&
      Math.abs(raycastCache.frameTime - currentFrame) < 16 && // Within same frame (~60fps)
      raycastCache.mouseX === mousePosition.x &&
      raycastCache.mouseY === mousePosition.y) {
    return raycastCache.result;
  }

  // Convert mouse position to normalized device coordinates
  const rect = canvasElement.getBoundingClientRect();
  const ndcX = ((mousePosition.x - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((mousePosition.y - rect.top) / rect.height) * 2 + 1;

  // Update raycaster
  sharedRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Intersect with terrain mesh
  const intersects = sharedRaycaster.intersectObject(terrainMesh, false);

  let result: RaycastResult | null = null;

  if (intersects.length > 0) {
    const hitPoint = intersects[0].point;

    // Get accurate terrain height at this position
    const terrainHeight = engine.getTerrainHeightAt(hitPoint.x, hitPoint.z);

    if (terrainHeight !== null) {
      // Calculate terrain normal
      const normal = getTerrainNormal(engine, hitPoint.x, hitPoint.z);

      result = {
        point: new THREE.Vector3(hitPoint.x, terrainHeight, hitPoint.z),
        terrainHeight,
        normal,
        distance: intersects[0].distance
      };
    }
  }

  // Always use ray marching for accurate displaced terrain intersection
  // This ensures we find the FIRST intersection with the actual displaced surface
  const rayOrigin = sharedRaycaster.ray.origin.clone();
  const rayDirection = sharedRaycaster.ray.direction.clone();

  // Get terrain bounds from engine (usually 100x100)
  const terrainSize = 50; // Half size for bounds checking

  // Start ray marching from camera position
  const maxDistance = 500; // Increased for high mountains
  let stepSize = 0.5; // Smaller initial step for better accuracy
  let foundHit = false;
  let closestPoint: THREE.Vector3 | null = null;
  let closestDistance = Infinity;
  let bestIntersection: RaycastResult | null = null;

  // Track last few samples to detect crossings in either direction
  let previousSamples: Array<{dist: number, height: number, point: THREE.Vector3}> = [];

  for (let distance = 0; distance < maxDistance && !foundHit; distance += stepSize) {
    const testPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(distance));

    // Skip if outside terrain bounds
    if (Math.abs(testPoint.x) > terrainSize || Math.abs(testPoint.z) > terrainSize) {
      continue;
    }

    const terrainHeight = engine.getTerrainHeightAt(testPoint.x, testPoint.z);
    if (terrainHeight === null) continue;

    const heightDiff = testPoint.y - terrainHeight;
    const absHeightDiff = Math.abs(heightDiff);

    // Track closest point to terrain as fallback
    if (absHeightDiff < closestDistance) {
      closestDistance = absHeightDiff;
      closestPoint = new THREE.Vector3(testPoint.x, terrainHeight, testPoint.z);
    }

    // Check if we're very close to the surface (within threshold)
    if (absHeightDiff < 0.5) {
      // We're close enough to consider this a hit
      const normal = getTerrainNormal(engine, testPoint.x, testPoint.z);
      const dotProduct = normal.dot(rayDirection);

      // Only accept front-facing surfaces
      if (dotProduct < 0.3) {
        bestIntersection = {
          point: new THREE.Vector3(testPoint.x, terrainHeight + 0.1, testPoint.z),
          terrainHeight: terrainHeight,
          normal,
          distance
        };
        foundHit = true;
        break;
      }
    }

    // Store current sample
    const currentSample = {dist: distance, height: heightDiff, point: testPoint.clone()};

    // Check for crossing with previous sample (works for both above->below and below->above)
    if (previousSamples.length > 0) {
      const lastSample = previousSamples[previousSamples.length - 1];

      // Check if we crossed the surface (sign change in height difference)
      if ((lastSample.height > 0 && heightDiff <= 0) || (lastSample.height < 0 && heightDiff >= 0)) {
      // We've crossed the surface - refine with binary search
      let low = Math.max(0, distance - stepSize);
      let high = distance;

      // Binary search for exact intersection
      for (let i = 0; i < 15; i++) { // More iterations for better accuracy
        const mid = (low + high) / 2;
        const midPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(mid));
        const midHeight = engine.getTerrainHeightAt(midPoint.x, midPoint.z);

        if (midHeight !== null) {
          const midHeightDiff = midPoint.y - midHeight;

          if (Math.abs(midHeightDiff) < 0.01) { // Tighter tolerance
            // Found accurate intersection
            const normal = getTerrainNormal(engine, midPoint.x, midPoint.z);

            // Check if this is a front-facing surface (not backface)
            // The ray direction points away from camera, so we check if normal opposes it
            const dotProduct = normal.dot(rayDirection);

            // Only accept if surface is facing toward camera
            // Negative dot product means normal opposes ray (facing camera)
            // Allow some tolerance for grazing angles
            if (dotProduct < 0.3) {
              const intersectionPoint = new THREE.Vector3(midPoint.x, midHeight + 0.1, midPoint.z); // Small offset above surface
              bestIntersection = {
                point: intersectionPoint,
                terrainHeight: midHeight,
                normal,
                distance: mid
              };
              foundHit = true;
              break;
            }
          }

          if (midPoint.y > midHeight) {
            low = mid;
          } else {
            high = mid;
          }
        }
      }

      if (!foundHit) {
        // Use the refined position even if not exact
        const finalDist = (low + high) / 2;
        const finalPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(finalDist));
        const finalHeight = engine.getTerrainHeightAt(finalPoint.x, finalPoint.z);
        if (finalHeight !== null) {
          const normal = getTerrainNormal(engine, finalPoint.x, finalPoint.z);

          // Check backface here too
          const dotProduct = normal.dot(rayDirection);

          // Accept if facing toward camera (negative dot or small positive for grazing)
          if (dotProduct < 0.3) {
            const intersectionPoint = new THREE.Vector3(finalPoint.x, finalHeight + 0.1, finalPoint.z);
            bestIntersection = {
              point: intersectionPoint,
              terrainHeight: finalHeight,
              normal,
              distance: finalDist
            };
            foundHit = true;
          }
        }
      }
      } // Close the if statement for crossing detection
    }

    // Add to previous samples (keep last 2 for crossing detection)
    previousSamples.push(currentSample);
    if (previousSamples.length > 2) {
      previousSamples.shift();
    }

    // Adaptive step size - smaller steps when close to terrain
    if (absHeightDiff < 1) {
      stepSize = 0.1; // Very small steps when very close
    } else if (absHeightDiff < 3) {
      stepSize = 0.25;
    } else if (absHeightDiff < 5) {
      stepSize = 0.5;
    } else if (absHeightDiff < 10) {
      stepSize = 1.0;
    } else {
      stepSize = 2.0; // Larger steps when far from terrain
    }
  }

  // Use the best intersection we found
  if (bestIntersection) {
    result = bestIntersection;
  }

  // If we didn't find an exact intersection but have a closest point, use it as fallback
  // Be more aggressive about using close points - this helps with mountain peaks
  if (!result && closestPoint && closestDistance < 5.0) { // Increased threshold
    const fallbackNormal = getTerrainNormal(engine, closestPoint.x, closestPoint.z);

    // Check if this is a valid front-facing surface
    const dotProduct = fallbackNormal.dot(rayDirection);

    // Accept if facing toward camera (relaxed threshold for fallback)
    if (dotProduct < 0.5) { // More permissive for fallback
      const offsetPoint = closestPoint.clone();
      offsetPoint.y += 0.1; // Small offset above surface
      result = {
        point: offsetPoint,
        terrainHeight: closestPoint.y,
        normal: fallbackNormal,
        distance: closestPoint.distanceTo(rayOrigin)
      };
    }
  }

  // Update cache
  raycastCache = {
    frameTime: currentFrame,
    mouseX: mousePosition.x,
    mouseY: mousePosition.y,
    result
  };

  return result;
}

/**
 * Calculate terrain normal at a given position
 */
export function getTerrainNormal(engine: Engine, x: number, z: number): THREE.Vector3 {
  const epsilon = 0.25; // Smaller epsilon for more accurate normals

  // Sample heights around the point using Sobel-like pattern for better accuracy
  const h0 = engine.getTerrainHeightAt(x, z) || 0;
  const hX1 = engine.getTerrainHeightAt(x + epsilon, z) || 0;
  const hX2 = engine.getTerrainHeightAt(x - epsilon, z) || 0;
  const hZ1 = engine.getTerrainHeightAt(x, z + epsilon) || 0;
  const hZ2 = engine.getTerrainHeightAt(x, z - epsilon) || 0;

  // Also sample diagonal neighbors for better gradient estimation
  const hX1Z1 = engine.getTerrainHeightAt(x + epsilon, z + epsilon) || 0;
  const hX2Z1 = engine.getTerrainHeightAt(x - epsilon, z + epsilon) || 0;
  const hX1Z2 = engine.getTerrainHeightAt(x + epsilon, z - epsilon) || 0;
  const hX2Z2 = engine.getTerrainHeightAt(x - epsilon, z - epsilon) || 0;

  // Calculate gradient using Sobel filter weights
  // This gives more accurate normals especially on steep slopes
  const dx = ((hX1 - hX2) * 2 + (hX1Z1 - hX2Z1) + (hX1Z2 - hX2Z2)) / (8 * epsilon);
  const dz = ((hZ1 - hZ2) * 2 + (hX1Z1 - hX1Z2) + (hX2Z1 - hX2Z2)) / (8 * epsilon);

  // Create normal vector from gradient
  // For a height field, normal = (-dh/dx, 1, -dh/dz)
  const normal = new THREE.Vector3(-dx, 1, -dz);
  normal.normalize();

  return normal;
}

/**
 * Clear the raycast cache (call when mouse moves or frame changes)
 */
export function clearRaycastCache(): void {
  raycastCache = null;
}