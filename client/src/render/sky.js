// A sky dome seen from the surface: horizon-to-zenith gradient, sun glow, sunsets,
// and colours that follow the planet's air quality (toxic amber to clean blue).
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);
const SKY = {
  toxicZenith: C(0x5a3418),
  toxicHorizon: C(0xc98b55),
  cleanZenith: C(0x2a64c2),
  cleanHorizon: C(0xa8cdee),
  nightZenith: C(0x02040b),
  nightHorizon: C(0x0a1224),
  sunsetZenith: C(0x33305e),
  sunsetHorizon: C(0xff8448),
  toxicGround: C(0x3a2616),
  cleanGround: C(0x40566a),
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SkyDome {
  constructor(scene) {
    this.uniforms = {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunTint: { value: new THREE.Color(0xffd9a8) },
      uDay: { value: 1 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uUp;
          uniform vec3 uSun;
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uGround;
          uniform vec3 uSunTint;
          uniform float uDay;
          varying vec3 vWorld;
          void main() {
            vec3 d = normalize(vWorld - cameraPosition);
            float h = dot(d, uUp);
            vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.75, h), 0.55));
            col = mix(col, uGround, smoothstep(0.0, -0.3, h));
            float s = max(dot(d, uSun), 0.0);
            col += uSunTint * (pow(s, 5.0) * 0.28 * uDay + pow(s, 48.0) * 0.5 + pow(s, 900.0) * 6.0);
            gl_FragColor = vec4(col, 1.0);
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    this.mesh.scale.setScalar(2400);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.horizon = new THREE.Color();
    this.zenith = new THREE.Color();
    this.daylight = 1;
  }

  /**
   * Updates the dome for a camera standing on the surface with local `up`.
   * Returns nothing; read `horizon`, `zenith` and `daylight` afterwards for fog and lighting.
   */
  update(camera, up, sun, air) {
    const elev = up.dot(sun);
    const day = smooth(-0.14, 0.28, elev);
    const sunset = Math.max(0, 1 - Math.abs(elev - 0.03) / 0.22);
    const zenith = this.zenith.copy(SKY.toxicZenith).lerp(SKY.cleanZenith, air);
    const horizon = this.horizon.copy(SKY.toxicHorizon).lerp(SKY.cleanHorizon, air);
    zenith.lerp(SKY.sunsetZenith, sunset * 0.5);
    horizon.lerp(SKY.sunsetHorizon, sunset * 0.65);
    zenith.lerp(SKY.nightZenith, 1 - day);
    horizon.lerp(SKY.nightHorizon, 1 - day);
    const u = this.uniforms;
    u.uUp.value.copy(up);
    u.uSun.value.copy(sun);
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uGround.value.copy(SKY.toxicGround).lerp(SKY.cleanGround, air).lerp(horizon, 0.6).multiplyScalar(0.3 + day * 0.6);
    u.uSunTint.value.setRGB(1, 0.85 - sunset * 0.35, 0.66 - sunset * 0.45);
    u.uDay.value = day;
    this.daylight = day;
    this.mesh.position.copy(camera.position);
  }
}
