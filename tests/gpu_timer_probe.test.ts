import * as THREE from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GPU_TIMER_SCENE_AO_BRACKET,
  GPU_TIMER_UNAVAILABLE,
  labelGpuTimerPass,
} from '../src/render/gpu_timer_probe_core';

const flags = vi.hoisted(() => ({ gpuTimer: false }));

vi.mock('../src/render/render_dev_flags', () => ({
  gpuTimerRequested: () => flags.gpuTimer,
  renderLayerDisabled: () => false,
}));

import {
  createGpuTimerProbe,
  GPU_TIMER_EXTENSION,
  type GpuTimerGl,
  GpuTimerProbe,
} from '../src/render/gpu_timer_probe';
import { PostEffectComposer } from '../src/render/post_composer';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT_AVAILABLE = 0x8867;
const QUERY_RESULT = 0x8866;

// The slice of WebGL2 the adapter touches, recording every call.
function fakeGl(withExtension: boolean) {
  const calls: string[] = [];
  let nextQuery = 1;
  const ready = new Map<object, number>();
  let disjoint = false;
  const queries = new Map<object, number>();
  const gl: GpuTimerGl & {
    calls: string[];
    finish(query: object, ms: number): void;
    setDisjoint(): void;
  } = {
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
    calls,
    getExtension(name: string) {
      calls.push(`getExtension ${name}`);
      return withExtension && name === GPU_TIMER_EXTENSION
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null;
    },
    createQuery() {
      const query = { id: nextQuery++ } as unknown as WebGLQuery;
      queries.set(query, (query as unknown as { id: number }).id);
      calls.push(`createQuery ${queries.get(query)}`);
      return query;
    },
    deleteQuery(query) {
      calls.push(`deleteQuery ${query ? queries.get(query) : 'null'}`);
    },
    beginQuery(target, query) {
      calls.push(`beginQuery ${target} ${queries.get(query)}`);
    },
    endQuery(target) {
      calls.push(`endQuery ${target}`);
    },
    getQueryParameter(query, pname) {
      if (pname === QUERY_RESULT_AVAILABLE) return ready.has(query);
      if (pname === QUERY_RESULT) return ready.get(query) ?? 0;
      return null;
    },
    getParameter(pname) {
      if (pname !== GPU_DISJOINT_EXT) return null;
      const flag = disjoint;
      disjoint = false;
      return flag;
    },
    finish(query, ms) {
      ready.set(query, ms * 1e6);
    },
    setDisjoint() {
      disjoint = true;
    },
  };
  return gl;
}

afterEach(() => {
  flags.gpuTimer = false;
});

describe('gpu timer probe: the WebGL2 adapter', () => {
  it('is inert and reports unavailable when the context lacks the extension', () => {
    const gl = fakeGl(false);
    const probe = new GpuTimerProbe(gl);
    expect(probe.available).toBe(false);
    probe.beginScene();
    probe.begin('bloom');
    probe.end();
    probe.endFrame();
    expect(probe.snapshot()).toBe(GPU_TIMER_UNAVAILABLE);
    expect(gl.calls).toEqual([`getExtension ${GPU_TIMER_EXTENSION}`]);
  });

  it('opens TIME_ELAPSED queries on the extension target', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    expect(probe.available).toBe(true);
    probe.begin('bloom');
    probe.end();
    probe.endFrame();
    expect(gl.calls.slice(1)).toEqual([
      'createQuery 1',
      `beginQuery ${TIME_ELAPSED_EXT} 1`,
      `endQuery ${TIME_ELAPSED_EXT}`,
    ]);
  });

  it('resolves a finished query into the bracket table', () => {
    const gl = fakeGl(true);
    const created: WebGLQuery[] = [];
    const originalCreate = gl.createQuery;
    gl.createQuery = () => {
      const query = originalCreate.call(gl);
      created.push(query as WebGLQuery);
      return query;
    };
    const probe = new GpuTimerProbe(gl);
    probe.begin('bloom');
    probe.end();
    probe.endFrame();
    gl.finish(created[0], 2.5);
    probe.endFrame();
    const snap = probe.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.brackets.bloom).toEqual({ count: 1, avg: 2.5, p95: 2.5, max: 2.5 });
  });

  it('discards frames in flight when the disjoint flag is set', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    probe.begin('bloom');
    probe.end();
    probe.endFrame();
    gl.setDisjoint();
    probe.endFrame();
    expect(probe.snapshot().disjointFrames).toBe(1);
    expect(probe.snapshot().framesResolved).toBe(0);
  });

  it('hands the shadow bracket over to the scene once the shadow maps are drawn', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    const seen: unknown[][] = [];
    const shadowMap = {
      render(lights: unknown, scene: unknown, camera: unknown) {
        seen.push([this, lights, scene, camera]);
        gl.calls.push('shadowMap.render');
      },
    };
    probe.installShadowSplit(shadowMap);
    const lights = [{}];
    const scene = {};
    const camera = {};
    probe.beginScene();
    shadowMap.render(lights, scene, camera);
    probe.end();
    expect(seen).toEqual([[shadowMap, lights, scene, camera]]);
    expect(gl.calls.slice(1)).toEqual([
      'createQuery 1',
      `beginQuery ${TIME_ELAPSED_EXT} 1`,
      'shadowMap.render',
      `endQuery ${TIME_ELAPSED_EXT}`,
      'createQuery 2',
      `beginQuery ${TIME_ELAPSED_EXT} 2`,
      `endQuery ${TIME_ELAPSED_EXT}`,
    ]);
  });

  it('hands over to the scene+ao name when the AO pass drew the scene', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    const shadowMap = { render() {} };
    probe.installShadowSplit(shadowMap);
    const created: WebGLQuery[] = [];
    const originalCreate = gl.createQuery;
    gl.createQuery = () => {
      const query = originalCreate.call(gl);
      created.push(query as WebGLQuery);
      return query;
    };
    probe.beginScene(GPU_TIMER_SCENE_AO_BRACKET);
    shadowMap.render();
    probe.end();
    probe.endFrame();
    gl.finish(created[0], 1);
    gl.finish(created[1], 6);
    probe.endFrame();
    const snap = probe.snapshot();
    expect(snap.brackets.shadow.avg).toBe(1);
    expect(snap.brackets[GPU_TIMER_SCENE_AO_BRACKET].avg).toBe(6);
    expect(snap.frameSumMs).toBe(7);
  });

  it('passes a shadow render through untouched when no scene bracket is open', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    let renders = 0;
    const shadowMap = {
      render() {
        renders++;
      },
    };
    probe.installShadowSplit(shadowMap);
    // A prewarm or screenshot render, outside any frame bracket.
    shadowMap.render();
    // A non-scene bracket (a composer pass) that happens to render shadows.
    probe.begin('bloom');
    shadowMap.render();
    probe.end();
    expect(renders).toBe(2);
    expect(gl.calls.filter((c) => c.startsWith('createQuery'))).toEqual(['createQuery 1']);
  });

  it('releases its queries on dispose', () => {
    const gl = fakeGl(true);
    const probe = new GpuTimerProbe(gl);
    probe.begin('bloom');
    probe.end();
    probe.endFrame();
    probe.dispose();
    expect(gl.calls.at(-1)).toBe('deleteQuery 1');
    probe.begin('bloom');
    expect(gl.calls.at(-1)).toBe('deleteQuery 1');
  });
});

describe('gpu timer probe: the ?gputimer=1 gate', () => {
  it('builds no probe at all without the flag, so a player context is never queried', () => {
    flags.gpuTimer = false;
    const gl = fakeGl(true);
    expect(createGpuTimerProbe(gl)).toBeNull();
    expect(gl.calls).toEqual([]);
  });

  it('builds the probe under the flag', () => {
    flags.gpuTimer = true;
    const gl = fakeGl(true);
    const probe = createGpuTimerProbe(gl);
    expect(probe?.available).toBe(true);
  });
});

describe('gpu timer probe: the composer pass loop', () => {
  function stubRenderer(log: string[]): THREE.WebGLRenderer {
    return {
      getRenderTarget: () => null,
      setRenderTarget: (target: unknown) => log.push(`setRenderTarget ${target}`),
      getPixelRatio: () => 1,
    } as unknown as THREE.WebGLRenderer;
  }

  function stubPass(log: string[], name: string, enabled = true) {
    return {
      enabled,
      needsSwap: false,
      renderToScreen: false,
      clear: false,
      setSize() {},
      dispose() {},
      render() {
        log.push(`render ${name}`);
      },
    } as unknown as Pass;
  }

  function stubTimer(log: string[]) {
    return {
      beginScene: (name = 'scene') => log.push(`beginScene ${name}`),
      begin: (name: string) => log.push(`begin ${name}`),
      end: () => log.push('end'),
      endFrame: () => log.push('endFrame'),
    };
  }

  function composer(log: string[]): PostEffectComposer {
    return new PostEffectComposer(
      stubRenderer(log),
      new THREE.WebGLRenderTarget(4, 4),
      4,
      4,
      false,
    );
  }

  it('brackets every enabled pass, opening scene-drawing passes through beginScene', () => {
    const log: string[] = [];
    const post = composer(log);
    post.addPass(labelGpuTimerPass(stubPass(log, 'ao'), GPU_TIMER_SCENE_AO_BRACKET));
    post.addPass(labelGpuTimerPass(stubPass(log, 'bloom'), 'bloom'));
    post.addPass(labelGpuTimerPass(stubPass(log, 'twin', false), 'grade-fxaa'));
    post.addPass(stubPass(log, 'unlabelled'));
    post.passTimer = stubTimer(log);
    post.render();
    expect(log).toEqual([
      `beginScene ${GPU_TIMER_SCENE_AO_BRACKET}`,
      'render ao',
      'end',
      'begin bloom',
      'render bloom',
      'end',
      'begin pass',
      'render unlabelled',
      'end',
      'setRenderTarget null',
    ]);
    // The last enabled pass draws to the screen, exactly as three's loop marks it.
    expect(post.passes.map((pass) => pass.renderToScreen)).toEqual([false, false, false, true]);
  });

  it("renders through three's own loop when no timer is attached", () => {
    const log: string[] = [];
    const post = composer(log);
    post.addPass(stubPass(log, 'a'));
    post.render();
    expect(log).toEqual(['render a', 'setRenderTarget null']);
  });
});
