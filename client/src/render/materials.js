// Procedural surface detail: canvas-generated textures (hull panels, concrete, rust) applied
// with world-space triplanar mapping, so any box or cylinder gets correctly scaled detail
// without UVs. Textures are grey around 0.5 and multiply the material colour.
import * as THREE from 'three';
import { mulberry32 } from '../sim/noise.js';

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Speckle noise over the whole canvas; `amount` is the grey deviation (0-255). */
function speckle(ctx, size, rand, amount, count) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(128 + (rand() - 0.5) * amount);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.15 + rand() * 0.25})`;
    const s = 1 + rand() * 3;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
}

export const TEX = {
  /** Spacecraft-style hull: panel seams, rivets, streaks of dust and rust. */
  panels: canvasTexture(512, (ctx, size) => {
    const rand = mulberry32(11);
    ctx.fillStyle = 'rgb(134,134,134)';
    ctx.fillRect(0, 0, size, size);
    const cell = size / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = Math.floor(120 + rand() * 30);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
        ctx.fillStyle = 'rgba(40,40,40,0.55)';
        for (const [rx, ry] of [[10, 10], [cell - 14, 10], [10, cell - 14], [cell - 14, cell - 14]]) {
          ctx.fillRect(x * cell + rx, y * cell + ry, 4, 4);
        }
      }
    }
    speckle(ctx, size, rand, 90, 5000);
    for (let i = 0; i < 26; i++) {
      const x = rand() * size;
      const g = ctx.createLinearGradient(0, 0, 0, size * (0.2 + rand() * 0.4));
      g.addColorStop(0, 'rgba(90,50,30,0.45)');
      g.addColorStop(1, 'rgba(90,50,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, rand() * size * 0.6, 2 + rand() * 6, size * 0.5);
    }
  }),
  /** Poured concrete with aggregate speckle and hairline cracks. */
  concrete: canvasTexture(512, (ctx, size) => {
    const rand = mulberry32(23);
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, rand, 120, 14000);
    ctx.strokeStyle = 'rgba(40,40,40,0.5)';
    for (let i = 0; i < 10; i++) {
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      let x = rand() * size;
      let y = rand() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rand() - 0.5) * 60;
        y += (rand() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,60,60,0.35)';
    ctx.fillRect(0, size / 2 - 2, size, 4);
    ctx.fillRect(size / 2 - 2, 0, 4, size);
  }),
  /** Corrugated, rusty container steel. */
  corrugated: canvasTexture(256, (ctx, size) => {
    const rand = mulberry32(37);
    for (let x = 0; x < size; x++) {
      const v = Math.floor(128 + Math.sin((x / size) * Math.PI * 24) * 40);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, 0, 1, size);
    }
    speckle(ctx, size, rand, 110, 3000);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(70,35,20,${0.2 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 3 + rand() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }),
};

/**
 * Adds world-space triplanar detail to a MeshStandardMaterial. `scale` is texture repeats
 * per metre; `strength` blends between flat (0) and full detail (1).
 */
export function triplanar(mat, tex, scale = 0.35, strength = 1) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTri = { value: tex };
    shader.uniforms.uTriScale = { value: scale };
    shader.uniforms.uTriStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTriNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uTri;\nuniform float uTriScale;\nuniform float uTriStrength;\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 tw = pow(abs(normalize(vTriNormal)), vec3(4.0));
        tw /= (tw.x + tw.y + tw.z);
        vec3 tri = texture2D(uTri, vTriPos.yz * uTriScale).rgb * tw.x
                 + texture2D(uTri, vTriPos.xz * uTriScale).rgb * tw.y
                 + texture2D(uTri, vTriPos.xy * uTriScale).rgb * tw.z;
        diffuseColor.rgb *= mix(vec3(1.0), tri * 1.9, uTriStrength);`,
      );
  };
  mat.customProgramCacheKey = () => `tri-${tex.uuid}-${scale}-${strength}`;
  return mat;
}
