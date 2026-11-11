/* Convierte fotos a un PDF de una o varias páginas A4, en el navegador del cliente. */
(function () {
  'use strict';
  const A4 = [595.28, 841.89];
  const MARGEN = 24;
  const MAX_LADO = 2200;

  async function aJpeg(archivo) {
    const imagen = await createImageBitmap(archivo);
    const escala = Math.min(1, MAX_LADO / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    return lienzoAJpeg(lienzo);
  }

  async function lienzoAJpeg(lienzo) {
    const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ancho: lienzo.width, alto: lienzo.height };
  }

  function construirPdf(imagenes) {
    const texto = new TextEncoder();
    const partes = [];
    const offsets = [];
    let posicion = 0;
    const escribir = (d) => {
      const b = typeof d === 'string' ? texto.encode(d) : d;
      partes.push(b);
      posicion += b.length;
    };
    const objeto = (n, cuerpo) => { offsets[n] = posicion; escribir(`${n} 0 obj\n${cuerpo}\nendobj\n`); };

    escribir('%PDF-1.4\n');
    const paginas = imagenes.map((_, i) => 3 + i * 3);
    objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objeto(2, `<< /Type /Pages /Count ${imagenes.length} /Kids [${paginas.map((n) => `${n} 0 R`).join(' ')}] >>`);

    imagenes.forEach((img, i) => {
      const [pag, cont, foto] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
      const factor = Math.min((A4[0] - MARGEN * 2) / img.ancho, (A4[1] - MARGEN * 2) / img.alto);
      const [w, h] = [img.ancho * factor, img.alto * factor];
      const [x, y] = [(A4[0] - w) / 2, (A4[1] - h) / 2];
      objeto(pag, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /XObject << /I ${foto} 0 R >> >> /Contents ${cont} 0 R >>`);
      const dibujo = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /I Do Q`;
      objeto(cont, `<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`);
      offsets[foto] = posicion;
      escribir(`${foto} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.ancho} /Height ${img.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      escribir(img.bytes);
      escribir('\nendstream\nendobj\n');
    });

    const total = 3 + imagenes.length * 3;
    const inicioXref = posicion;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    escribir(`${xref}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
    return new Blob(partes, { type: 'application/pdf' });
  }

  /* Solo demo: página que indica que el Word se convertiría en el servidor. */
  async function pdfAvisoDemo(nombre) {
    const lienzo = document.createElement('canvas');
    lienzo.width = 1240;
    lienzo.height = 1754;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.fillStyle = '#16263F';
    ctx.font = '600 40px sans-serif';
    ctx.fillText('Demo: conversión simulada a PDF', 100, 200);
    ctx.font = '32px sans-serif';
    ctx.fillText(nombre.slice(0, 60), 100, 270);
    return construirPdf([await lienzoAJpeg(lienzo)]);
  }

  window.PortalPdf = {
    async desdeImagenes(archivos) {
      const imagenes = [];
      for (const a of archivos) imagenes.push(await aJpeg(a));
      return construirPdf(imagenes);
    },
    pdfAvisoDemo,
  };
})();
