import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry
} from 'three';

function createRoundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;

  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  return shape;
}

export function createGlassPanel() {
  const group = new Group();

  const panelShape = createRoundedRectShape(1.55, 0.98, 0.14);
  const panelGeometry = new ShapeGeometry(panelShape, 24);

  const panelMaterial = new MeshPhysicalMaterial({
    color: new Color('#d8eeff'),
    transparent: true,
    opacity: 0.16,
    roughness: 0.12,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transmission: 0.88,
    ior: 1.12,
    reflectivity: 0.8,
    thickness: 0.7
  });

  const panel = new Mesh(panelGeometry, panelMaterial);
  panel.castShadow = true;
  panel.receiveShadow = true;
  group.add(panel);

  const border = new Mesh(
    new ShapeGeometry(panelShape, 24),
    new MeshBasicMaterial({
      color: new Color('#f0f7ff'),
      transparent: true,
      opacity: 0.12
    })
  );
  border.position.z = 0.004;
  border.scale.set(1.01, 1.01, 1);
  group.add(border);

  const glow = new Mesh(
    new PlaneGeometry(1.85, 1.2, 1, 1),
    new MeshBasicMaterial({
      color: new Color('#7dc6ff'),
      transparent: true,
      opacity: 0.1,
      depthWrite: false
    })
  );
  glow.position.z = -0.16;
  glow.scale.setScalar(1.06);
  group.add(glow);

  const statusLine = new Mesh(
    new PlaneGeometry(0.52, 0.03, 1, 1),
    new MeshBasicMaterial({
      color: new Color('#cbeaff'),
      transparent: true,
      opacity: 0.75
    })
  );
  statusLine.position.set(0, 0.26, 0.012);
  group.add(statusLine);

  const subtitleLine = new Mesh(
    new PlaneGeometry(0.74, 0.04, 1, 1),
    new MeshBasicMaterial({
      color: new Color('#d7eaff'),
      transparent: true,
      opacity: 0.42
    })
  );
  subtitleLine.position.set(0, 0.08, 0.012);
  group.add(subtitleLine);

  const faintCard = new Mesh(
    new PlaneGeometry(0.72, 0.32, 1, 1),
    new MeshBasicMaterial({
      color: new Color('#8fd1ff'),
      transparent: true,
      opacity: 0.1
    })
  );
  faintCard.position.set(0, -0.22, 0.012);
  group.add(faintCard);

  return {
    group,
    panel,
    panelMaterial,
    glow
  };
}
