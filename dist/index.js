//#region src/model.ts
var e = [
	1 / 16,
	4 / 16,
	6 / 16,
	4 / 16,
	1 / 16
], t = 5e-4, n = 8192, r = .01, i = 2 ** -16, a = {
	amount: 0,
	size: 30,
	threshold: 80
};
function o(e, n) {
	return e * t * n;
}
function s(e) {
	let t = o(e, n);
	if (t <= 0) return 1;
	let r = Math.ceil(Math.log(3 * t * t + 1) / Math.log(4));
	return Math.min(10, Math.max(1, r));
}
function c(e) {
	return e.amount > 0;
}
//#endregion
//#region src/params.ts
var l = "glow", u = `${l}.glow`, d = [
	"amount",
	"size",
	"threshold",
	"draws"
], f = Object.fromEntries(d.map((e) => [e, `${u}.${e}`])), p = {
	amount: {
		min: 0,
		max: 100,
		step: 1
	},
	size: {
		min: 0,
		max: 100,
		step: 1
	},
	threshold: {
		min: 0,
		max: 100,
		step: 1
	}
};
function m() {
	return d.map((e) => f[e]);
}
function h(e, t, n, r) {
	let i = e[t];
	return typeof i != "number" || !Number.isFinite(i) ? r : i < n.min ? n.min : i > n.max ? n.max : i;
}
function g(e) {
	return {
		amount: h(e, f.amount, p.amount, a.amount),
		size: h(e, f.size, p.size, a.size),
		threshold: h(e, f.threshold, p.threshold, a.threshold)
	};
}
function _(e) {
	return {
		[f.amount]: e.amount,
		[f.size]: e.size,
		[f.threshold]: e.threshold,
		[f.draws]: c(e) ? s(e.size) : 0
	};
}
function v() {
	return _(a);
}
var y = [
	f.amount,
	f.size,
	f.threshold
];
function b(e) {
	if (!y.some((t) => t in e)) return null;
	let t = _(g(e)), n = e[f.draws];
	return (typeof n == "number" && Number.isFinite(n) ? n : 0) === t[f.draws] ? null : t;
}
//#endregion
//#region src/runtime.ts
var x = null;
function S(e) {
	x = e;
}
function C() {
	if (!x) throw Error("[glow] api() called before activate()");
	return x;
}
function w(e, t, ...n) {
	return C().react.createElement(e, t, ...n);
}
//#endregion
//#region src/Panel.ts
var T = [
	{
		label: "Amount",
		...p.amount,
		read: (e) => e.amount,
		write: (e, t) => ({
			...e,
			amount: t
		}),
		commitLabel: "amount"
	},
	{
		label: "Size",
		...p.size,
		read: (e) => e.size,
		write: (e, t) => ({
			...e,
			size: t
		}),
		commitLabel: "size"
	},
	{
		label: "Threshold",
		...p.threshold,
		read: (e) => e.threshold,
		write: (e, t) => ({
			...e,
			threshold: t
		}),
		commitLabel: "threshold"
	}
], E = "Pixels brighter than Threshold glow; Size is how far the glow reaches. Threshold 0 softens the whole photo.", D = {
	display: "flex",
	flexDirection: "column",
	gap: 1
};
function O() {
	let { Slider: e } = C().components, { Stack: t, tokens: n } = C().ui, r = C().develop.useParamScope(), i = g(r.getParams()), o = () => g(r.getParams()), s = (e) => r.setParams(_(e)), c = (e) => r.commit(`Glow ${e}`), l = (t) => w(e, {
		key: t.label,
		label: t.label,
		value: t.read(i),
		min: t.min,
		max: t.max,
		step: t.step,
		defaultValue: t.read(a),
		onChange: (e) => s(t.write(o(), e)),
		onCommit: () => c(t.commitLabel)
	}), u = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: n.textMuted
	};
	return w(t, {
		gap: 6,
		style: { padding: "6px 8px 8px" }
	}, w("div", {
		key: "controls",
		style: D
	}, ...T.map(l)), w("p", {
		key: "hint",
		style: u
	}, E));
}
//#endregion
//#region src/glsl.ts
function k(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t : `${t}.0`;
}
var A = k, j = `
float glowB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${A(e[2])} : (d == 1 ? ${A(e[1])} : ${A(e[0])}); }
float glowLinear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 glowLight(vec3 p) {
  float Y = luma(p);
  float T = glowLinear(threshold * 0.01);
  return p * (max(Y - T, 0.0) / max(Y, ${A(i)}));
}
vec3 glowLevel(vec2 uv) { vec3 p = readPrev(uv); return uPassIndex == 0 ? glowLight(p) : p; }
`, M = `
{
  float longEdge = max(1.0 / uTexel.x, 1.0 / uTexel.y);
  float sigma = size * ${A(t)} * longEdge;
  float s = sigma * inversesqrt((exp2(2.0 * float(uPassCount)) - 1.0) / 3.0) * exp2(float(uPassIndex));
  vec3 sum = vec3(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      sum += glowB3(dx) * glowB3(dy) * glowLevel(vUv + vec2(float(dx), float(dy)) * s * uTexel);
    }
  }
  c = sum;
}
`, N = `
{
  if (amount > 0.0 && draws > 0.5) {
    lin += amount * ${A(r)} * max(stageResult, 0.0);
  }
}
`;
//#endregion
//#region src/stage.ts
function P() {
	return {
		glsl: M,
		helpers: j,
		iterations: {
			key: "draws",
			max: 10
		},
		uniforms: [{
			key: "size",
			glslType: "float",
			default: a.size,
			range: { ...p.size },
			label: "size"
		}, {
			key: "threshold",
			glslType: "float",
			default: a.threshold,
			range: { ...p.threshold },
			label: "threshold"
		}]
	};
}
function F() {
	return {
		id: u,
		name: "Glow",
		phase: "scene-linear",
		priority: 70,
		reads: "current",
		glsl: N,
		uniforms: [{
			key: "amount",
			glslType: "float",
			default: 0,
			range: { ...p.amount },
			label: "amount"
		}, {
			key: "draws",
			glslType: "float",
			default: 0,
			range: {
				min: 0,
				max: 10,
				step: 1
			}
		}],
		passes: [P()],
		presetScope: "global",
		mask: { maskable: !0 }
	};
}
function I() {
	return [F()];
}
//#endregion
//#region src/index.ts
var L = `${l}.panel`, R = null;
function z() {
	let e = C().stores.useDevelopStore.getState();
	e.setDynParams(v()), e.commitEdit("Glow reset");
}
function B(e) {
	S(e);
	for (let t of I()) e.registerProcessingStage(t);
	e.registerPanel({
		id: L,
		title: "Glow",
		component: O,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 8,
			width: 268
		},
		onReset: z,
		mask: {
			component: O,
			owns: m()
		}
	}), R = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.paramBag === t.paramBag) return;
		let n = b(e.paramBag);
		n && e.setDynParams(n);
	});
}
function V() {
	R?.(), R = null;
	try {
		let e = C();
		for (let t of I()) e.unregisterProcessingStage(t.id);
	} catch {}
}
//#endregion
export { B as activate, V as deactivate };

//# sourceMappingURL=index.js.map