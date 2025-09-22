import * as THREE from 'three';

export interface SourceVisualizationOptions {
  type: 'water' | 'lava';
  position?: THREE.Vector3;
  showCenter?: boolean; // Whether to show the center sphere
  baseRadius?: number; // Base size for the visualization
}

/**
 * Creates animated ripple rings for source indicators
 * This is the centralized visualization for both hover and placed sources
 */
export function createSourceRipples(options: SourceVisualizationOptions): THREE.Group {
  const {
    type,
    position = new THREE.Vector3(0, 0, 0),
    showCenter = false,
    baseRadius = 1
  } = options;

  const group = new THREE.Group();
  group.position.copy(position);

  // Color based on type
  const color = type === 'water' ? 0x0099cc : 0xff4500;
  const emissiveColor = type === 'water' ? 0x0066aa : 0xff2200;

  // Optional center sphere (for placed sources)
  if (showCenter) {
    const centerGeometry = new THREE.SphereGeometry(baseRadius * 0.5, 16, 16);
    const centerMaterial = new THREE.MeshPhysicalMaterial({
      color,
      emissive: emissiveColor,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 0.8
    });
    const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial);
    group.add(centerMesh);
  }

  // Create 3 animated ripple rings
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const ringRadius = baseRadius * (0.8 + i * 0.4);
    const ringGeometry = new THREE.RingGeometry(ringRadius, ringRadius + 0.1, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3 - i * 0.1,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.userData.ringIndex = i;
    ring.userData.baseRadius = ringRadius;
    ring.userData.baseOpacity = 0.3 - i * 0.1;
    rings.push(ring);
    group.add(ring);
  }

  group.userData.rings = rings;
  group.userData.sourceType = type;

  return group;
}

/**
 * Animates source ripple rings
 * Call this in your animation loop
 */
export function animateSourceRipples(group: THREE.Group, deltaTime: number): void {
  const time = Date.now() * 0.001;
  const rings = group.userData.rings as THREE.Mesh[];

  if (!rings) return;

  // Animate each ring with expanding ripple effect
  rings.forEach((ring, index) => {
    const phase = index * 0.3;
    const animTime = (time + phase) % 2; // 2 second cycle

    // Expand and fade out
    const scale = 1 + animTime * 0.5;
    ring.scale.setScalar(scale);

    // Fade opacity
    const baseOpacity = ring.userData.baseOpacity || 0.3;
    const opacity = Math.max(0, baseOpacity * (1 - animTime / 2));
    (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
  });
}