/* Site de resultados do TCC. Lê window.DATA (gerado por build_data.py) e desenha
   gráficos em SVG puro + tabelas. Sem dependências externas. */
(function () {
  "use strict";

  var D = window.DATA;
  var RUNS = D.runs;
  var SVGNS = "http://www.w3.org/2000/svg";
  var SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

  /* ---------- utilidades ---------- */

  function fmt(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function s(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function byId(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function find(pred) { for (var i = 0; i < RUNS.length; i++) if (pred(RUNS[i])) return RUNS[i]; return null; }
  function filter(pred) { return RUNS.filter(pred); }

  /* Escala linear e marcas "bonitas" para os eixos. */
  function scale(d0, d1, r0, r1) {
    return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }
  function ticks(min, max, count) {
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [], t = Math.ceil(min / step) * step;
    for (; t <= max + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
    return out;
  }
  function decimalsFor(arr) {
    return arr.some(function (t) { return Math.abs(t - Math.round(t)) > 1e-9; }) ? 1 : 0;
  }

  /* ---------- tooltip ---------- */

  var tip = byId("tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(x + 14, window.innerWidth - w - 8);
    var top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = top + "px";
  }
  function hideTip() { tip.hidden = true; }
  function tipRows(title, rows) {
    return "<b>" + esc(title) + "</b>" + rows.map(function (r) {
      return '<div class="tt-row"><span>' + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></div>";
    }).join("");
  }
  function attachTip(node, html) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("class", "mark");
    node.addEventListener("mousemove", function (ev) { showTip(html, ev.clientX, ev.clientY); });
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("focus", function () {
      var b = node.getBoundingClientRect();
      showTip(html, b.left + b.width / 2, b.top);
    });
    node.addEventListener("blur", hideTip);
  }

  /* ---------- legenda e formas ---------- */

  function shapePath(kind, cx, cy, r) {
    if (kind === "square") return "M" + (cx - r) + " " + (cy - r) + "h" + 2 * r + "v" + 2 * r + "h" + -2 * r + "z";
    if (kind === "diamond") { var q = r * 1.3; return "M" + cx + " " + (cy - q) + "L" + (cx + q) + " " + cy + "L" + cx + " " + (cy + q) + "L" + (cx - q) + " " + cy + "z"; }
    return "M" + (cx - r) + " " + cy + "a" + r + " " + r + " 0 1 0 " + 2 * r + " 0a" + r + " " + r + " 0 1 0 " + -2 * r + " 0";
  }
  function legend(items) {
    var box = el("div", { class: "legend" });
    items.forEach(function (it) {
      var sv = s("svg", { viewBox: "0 0 12 12", "aria-hidden": "true" });
      if (it.line) s("path", { d: "M0 6H12", stroke: it.color, "stroke-width": 2 }, sv);
      else s("path", { d: shapePath(it.shape || "square", 6, 6, 5), fill: it.color }, sv);
      var span = el("span");
      span.appendChild(sv);
      span.appendChild(document.createTextNode(it.name));
      box.appendChild(span);
    });
    return box;
  }

  /* ---------- gráfico de barras verticais agrupadas ---------- */

  function groupedBars(container, opt) {
    clear(container);
    var n = opt.series.length;
    if (n > 1) container.appendChild(legend(opt.series.map(function (sr, i) { return { name: sr.name, color: SERIES[i] }; })));
    var W = Math.max(280, container.clientWidth), H = opt.height || 260;
    var m = { l: 44, r: 8, t: 18, b: 36 };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opt.aria || "" });
    container.appendChild(svg);
    var all = [];
    opt.series.forEach(function (sr) { sr.values.forEach(function (v) { if (v !== null) all.push(v); }); });
    var ymax = opt.ymax || Math.max.apply(null, all) * 1.12;
    var tk = ticks(0, ymax, 4), y = scale(0, tk[tk.length - 1], H - m.b, m.t), dec = decimalsFor(tk);
    tk.forEach(function (t) {
      s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }, svg);
      s("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end", text: fmt(t, dec) }, svg);
    });
    var cats = opt.categories, gw = (W - m.l - m.r) / cats.length;
    var inner = Math.min(gw * 0.72, n * 46), gap = 2, bw = (inner - gap * (n - 1)) / n;
    cats.forEach(function (c, ci) {
      var x0 = m.l + gw * ci + (gw - inner) / 2;
      s("text", { x: m.l + gw * ci + gw / 2, y: H - m.b + 18, "text-anchor": "middle", class: "lbl", text: c }, svg);
      opt.series.forEach(function (sr, si) {
        var v = sr.values[ci];
        if (v === null || v === undefined) return;
        var x = x0 + si * (bw + gap), top = y(v), h = (H - m.b) - top, r = Math.min(4, bw / 2, h);
        var g = s("g", {}, svg);
        s("path", {
          d: "M" + x + " " + (H - m.b) + "V" + (top + r) + "Q" + x + " " + top + " " + (x + r) + " " + top +
             "H" + (x + bw - r) + "Q" + (x + bw) + " " + top + " " + (x + bw) + " " + (top + r) + "V" + (H - m.b) + "Z",
          fill: SERIES[si], class: "shape"
        }, g);
        s("rect", { x: x - 1, y: m.t, width: bw + 2, height: H - m.b - m.t, fill: "transparent" }, g);
        if (opt.labelSeries === si || (opt.labelSeries === "all")) {
          s("text", { x: x + bw / 2, y: top - 5, "text-anchor": "middle", class: "lbl", text: fmt(v, opt.labelDec || 1) }, svg);
        }
        attachTip(g, tipRows(c + " — " + sr.name, [[opt.valueName || "Valor", fmt(v, opt.tipDec || 2) + (opt.unit || "")]].concat(sr.extra ? sr.extra(ci) : [])));
      });
    });
  }

  /* ---------- gráfico de barras horizontais (uma série) ---------- */

  function hBars(container, opt) {
    clear(container);
    var rowH = 26, m = { l: Math.min(150, Math.max(90, container.clientWidth * 0.32)), r: 52, t: 6, b: 24 };
    var W = Math.max(280, container.clientWidth), H = m.t + m.b + rowH * opt.rows.length;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opt.aria || "" });
    container.appendChild(svg);
    var vals = opt.rows.map(function (r) { return r.value || 0; });
    var tk = ticks(0, Math.max.apply(null, vals) * 1.08, 4), x = scale(0, tk[tk.length - 1], m.l, W - m.r);
    tk.forEach(function (t) {
      s("line", { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, class: t === 0 ? "axis" : "grid" }, svg);
      s("text", { x: x(t), y: H - m.b + 16, "text-anchor": "middle", text: fmt(t, 0) }, svg);
    });
    opt.rows.forEach(function (r, i) {
      var yc = m.t + rowH * i + rowH / 2, bh = 14;
      s("text", { x: m.l - 8, y: yc + 4, "text-anchor": "end", class: r.highlight ? "lbl-strong" : "lbl", text: r.label }, svg);
      if (r.value === null) {
        s("text", { x: m.l + 6, y: yc + 4, text: r.missing || "não executa" }, svg);
        return;
      }
      var w = x(r.value) - m.l, rr = Math.min(4, bh / 2, w);
      var g = s("g", {}, svg);
      s("path", {
        d: "M" + m.l + " " + (yc - bh / 2) + "H" + (m.l + w - rr) + "Q" + (m.l + w) + " " + (yc - bh / 2) + " " + (m.l + w) + " " + (yc - bh / 2 + rr) +
           "V" + (yc + bh / 2 - rr) + "Q" + (m.l + w) + " " + (yc + bh / 2) + " " + (m.l + w - rr) + " " + (yc + bh / 2) + "H" + m.l + "Z",
        fill: SERIES[0], class: "shape", opacity: r.highlight ? 1 : 0.85
      }, g);
      s("rect", { x: m.l, y: yc - rowH / 2, width: W - m.l - m.r, height: rowH, fill: "transparent" }, g);
      s("text", { x: m.l + w + 6, y: yc + 4, class: "lbl", text: fmt(r.value, 1) }, svg);
      attachTip(g, r.tip);
    });
  }

  /* ---------- gráfico de linhas ---------- */

  function lineChart(container, opt) {
    clear(container);
    container.appendChild(legend(opt.series.map(function (sr, i) { return { name: sr.name, color: SERIES[i], line: true }; })));
    var W = Math.max(280, container.clientWidth), H = opt.height || 240;
    var m = { l: 44, r: 16, t: 12, b: 34 };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opt.aria || "" });
    container.appendChild(svg);
    var all = [];
    opt.series.forEach(function (sr) { sr.values.forEach(function (v) { if (v !== null) all.push(v); }); });
    var tk = ticks(0, Math.max.apply(null, all) * 1.08, 4), dec = decimalsFor(tk);
    var y = scale(0, tk[tk.length - 1], H - m.b, m.t);
    var xs = opt.x, x = scale(xs[0], xs[xs.length - 1], m.l + 10, W - m.r - 10);
    tk.forEach(function (t) {
      s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? "axis" : "grid" }, svg);
      s("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end", text: fmt(t, dec) }, svg);
    });
    xs.forEach(function (v) { s("text", { x: x(v), y: H - m.b + 18, "text-anchor": "middle", class: "lbl", text: v + (opt.xUnit || "") }, svg); });
    opt.series.forEach(function (sr, si) {
      var pts = [];
      sr.values.forEach(function (v, i) { if (v !== null) pts.push([x(xs[i]), y(v), v, i]); });
      s("path", { d: pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(""), fill: "none", stroke: SERIES[si], "stroke-width": 2 }, svg);
      pts.forEach(function (p) {
        var g = s("g", {}, svg);
        s("circle", { cx: p[0], cy: p[1], r: 12, fill: "transparent" }, g);
        s("circle", { cx: p[0], cy: p[1], r: 4.5, fill: SERIES[si], stroke: "var(--surface)", "stroke-width": 2, class: "shape" }, g);
        attachTip(g, tipRows(sr.name + " — " + xs[p[3]] + (opt.xUnit || ""), [[opt.valueName, fmt(p[2], 2) + (opt.unit || "")]]));
      });
    });
  }

  /* ---------- tabelas ---------- */

  function table(container, cols, rows, opt) {
    clear(container);
    opt = opt || {};
    var t = el("table", { class: "data" });
    var thead = el("thead"), tr = el("tr");
    cols.forEach(function (c, ci) {
      var th = el("th", { scope: "col", class: (c.txt ? "txt " : "") + (opt.sortable ? "sortable" : ""), text: c.label });
      if (opt.sortable) {
        th.setAttribute("tabindex", "0");
        if (opt.sort && opt.sort.key === c.key) th.setAttribute("aria-sort", opt.sort.dir > 0 ? "ascending" : "descending");
        var go = function () { opt.onSort(c.key); };
        th.addEventListener("click", go);
        th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr", r._highlight ? { class: "highlight" } : null);
      cols.forEach(function (c) {
        var td = el("td", { class: c.txt ? "txt" : "" });
        var v = c.render ? c.render(r) : r[c.key];
        if (v instanceof Node) td.appendChild(v); else td.innerHTML = v === undefined || v === null ? "—" : v;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    container.appendChild(t);
  }

  /* Variação em relação à base: p.p. para acurácias, % para o resto. */
  function delta(v, base, kind, higherBetter, neutral) {
    if (v === null || base === null || v === undefined || base === undefined) return "";
    var d = Math.round((kind === "pp" ? v - base : (v / base - 1) * 100) * 10) / 10;
    var txt = (d > 0 ? "+" : "") + fmt(d, 1) + (kind === "pp" ? " p.p." : "%");
    if (neutral) return ' <span class="delta flat" title="' + esc(neutral) + '">' + txt + "</span>";
    var flat = Math.abs(d) < (kind === "pp" ? 0.1 : 1);
    if (flat) return ' <span class="delta flat" title="praticamente igual">≈ 0</span>';
    var good = higherBetter ? d > 0 : d < 0;
    var cls = flat ? "flat" : good ? "good" : "bad", arrow = flat ? "≈" : good ? "▲" : "▼";
    return ' <span class="delta ' + cls + '" title="' + (flat ? "praticamente igual" : good ? "melhorou" : "piorou") + '">' + arrow + " " + txt + "</span>";
  }

  /* Nome curto de uma execução individual. */
  function shortName(r) {
    var name = r.model_name.split("-")[0];
    if (r.model === "parseq") name += " " + r.decode + (r.res === "64×256" ? " 64×256" : "");
    if (r.technique !== "Original") name += " " + r.technique.replace("TensorRT", "TRT");
    if (r.input === "binarizada") name += " (bin.)";
    return name;
  }

  /* ---------- seções ---------- */

  function renderTiles() {
    var cor = function (r) { return r.input === "cor"; };
    var ensBest = D.ensembles.filter(function (e) { return e.input === "cor"; })
      .reduce(function (a, b) { return b.track_mvcp > a.track_mvcp ? b : a; });
    var base = ["crnn", "svtr"].map(function (m) { return find(function (r) { return r.round === "v2" && r.model === m && cor(r) && r.technique === "Original"; }); })
      .concat([find(function (r) { return r.round === "v2" && r.model === "parseq" && cor(r) && r.technique === "Original" && r.decode === "NAR+1"; })]);
    var gains = base.map(function (r) { return r.track_mvcp - r.acc_img; });
    var svtr = base[1], svtrTrt = find(function (r) { return r.model === "svtr" && cor(r) && r.technique === "TensorRT FP16"; });
    var ar = find(function (r) { return r.round === "v2" && r.model === "parseq" && cor(r) && r.technique === "Original" && r.decode === "AR"; });
    var tiles = [
      [fmt(ensBest.track_mvcp, 2) + "%", "maior acurácia por veículo: ensemble " + ensBest.members],
      ["+" + fmt(Math.min.apply(null, gains), 1) + " a +" + fmt(Math.max.apply(null, gains), 1) + " p.p.", "ganho de acurácia ao fundir as 5 imagens de cada veículo (MVCP)"],
      [fmt(svtrTrt.plates_s, 2) + " placas/s", "maior vazão: SVTR em TensorRT FP16, com " + fmt(svtrTrt.track_mvcp, 2) + "% por veículo"],
      ["+" + fmt((svtrTrt.fps / svtr.fps - 1) * 100, 0) + "% FPS", "TensorRT no SVTR, sem perder acurácia — a única técnica que acelerou"],
      [fmt(base[2].fps / ar.fps, 1) + "×", "FPS do PARSeq com decodificação NAR+1 em vez de AR, sem retreino"],
      [fmt(D.desktop.ensemble_ar, 2) + "%", "ensemble no desktop e na Jetson: acurácia idêntica nas duas"]
    ];
    var box = byId("tiles");
    tiles.forEach(function (t) {
      box.appendChild(el("div", { class: "tile" }, [el("div", { class: "value", text: t[0] }), el("div", { class: "label", text: t[1] })]));
    });
  }

  /* Acurácia × vazão (dispersão + fronteira de Pareto). */
  function tradeoffPoints() {
    var bin = byId("tr-bin").checked, fp16 = byId("tr-fp16").checked;
    var pts = [];
    filter(function (r) {
      return r.round !== "v1" && !r.prune && r.track_mvcp !== undefined &&
        (bin || r.input === "cor") && (fp16 || r.technique !== "FP16") &&
        !(r.round === "v3" && r.run === "bj7_parseq_legado");  // mesmo modelo já medido na rodada 2
    }).forEach(function (r) {
      pts.push({ x: r.plates_s, y: r.track_mvcp, kind: r.technique.indexOf("TensorRT") === 0 ? 1 : 0, name: shortName(r), r: r });
    });
    D.ensembles.forEach(function (e) {
      if (!bin && e.input !== "cor") return;
      if (!fp16 && e.members.indexOf("FP16") >= 0) return;
      pts.push({ x: e.plates_s, y: e.track_mvcp, kind: 2, name: e.members + (e.input === "cor" ? "" : " (bin.)"), e: e });
    });
    return pts;
  }
  function renderTradeoff() {
    var c = byId("chart-tradeoff");
    clear(c);
    var kinds = [{ name: "Modelo único — PyTorch", shape: "circle" }, { name: "Modelo único — TensorRT", shape: "square" }, { name: "Ensemble (vazão estimada)", shape: "diamond" }];
    c.appendChild(legend(kinds.map(function (k, i) { return { name: k.name, color: SERIES[i], shape: k.shape }; })
      .concat([{ name: "Fronteira de Pareto", color: "var(--muted)", line: true }])));
    var pts = tradeoffPoints();
    var W = Math.max(300, c.clientWidth), H = W < 560 ? 320 : 400;
    var m = { l: 46, r: 16, t: 14, b: 44 };
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Dispersão de acurácia por veículo contra placas por segundo" });
    c.appendChild(svg);
    var ys = pts.map(function (p) { return p.y; }), xsv = pts.map(function (p) { return p.x; });
    var ymin = Math.floor(Math.min.apply(null, ys) - 1), ymax = Math.ceil(Math.max.apply(null, ys) + 1);
    var ty = ticks(ymin, ymax, 5), tx = ticks(0, Math.max.apply(null, xsv) * 1.06, 6);
    var y = scale(ty[0], ty[ty.length - 1], H - m.b, m.t), x = scale(0, tx[tx.length - 1], m.l, W - m.r);
    ty.forEach(function (t) {
      s("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: "grid" }, svg);
      s("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end", text: fmt(t, 0) }, svg);
    });
    tx.forEach(function (t) {
      s("line", { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, class: t === 0 ? "axis" : "grid" }, svg);
      s("text", { x: x(t), y: H - m.b + 16, "text-anchor": "middle", text: fmt(t, decimalsFor(tx)) }, svg);
    });
    s("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, svg);
    s("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "lbl", text: "placas por segundo (maior é melhor)" }, svg);
    s("text", { x: 12, y: m.t + (H - m.b - m.t) / 2, transform: "rotate(-90 12 " + (m.t + (H - m.b - m.t) / 2) + ")", "text-anchor": "middle", class: "lbl", text: "acurácia por veículo (%)" }, svg);

    // Fronteira de Pareto: varre da maior vazão para a menor, guardando quem melhora a acurácia.
    var sorted = pts.slice().sort(function (a, b) { return b.x - a.x || b.y - a.y; });
    var front = [], best = -1;
    sorted.forEach(function (p) { if (p.y > best + 1e-9) { front.push(p); best = p.y; } });
    front.sort(function (a, b) { return a.x - b.x; });
    s("path", { d: front.map(function (p, i) { return (i ? "L" : "M") + x(p.x) + " " + y(p.y); }).join(""), fill: "none", stroke: "var(--muted)", "stroke-width": 1.5 }, svg);

    pts.forEach(function (p) {
      var g = s("g", {}, svg), cx = x(p.x), cy = y(p.y);
      s("circle", { cx: cx, cy: cy, r: 12, fill: "transparent" }, g);
      s("path", { d: shapePath(kinds[p.kind].shape, cx, cy, 5), fill: SERIES[p.kind], stroke: "var(--surface)", "stroke-width": 2, class: "shape" }, g);
      var rows = [["Acurácia por veículo", fmt(p.y, 2) + "%"], ["Placas/s", fmt(p.x, 2) + (p.e ? " (estimado)" : "")]];
      if (p.r) rows.push(["FPS", fmt(p.r.fps, 1)], ["Acurácia por imagem", fmt(p.r.acc_img, 2) + "%"], ["Energia", fmt(p.r.energy_j_img, 2) + " J/img"]);
      else rows.push(["Latência estimada", fmt(p.e.latency_ms, 1) + " ms/img"], ["Energia (soma)", fmt(p.e.energy_j_img, 2) + " J/img"]);
      attachTip(g, tipRows(p.name, rows));
    });
    // Rótulos diretos só na fronteira; cada rótulo tenta 4 posições e fica na
    // primeira que não colide com os já colocados.
    var placed = [];
    front.forEach(function (p) {
      var cx = x(p.x), cy = y(p.y), w = p.name.length * 6.6 + 4, h = 14;
      var cands = [[cx + 9, cy - 8, "start"], [cx + 9, cy + 18, "start"], [cx - 9, cy - 8, "end"], [cx - 9, cy + 18, "end"]];
      var pick = null;
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i], x0 = c[2] === "start" ? c[0] : c[0] - w;
        var box = { x0: x0, x1: x0 + w, y0: c[1] - h + 3, y1: c[1] + 3 };
        var fits = box.x0 >= m.l && box.x1 <= W - m.r && box.y0 >= 0;
        var free = placed.every(function (b) { return box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1; });
        if (fits && free) { pick = c; placed.push(box); break; }
      }
      // Sem espaço livre (tela estreita): fica sem rótulo; tooltip e tabela mostram o valor.
      if (pick) s("text", { x: pick[0], y: pick[1], "text-anchor": pick[2], class: "lbl-strong", text: p.name }, svg);
    });

    table(byId("table-tradeoff"),
      [{ key: "name", label: "Configuração", txt: true }, { key: "type", label: "Tipo", txt: true }, { key: "y", label: "Acurácia por veículo (%)" }, { key: "x", label: "Placas/s" }, { key: "pareto", label: "Na fronteira?" }],
      pts.slice().sort(function (a, b) { return b.y - a.y; }).map(function (p) {
        return { name: esc(p.name), type: kinds[p.kind].name, y: fmt(p.y, 2), x: fmt(p.x, 2), pareto: front.indexOf(p) >= 0 ? "sim" : "", _highlight: front.indexOf(p) >= 0 };
      }));
  }

  /* Comparador de compressão. */
  function cmpOptions() {
    var input = byId("cmp-input").value, sel = byId("cmp-model"), prev = sel.value, seen = {};
    clear(sel);
    filter(function (r) { return r.input === input && !r.prune; }).forEach(function (r) {
      var key = r.model + "|" + r.res + "|" + r.decode;
      if (seen[key]) return;
      seen[key] = true;
      var label = r.model_name + (r.model === "parseq" ? " " + r.res + ", " + r.decode : "");
      sel.appendChild(el("option", { value: key, text: label }));
    });
    if (seen[prev]) sel.value = prev;
  }
  function renderCompress() {
    var input = byId("cmp-input").value, k = byId("cmp-model").value.split("|");
    var model = k[0], res = k[1], dec = k[2];
    var same = function (r) { return r.model === model && r.res === res && r.decode === dec && r.input === input; };
    var baseMain = find(function (r) { return same(r) && r.technique === "Original" && r.round === "v2"; }) ||
                   find(function (r) { return same(r) && r.technique === "Original" && r.round === "v3"; });
    var baseV1 = find(function (r) { return same(r) && r.technique === "Original" && r.round === "v1"; });
    var order = ["Original", "FP16", "TensorRT FP32", "TensorRT FP16", "Pruning 30%", "Pruning 50%", "Pruning 70%"];
    var rows = [];
    order.forEach(function (tech) {
      var r = tech.indexOf("Pruning") === 0 ? find(function (x) { return same(x) && x.technique === tech; })
        : find(function (x) { return same(x) && x.technique === tech && x.round !== "v1" && !(x.round === "v3" && baseMain && baseMain.round === "v2" && tech === "Original"); });
      var base = tech.indexOf("Pruning") === 0 ? (baseV1 || baseMain) : baseMain;
      if (!r) {
        if (tech.indexOf("TensorRT") === 0 && model === "parseq") rows.push({ tech: tech, missing: "falha na compilação (TensorRT 8.2)" });
        return;
      }
      rows.push({ tech: tech, r: r, base: base });
    });
    rows.push({ tech: "INT8 (quantização)", missing: "não executa na Jetson Nano" });

    var isBase = function (row) { return row.r && row.base && row.r === row.base; };
    var cell = function (key, dec, kind, hb, unit) {
      return function (row) {
        if (!row.r) return "";
        var v = row.r[key];
        if (isBase(row)) return fmt(v, dec) + (unit || "");
        // FPS do pruning vem da rodada 1 (com throttling): a variação é ruído, não ganho.
        var neutral = row.r.round === "v1" && key === "fps" ? "rodada 1, sem refrigeração: variação dentro do ruído" : "";
        return fmt(v, dec) + (unit || "") + delta(v, row.base && row.base[key], kind, hb, neutral);
      };
    };
    table(byId("table-compress"), [
      { key: "tech", label: "Técnica", txt: true, render: function (row) {
        return esc(row.tech) + (row.r ? '<span class="tag">rodada ' + row.r.round.slice(1) + "</span>" : "");
      } },
      { key: "acc_img", label: "Acurácia imagem (%)", render: function (row) { return row.missing ? '<span class="muted">' + esc(row.missing) + "</span>" : cell("acc_img", 2, "pp", true)(row); } },
      { key: "track_mvcp", label: "Acurácia veículo (%)", render: cell("track_mvcp", 2, "pp", true) },
      { key: "fps", label: "FPS", render: cell("fps", 1, "pct", true) },
      { key: "mem_mb", label: "Memória GPU (MB)", render: cell("mem_mb", 1, "pct", false) },
      { key: "size_mb", label: "Tamanho (MB)", render: cell("size_mb", 1, "pct", false) },
      { key: "size_gz_mb", label: "Com gzip (MB)", render: cell("size_gz_mb", 1, "pct", false) },
      { key: "energy_j_img", label: "Energia (J/img)", render: cell("energy_j_img", 2, "pct", false) }
    ], rows.map(function (row) { row._highlight = isBase(row); return row; }));

    var fpsRows = rows.filter(function (row) { return row.tech.indexOf("Pruning") !== 0; }).map(function (row) {
      return {
        label: row.tech.replace("(quantização)", "").trim(), value: row.r ? row.r.fps : null, highlight: isBase(row),
        missing: row.missing ? (row.tech.indexOf("INT8") === 0 ? "não executa" : "não compila") : "",
        tip: row.r ? tipRows(row.tech, [["FPS", fmt(row.r.fps, 1)], ["Variação", row.base && !isBase(row) ? fmt((row.r.fps / row.base.fps - 1) * 100, 1) + "%" : "base"], ["Acurácia imagem", fmt(row.r.acc_img, 2) + "%"]]) : ""
      };
    });
    hBars(byId("chart-compress"), { rows: fpsRows, aria: "FPS por técnica de compressão" });
  }

  /* Fusão. */
  function renderFusion() {
    var cats = [], vals = [[], [], [], []];
    [["crnn", ""], ["svtr", ""], ["parseq", "NAR+1"]].forEach(function (k) {
      var r = find(function (x) { return x.round === "v2" && x.model === k[0] && x.decode === k[1] && x.input === "cor" && x.technique === "Original"; });
      cats.push(r.model_name.split("-")[0] + (k[1] ? " " + k[1] : ""));
      vals[0].push(r.acc_img); vals[1].push(r.track_hc); vals[2].push(r.track_mv); vals[3].push(r.track_mvcp);
    });
    var names = ["1 imagem", "Fusão HC", "Fusão MV", "Fusão MVCP"];
    groupedBars(byId("chart-fusion"), {
      categories: cats, series: names.map(function (n, i) { return { name: n, values: vals[i] }; }),
      ymax: 80, labelSeries: 3, unit: "%", valueName: "Acurácia", height: 280, aria: "Acurácia por veículo com e sem fusão"
    });
    table(byId("table-fusion"), [{ key: "m", label: "Modelo", txt: true }].concat(names.map(function (n, i) { return { key: "v" + i, label: n + " (%)" }; })),
      cats.map(function (c, ci) { var o = { m: c }; vals.forEach(function (v, i) { o["v" + i] = fmt(v[ci], 2); }); return o; }));

    var sel = byId("ens-group");
    if (!sel.options.length) {
      sel.appendChild(el("option", { value: "", text: "todos" }));
      D.ensembles.map(function (e) { return e.group; }).filter(function (g, i, a) { return a.indexOf(g) === i; })
        .forEach(function (g) { sel.appendChild(el("option", { value: g, text: g })); });
      sel.addEventListener("change", renderFusion);
    }
    var list = D.ensembles.filter(function (e) { return !sel.value || e.group === sel.value; })
      .sort(function (a, b) { return b.track_mvcp - a.track_mvcp; });
    var best = list.length ? list[0] : null;
    table(byId("table-ensembles"), [
      { key: "members", label: "Combinação", txt: true, render: function (e) { return esc(e.members) + (e.input === "cor" ? "" : '<span class="tag">binarizada</span>'); } },
      { key: "track_mv", label: "MV (%)", render: function (e) { return fmt(e.track_mv, 2); } },
      { key: "track_mvcp", label: "MVCP (%)", render: function (e) { return fmt(e.track_mvcp, 2); } },
      { key: "latency_ms", label: "Latência est. (ms/img)", render: function (e) { return fmt(e.latency_ms, 1); } },
      { key: "plates_s", label: "Placas/s est.", render: function (e) { return fmt(e.plates_s, 2); } },
      { key: "energy_j_img", label: "Energia (J/img)", render: function (e) { return fmt(e.energy_j_img, 2); } },
      { key: "size_mb", label: "Tamanho total (MB)", render: function (e) { return fmt(e.size_mb, 1); } }
    ], list.map(function (e) { e._highlight = e === best; return e; }));
  }

  /* PARSeq: resolução × decodificação (rodada 3, mesma sessão). */
  function renderParseq() {
    var decs = ["AR", "NAR", "NAR+1"], resList = ["32×128", "64×256"];
    var get = function (res, d) { return find(function (r) { return r.round === "v3" && r.model === "parseq" && r.input === "cor" && r.technique === "Original" && r.res === res && r.decode === d; }); };
    var series = function (key) {
      return resList.map(function (res) {
        return { name: res, values: decs.map(function (d) { return get(res, d)[key]; }),
                 extra: function (ci) { var r = get(res, decs[ci]); return [["Temperatura média", fmt(r.temp_avg, 0) + " °C"]]; } };
      });
    };
    groupedBars(byId("chart-parseq-acc"), { categories: decs, series: series("track_mvcp"), ymax: 80, unit: "%", valueName: "Acurácia por veículo", aria: "Acurácia do PARSeq por resolução e decodificação" });
    groupedBars(byId("chart-parseq-fps"), { categories: decs, series: series("fps"), unit: "", valueName: "FPS", labelSeries: "all", tipDec: 1, aria: "FPS do PARSeq por resolução e decodificação" });
    var rows = [];
    resList.forEach(function (res) { decs.forEach(function (d) { rows.push(get(res, d)); }); });
    table(byId("table-parseq"), [
      { key: "res", label: "Resolução", txt: true }, { key: "decode", label: "Decodificação", txt: true },
      { key: "acc_img", label: "Imagem (%)", render: function (r) { return fmt(r.acc_img, 2); } },
      { key: "track_mvcp", label: "Veículo (%)", render: function (r) { return fmt(r.track_mvcp, 2); } },
      { key: "fps", label: "FPS", render: function (r) { return fmt(r.fps, 1); } },
      { key: "energy_j_img", label: "Energia (J/img)", render: function (r) { return fmt(r.energy_j_img, 2); } },
      { key: "temp_avg", label: "Temp. média (°C)", render: function (r) { return fmt(r.temp_avg, 0); } },
      { key: "temp_max", label: "Temp. máx. (°C)", render: function (r) { return fmt(r.temp_max, 1); } }
    ], rows);
  }

  /* Pruning (rodada 1). */
  function renderPruning() {
    var input = byId("pr-input").value, levels = [0, 30, 50, 70];
    var specs = [["crnn", ""], ["svtr", ""], ["parseq", "AR"]];
    var get = function (m, d, p) {
      return find(function (r) { return r.round === "v1" && r.model === m && r.decode === d && r.input === input && r.prune === p && (p || r.technique === "Original"); }) ||
        (p === 0 ? find(function (r) { return r.round === "v2" && r.model === m && r.decode === d && r.input === input && r.technique === "Original"; }) : null);
    };
    var mk = function (key) {
      return specs.map(function (sp) {
        return { name: sp[0] === "parseq" ? "PARSeq (AR)" : MODEL(sp[0]), values: levels.map(function (p) { var r = get(sp[0], sp[1], p); return r ? r[key] : null; }) };
      });
    };
    lineChart(byId("chart-prune-acc"), { x: levels, xUnit: "%", series: mk("acc_img"), valueName: "Acurácia por imagem", unit: "%", aria: "Acurácia por taxa de poda" });
    lineChart(byId("chart-prune-size"), { x: levels, xUnit: "%", series: mk("size_gz_mb"), valueName: "Tamanho com gzip", unit: " MB", aria: "Tamanho comprimido por taxa de poda" });
    var rows = [];
    specs.forEach(function (sp) { levels.forEach(function (p) { var r = get(sp[0], sp[1], p); if (r) rows.push(r); }); });
    table(byId("table-prune"), [
      { key: "m", label: "Modelo", txt: true, render: function (r) { return r.model_name + (r.decode ? " " + r.decode : ""); } },
      { key: "prune", label: "Poda (%)" },
      { key: "acc_img", label: "Imagem (%)", render: function (r) { return fmt(r.acc_img, 2); } },
      { key: "track_mvcp", label: "Veículo (%)", render: function (r) { return fmt(r.track_mvcp, 2); } },
      { key: "fps", label: "FPS (rodada 1)", render: function (r) { return fmt(r.fps, 1); } },
      { key: "size_gz_mb", label: "Gzip (MB)", render: function (r) { return fmt(r.size_gz_mb, 1); } }
    ], rows);
  }
  function MODEL(m) { return { crnn: "CRNN", svtr: "SVTR-Tiny", parseq: "PARSeq-Tiny" }[m]; }

  /* Temperatura: rodada 1 × rodada 2. */
  function renderThermal() {
    var specs = [["crnn", "", "CRNN"], ["svtr", "", "SVTR"], ["parseq", "AR", "PARSeq AR"], ["parseq", "NAR+1", "PARSeq NAR+1"]];
    var get = function (rk, sp) { return find(function (r) { return r.round === rk && r.model === sp[0] && r.decode === sp[1] && r.input === "cor" && r.technique === "Original"; }); };
    var series = ["v1", "v2"].map(function (rk) {
      return { name: D.rounds[rk].label + " — " + D.rounds[rk].desc, values: specs.map(function (sp) { var r = get(rk, sp); return r ? r.fps : null; }),
               extra: function (ci) { var r = get(rk, specs[ci]); return r ? [["Temperatura média", fmt(r.temp_avg, 0) + " °C"], ["Temperatura máxima", fmt(r.temp_max, 1) + " °C"]] : []; } };
    });
    groupedBars(byId("chart-thermal"), { categories: specs.map(function (sp) { return sp[2]; }), series: series, labelSeries: "all", valueName: "FPS", tipDec: 1, aria: "FPS sem e com refrigeração" });
    table(byId("table-thermal"), [
      { key: "m", label: "Modelo", txt: true },
      { key: "f1", label: "FPS rodada 1" }, { key: "t1", label: "Temp. média r1 (°C)" },
      { key: "f2", label: "FPS rodada 2" }, { key: "t2", label: "Temp. média r2 (°C)" }, { key: "d", label: "Variação de FPS" }
    ], specs.map(function (sp) {
      var a = get("v1", sp), b = get("v2", sp);
      return { m: sp[2], f1: fmt(a.fps, 1), t1: fmt(a.temp_avg, 0), f2: fmt(b.fps, 1), t2: fmt(b.temp_avg, 0), d: delta(b.fps, a.fps, "pct", true) };
    }));
  }

  /* Desktop × Jetson. */
  function renderDesktop() {
    var dk = D.desktop;
    var rows = [["crnn", "", "CRNN"], ["svtr", "", "SVTR-Tiny"], ["parseq", "AR", "PARSeq-Tiny (AR, 32×128)"]].map(function (sp) {
      var j = find(function (r) { return r.round === "v2" && r.model === sp[0] && r.decode === sp[1] && r.input === "cor" && r.technique === "Original"; });
      return { m: sp[2], di: fmt(dk[sp[0]].acc_img, 2), ji: fmt(j.acc_img, 2), dt: fmt(dk[sp[0]].track_mvcp, 2), jt: fmt(j.track_mvcp, 2) };
    });
    var jEns = D.ensembles.filter(function (e) { return e.members === "CRNN + SVTR + PARSeq AR" && e.input === "cor"; })[0];
    rows.push({ m: "Ensemble dos 3 (PARSeq AR)", di: "—", ji: "—", dt: fmt(dk.ensemble_ar, 2), jt: fmt(jEns.track_mvcp, 2), _highlight: true });
    table(byId("table-desktop"), [
      { key: "m", label: "Modelo", txt: true }, { key: "di", label: "Imagem — desktop (%)" }, { key: "ji", label: "Imagem — Jetson (%)" },
      { key: "dt", label: "Veículo — desktop (%)" }, { key: "jt", label: "Veículo — Jetson (%)" }
    ], rows);
  }

  /* Tabela completa com filtros e ordenação. */
  var allSort = { key: "acc_img", dir: -1 };
  var ALL_COLS = [
    { key: "round", label: "Rodada", txt: true, render: function (r) { return r.round.slice(1); } },
    { key: "model_name", label: "Modelo", txt: true },
    { key: "input", label: "Entrada", txt: true },
    { key: "res", label: "Resolução", txt: true },
    { key: "technique", label: "Técnica", txt: true },
    { key: "decode", label: "Decod.", txt: true, render: function (r) { return r.decode || "—"; } },
    { key: "acc_img", label: "Imagem (%)", d: 2 }, { key: "acc_char", label: "Caractere (%)", d: 2 },
    { key: "track_hc", label: "Veículo HC (%)", d: 2 }, { key: "track_mv", label: "Veículo MV (%)", d: 2 }, { key: "track_mvcp", label: "Veículo MVCP (%)", d: 2 },
    { key: "fps", label: "FPS", d: 1 }, { key: "latency_ms", label: "Latência (ms)", d: 1 }, { key: "plates_s", label: "Placas/s", d: 2 },
    { key: "mem_mb", label: "Memória (MB)", d: 1 }, { key: "size_mb", label: "Tamanho (MB)", d: 1 }, { key: "size_gz_mb", label: "Gzip (MB)", d: 1 },
    { key: "temp_avg", label: "Temp. méd. (°C)", d: 1 }, { key: "temp_max", label: "Temp. máx. (°C)", d: 1 },
    { key: "power_w", label: "Potência (W)", d: 2 }, { key: "energy_j_img", label: "Energia (J/img)", d: 2 }
  ];
  ALL_COLS.forEach(function (c) { if (c.d !== undefined) c.render = function (r) { return fmt(r[c.key], c.d); }; });
  function setupAllFilters() {
    var fill = function (id, key, labelFn) {
      var sel = byId(id);
      sel.appendChild(el("option", { value: "", text: "todas" }));
      RUNS.map(function (r) { return r[key]; }).filter(function (v, i, a) { return a.indexOf(v) === i; })
        .forEach(function (v) { sel.appendChild(el("option", { value: v, text: labelFn ? labelFn(v) : v })); });
      sel.addEventListener("change", renderAll);
    };
    fill("f-round", "round", function (v) { return D.rounds[v].label + " (" + D.rounds[v].desc + ")"; });
    fill("f-model", "model_name");
    fill("f-input", "input");
    fill("f-tech", "technique");
  }
  function renderAll() {
    var f = { round: byId("f-round").value, model_name: byId("f-model").value, input: byId("f-input").value, technique: byId("f-tech").value };
    var rows = RUNS.filter(function (r) { return Object.keys(f).every(function (k) { return !f[k] || r[k] === f[k]; }); });
    rows.sort(function (a, b) {
      var x = a[allSort.key], y = b[allSort.key];
      if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y), "pt-BR") * allSort.dir;
      return ((x === undefined ? -Infinity : x) - (y === undefined ? -Infinity : y)) * allSort.dir;
    });
    byId("f-count").textContent = rows.length + " de " + RUNS.length + " execuções.";
    table(byId("table-all"), ALL_COLS, rows, {
      sortable: true, sort: allSort,
      onSort: function (key) { allSort = { key: key, dir: allSort.key === key ? -allSort.dir : -1 }; renderAll(); }
    });
  }

  /* ---------- tema ---------- */

  function setupTheme() {
    var btn = byId("theme-toggle");
    var stored = null;
    try { stored = localStorage.getItem("tema"); } catch (e) { /* armazenamento indisponível */ }
    if (stored) document.documentElement.setAttribute("data-theme", stored);
    var label = function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
      btn.textContent = dark ? "Tema claro" : "Tema escuro";
      return dark;
    };
    label();
    btn.addEventListener("click", function () {
      var next = label() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("tema", next); } catch (e) { /* ok */ }
      label();
    });
  }

  /* ---------- início ---------- */

  function renderCharts() {
    renderTradeoff();
    renderCompress();
    renderFusion();
    renderParseq();
    renderPruning();
    renderThermal();
  }

  setupTheme();
  byId("link-repo").href = D.links.repo;
  byId("link-article").href = D.links.article;
  byId("generated").textContent = new Date(D.generated + "T12:00:00").toLocaleDateString("pt-BR");
  renderTiles();
  cmpOptions();
  byId("cmp-input").addEventListener("change", function () { cmpOptions(); renderCompress(); });
  byId("cmp-model").addEventListener("change", renderCompress);
  byId("tr-bin").addEventListener("change", renderTradeoff);
  byId("tr-fp16").addEventListener("change", renderTradeoff);
  byId("pr-input").addEventListener("change", renderPruning);
  renderCharts();
  renderDesktop();
  setupAllFilters();
  renderAll();

  var lastW = window.innerWidth, timer = null;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; renderCharts(); } }, 150);
  });
})();
