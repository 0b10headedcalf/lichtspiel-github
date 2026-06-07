/**
 * DistortionLayer — the WebGL post-process overlay. It owns a transparent canvas
 * stacked over the p5 `#stage`, samples the live p5 frame as a texture every
 * frame, and renders an audio-driven distortion of it (see shaders.ts). A
 * two-buffer ping-pong feeds the feedback/echo effect from the previous output.
 *
 * It is renderer-agnostic: it reads whatever the active template drew (P2D or
 * WEBGL) via `getSource()`, re-queried each frame so it survives scene swaps
 * (every mount replaces the p5 canvas). When disabled it hides entirely, so the
 * pristine p5 canvas shows through — the audio layer degrades to a no-op, in
 * keeping with the runtime's "every layer reduces to a safe path" doctrine.
 */

import type { DistortionUniforms } from './audioMapping.js';
import { COPY_FRAG, DISTORT_FRAG, FULLSCREEN_VERT } from './shaders.js';

const MAX_DPR = 2;

const DISTORT_UNIFORMS = [
  'uScene',
  'uPrev',
  'uRes',
  'uTime',
  'uBulge',
  'uWarp',
  'uRipple',
  'uChroma',
  'uGlitch',
  'uShift',
  'uDesync',
  'uFeedback',
  'uScan',
  'uHue',
  'uBloom',
  'uKaleido',
] as const;

function must<T>(x: T | null, what: string): T {
  if (x === null) throw new Error(`[distortion] failed to create ${what}`);
  return x;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export class DistortionLayer {
  private readonly parent: HTMLElement;
  private readonly getSource: () => HTMLCanvasElement | null;
  private readonly canvas: HTMLCanvasElement;

  private gl: WebGLRenderingContext | null = null;
  private enabled = false;
  private failed = false;

  private distort: WebGLProgram | null = null;
  private copy: WebGLProgram | null = null;
  private quad: WebGLBuffer | null = null;
  private sceneTex: WebGLTexture | null = null;
  private a: Target | null = null;
  private b: Target | null = null;
  private cur: 'a' | 'b' = 'a';
  private bw = 0;
  private bh = 0;

  private readonly uLoc: Record<string, WebGLUniformLocation | null> = {};
  private aPosLoc = -1;
  private copyPosLoc = -1;
  private copyTexLoc: WebGLUniformLocation | null = null;
  private t0 = 0;

  constructor(parent: HTMLElement, getSource: () => HTMLCanvasElement | null) {
    this.parent = parent;
    this.getSource = getSource;
    const c = document.createElement('canvas');
    c.className = 'distortion-overlay';
    c.setAttribute('aria-hidden', 'true');
    parent.appendChild(c);
    this.canvas = c;
  }

  isEnabled(): boolean {
    return this.enabled && !this.failed;
  }

  /** Show/hide the overlay. First enable lazily creates the GL context. */
  setEnabled(on: boolean): void {
    if (on && !this.gl && !this.failed) this.init();
    this.enabled = on && !this.failed;
    this.canvas.classList.toggle('shown', this.enabled);
  }

  private init(): void {
    const opts: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    const gl = (this.canvas.getContext('webgl', opts) ??
      this.canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) {
      this.failed = true;
      console.warn('[distortion] WebGL unavailable — audio distortion disabled');
      return;
    }
    try {
      this.gl = gl;
      this.distort = this.program(DISTORT_FRAG);
      this.copy = this.program(COPY_FRAG);

      this.quad = must(gl.createBuffer(), 'quad');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      // Two triangles covering clip space.
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );

      this.aPosLoc = gl.getAttribLocation(this.distort, 'aPos');
      this.copyPosLoc = gl.getAttribLocation(this.copy, 'aPos');
      this.copyTexLoc = gl.getUniformLocation(this.copy, 'uTex');
      for (const n of DISTORT_UNIFORMS) this.uLoc[n] = gl.getUniformLocation(this.distort, n);

      this.sceneTex = this.makeTex();
      this.t0 = performance.now();
    } catch (err) {
      this.failed = true;
      this.gl = null;
      console.warn('[distortion] init failed — disabled', err);
    }
  }

  private program(frag: string): WebGLProgram {
    const gl = this.gl as WebGLRenderingContext;
    const vs = this.shader(gl.VERTEX_SHADER, FULLSCREEN_VERT);
    const fs = this.shader(gl.FRAGMENT_SHADER, frag);
    const p = must(gl.createProgram(), 'program');
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(p) ?? ''}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return p;
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl as WebGLRenderingContext;
    const s = must(gl.createShader(type), 'shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`shader compile failed: ${gl.getShaderInfoLog(s) ?? ''}`);
    }
    return s;
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl as WebGLRenderingContext;
    const t = must(gl.createTexture(), 'texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl as WebGLRenderingContext;
    const tex = this.makeTex();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = must(gl.createFramebuffer(), 'framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  private resize(bw: number, bh: number): void {
    const gl = this.gl as WebGLRenderingContext;
    this.bw = bw;
    this.bh = bh;
    this.canvas.width = bw;
    this.canvas.height = bh;
    if (this.a) {
      gl.deleteTexture(this.a.tex);
      gl.deleteFramebuffer(this.a.fbo);
    }
    if (this.b) {
      gl.deleteTexture(this.b.tex);
      gl.deleteFramebuffer(this.b.fbo);
    }
    this.a = this.makeTarget(bw, bh);
    this.b = this.makeTarget(bw, bh);
    this.cur = 'a';
  }

  /** Position the overlay exactly over the source canvas (inside `parent`). */
  private place(src: HTMLCanvasElement): { bw: number; bh: number } {
    const pr = this.parent.getBoundingClientRect();
    const sr = src.getBoundingClientRect();
    this.canvas.style.left = `${Math.round(sr.left - pr.left)}px`;
    this.canvas.style.top = `${Math.round(sr.top - pr.top)}px`;
    this.canvas.style.width = `${Math.round(sr.width)}px`;
    this.canvas.style.height = `${Math.round(sr.height)}px`;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    return {
      bw: Math.max(1, Math.round(sr.width * dpr)),
      bh: Math.max(1, Math.round(sr.height * dpr)),
    };
  }

  private bindQuad(loc: number): void {
    const gl = this.gl as WebGLRenderingContext;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  /** Sample the current p5 frame and present its audio-distorted version. */
  render(u: DistortionUniforms): void {
    if (!this.enabled || this.failed) return;
    const gl = this.gl;
    if (!gl || !this.distort || !this.copy || !this.sceneTex) return;
    const src = this.getSource();
    if (!src || src.width === 0 || src.height === 0) return;

    const { bw, bh } = this.place(src);
    if (bw !== this.bw || bh !== this.bh || !this.a || !this.b) this.resize(bw, bh);
    if (!this.a || !this.b) return;
    const cur = this.cur === 'a' ? this.a : this.b;
    const prev = this.cur === 'a' ? this.b : this.a;

    // Upload the live p5 frame (flip Y so the canvas lands upright in GL).
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      // A tainted or transiently-empty source can throw — skip this frame.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      return;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // ── Pass 1: distortion → current FBO ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.distort);
    this.bindQuad(this.aPosLoc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.uLoc['uScene'], 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(this.uLoc['uPrev'], 1);
    gl.uniform2f(this.uLoc['uRes'], bw, bh);
    gl.uniform1f(this.uLoc['uTime'], (performance.now() - this.t0) / 1000);
    gl.uniform1f(this.uLoc['uBulge'], u.bulge);
    gl.uniform1f(this.uLoc['uWarp'], u.warp);
    gl.uniform1f(this.uLoc['uRipple'], u.ripple);
    gl.uniform1f(this.uLoc['uChroma'], u.chroma);
    gl.uniform1f(this.uLoc['uGlitch'], u.glitch);
    gl.uniform1f(this.uLoc['uShift'], u.shift);
    gl.uniform1f(this.uLoc['uDesync'], u.desync);
    gl.uniform1f(this.uLoc['uFeedback'], u.feedback);
    gl.uniform1f(this.uLoc['uScan'], u.scan);
    gl.uniform1f(this.uLoc['uHue'], u.hue);
    gl.uniform1f(this.uLoc['uBloom'], u.bloom);
    gl.uniform1f(this.uLoc['uKaleido'], u.kaleido);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 2: copy current FBO → screen ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.copy);
    this.bindQuad(this.copyPosLoc);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(this.copyTexLoc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Ping-pong: this frame's output becomes next frame's feedback source.
    this.cur = this.cur === 'a' ? 'b' : 'a';
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.a) {
        gl.deleteTexture(this.a.tex);
        gl.deleteFramebuffer(this.a.fbo);
      }
      if (this.b) {
        gl.deleteTexture(this.b.tex);
        gl.deleteFramebuffer(this.b.fbo);
      }
      if (this.sceneTex) gl.deleteTexture(this.sceneTex);
      if (this.quad) gl.deleteBuffer(this.quad);
      if (this.distort) gl.deleteProgram(this.distort);
      if (this.copy) gl.deleteProgram(this.copy);
    }
    this.canvas.remove();
  }
}
