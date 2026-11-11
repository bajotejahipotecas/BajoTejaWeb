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

  /* PDF por POST: el documento subido (accion ver) o el contrato para firmar (ver-contrato). */
  async function pedirPdf(cuerpo, idDemo) {
    if (!configurado) return window.DemoBackend.leerPdf(idDemo);
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabeceras },
      body: JSON.stringify({ token, ...cuerpo }),
    });
    if (!r.ok) await respuesta(r);
    return r.blob();
  }

  async function verPdf(documentoId) {
    try {
      const blob = await pedirPdf({ accion: 'ver', documento_id: documentoId }, documentoId);
      if (!blob) throw new Error('No hemos encontrado este PDF.');
      abrirVisor(datos.documentos.find((d) => d.id === documentoId).tipo, blob);
    } catch (err) {
      aviso(err.message, true);
    }
  }

  async function verContrato(f) {
    try {
      const blob = await pedirPdf({ accion: 'ver-contrato', tipo: f.tipo, referencia_id: f.id }, f.id);
      if (!blob) throw new Error('No hemos encontrado este PDF.');
      abrirVisor(f.titulo, blob);
    } catch (err) {
      aviso(err.message, true);
    }
  }

  function abrirVisor(titulo, blob) {
    const doc = { tipo: titulo };
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

  const firmaDe = (tipo) => (datos.firmas || []).find((f) => f.tipo === tipo);
  const fechaCorta = (iso) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  function bloqueOferta(o) {
    if (!o) return '';
    const iva = o.iva_incluido ? 'IVA incluido' : `más ${String(o.iva_pct).replace('.', ',')} % de IVA`;
    const f = firmaDe('oferta');
    const leer = f ? `<button class="btn btn-suave" type="button" data-leer="oferta">Leer la propuesta</button>` : '';
    const cierre = {
      aceptada: f && !f.firmado
        ? `<p class="ok">Has aceptado la propuesta. Fírmala para confirmarla.</p>
          <div class="acciones">${leer}<button class="btn btn-primario" type="button" data-firmar="oferta">Firmar</button></div>`
        : `<p class="ok">${f?.firmado ? `Has firmado y aceptado la propuesta el ${esc(fechaCorta(f.firmado_at))}.` : 'Has aceptado la propuesta.'} Te enviaremos la Nota de Encargo.</p>`,
      rechazada: '<p class="suave">Has rechazado la propuesta.</p>',
      enviada: f
        ? `<div class="acciones">${leer}<button class="btn btn-primario" type="button" data-firmar="oferta">Firmar y aceptar</button>
          <button class="btn btn-enlace" type="button" data-oferta="rechazada">Rechazar</button></div>`
        : `<div class="acciones"><button class="btn btn-primario" type="button" data-oferta="aceptada">Aceptar propuesta</button>
          <button class="btn btn-suave" type="button" data-oferta="rechazada">Rechazar</button></div>`,
    }[o.estado];
    return `<section class="tarjeta"><h2>Tu propuesta</h2>
      <p class="importe">${esc(euros(o.honorarios))} <small>${esc(iva)}</small></p>
      ${o.mensaje ? `<p class="mensaje">${esc(o.mensaje)}</p>` : ''}
      ${f ? '' : '<p class="suave">El detalle está en el PDF que te hemos enviado.</p>'}${cierre}</section>`;
  }

  function bloqueNota() {
    const f = firmaDe('nota');
    if (!f) return '';
    let estado;
    if (!f.firmado) {
      estado = `<p class="suave">Léela con calma y fírmala con el dedo o con el ratón. Si sois varios titulares, cada uno la firma desde su propio enlace.</p>
        <div class="acciones"><button class="btn btn-suave" type="button" data-leer="nota">Leer la Nota</button>
        <button class="btn btn-primario" type="button" data-firmar="nota">Firmar</button></div>`;
    } else if (f.completo) {
      estado = `<p class="ok">Nota de Encargo firmada el ${esc(fechaCorta(f.firmado_at))}. Gracias.</p>`;
    } else {
      estado = `<p class="ok">Has firmado el ${esc(fechaCorta(f.firmado_at))}.</p><p class="suave">Falta la firma de otro titular.</p>`;
    }
    return `<section class="tarjeta"><h2>Nota de Encargo</h2>${estado}</section>`;
  }

  /* ---------- firma con el dedo o el ratón ---------- */
  function lienzoFirma(lienzo) {
    const ctx = lienzo.getContext('2d');
    let trazo = 0;
    let anterior = null;
    const ajustar = () => {
      const r = lienzo.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      lienzo.width = Math.round(r.width * dpr);
      lienzo.height = Math.round(r.height * dpr);
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#16263F';
      trazo = 0;
    };
    const punto = (e) => {
      const r = lienzo.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    lienzo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lienzo.setPointerCapture(e.pointerId);
      anterior = punto(e);
      ctx.beginPath();
      ctx.arc(anterior[0], anterior[1], 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#16263F';
      ctx.fill();
    });
    lienzo.addEventListener('pointermove', (e) => {
      if (!anterior) return;
      e.preventDefault();
      const p = punto(e);
      ctx.beginPath();
      ctx.moveTo(anterior[0], anterior[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      trazo += Math.hypot(p[0] - anterior[0], p[1] - anterior[1]);
      anterior = p;
    });
    const soltar = () => { anterior = null; };
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    ajustar();
    return {
      borrar: () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, lienzo.width, lienzo.height); ajustar(); },
      valida: () => trazo > 60,
      /* PNG reducido a 600 px de ancho: suficiente para el PDF y ligero de enviar. */
      png: () => {
        const salida = document.createElement('canvas');
        const escala = Math.min(1, 600 / lienzo.width);
        salida.width = Math.round(lienzo.width * escala);
        salida.height = Math.round(lienzo.height * escala);
        salida.getContext('2d').drawImage(lienzo, 0, 0, salida.width, salida.height);
        return salida.toDataURL('image/png');
      },
    };
  }

  function abrirFirma(tipo) {
    const f = firmaDe(tipo);
    if (!f) return;
    const dlg = document.getElementById('firma');
    const siNo = (nombre, texto) => `<fieldset class="consent"><legend>${esc(texto)}</legend>
      <label><input type="radio" name="${nombre}" value="si" required> Sí</label>
      <label><input type="radio" name="${nombre}" value="no"> No</label></fieldset>`;
    dlg.innerHTML = `<form class="firma-form" novalidate>
      <header><strong>Firmar ${esc(f.titulo)}</strong><button class="cerrar" type="button" data-cerrar aria-label="Cerrar">×</button></header>
      <div class="firma-cuerpo">
        <p class="suave">Antes de firmar, <button class="btn-enlace en-linea" type="button" data-leer="${esc(tipo)}">lee el documento completo</button>.</p>
        <label class="campo"><span>Nombre y apellidos</span><input name="nombre" autocomplete="name" required></label>
        <label class="campo"><span>DNI / NIE</span><input name="dni" autocomplete="off" autocapitalize="characters" required></label>
        ${f.pide_consentimientos ? `<div class="consentimientos">
          <label class="check"><input type="checkbox" name="cesion" required><span>Autorizo la cesión de mis datos a las entidades indicadas para tramitar la operación (necesario).</span></label>
          ${siNo('comerciales', 'Acepto recibir información comercial de Bajo Teja')}
          ${siNo('conservacion', 'Acepto que se conserven mis datos tras finalizar el encargo')}
        </div>` : ''}
        <div class="firma-caja"><span>Firma aquí con el dedo o el ratón</span><canvas aria-label="Recuadro para firmar"></canvas></div>
        <button class="btn btn-enlace" type="button" data-borrar>Borrar firma</button>
        <label class="check"><input type="checkbox" name="acepto" required><span>He leído el documento y lo firmo electrónicamente.</span></label>
      </div>
      <footer><button class="btn btn-primario btn-ancho" type="submit">Firmar</button></footer>
    </form>`;
    dlg.showModal();
    const pad = lienzoFirma(dlg.querySelector('canvas'));
    dlg.querySelector('[data-cerrar]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-borrar]').addEventListener('click', () => pad.borrar());
    dlg.querySelector('[data-leer]').addEventListener('click', () => verContrato(f));
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const d = new FormData(form);
      const falta = !d.get('nombre').trim() ? 'Escribe tu nombre y apellidos.'
        : !d.get('dni').trim() ? 'Escribe tu DNI o NIE.'
          : f.pide_consentimientos && !d.get('cesion') ? 'Para tramitar la operación tienes que autorizar la cesión de datos.'
            : f.pide_consentimientos && (!d.get('comerciales') || !d.get('conservacion')) ? 'Marca Sí o No en las dos preguntas de protección de datos.'
              : !pad.valida() ? 'Dibuja tu firma en el recuadro.'
                : !d.get('acepto') ? 'Marca la casilla de confirmación.' : '';
      if (falta) { aviso(falta, true); return; }
      const boton = form.querySelector('[type=submit]');
      boton.disabled = true;
      boton.textContent = 'Firmando…';
      try {
        const r = await llamar('firmar', {
          tipo, referencia_id: f.id, nombre: d.get('nombre'), dni: d.get('dni'), firma: pad.png(),
          consentimientos: f.pide_consentimientos
            ? { cesion: true, comerciales: d.get('comerciales') === 'si', conservacion: d.get('conservacion') === 'si' }
            : undefined,
        });
        dlg.close();
        aviso(r.completo ? 'Documento firmado. Gracias.' : 'Firma registrada.');
        await recargar();
      } catch (err) {
        boton.disabled = false;
        boton.textContent = 'Firmar';
        aviso(err.message, true);
      }
    });
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
      ${bloqueNota()}
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
      if (d.leer) { await verContrato(firmaDe(d.leer)); return; }
      if (d.firmar) { abrirFirma(d.firmar); return; }
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
