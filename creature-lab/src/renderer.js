// Minimal WebGPU renderer: one canvas, many viewports. Each "view" is a DOM element
// whose on-screen rectangle gets a backdrop and one creature.
import { creatureWGSL, backdropWGSL, UNIFORM_FLOATS } from './shaders.js';
import { PLANS, PATTERNS } from './genome.js';

const DBG = location.search;
const mat4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = far / (near - far); m[11] = -1; m[14] = (near * far) / (near - far);
    return m;
  },
  lookAt(eye, target, up) {
    const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  translate(x, y, z) { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z; return m; },
};
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export async function createRenderer(canvas) {
  if (!navigator.gpu) throw new Error('no-webgpu');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no-adapter');
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.error('GPU device lost:', info.reason, info.message));
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', e.error.message));
  // ?offscreen renders into a plain texture instead of the page canvas. Automated checks use it
  // in headless browsers, where presenting a WebGPU canvas is not supported.
  const offscreen = DBG.includes('offscreen');
  const ctx = offscreen ? null : canvas.getContext('webgpu');
  const format = offscreen ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  ctx?.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  let offTex = null;

  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const cMod = device.createShaderModule({ code: creatureWGSL });
  const bMod = device.createShaderModule({ code: backdropWGSL });
  const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const creaturePipe = device.createRenderPipeline({
    layout,
    vertex: { module: cMod, entryPoint: 'vs', buffers: [{ arrayStride: 40, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x4' },
    ] }] },
    fragment: { module: cMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil,
  });
  const backdropPipe = device.createRenderPipeline({
    layout,
    vertex: { module: bMod, entryPoint: 'vs' },
    fragment: { module: bMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });

  let depth = null;
  const views = new Set();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h || !depth) {
      canvas.width = w; canvas.height = h;
      depth?.destroy();
      depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      if (offscreen) { offTex?.destroy(); offTex = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
    }
    return dpr;
  }

  function makeView(el) {
    const ubuf = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
    const view = {
      el, ubuf, bind, mesh: null, genome: null, yaw: Math.random() * 6, pitch: 0.25, zoom: 1, spin: true, selected: 0,
      setCreature(genome, mesh) {
        view.vb?.destroy(); view.ib?.destroy();
        view.vb = device.createBuffer({ size: mesh.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(view.vb, 0, mesh.verts);
        view.ib = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(view.ib, 0, mesh.indices);
        view.mesh = mesh; view.genome = genome;
      },
      destroy() { view.vb?.destroy(); view.ib?.destroy(); ubuf.destroy(); views.delete(view); },
    };
    views.add(view);
    return view;
  }

  const data = new Float32Array(UNIFORM_FLOATS);
  function writeUniforms(view, aspect, t, adj) {
    const g = view.genome, m = view.mesh;
    const dist = m.radius * (g.plan === 'medusa' ? 3.1 : 2.6) / view.zoom;
    const eye = [Math.sin(view.yaw) * Math.cos(view.pitch) * dist, Math.sin(view.pitch) * dist, Math.cos(view.yaw) * Math.cos(view.pitch) * dist];
    let vp = mat4.mul(mat4.perspective(0.75, aspect, dist * 0.05, dist * 4), mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]));
    if (adj) vp = mat4.mul(adj, vp);
    const model = mat4.translate(-m.center[0], -m.center[1], -m.center[2]);
    const lin = (c) => c.map((x) => Math.pow(x, 2.2)), c = { back: lin(g.colors.back), belly: lin(g.colors.belly), accent: lin(g.colors.accent), glow: lin(g.colors.glow) };
    data.set(vp, 0); data.set(model, 16);
    data.set([eye[0], eye[1], eye[2], 0], 32);
    data.set([...c.back, 1], 36); data.set([...c.belly, 1], 40); data.set([...c.accent, 1], 44); data.set([...c.glow, 1], 48);
    data.set([PATTERNS.indexOf(g.pattern), g.patternFreq, g.patternContrast, g.iridescence], 52);
    data.set([g.undulation, g.waves, g.swimSpeed, g.flap], 56);
    data.set([g.flapSpeed, g.plan === 'medusa' ? 0.05 : 0.025, PLANS.indexOf(g.plan), t], 60);
    data.set([g.glow, g.glowPulse, g.length, view.selected], 64);
    device.queue.writeBuffer(view.ubuf, 0, data);
  }

  function frame(t, capture = null) {
    const dpr = resize();
    const target = offscreen ? offTex : ctx.getCurrentTexture();
    const cr = canvas.getBoundingClientRect();
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), clearValue: { r: 0.012, g: 0.03, b: 0.05, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    for (const view of views) {
      if (!view.mesh || view.el.offsetParent === null) continue;
      const r = view.el.getBoundingClientRect();
      let x = Math.floor((r.left - cr.left) * dpr), y = Math.floor((r.top - cr.top) * dpr);
      let w = Math.floor(r.width * dpr), h = Math.floor(r.height * dpr);
      if (w < 2 || h < 2 || x >= canvas.width || y >= canvas.height || x + w <= 0 || y + h <= 0) continue;
      // Viewport must stay inside the canvas, so clip and keep the projection centered on the element.
      const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(canvas.width, x + w), y1 = Math.min(canvas.height, y + h);
      if (view.spin) view.yaw += 0.0025;
      const cw = x1 - x0, ch = y1 - y0;
      let adj = null;
      if (cw !== w || ch !== h) {
        // Clipped by the canvas edge: draw into the visible part and shift the projection to match.
        adj = new Float32Array(16);
        adj[0] = w / cw; adj[5] = h / ch; adj[10] = 1; adj[15] = 1;
        adj[12] = ((x + w / 2) - (x0 + cw / 2)) * 2 / cw;
        adj[13] = -((y + h / 2) - (y0 + ch / 2)) * 2 / ch;
      }
      writeUniforms(view, w / h, t, adj);
      pass.setViewport(x0, y0, cw, ch, 0, 1);
      pass.setScissorRect(x0, y0, cw, ch);
      pass.setBindGroup(0, view.bind);
      pass.setPipeline(backdropPipe); pass.draw(3);
      pass.setPipeline(creaturePipe);
      pass.setVertexBuffer(0, view.vb); pass.setIndexBuffer(view.ib, 'uint32');
      pass.drawIndexed(view.mesh.indices.length);
    }
    pass.end();
    let readback = null;
    if (capture) {
      const bpr = Math.ceil(canvas.width * 4 / 256) * 256;
      readback = device.createBuffer({ size: bpr * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: bpr }, [canvas.width, canvas.height]);
      readback.bpr = bpr;
    }
    device.queue.submit([enc.finish()]);
    return readback;
  }

  // Debug helper for automated checks: renders one frame and returns it as a PNG data URL.
  async function capture(t) {
    const rb = frame(t, true);
    await rb.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(rb.getMappedRange()), w = canvas.width, h = canvas.height;
    const img = new ImageData(w, h), bgra = format === 'bgra8unorm';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * rb.bpr + x * 4, o = (y * w + x) * 4;
      img.data[o] = src[i + (bgra ? 2 : 0)]; img.data[o + 1] = src[i + 1]; img.data[o + 2] = src[i + (bgra ? 0 : 2)]; img.data[o + 3] = 255;
    }
    rb.unmap(); rb.destroy();
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    c2.getContext('2d').putImageData(img, 0, 0);
    return c2.toDataURL('image/png');
  }

  return { makeView, frame, capture, device };
}
