import { AI_IMAGE_MODES, AI_IMAGE_QUALITIES, AI_IMAGE_SIZES } from "../ai/imageOptions"
import { defineNode } from "../engine/nodeDef"

export default defineNode({
  type: "ai_image",
  category: "Sources",
  doc: "A picture generated from a prompt by OpenAI's Images API, with the artist's own key. Nothing is generated until Generate is pressed (or an agent calls generate_image, if the artist allowed that); the result is saved in the project and reused. mode transparent asks for a transparent background; mode mask asks for a bright subject on black and turns brightness into alpha. Outputs the picture and its alpha as a grayscale mask, ready for Band, Erosion or Palette Remap.",
  inputs: {},
  outputs: { out: "color", mask: "gray" },
  params: {
    prompt: { type: "string", default: "", doc: "What to draw. Describe the shape and the style; say what should stay empty." },
    mode: { type: "enum", default: "transparent", options: AI_IMAGE_MODES, doc: "transparent: transparent background from the model. mask: bright subject on black, brightness becomes alpha." },
    size: { type: "enum", default: "1024x1024", options: AI_IMAGE_SIZES, doc: "Size of the generated picture. It is stretched over the frame." },
    quality: { type: "enum", default: "medium", options: AI_IMAGE_QUALITIES, doc: "Higher quality costs more and takes longer." },
    image: { type: "string", default: "", doc: "The generated picture, set by Generate. Empty until then." }
  },
  asset: "image",
  wgsl: /* wgsl */ `
fn node(uv: vec2f) -> vec4f {
  let c = sample_asset(uv);
  let brightness = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let a = select(c.a, clamp(brightness, 0.0, 1.0) * c.a, P.mode == 1u);
  if (OUT == 1u) { return vec4f(a, a, a, 1.0); }
  return vec4f(c.rgb, a);
}`
})
