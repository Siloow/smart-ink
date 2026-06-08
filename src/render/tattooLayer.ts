// Shared GLSL: samples the tattoo at a UV using the same center/scale/rotation/edge-fade
// convention as ModelWithUVTattoo. Returns straight-alpha RGBA (tattoo only).
export const TATTOO_LAYER_GLSL = /* glsl */ `
vec4 sampleTattooLayer(
  sampler2D tattooTexture, vec2 uv,
  vec2 tattooCenter, float tattooScale, float tattooRotation
) {
  vec2 offset = uv - tattooCenter;
  float c = cos(tattooRotation);
  float s = sin(tattooRotation);
  offset = vec2(c * offset.x + s * offset.y, -s * offset.x + c * offset.y);
  vec2 tUV = offset / tattooScale + 0.5;
  if (tUV.x < 0.0 || tUV.x > 1.0 || tUV.y < 0.0 || tUV.y > 1.0) return vec4(0.0);
  vec4 t = texture2D(tattooTexture, tUV);
  float fw = 0.04;
  float fade = 1.0;
  fade *= smoothstep(0.0, fw, tUV.x);
  fade *= smoothstep(0.0, fw, 1.0 - tUV.x);
  fade *= smoothstep(0.0, fw, tUV.y);
  fade *= smoothstep(0.0, fw, 1.0 - tUV.y);
  return vec4(t.rgb, t.a * fade);
}
`;
