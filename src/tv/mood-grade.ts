/**
 * The "Stimmungsvoll" look in one pass: the soft vignette and the little extra contrast and colour,
 * exactly as Phaser's Vignette and ColorMatrix effects compute them – but in a single full-screen
 * draw instead of one per effect plus copies (that is most of the post-processing cost on a TV).
 */
import Phaser from "phaser";

/** Same numbers as cam.postFX.addVignette(0.5, 0.5, 0.92, 0.3) and contrast(0.08) + saturate(0.12, true). */
const VIGNETTE = { x: 0.5, y: 0.5, radius: 0.92, strength: 0.3 };

const FRAG = `
#define SHADER_NAME MOOD_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform float radius;
uniform float strength;
uniform vec2 position;
uniform float uColorMatrix[20];
varying vec2 outTexCoord;
void main ()
{
    // Phaser's vignette …
    vec4 col = vec4(1.0);
    float d = length(outTexCoord - position);
    if (d <= radius)
    {
        float g = d / radius;
        g = sin(g * 3.14 * strength);
        col = vec4(g * g * g);
    }
    vec4 c = texture2D(uMainSampler, outTexCoord) * (1.0 - col);
    // … then Phaser's colour matrix (strength 1).
    if (c.a > 0.0)
    {
        c.rgb /= c.a;
    }
    vec4 result;
    result.r = (uColorMatrix[0] * c.r) + (uColorMatrix[1] * c.g) + (uColorMatrix[2] * c.b) + (uColorMatrix[3] * c.a) + uColorMatrix[4];
    result.g = (uColorMatrix[5] * c.r) + (uColorMatrix[6] * c.g) + (uColorMatrix[7] * c.b) + (uColorMatrix[8] * c.a) + uColorMatrix[9];
    result.b = (uColorMatrix[10] * c.r) + (uColorMatrix[11] * c.g) + (uColorMatrix[12] * c.b) + (uColorMatrix[13] * c.a) + uColorMatrix[14];
    result.a = (uColorMatrix[15] * c.r) + (uColorMatrix[16] * c.g) + (uColorMatrix[17] * c.b) + (uColorMatrix[18] * c.a) + uColorMatrix[19];
    gl_FragColor = vec4(result.rgb * result.a, result.a);
}
`;

export class MoodGrade extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private readonly matrix: number[];

  constructor(game: Phaser.Game) {
    super({ game, name: "MoodGrade", fragShader: FRAG });
    const cm = new Phaser.Display.ColorMatrix();
    cm.contrast(0.08);
    cm.saturate(0.12, true);
    this.matrix = Array.from(cm.getData());
  }

  override onPreRender(): void {
    this.set1f("radius", VIGNETTE.radius);
    this.set1f("strength", VIGNETTE.strength);
    this.set2f("position", VIGNETTE.x, VIGNETTE.y);
    this.set1fv("uColorMatrix", this.matrix);
  }
}
