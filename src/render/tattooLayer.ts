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

/**
 * Samples continuous coordinates measured along the body, independent of the
 * body's texture atlas. Size is the longest design side, in body units.
 * Texture and tint are linear colours; the result has straight alpha.
 */
export const SURFACE_TATTOO_GLSL = /* glsl */ `
vec4 sampleSurfaceTattoo(
  sampler2D tattooTexture, vec2 offset, float mask,
  float size, float aspect, float rotation, vec3 tint, float opacity
) {
  if (mask < 0.9999 || size <= 0.0 || aspect <= 0.0) return vec4(0.0);
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 rotated = vec2(c * offset.x + s * offset.y, -s * offset.x + c * offset.y);
  vec2 dimensions = size * vec2(min(aspect, 1.0), min(1.0 / aspect, 1.0));
  vec2 tUV = rotated / dimensions + 0.5;
  if (tUV.x < 0.0 || tUV.x > 1.0 || tUV.y < 0.0 || tUV.y > 1.0) return vec4(0.0);

  vec4 ink = texture2D(tattooTexture, tUV);
  // Only soften the image boundary by about half a screen pixel. Broad fades
  // visibly erase lettering and strokes that reach the source image edge.
  vec2 feather = min(vec2(0.005), max(fwidth(tUV) * 0.5, vec2(0.00001)));
  vec2 edge = min(tUV, 1.0 - tUV);
  vec2 fade = smoothstep(vec2(0.0), feather, edge);
  return vec4(ink.rgb * tint, ink.a * clamp(opacity, 0.0, 1.0) * fade.x * fade.y);
}
`;
