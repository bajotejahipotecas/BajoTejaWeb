'use strict';
(function () {
  const cfg = window.PORTAL_CONFIG || {};
  const esLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const demo = esLocal && new URLSearchParams(location.search).has('demo');
  const configurado = !demo && Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);
  /* x-region mantiene la ejecución de las funciones en la UE. */
  const cabeceras = { apikey: cfg.SUPABASE_KEY, ...(cfg.SUPABASE_REGION ? { 'x-region': cfg.SUPABASE_REGION } : {}) };
  const token = location.hash.slice(1);
  const app = document.getElementById('app');
  const MB = 1024 * 1024;
  const IMAGENES = /\.(jpe?g|png|webp)$/i;
  const WORD = /\.docx?$/i;
  const PDF = /\.pdf$/i;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euros = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);

  let datos = null;
  let revisado = false;
  const subiendo = new Set();

  /* ---------- conexión ---------- */
  async function llamar(accion, cuerpo = {}) {
    if (!configurado) return window.DemoBackend.portal(accion, { token, ...cuerpo });
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabeceras },
      body: JSON.stringify({ accion, token, ...cuerpo }),
    });
    return respuesta(r);
  }

  async function respuesta(r) {
    if (r.ok) return r.json();
    let mensaje = 'No se ha podido completar. Inténtalo de nuevo.';
    try { mensaje = (await r.json()).error || mensaje; } catch { /* sin JSON */ }
    throw new Error(mensaje);
  }

  async function enviarArchivo(documentoId, blob, nombre) {
    if (!configurado) {
      const pdf = WORD.test(nombre) ? await window.PortalPdf.pdfAvisoDemo(nombre) : blob;
      await window.DemoBackend.guardarPdf(documentoId, pdf);
      return llamar('subir', { documento_id: documentoId, archivo_nombre: nombre });
    }
    const form = new FormData();
    form.append('accion', 'subir');
    form.append('token', token);
    form.append('documento_id', documentoId);
    form.append('archivo', blob, nombre);
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/portal`, {
      method: 'POST', headers: { ...cabeceras }, body: form,
    });
    return respuesta(r);
  }

  async function verPdf(documentoId) {
    try {
      let blob;
      if (!configurado) blob = await window.DemoBackend.leerPdf(documentoId);
      else {
        const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/portal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cabeceras },
          body: JSON.stringify({ accion: 'ver', token, documento_id: documentoId }),
        });
        if (!r.ok) await respuesta(r);
        blob = await r.blob();
      }
      if (!blob) throw new Error('No hemos encontrado este PDF.');
      abrirVisor(documentoId, blob);
    } catch (err) {
      aviso(err.message, true);
    }
  }

  function abrirVisor(documentoId, blob) {
    const doc = datos.documentos.find((d) => d.id === documentoId);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const visor = document.getElementById('visor');
    visor.innerHTML = `<header><strong>${esc(doc.tipo)}</strong>
      <a href="${esc(url)}" download="${esc(doc.tipo)}.pdf">Descargar</a>
      <button class="cerrar" type="button" aria-label="Cerrar">×</button></header>
      <iframe src="${esc(url)}" title="${esc(doc.tipo)}"></iframe>`;
    visor.querySelector('.cerrar').addEventListener('click', () => visor.close());
    visor.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
    visor.showModal();
  }

  /* ---------- utilidades ---------- */
  let temporizador;
  function aviso(texto, error = false) {
    const t = document.getElementById('toast');
    t.textContent = texto;
    t.classList.toggle('toast-error', error);
    if (t.matches(':popover-open')) t.hidePopover();
    t.showPopover();
    clearTimeout(temporizador);
    temporizador = setTimeout(() => t.hidePopover(), error ? 7000 : 2600);
  }

  async function prepararArchivo(archivos) {
    const lista = [...archivos];
    const total = lista.reduce((n, a) => n + a.size, 0);
    if (lista.every((a) => IMAGENES.test(a.name))) {
      if (total > 60 * MB) throw new Error('Las fotos pesan demasiado. Sube menos a la vez.');
      let pdf;
      try {
        pdf = await window.PortalPdf.desdeImagenes(lista);
      } catch {
        throw new Error('No hemos podido leer esa imagen. Súbela en JPG o PDF.');
      }
      return { blob: pdf, nombre: `${lista[0].name.replace(IMAGENES, '')}.pdf` };
    }
    if (lista.length > 1) throw new Error('Solo se pueden juntar varias fotos. Un PDF o Word se sube de uno en uno.');
    const [a] = lista;
    if (PDF.test(a.name)) {
      if (a.size > 25 * MB) throw new Error('El PDF supera los 25 MB.');
      return { blob: a, nombre: a.name };
    }
    if (WORD.test(a.name)) {
      if (a.size > 10 * MB) throw new Error('El Word supera los 10 MB.');
      return { blob: a, nombre: a.name };
    }
    throw new Error('Formato no admitido. Sube PDF, Word, JPG o PNG.');
  }

  /* ---------- pantalla ---------- */
  function filaDocumento(d) {
    const ocupado = subiendo.has(d.id);
    const motivo = d.motivo ? `<p class="motivo">Hay que subirlo de nuevo: ${esc(d.motivo)}</p>` : '';
    const entrada = (texto, clase) => `<label class="btn ${clase}">${esc(texto)}<input type="file" data-subir="${esc(d.id)}" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"></label>`;
    if (d.estado === 'aprobado') {
      return `<li class="doc doc-ok"><div><strong>${esc(d.tipo)}</strong><span>Enviado</span></div><span class="tick" aria-hidden="true">✓</span></li>`;
    }
    if (ocupado) return `<li class="doc"><div><strong>${esc(d.tipo)}</strong><span>Subiendo y convirtiendo a PDF…</span></div></li>`;
    if (d.estado === 'subido') {
      return `<li class="doc doc-subido"><div><strong>${esc(d.tipo)}</strong><span>${esc((d.archivo_nombre || '').replace(WORD, '.pdf'))}</span>${motivo}</div>
        <div class="doc-acciones"><button class="btn btn-suave" type="button" data-ver="${esc(d.id)}">Ver PDF</button>
        ${entrada('Cambiar', 'btn-enlace')}<button class="btn btn-enlace" type="button" data-quitar="${esc(d.id)}">Quitar</button></div></li>`;
    }
    return `<li class="doc"><div><strong>${esc(d.tipo)}</strong><span>Pendiente</span>${motivo}</div>
      <div class="doc-acciones">${entrada('Subir archivo', 'btn-suave')}</div></li>`;
  }

  function bloqueOferta(o) {
    if (!o) return '';
    const iva = o.iva_incluido ? 'IVA incluido' : `más ${String(o.iva_pct).replace('.', ',')} % de IVA`;
    const cierre = {
      aceptada: '<p class="ok">Has aceptado la propuesta. Te enviaremos la Nota de Encargo.</p>',
      rechazada: '<p class="suave">Has rechazado la propuesta.</p>',
      enviada: `<div class="acciones"><button class="btn btn-primario" type="button" data-oferta="aceptada">Aceptar propuesta</button>
        <button class="btn btn-suave" type="button" data-oferta="rechazada">Rechazar</button></div>`,
    }[o.estado];
    return `<section class="tarjeta"><h2>Tu propuesta</h2>
      <p class="importe">${esc(euros(o.honorarios))} <small>${esc(iva)}</small></p>
      ${o.mensaje ? `<p class="mensaje">${esc(o.mensaje)}</p>` : ''}
      <p class="suave">El detalle está en el PDF que te hemos enviado por email.</p>${cierre}</section>`;
  }

  function pintar() {
    const docs = datos.documentos.filter((d) => d.estado !== 'no_aplica');
    const porAprobar = docs.filter((d) => d.estado === 'subido');
    const aprobados = docs.filter((d) => d.estado === 'aprobado').length;
    const completo = docs.length > 0 && aprobados === docs.length;
    const pie = porAprobar.length ? `<div class="aprobar">
        <label class="check"><input type="checkbox" id="revisado"${revisado ? ' checked' : ''}><span>He revisado los PDF y son correctos. Una vez enviados no se pueden cambiar.</span></label>
        <button class="btn btn-primario btn-ancho" type="button" data-aprobar${revisado ? '' : ' disabled'}>Aprobar y enviar ${porAprobar.length} ${porAprobar.length === 1 ? 'documento' : 'documentos'}</button>
      </div>` : '';
    app.innerHTML = `
      <h1>Hola, ${esc(datos.titular.nombre)}</h1>
      <p class="suave">Expediente ${esc(datos.expediente)}</p>
      ${bloqueOferta(datos.oferta)}
      <section class="tarjeta">
        <h2>Tu documentación</h2>
        <p class="progreso">${aprobados} de ${docs.length} enviados</p>
        ${completo ? '<p class="ok">Lo tenemos todo. Gracias, nos pondremos en contacto contigo.</p>' : '<p class="suave">Puedes subir PDF, Word o fotos. Todo se convierte a PDF, y podrás revisarlo antes de enviarlo. Si tienes varias fotos del mismo documento, selecciónalas juntas.</p>'}
        <ul class="docs">${docs.map(filaDocumento).join('')}</ul>
        ${pie}
      </section>
      <p class="pie">Este enlace es personal. No lo compartas.</p>`;
  }

  async function recargar() {
    datos = await llamar('estado');
    pintar();
  }

  function pantallaError() {
    app.innerHTML = `<h1>Enlace no válido</h1>
      <p class="suave">Este enlace no existe o ha caducado. Escríbenos y te enviaremos uno nuevo.</p>`;
  }

  app.addEventListener('change', async (e) => {
    if (e.target.id === 'revisado') {
      revisado = e.target.checked;
      pintar();
      return;
    }
    const id = e.target.dataset.subir;
    if (!id || !e.target.files.length) return;
    const archivos = e.target.files;
    subiendo.add(id);
    pintar();
    try {
      const { blob, nombre } = await prepararArchivo(archivos);
      await enviarArchivo(id, blob, nombre);
      revisado = false;
    } catch (err) {
      aviso(err.message, true);
    }
    subiendo.delete(id);
    await recargar();
  });

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    try {
      if (d.ver) { await verPdf(d.ver); return; }
      b.disabled = true;
      if (d.quitar) {
        await llamar('quitar', { documento_id: d.quitar });
        if (!configurado) await window.DemoBackend.borrarPdf(d.quitar);
      } else if ('aprobar' in d) {
        const ids = datos.documentos.filter((x) => x.estado === 'subido').map((x) => x.id);
        await llamar('aprobar', { documento_ids: ids });
        revisado = false;
        aviso('Documentos enviados');
      } else if (d.oferta) {
        await llamar('responder-oferta', { oferta_id: datos.oferta.id, respuesta: d.oferta });
      } else return;
      await recargar();
    } catch (err) {
      b.disabled = false;
      aviso(err.message, true);
    }
  });

  async function cargarDemo() {
    await new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = '../crm/demo-backend.js';
      s.onload = ok;
      s.onerror = mal;
      document.head.append(s);
    });
  }

  async function arrancar() {
    try {
      if (!token) throw new Error('sin token');
      if (!configurado) {
        if (!demo) throw new Error('sin configurar');
        await cargarDemo();
      }
      await recargar();
    } catch {
      pantallaError();
    }
  }

  arrancar();
})();
