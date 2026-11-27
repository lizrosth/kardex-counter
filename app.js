(function () {
  'use strict';
  var KEY = 'kardex-counter-v1';
  var $ = function (s) { return document.querySelector(s); };

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (kid) {
        if (kid === null || kid === undefined || kid === false) return;
        if (Array.isArray(kid)) return add(kid);
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    })(kids);
    return el;
  }

  var pad = function (n) { return String(n).padStart(2, '0'); };
  var todayStr = function () { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var nowTime = function () { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var fmt = function (n) { return round2(n).toLocaleString('es-PE', { maximumFractionDigits: 2 }); };
  var fechaLarga = function (s) {
    var p = s.split('-').map(Number);
    var t = new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  var fechaCorta = function (s) { var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  var norm = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var parseQty = function (s) { var n = Number(String(s).trim().replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
  var parseNum = function (s) { var t = String(s).trim().replace(',', '.'); if (t === '') return NaN; return Number(t); };
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  /* ---------- almacenamiento ---------- */
  var storageOk = true;
  var data = { insumos: [], movs: [], quien: '' };

  function seed() {
    return (window.INSUMOS_INICIALES || []).map(function (x, n) {
      return { id: 'i' + (n + 1), codigo: x.codigo, tp: x.tp || '', nombre: x.nombre, stockInicial: Number(x.stock) || 0, minimo: null, orden: n + 1 };
    });
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.insumos) && Array.isArray(d.movs)) { data = { insumos: d.insumos, movs: d.movs, quien: d.quien || '' }; return; }
      }
    } catch (e) { storageOk = false; }
    data = { insumos: seed(), movs: [], quien: '' };
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { storageOk = false; renderChrome(); }
  }

  var S = { tab: 'registrar', q: '', aq: '', openId: null, qty: '1', day: todayStr(), kId: '', editId: null, adding: false, copyText: '', pendingRestore: null, byId: new Map(), agg: new Map() };

  function recompute() {
    S.byId = new Map(data.insumos.map(function (i) { return [i.id, i]; }));
    S.agg = new Map();
    data.movs.forEach(function (m) {
      var a = S.agg.get(m.insumoId) || { ent: 0, sal: 0 };
      var q = Number(m.cantidad) || 0;
      if (m.tipo === 'entrada') a.ent += q; else a.sal += q;
      S.agg.set(m.insumoId, a);
    });
  }
  function stockOf(id) {
    var i = S.byId.get(id);
    if (!i) return 0;
    var a = S.agg.get(id) || { ent: 0, sal: 0 };
    return round2((Number(i.stockInicial) || 0) + a.ent - a.sal);
  }
  function nameOf(id) { var i = S.byId.get(id); return i ? i.nombre : 'Insumo eliminado'; }

  /* ---------- avisos ---------- */
  var toastTimer = null;
  function toast(msg, action) {
    var box = $('#toast');
    box.replaceChildren();
    var card = h('div', { class: 'toast-card' }, h('span', { text: msg }));
    if (action) {
      card.append(h('button', { class: 'toast-act', type: 'button', onclick: function () { box.replaceChildren(); action.fn(); toast(action.done || 'Listo'); } }, action.label));
    }
    box.append(card);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.replaceChildren(); }, action ? 9000 : 4500);
  }

  /* ---------- registrar ---------- */
  function filtered() {
    var toks = norm(S.q).split(/\s+/).filter(Boolean);
    var arr = data.insumos.filter(function (i) {
      var hay = norm(i.nombre + ' ' + i.codigo);
      return toks.every(function (t) { return hay.indexOf(t) !== -1; });
    });
    return arr.filter(function (i) { return stockOf(i.id) !== 0; }).concat(arr.filter(function (i) { return stockOf(i.id) === 0; }));
  }
  function statePill(i, st) {
    if (st < 0) return h('span', { class: 'pill crit', text: 'Revisar' });
    if (st === 0) return h('span', { class: 'pill muted', text: 'Sin stock' });
    if (i.minimo !== null && i.minimo !== undefined && i.minimo !== '' && st <= Number(i.minimo)) return h('span', { class: 'pill warn', text: 'Bajo' });
    return null;
  }
  var reg = { root: null, search: null, list: null, stat: null };
  function buildRegistrar() {
    reg.search = h('input', {
      id: 'buscar', type: 'search', placeholder: 'Buscar insumo o código', autocomplete: 'off', 'aria-label': 'Buscar insumo',
      oninput: function (e) { S.q = e.target.value; S.openId = null; updateRegistrar(); }
    });
    reg.stat = h('p', { class: 'sub' });
    reg.list = h('ul', { class: 'list' });
    reg.root = h('section', { class: 'stack' }, reg.search, reg.stat, reg.list);
  }
  function updateRegistrar() {
    if (!data.insumos.length) {
      reg.stat.textContent = '';
      reg.list.replaceChildren(h('li', { class: 'note', text: 'Aún no hay insumos. Agrégalos en la pestaña Insumos.' }));
      return;
    }
    var items = filtered();
    var hoy = todayStr();
    var n = data.movs.filter(function (m) { return m.fecha === hoy && m.tipo === 'salida'; }).length;
    reg.stat.textContent = S.q.trim() ? items.length + ' resultados' : n + (n === 1 ? ' salida registrada hoy' : ' salidas registradas hoy');
    if (!items.length) { reg.list.replaceChildren(h('li', { class: 'note', text: 'No hay insumos con ese nombre o código.' })); return; }
    reg.list.replaceChildren.apply(reg.list, items.map(itemEl));
  }
  function itemEl(i) {
    var st = stockOf(i.id);
    var open = S.openId === i.id;
    var head = h('button', {
      class: 'item-head', type: 'button', 'aria-expanded': String(open),
      onclick: function () { S.openId = open ? null : i.id; S.qty = '1'; updateRegistrar(); }
    },
      h('span', null, h('span', { class: 'name', text: i.nombre }), h('span', { class: 'meta mono', text: [i.codigo, i.tp].filter(Boolean).join(' · ') })),
      h('span', { class: 'item-stock' }, h('span', { class: 'num mono', text: fmt(st) }), statePill(i, st)));
    var li = h('li', { class: 'item' + (open ? ' open' : '') + (st === 0 ? ' zero' : '') }, head);
    if (open) li.append(panelEl(i, st));
    return li;
  }
  function panelEl(i, st) {
    var input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Cantidad usada', value: S.qty });
    var btn = h('button', { class: 'primary', type: 'button' });
    var hint = h('p', { class: 'hint' });
    function upd() {
      var q = parseQty(input.value);
      S.qty = input.value;
      btn.textContent = q > 0 ? 'Descontar ' + fmt(q) : 'Descontar';
      btn.disabled = !(q > 0);
      hint.textContent = q > 0 ? 'Stock: ' + fmt(st) + ' → ' + fmt(st - q) : 'Escribe cuántos se usaron.';
      hint.className = 'hint' + (q > 0 && st - q < 0 ? ' crit' : '');
    }
    input.addEventListener('input', upd);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
    var minus = h('button', { class: 'step', type: 'button', 'aria-label': 'Menos', onclick: function () { input.value = String(Math.max(0, round2((parseQty(input.value) || 1) - 1))); upd(); } }, '−');
    var plus = h('button', { class: 'step', type: 'button', 'aria-label': 'Más', onclick: function () { input.value = String(round2(parseQty(input.value) + 1)); upd(); } }, '+');
    btn.addEventListener('click', function () { registrarSalida(i, parseQty(input.value)); });
    upd();
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return h('div', { class: 'panel' }, h('div', { class: 'qty' }, minus, input, plus), btn, hint);
  }
  function addMov(i, tipo, q) {
    var m = { id: uid('m'), insumoId: i.id, tipo: tipo, cantidad: q, fecha: todayStr(), hora: nowTime(), quien: (data.quien || '').trim(), ts: Date.now() };
    data.movs.push(m);
    save(); recompute();
    return m;
  }
  function removeMov(id) {
    data.movs = data.movs.filter(function (m) { return m.id !== id; });
    save(); recompute();
  }
  function registrarSalida(i, q) {
    if (!(q > 0)) return;
    if (!(data.quien || '').trim()) { toast('Escribe tu nombre arriba antes de registrar.'); $('#quien').focus(); return; }
    var m = addMov(i, 'salida', q);
    S.openId = null; S.q = ''; reg.search.value = '';
    render();
    toast('Descontado ' + fmt(q) + ' · ' + i.nombre, { label: 'Deshacer', done: 'Salida deshecha', fn: function () { removeMov(m.id); render(); } });
  }

  /* ---------- cierre del día ---------- */
  function cierreData(day) {
    var dayMovs = data.movs.filter(function (m) { return m.fecha === day; }).sort(function (a, b) { return a.ts - b.ts; });
    var sal = new Map();
    dayMovs.forEach(function (m) { if (m.tipo === 'salida') sal.set(m.insumoId, round2((sal.get(m.insumoId) || 0) + (Number(m.cantidad) || 0))); });
    var saldo = new Map();
    data.insumos.forEach(function (i) { saldo.set(i.id, Number(i.stockInicial) || 0); });
    data.movs.forEach(function (m) {
      if (m.fecha > day || !saldo.has(m.insumoId)) return;
      var q = Number(m.cantidad) || 0;
      saldo.set(m.insumoId, saldo.get(m.insumoId) + (m.tipo === 'entrada' ? q : -q));
    });
    var rows = data.insumos.filter(function (i) { return sal.has(i.id); }).map(function (i) { return { i: i, gastado: sal.get(i.id), quedan: round2(saldo.get(i.id)) }; });
    return { dayMovs: dayMovs, rows: rows };
  }
  function tableRows(day, rows) {
    return [['Fecha', 'Código', 'Insumo', 'Gastado', 'Stock al cierre']].concat(rows.map(function (r) { return [day, r.i.codigo, r.i.nombre, r.gastado, r.quedan]; }));
  }
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function descargarArchivo(nombre, texto, tipo) {
    try {
      var blob = new Blob([texto], { type: tipo });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Archivo descargado: ' + nombre);
    } catch (e) { toast('No se pudo descargar el archivo.'); }
  }
  function copiar(day, rows) {
    var text = tableRows(day, rows).map(function (r) { return r.join('\t'); }).join('\n');
    var fallback = function () { S.copyText = text; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { S.copyText = ''; toast('Copiado. Pégalo en tu hoja del Drive.'); }).catch(fallback);
    } else fallback();
  }
  function anularBtn(m) {
    var b = h('button', { class: 'link', type: 'button' }, 'Anular');
    b.addEventListener('click', function () {
      if (b.dataset.arm !== '1') {
        b.dataset.arm = '1'; b.textContent = '¿Seguro?'; b.classList.add('crit');
        setTimeout(function () { if (b.isConnected) { b.dataset.arm = ''; b.textContent = 'Anular'; b.classList.remove('crit'); } }, 3000);
        return;
      }
      removeMov(m.id); render(); toast('Movimiento anulado.');
    });
    return b;
  }
  function viewCierre() {
    var day = S.day;
    var d = cierreData(day);
    var total = round2(d.rows.reduce(function (a, r) { return a + r.gastado; }, 0));
    var dateInput = h('input', { id: 'dia', type: 'date', value: day, 'aria-label': 'Día del cierre', onchange: function (e) { S.day = e.target.value || todayStr(); S.copyText = ''; render(); } });
    var head = h('div', { class: 'day-head' },
      h('p', { class: 'lbl', text: 'Cierre del día' }),
      h('h2', { text: fechaLarga(day) }),
      d.rows.length
        ? h('p', null, h('span', { class: 'big', text: fmt(total) }), ' ' + (total === 1 ? 'unidad' : 'unidades') + ' en ' + d.rows.length + (d.rows.length === 1 ? ' insumo' : ' insumos'))
        : h('p', { class: 'sub', text: 'Todavía no se registró ninguna salida este día.' }));
    var picker = h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'dia', text: 'Elegir otro día' }), dateInput);
    var root = h('section', { class: 'stack' }, head, picker);
    if (d.rows.length) {
      root.append(h('div', { class: 'actions' },
        h('button', { class: 'primary', type: 'button', onclick: function () { copiar(day, d.rows); } }, 'Copiar para el Drive'),
        h('button', { class: 'ghost', type: 'button', onclick: function () { descargarArchivo('consumo-insumos-' + day + '.csv', '﻿' + tableRows(day, d.rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv;charset=utf-8'); } }, 'Descargar CSV')));
      root.append(h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Insumo' }), h('th', { class: 'r', text: 'Gastado' }), h('th', { class: 'r', text: 'Quedan' }))),
        h('tbody', null, d.rows.map(function (r) {
          return h('tr', null,
            h('td', null, h('span', { class: 'name', text: r.i.nombre }), h('span', { class: 'meta mono', text: r.i.codigo })),
            h('td', { class: 'r mono', text: fmt(r.gastado) }),
            h('td', { class: 'r mono', text: fmt(r.quedan) }));
        })),
        h('tfoot', null, h('tr', null, h('td', { text: 'Total' }), h('td', { class: 'r mono', text: fmt(total) }), h('td'))))));
    }
    if (S.copyText) {
      var ta = h('textarea', { readonly: true, 'aria-label': 'Texto para copiar' });
      ta.value = S.copyText;
      root.append(h('p', { class: 'hint', text: 'El navegador no dejó copiar solo. Copia este texto (Ctrl+C) y pégalo en tu hoja.' }), ta);
      setTimeout(function () { ta.focus(); ta.select(); }, 0);
    }
    if (d.dayMovs.length) {
      root.append(h('p', { class: 'sect', text: 'Movimientos del día' }));
      root.append(h('ul', { class: 'list' }, d.dayMovs.map(function (m) {
        var entrada = m.tipo === 'entrada';
        return h('li', { class: 'row' },
          h('span', { class: 't mono', text: m.hora || '' }),
          h('span', null, h('span', { class: 'name', text: nameOf(m.insumoId) }), h('span', { class: 'meta', text: (entrada ? 'Entrada · ' : '') + (m.quien || 'Sin nombre') })),
          h('span', { class: 'end' }, h('span', { class: 'amt mono' + (entrada ? ' in' : ''), text: (entrada ? '+' : '−') + fmt(Number(m.cantidad) || 0) }), anularBtn(m)));
      })));
    }
    return root;
  }

  /* ---------- kardex ---------- */
  function viewKardex() {
    var sel = h('select', { id: 'k-sel', 'aria-label': 'Insumo', onchange: function (e) { S.kId = e.target.value; render(); } },
      h('option', { value: '', text: 'Elige un insumo' }),
      data.insumos.map(function (i) { return h('option', { value: i.id, text: i.nombre }); }));
    sel.value = S.kId;
    var root = h('section', { class: 'stack' }, h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'k-sel', text: 'Insumo' }), sel));
    var i = S.byId.get(S.kId);
    if (!i) {
      root.append(h('div', { class: 'empty' }, h('strong', { text: 'Kardex por insumo' }), h('span', { text: 'Elige un insumo para ver su stock inicial, entradas, salidas y saldo.' })));
      return root;
    }
    var movs = data.movs.filter(function (m) { return m.insumoId === i.id; }).sort(function (a, b) { return a.ts - b.ts; });
    var saldo = Number(i.stockInicial) || 0, ent = 0, sal = 0;
    var rows = [{ f: '', hr: '', det: 'Stock inicial', e: null, s: null, saldo: saldo, q: '' }];
    movs.forEach(function (m) {
      var q = Number(m.cantidad) || 0;
      if (m.tipo === 'entrada') { saldo += q; ent += q; rows.push({ f: m.fecha, hr: m.hora, det: 'Entrada', e: q, s: null, saldo: saldo, q: m.quien }); }
      else { saldo -= q; sal += q; rows.push({ f: m.fecha, hr: m.hora, det: 'Salida', e: null, s: q, saldo: saldo, q: m.quien }); }
    });
    saldo = round2(saldo);
    root.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'lbl', text: 'Inicial' }), h('span', { class: 'v', text: fmt(Number(i.stockInicial) || 0) })),
      h('div', { class: 'stat' }, h('span', { class: 'lbl', text: 'Entradas' }), h('span', { class: 'v', text: fmt(ent) })),
      h('div', { class: 'stat' }, h('span', { class: 'lbl', text: 'Salidas' }), h('span', { class: 'v', text: fmt(sal) })),
      h('div', { class: 'stat' + (saldo < 0 ? ' critv' : '') }, h('span', { class: 'lbl', text: 'Saldo' }), h('span', { class: 'v', text: fmt(saldo) }))));
    root.append(h('p', { class: 'meta mono', text: [i.codigo, i.tp].filter(Boolean).join(' · ') }));
    root.append(h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { text: 'Fecha' }), h('th', { text: 'Detalle' }), h('th', { class: 'r', text: 'Entra' }), h('th', { class: 'r', text: 'Sale' }), h('th', { class: 'r', text: 'Saldo' }), h('th', { text: 'Quién' }))),
      h('tbody', null, rows.map(function (r) {
        return h('tr', null,
          h('td', { class: 'mono', text: r.f ? fechaCorta(r.f) + ' ' + (r.hr || '') : '' }),
          h('td', { text: r.det }),
          h('td', { class: 'r mono', text: r.e !== null ? fmt(r.e) : '' }),
          h('td', { class: 'r mono', text: r.s !== null ? fmt(r.s) : '' }),
          h('td', { class: 'r mono', text: fmt(r.saldo) }),
          h('td', { text: r.q || '' }));
      })))));
    return root;
  }

  /* ---------- administrar insumos ---------- */
  function field(label, props) {
    var input = h('input', props);
    var id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return { wrap: h('div', { class: 'field' }, h('label', { class: 'lbl', for: id, text: label }), input), input: input };
  }
  function insumoForm(i) {
    var fCod = field('Código', { type: 'text', value: i ? i.codigo : '', autocomplete: 'off' });
    var fTp = field('T.P', { type: 'text', value: i && i.tp ? i.tp : '', autocomplete: 'off' });
    var fNom = field('Descripción', { type: 'text', value: i ? i.nombre : '', autocomplete: 'off' });
    var fSt = field('Stock inicial', { type: 'text', inputmode: 'decimal', value: i ? String(i.stockInicial) : '0', autocomplete: 'off' });
    var fMin = field('Stock mínimo (opcional)', { type: 'text', inputmode: 'decimal', value: i && i.minimo !== null && i.minimo !== undefined ? String(i.minimo) : '', autocomplete: 'off' });
    var save1 = h('button', { class: 'primary', type: 'button' }, i ? 'Guardar cambios' : 'Agregar insumo');
    save1.addEventListener('click', function () {
      var nombre = fNom.input.value.trim();
      var si = parseNum(fSt.input.value);
      var mn = fMin.input.value.trim() === '' ? null : parseNum(fMin.input.value);
      if (!nombre) { toast('Falta la descripción.'); return; }
      if (!isFinite(si)) { toast('Revisa el stock inicial.'); return; }
      if (mn !== null && !isFinite(mn)) { toast('Revisa el stock mínimo.'); return; }
      var vals = { codigo: fCod.input.value.trim(), tp: fTp.input.value.trim(), nombre: nombre, stockInicial: si, minimo: mn };
      if (i) Object.assign(i, vals);
      else {
        var max = data.insumos.reduce(function (a, x) { return Math.max(a, Number(x.orden) || 0); }, 0);
        data.insumos.push(Object.assign({ id: uid('i'), orden: max + 1 }, vals));
      }
      save(); recompute();
      S.editId = null; S.adding = false;
      toast(i ? 'Cambios guardados.' : 'Insumo agregado.'); render();
    });
    var cancel = h('button', { class: 'ghost', type: 'button', onclick: function () { S.editId = null; S.adding = false; render(); } }, 'Cancelar');
    var form = h('div', { class: 'form' }, fNom.wrap, h('div', { class: 'two' }, fCod.wrap, fTp.wrap), h('div', { class: 'two' }, fSt.wrap, fMin.wrap), h('div', { class: 'actions' }, save1, cancel));
    if (i) {
      var fIn = field('Entrada de stock (reposición)', { type: 'text', inputmode: 'decimal', placeholder: 'Cantidad que llegó', autocomplete: 'off' });
      var add = h('button', { class: 'ghost', type: 'button' }, 'Sumar al stock');
      add.addEventListener('click', function () {
        var q = parseQty(fIn.input.value);
        if (!(q > 0)) { toast('Escribe la cantidad que llegó.'); return; }
        if (!(data.quien || '').trim()) { toast('Escribe tu nombre arriba antes de registrar.'); $('#quien').focus(); return; }
        addMov(i, 'entrada', q);
        toast('Entrada registrada: +' + fmt(q) + ' · ' + i.nombre); render();
      });
      form.append(h('p', { class: 'sect', text: 'Reposición' }), fIn.wrap, add);
    }
    return form;
  }
  function backupBox() {
    var file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden-file', id: 'restaurar', 'aria-label': 'Archivo de copia' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          if (!d || !Array.isArray(d.insumos) || !Array.isArray(d.movs)) throw new Error('formato');
          S.pendingRestore = d; render();
        } catch (e) { toast('Ese archivo no es una copia válida del kardex.'); }
      };
      rd.readAsText(f);
    });
    var box = h('div', { class: 'box' },
      h('p', { class: 'sect', text: 'Copia de seguridad' }),
      h('p', { class: 'hint', text: 'Los registros se guardan en este navegador y en este computador. Descarga una copia de vez en cuando, por si se borran los datos del navegador.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'ghost', type: 'button', onclick: function () { descargarArchivo('kardex-copia-' + todayStr() + '.json', JSON.stringify(data, null, 1), 'application/json'); } }, 'Descargar copia'),
        h('button', { class: 'ghost', type: 'button', onclick: function () { file.click(); } }, 'Restaurar copia'),
        file));
    if (S.pendingRestore) {
      var p = S.pendingRestore;
      box.append(h('p', { class: 'hint crit', text: 'Se va a reemplazar todo lo actual por la copia (' + p.insumos.length + ' insumos, ' + p.movs.length + ' movimientos).' }),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', type: 'button', onclick: function () { data = { insumos: p.insumos, movs: p.movs, quien: data.quien }; S.pendingRestore = null; save(); recompute(); toast('Copia restaurada.'); render(); } }, 'Sí, restaurar'),
          h('button', { class: 'ghost', type: 'button', onclick: function () { S.pendingRestore = null; render(); } }, 'Cancelar')));
    }
    return box;
  }
  function viewInsumos() {
    var list = h('ul', { class: 'list' });
    var search = h('input', { id: 'adm-buscar', type: 'search', placeholder: 'Buscar insumo o código', autocomplete: 'off', 'aria-label': 'Buscar insumo', oninput: function (e) { S.aq = e.target.value; paint(); } });
    search.value = S.aq;
    function paint() {
      var toks = norm(S.aq).split(/\s+/).filter(Boolean);
      var arr = data.insumos.filter(function (i) { var hay = norm(i.nombre + ' ' + i.codigo); return toks.every(function (t) { return hay.indexOf(t) !== -1; }); });
      if (!arr.length) { list.replaceChildren(h('li', { class: 'note', text: 'No hay insumos con ese nombre o código.' })); return; }
      list.replaceChildren.apply(list, arr.map(function (i) {
        var st = stockOf(i.id);
        var open = S.editId === i.id;
        var head = h('button', { class: 'adm-head', type: 'button', 'aria-expanded': String(open), onclick: function () { S.editId = open ? null : i.id; S.adding = false; render(); } },
          h('span', null, h('span', { class: 'name', text: i.nombre }), h('span', { class: 'meta mono', text: [i.codigo, i.tp].filter(Boolean).join(' · ') })),
          h('span', { class: 'num mono', text: fmt(st) }));
        var li = h('li', { class: 'item' + (open ? ' open' : '') + (st === 0 ? ' zero' : '') }, head);
        if (open) li.append(insumoForm(i));
        return li;
      }));
    }
    var top = h('div', { class: 'actions' }, h('button', { class: 'ghost', type: 'button', onclick: function () { S.adding = !S.adding; S.editId = null; render(); } }, S.adding ? 'Cerrar' : 'Agregar insumo'));
    var root = h('section', { class: 'stack' }, backupBox(), top);
    if (S.adding) root.append(h('div', { class: 'list' }, insumoForm(null)));
    root.append(search, list);
    paint();
    return root;
  }

  /* ---------- pantalla ---------- */
  function renderChrome() {
    var tabs = [['registrar', 'Registrar'], ['cierre', 'Cierre'], ['kardex', 'Kardex'], ['insumos', 'Insumos']];
    $('#tabs').replaceChildren.apply($('#tabs'), tabs.map(function (t) {
      return h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(S.tab === t[0]), onclick: function () { S.tab = t[0]; S.copyText = ''; S.pendingRestore = null; render(); } }, t[1]);
    }));
    var b = [];
    if (!storageOk) b.push(h('div', { class: 'banner crit', text: 'Este navegador no permite guardar datos. Lo que registres se perderá al cerrar la página. Ábrela en Chrome o Edge sin modo privado.' }));
    $('#banners').replaceChildren.apply($('#banners'), b);
  }
  function render() {
    var v = $('#view');
    renderChrome();
    if (S.tab === 'registrar') {
      if (!reg.root) buildRegistrar();
      if (v.firstChild !== reg.root) v.replaceChildren(reg.root);
      updateRegistrar();
    } else if (S.tab === 'cierre') v.replaceChildren(viewCierre());
    else if (S.tab === 'kardex') v.replaceChildren(viewKardex());
    else v.replaceChildren(viewInsumos());
  }

  load();
  recompute();
  var q = $('#quien');
  q.value = data.quien || '';
  q.addEventListener('input', function (e) { data.quien = e.target.value; save(); });
  render();
})();
