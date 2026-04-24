import {
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3
} from 'three';

/**
 * Renders a soft, glowing outline that traces the actual silhouette of the
 * focused object. Consumes a binary category mask (Uint8Array, 0 = outside,
 * non-zero = inside) and uploads it as a single-channel R8 DataTexture; a
 * 12-tap sunflower kernel inside the shader produces an outer halo and a
 * bright inner rim, with a slow breathing pulse driven by uTime.
 *
 * The mesh is intended to be added as a child of the camera input surface so
 * it inherits the same plane size and mirror transform as the underlying
 * video frame -- the shader stays mirror-agnostic because UVs are intrinsic
 * to the geometry.
 */
function createHighlightMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uMask: { value: null },
      uHasMask: { value: 0 },
      uMaskTexel: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uGlowRadius: { value: 0.035 },
      uTintGlow: { value: new Vector3(0.46, 0.74, 1.0) },
      uTintRim: { value: new Vector3(0.85, 0.95, 1.0) }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uMask;
      uniform float uHasMask;
      uniform vec2 uMaskTexel;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uGlowRadius;
      uniform vec3 uTintGlow;
      uniform vec3 uTintRim;

      // 12 sunflower-distributed offsets in unit-disk space, expanded later
      // by uGlowRadius (UV units). Computed from the golden angle so the
      // distribution is low-discrepancy and visually smooth.
      const int TAP_COUNT = 12;
      const vec2 TAPS[12] = vec2[12](
        vec2( 0.288675,  0.000000),
        vec2(-0.293052,  0.310893),
        vec2( 0.025048, -0.526918),
        vec2( 0.453985,  0.482310),
        vec2(-0.764241, -0.084944),
        vec2( 0.620828, -0.540063),
        vec2(-0.052317,  0.840316),
        vec2(-0.625681, -0.638078),
        vec2( 0.928814, -0.184739),
        vec2(-0.717797,  0.668014),
        vec2( 0.116036, -0.985061),
        vec2( 0.626944,  0.831055)
      );

      float sampleBinary(vec2 uv) {
        // The mask is uploaded as 0 / 1 byte values, normalized by the GPU
        // to 0.0 / ~0.0039. Threshold low to recover a hard 0/1, then let
        // bilinear filtering give us softness near edges.
        float raw = texture2D(uMask, clamp(uv, vec2(0.0), vec2(1.0))).r;
        return step(0.5 / 255.0, raw);
      }

      void main() {
        if (uHasMask < 0.5 || uOpacity < 0.001) {
          discard;
        }

        float sharp = sampleBinary(vUv);

        float soft = 0.0;
        float total = 0.0;
        for (int i = 0; i < TAP_COUNT; i++) {
          vec2 dir = TAPS[i];
          // Two concentric rings to thicken the halo without doubling tap count.
          for (int j = 1; j <= 2; j++) {
            float scale = float(j) * 0.62;
            vec2 off = dir * uGlowRadius * scale;
            float w = 1.0 / (1.0 + scale * scale * 6.0);
            soft += sampleBinary(vUv + off) * w;
            total += w;
          }
        }
        soft /= max(total, 0.0001);

        float pulse = 0.88 + 0.12 * sin(uTime * 1.65);

        // Strictly outside the silhouette. Everything inside the actual object
        // stays untouched -- the camera feed must read through cleanly.
        float outside = 1.0 - sharp;

        // Broad halo: fades off with distance from the boundary.
        float outerHalo = outside * smoothstep(0.0, 0.48, soft) * pulse;

        // Thin rim: a brighter band hugging the outer edge of the silhouette.
        float rimOuter = outside * smoothstep(0.32, 0.56, soft) * pulse;

        vec3 color =
          uTintGlow * outerHalo * 0.85 +
          uTintRim  * rimOuter * 1.25;

        float alpha = clamp(
          outerHalo * 0.55 + rimOuter * 0.95,
          0.0,
          1.0
        ) * uOpacity;

        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

export class FocusHighlightLayer {
  constructor() {
    this.material = createHighlightMaterial();
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.position.z = 0.01;
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'focus-highlight-layer';

    this.maskTexture = null;
    this.maskWidth = 0;
    this.maskHeight = 0;

    this.targetOpacity = 0;
    this.currentOpacity = 0;
  }

  /**
   * Attaches the highlight mesh as a child of the given parent (typically the
   * camera input surface mesh, so the highlight inherits its size and any
   * mirror transform applied to the video frame).
   */
  attachTo(parent) {
    parent.add(this.mesh);
  }

  /**
   * Push a new mask in. Pass `null` to clear and fade out.
   * @param {{ data: Uint8Array, width: number, height: number } | null} mask
   */
  setMask(mask) {
    if (!mask) {
      this.targetOpacity = 0;
      this.material.uniforms.uHasMask.value = 0;
      return;
    }

    const { data, width, height } = mask;
    if (
      !this.maskTexture
      || this.maskWidth !== width
      || this.maskHeight !== height
    ) {
      this.maskTexture?.dispose();
      this.maskTexture = new DataTexture(
        data,
        width,
        height,
        RedFormat,
        UnsignedByteType
      );
      this.maskTexture.flipY = true;
      this.maskTexture.minFilter = LinearFilter;
      this.maskTexture.magFilter = LinearFilter;
      this.maskTexture.generateMipmaps = false;
      this.maskTexture.needsUpdate = true;

      this.maskWidth = width;
      this.maskHeight = height;

      this.material.uniforms.uMask.value = this.maskTexture;
      this.material.uniforms.uMaskTexel.value.set(1 / width, 1 / height);
    } else {
      this.maskTexture.image.data = data;
      this.maskTexture.needsUpdate = true;
    }

    this.material.uniforms.uHasMask.value = 1;
    this.targetOpacity = 1;
  }

  update(elapsedTime, deltaTime) {
    const damp = 1 - Math.exp(-7.5 * deltaTime);
    this.currentOpacity += (this.targetOpacity - this.currentOpacity) * damp;

    this.material.uniforms.uTime.value = elapsedTime;
    this.material.uniforms.uOpacity.value = this.currentOpacity;
    this.mesh.visible = this.currentOpacity > 0.01;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.maskTexture?.dispose();
    this.maskTexture = null;
  }
}
