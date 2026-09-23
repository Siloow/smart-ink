import * as THREE from 'three';

/** Restore the authored sockets without sharing mutable GLTF geometry/materials. */
export function createPreviewEyes(sources: THREE.Mesh[], body: THREE.Mesh): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Eyes';
  group.userData.previewAppearance = 'eyes';
  const inverse = body.matrixWorld.clone().invert();
  for (const source of sources) {
    const geometry = source.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, source.matrixWorld));
    geometry.computeBoundingBox();
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
    const size = geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(.5);
    const position = geometry.getAttribute('position');
    const directions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      directions[i * 3] = (position.getX(i) - center.x) / Math.max(size.x, 1e-6);
      directions[i * 3 + 1] = (position.getY(i) - center.y) / Math.max(size.y, 1e-6);
      directions[i * 3 + 2] = (position.getZ(i) - center.z) / Math.max(size.z, 1e-6);
    }
    // This rest-space attribute keeps the iris attached through head posing.
    geometry.setAttribute('aEyeDirection', new THREE.BufferAttribute(directions, 3));
    const material = new THREE.MeshPhysicalMaterial({ color: '#e1dbd4', roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .06 });
    material.onBeforeCompile = shader => {
      shader.uniforms.uIrisColor = { value: new THREE.Color('#634530') };
      shader.vertexShader = 'attribute vec3 aEyeDirection; varying vec3 vEyeDirection;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeDirection = aEyeDirection;');
      shader.fragmentShader = 'varying vec3 vEyeDirection; uniform vec3 uIrisColor;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 eye = normalize(vEyeDirection);
        float r = length(eye.xy);
        float edge = max(fwidth(r), 0.005);
        float iris = (1.0 - smoothstep(0.5 - edge, 0.5 + edge, r)) * step(0.0, eye.z);
        float pupil = 1.0 - smoothstep(0.18 - edge, 0.18 + edge, r);
        float angle = atan(eye.y, eye.x);
        float fibers = 0.85 + 0.15 * sin(angle * 65.0 + r * 25.0);
        vec3 irisColor = uIrisColor * fibers * mix(1.0, 0.3, smoothstep(0.43, 0.5, r));
        irisColor = mix(irisColor, vec3(0.003), pupil);
        diffuseColor.rgb = mix(diffuseColor.rgb, irisColor, iris);
      `);
    };
    material.customProgramCacheKey = () => 'smartink-eyes-v1';
    const eye = new THREE.Mesh(geometry, material);
    eye.name = source.name;
    eye.castShadow = true;
    eye.receiveShadow = true;
    group.add(eye);
  }
  return group;
}
