import {
  Euler,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Vector3
} from 'three';

/**
 * A rounded-rect plane that lives in 3D space, uses the built-in
 * MeshPhysicalMaterial transmission pipeline to refract everything rendered
 * opaquely behind it (camera feed, etc.), and exposes a screen-space API so
 * callers can position it to match a DOM rect.
 *
 * Why MeshPhysicalMaterial instead of drei's MeshTransmissionMaterial:
 *   MeshPhysicalMaterial is core Three.js. transmission + ior + thickness
 *   already give a real refraction sampled from the opaque back-buffer, which
 *   is exactly what we want for a "fluid glass" lens over the camera feed.
 *   Chromatic aberration / multi-sample are extras we don't need for a UI
 *   panel sitting on top of video, and they would require the FBO+drei stack.
 *
 * The rounded-rect look is produced via an onBeforeCompile patch that
 * evaluates a 2D SDF in pixel units (uPxSize + uPxRadius) and discards the
 * corners of the quad. Pixel-space uniforms make it trivial to keep a
 * constant corner radius even as the panel's screen-space size changes.
 *
 * Coordinate convention:
 *   The mesh is expected to be attached to the camera (so its local Z maps to
 *   depth in front of the viewer). setScreenRect() takes a CSS-pixel rect and
 *   converts it to camera-local XY + scale at a fixed local Z (this.distance),
 *   which is trivially back-projectable because we use a perspective camera.
 */
export class FluidGlassPanel {
  constructor({
    distance = 3.0,
    cornerRadiusPx = 22,
    // 'fixed'  : corner radius stays at cornerRadiusPx regardless of size.
    // 'circle' : radius is recomputed every frame as min(w, h) / 2, so the
    //            panel is always a perfect capsule/circle -- ideal for a
    //            cursor lens whose size may change with hover state.
    cornerMode = 'fixed',
    // Physically-plausible crystal glass defaults. The previous blue-tinted
    // thick glass absorbed almost all transmitted light; these values keep
    // the panel bright and achromatic like Apple's Liquid Glass.
    ior = 1.45,
    thickness = 0.35,
    roughness = 0.06,
    attenuationColor = 0xffffff,
    attenuationDistance = 3.0,
    // Width in pixels over which the bright top/edge rim fades inward.
    edgeWidthPx = 2.8,
    // Additive strength of the edge rim (reads as specular highlight on the
    // glass's geometric edge -- the single most important visual cue that
    // separates "real glass" from "flat blur").
    edgeStrength = 0.65,
    // Subtle milky lift over the whole interior. 0 = perfectly clear; Apple's
    // liquid glass uses ~6-10% to give text contrast without looking frosted.
    milkyLift = 0.08
  } = {}) {
    this.distance = distance;
    this.cornerRadiusPx = cornerRadiusPx;
    this.cornerMode = cornerMode;

    this.material = new MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness,
      transmission: 1.0,
      ior,
      thickness,
      attenuationColor,
      attenuationDistance,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      transparent: true,
      depthWrite: false
    });
    // Force the Three.js shader chunks to declare vUv unconditionally so our
    // SDF patch can read it regardless of whether a map is bound.
    this.material.defines = { ...(this.material.defines || {}), USE_UV: '' };

    this.uniforms = {
      uPxSize: { value: new Vector3(1, 1, 0) }, // x=width, y=height
      uPxRadius: { value: cornerRadiusPx },
      uEdgeWidthPx: { value: edgeWidthPx },
      uEdgeStrength: { value: edgeStrength },
      uMilkyLift: { value: milkyLift }
    };

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uPxSize = this.uniforms.uPxSize;
      shader.uniforms.uPxRadius = this.uniforms.uPxRadius;
      shader.uniforms.uEdgeWidthPx = this.uniforms.uEdgeWidthPx;
      shader.uniforms.uEdgeStrength = this.uniforms.uEdgeStrength;
      shader.uniforms.uMilkyLift = this.uniforms.uMilkyLift;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uPxSize;
         uniform float uPxRadius;
         uniform float uEdgeWidthPx;
         uniform float uEdgeStrength;
         uniform float uMilkyLift;

         // Signed distance to the rounded-rect border, in pixel units of the
         // current rect. Negative inside, 0 at boundary, positive outside.
         float fluidGlassSd(vec2 uv) {
           vec2 halfSizePx = uPxSize.xy * 0.5;
           vec2 ppx = (uv - 0.5) * uPxSize.xy;
           vec2 q = abs(ppx) - halfSizePx + uPxRadius;
           return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - uPxRadius;
         }`
      );

      // Hard discard of the corners. Happens before any PBR work so we never
      // waste a transmission sample on a pixel we'd throw away anyway.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         { if (fluidGlassSd(vUv) > 0.0) discard; }`
      );

      // Post-process: add the Apple-style bright geometric edge + a faint
      // milky lift over the interior so text above reads cleanly.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           float sd = fluidGlassSd(vUv);
           float insidePx = max(-sd, 0.0);
           float rim = 1.0 - smoothstep(0.0, uEdgeWidthPx, insidePx);
           rim = pow(rim, 2.2);

           // Soft uniform brightening over the whole surface.
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), uMilkyLift);

           // Bright specular edge, driven additively so it never looks dirty.
           gl_FragColor.rgb += vec3(1.0) * rim * uEdgeStrength;
           gl_FragColor.a = max(gl_FragColor.a, rim * 0.9);
         }`
      );
    };

    this.geometry = new PlaneGeometry(1, 1);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.mesh.name = 'fluid-glass-panel';

    this.camera = null;

    this.targetPos = new Vector3(0, 0, -this.distance);
    this.targetScale = new Vector3(0.0001, 0.0001, 1);
    this.targetOpacity = 0;
    this.currentOpacity = 0;

    // TiltedCard-style 3D rotation driven by setRotation(). Stored as a
    // separate Euler so we can spring it independently of the position /
    // scale lerp in update().
    this.targetEuler = new Euler(0, 0, 0, 'XYZ');
  }

  attachTo(camera) {
    this.camera = camera;
    this.mesh.position.copy(this.targetPos);
    camera.add(this.mesh);
  }

  /**
   * Translate a CSS-pixel rect on the viewport into a camera-local pose that
   * projects exactly to that rect. Using the perspective camera's FOV and
   * aspect we compute the world extents at this.distance and map linearly.
   *
   * @param {{x:number, y:number, width:number, height:number}} rect CSS px,
   *        origin top-left, x/y is the top-left of the rect.
   * @param {number} viewportW window.innerWidth
   * @param {number} viewportH window.innerHeight
   */
  setScreenRect(rect, viewportW, viewportH) {
    if (!this.camera || viewportW <= 0 || viewportH <= 0) return;

    const fovY = (this.camera.fov * Math.PI) / 180;
    const heightAtDistance = 2 * this.distance * Math.tan(fovY / 2);
    const widthAtDistance = heightAtDistance * this.camera.aspect;

    const cxPx = rect.x + rect.width / 2;
    const cyPx = rect.y + rect.height / 2;

    const localX = ((cxPx / viewportW) * 2 - 1) * (widthAtDistance / 2);
    const localY = (1 - (cyPx / viewportH) * 2) * (heightAtDistance / 2);

    const localW = (rect.width / viewportW) * widthAtDistance;
    const localH = (rect.height / viewportH) * heightAtDistance;

    this.targetPos.set(localX, localY, -this.distance);
    this.targetScale.set(Math.max(localW, 0.0001), Math.max(localH, 0.0001), 1);

    this.uniforms.uPxSize.value.set(rect.width, rect.height, 0);
    if (this.cornerMode === 'circle') {
      this.uniforms.uPxRadius.value = Math.min(rect.width, rect.height) * 0.5;
    }
  }

  setOpacity(opacity) {
    this.targetOpacity = Math.max(0, Math.min(1, opacity));
  }

  /**
   * Tilt the glass around its own X/Y axes. Values are in *degrees* and use
   * the same sign convention as CSS rotateX / rotateY so the 3D refraction
   * slides under the DOM tilt in lock-step. Because the mesh is attached to
   * the camera, local X/Y == the camera's right/up vectors which is exactly
   * what CSS perspective expects.
   */
  setRotation(rotXDeg, rotYDeg) {
    const toRad = Math.PI / 180;
    // CSS rotateX positive tilts the top *away* from the viewer. Three.js
    // rotation.x positive does the opposite along the camera's local axes,
    // so we negate. rotateY has the matching sign already.
    this.targetEuler.x = -rotXDeg * toRad;
    this.targetEuler.y = rotYDeg * toRad;
  }

  update(deltaTime) {
    const k = 1 - Math.exp(-9 * deltaTime);
    this.mesh.position.lerp(this.targetPos, k);
    this.mesh.scale.lerp(this.targetScale, k);

    // Spring the Euler toward target. We approach componentwise; each axis
    // is at most a few tens of degrees so there's no gimbal concern here.
    this.mesh.rotation.x += (this.targetEuler.x - this.mesh.rotation.x) * k;
    this.mesh.rotation.y += (this.targetEuler.y - this.mesh.rotation.y) * k;

    this.currentOpacity += (this.targetOpacity - this.currentOpacity) * k;
    // MeshPhysicalMaterial's transmission already makes the panel translucent
    // even at opacity 1, so we just use opacity as a fade-in/out multiplier.
    this.material.opacity = this.currentOpacity;
    this.mesh.visible = this.currentOpacity > 0.01;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
