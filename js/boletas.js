import { db } from './firebase-config.js';
import { escapeHtml, formatMoney, formatDate, moneyTexto, fechaArchivo, fechaEnRango, badgeClass, badgeLabel, initFiltrosToggle, actualizarPanelFiltros } from './shared.js';

// ============================================
// BOLETAS SII — checklist manual (NO conectado al SII). renderBoletas se
// exporta porque remesas.js la llama con cada actualización de su escucha
// de la colección remesas (misma fuente de datos que Historial/Dashboard).
// ============================================
const boletasPendientesCount = document.getElementById('boletasPendientesCount');
const boletasPendientesMonto = document.getElementById('boletasPendientesMonto');
const boletasPendientesFacturasCount = document.getElementById('boletasPendientesFacturasCount');
const boletasEmitidasMes = document.getElementById('boletasEmitidasMes');
const boletasEmitidasMonto = document.getElementById('boletasEmitidasMonto');
const boletasPendientesBody = document.getElementById('boletasPendientesBody');
const boletasPendientesTableWrap = document.getElementById('boletasPendientesTableWrap');
const boletasPendientesEmpty = document.getElementById('boletasPendientesEmpty');
const boletasEmitidasBody = document.getElementById('boletasEmitidasBody');
const boletasEmitidasTableWrap = document.getElementById('boletasEmitidasTableWrap');
const boletasEmitidasEmpty = document.getElementById('boletasEmitidasEmpty');
const boletasMarcarGrupoBtn = document.getElementById('boletasMarcarGrupoBtn');
const boletasSeleccionadasCount = document.getElementById('boletasSeleccionadasCount');
const boletasPendientesFiltroDesde = document.getElementById('boletasPendientesFiltroDesde');
const boletasPendientesFiltroHasta = document.getElementById('boletasPendientesFiltroHasta');
const boletasPendientesFiltroBuscar = document.getElementById('boletasPendientesFiltroBuscar');
const boletasPendientesFiltroLimpiar = document.getElementById('boletasPendientesFiltroLimpiar');
const boletasEmitidasFiltroDesde = document.getElementById('boletasEmitidasFiltroDesde');
const boletasEmitidasFiltroHasta = document.getElementById('boletasEmitidasFiltroHasta');
const boletasEmitidasFiltroBuscar = document.getElementById('boletasEmitidasFiltroBuscar');
const boletasEmitidasFiltroLimpiar = document.getElementById('boletasEmitidasFiltroLimpiar');

let boletasSeleccionadas = new Set();
let pendientesPorId = {};
// Guarda los listados completos (tal como salen de renderBoletas) para poder
// re-filtrar en el cliente sin volver a consultar.
let boletasPendientesCache = [];
let boletasEmitidasCache = [];
// Subconjuntos actualmente visibles según los filtros de cada tabla, usados para exportar.
let boletasPendientesFiltrado = [];
let boletasEmitidasFiltrado = [];

function actualizarBotonGrupoBoleta() {
    boletasSeleccionadasCount.textContent = boletasSeleccionadas.size;
    boletasMarcarGrupoBtn.disabled = boletasSeleccionadas.size < 2;
}

// Determina si una remesa requiere boleta: solo cuando el CLP entra al negocio
// (el cliente paga en CLP). Si el CLP sale (por ejemplo, un cambio de VES a
// CLP donde el cliente entrega VES y recibe CLP), no corresponde emitir boleta.
function requiereBoleta(r) {
    return (r.monedaEnviado || '').toUpperCase() === 'CLP';
}

// A partir de este monto en CLP, corresponde emitir factura en vez de boleta.
const UMBRAL_FACTURA_CLP = 500000;

// Devuelve 'factura' o 'boleta'. Por defecto se calcula según el monto, pero
// el campo r.facturaManual (marcado a mano desde el listado de Pendientes)
// permite forzar factura u boleta en casos puntuales (ej. cliente empresa
// que siempre pide factura aunque el monto no supere el umbral).
function tipoDocumento(r) {
    if (r.facturaManual === true) return 'factura';
    if (r.facturaManual === false) return 'boleta';
    return (r.montoEnviado || 0) > UMBRAL_FACTURA_CLP ? 'factura' : 'boleta';
}

function tipoDocumentoLabel(r) {
    return tipoDocumento(r) === 'factura' ? 'Factura' : 'Boleta';
}

function tipoDocumentoBadgeHtml(r) {
    const esFactura = tipoDocumento(r) === 'factura';
    const esManual = r.facturaManual === true || r.facturaManual === false;
    return `<button type="button" class="badge badge-toggle ${esFactura ? 'badge-danger' : 'badge-neutral'}" data-toggle-doc-id="${r.id}" title="Clic para cambiar a ${esFactura ? 'boleta' : 'factura'}${esManual ? ' (marcado a mano)' : ''}">${esFactura ? 'Factura' : 'Boleta'}${esManual ? ' ✎' : ''}</button>`;
}

// Versión no interactiva del badge, para el listado de Emitidas (ya no
// tiene sentido cambiar el tipo de documento una vez emitido).
function tipoDocumentoBadgeHtmlEstatico(r) {
    const esFactura = tipoDocumento(r) === 'factura';
    return `<span class="badge ${esFactura ? 'badge-danger' : 'badge-neutral'}">${esFactura ? 'Factura' : 'Boleta'}</span>`;
}

async function alternarTipoDocumento(remesaId) {
    const r = pendientesPorId[remesaId];
    if (!r) return;
    const esFacturaAhora = tipoDocumento(r) === 'factura';
    try {
        await db.collection('remesas').doc(remesaId).update({
            facturaManual: !esFacturaAhora
        });
    } catch (error) {
        console.error('Error al cambiar tipo de documento:', error);
        alert('No se pudo cambiar el tipo de documento. Intenta de nuevo.');
    }
}

export function renderBoletas(remesas) {
    const activas = remesas.filter(r => r.estado !== 'cancelado' && requiereBoleta(r));
    const pendientes = activas.filter(r => !r.boletaEmitida);
    const emitidas = activas.filter(r => r.boletaEmitida);

    pendientesPorId = {};
    pendientes.forEach(r => { pendientesPorId[r.id] = r; });
    // Si una remesa seleccionada ya no está pendiente (se marcó desde otra
    // pestaña, por ejemplo), se quita sola de la selección.
    boletasSeleccionadas.forEach(id => { if (!pendientesPorId[id]) boletasSeleccionadas.delete(id); });
    actualizarBotonGrupoBoleta();

    // --- Resumen ---
    boletasPendientesCount.textContent = pendientes.length;
    const montoPendienteClp = pendientes
        .filter(r => (r.monedaEnviado || '').toUpperCase() === 'CLP')
        .reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    boletasPendientesMonto.textContent = formatMoney(montoPendienteClp, 'CLP');
    if (boletasPendientesFacturasCount) {
        boletasPendientesFacturasCount.textContent = pendientes.filter(r => tipoDocumento(r) === 'factura').length;
    }

    // --- Tablas: se guardan en cache y se pintan a través de los filtros ---
    boletasPendientesCache = pendientes;
    boletasEmitidasCache = emitidas;
    aplicarFiltroBoletasPendientes();
    aplicarFiltroBoletasEmitidas();
}

// Aplica los filtros de fecha y búsqueda por cliente sobre
// boletasPendientesCache, y vuelve a pintar la tabla de Pendientes de boleta.
function aplicarFiltroBoletasPendientes() {
    const desdeFiltro = boletasPendientesFiltroDesde.value;
    const hastaFiltro = boletasPendientesFiltroHasta.value;
    const textoBusqueda = boletasPendientesFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = boletasPendientesCache.filter(r => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('boletasPendientes', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { boletasPendientesFiltroDesde.value = ''; boletasPendientesFiltroHasta.value = ''; aplicarFiltroBoletasPendientes(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente: "${boletasPendientesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { boletasPendientesFiltroBuscar.value = ''; aplicarFiltroBoletasPendientes(); }
        }
    ], { mostrados: filtrados.length, total: boletasPendientesCache.length });

    boletasPendientesFiltrado = filtrados;
    boletasPendientesBody.innerHTML = '';
    if (filtrados.length === 0) {
        boletasPendientesEmpty.style.display = 'block';
        boletasPendientesTableWrap.style.display = 'none';
        boletasPendientesEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay remesas pendientes que coincidan con el filtro.'
            : 'No tienes remesas pendientes de boleta.';
        return;
    }
    boletasPendientesEmpty.style.display = 'none';
    boletasPendientesTableWrap.style.display = 'block';
    filtrados.forEach(r => {
        const tr = document.createElement('tr');
        const esFactura = tipoDocumento(r) === 'factura';
        tr.innerHTML = `
            <td><input type="checkbox" class="boleta-checkbox" data-id="${r.id}" ${boletasSeleccionadas.has(r.id) ? 'checked' : ''}></td>
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
            <td>${tipoDocumentoBadgeHtml(r)}</td>
            <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            <td><button type="button" class="btn-icon-action" data-id="${r.id}"><i class="ti ti-receipt" aria-hidden="true"></i> Marcar ${esFactura ? 'factura' : 'boleta'} emitida</button></td>
        `;
        tr.querySelector('.boleta-checkbox').addEventListener('change', (e) => {
            if (e.target.checked) boletasSeleccionadas.add(r.id);
            else boletasSeleccionadas.delete(r.id);
            actualizarBotonGrupoBoleta();
        });
        tr.querySelector('[data-toggle-doc-id]').addEventListener('click', () => alternarTipoDocumento(r.id));
        tr.querySelector('button.btn-icon-action').addEventListener('click', () => marcarBoletaEmitida(r.id));
        boletasPendientesBody.appendChild(tr);
    });
}

// Aplica los filtros de fecha y búsqueda por cliente/folio sobre
// boletasEmitidasCache, y vuelve a pintar la tabla de Boletas emitidas.
function aplicarFiltroBoletasEmitidas() {
    const desdeFiltro = boletasEmitidasFiltroDesde.value;
    const hastaFiltro = boletasEmitidasFiltroHasta.value;
    const textoBusqueda = boletasEmitidasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = boletasEmitidasCache.filter(r => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda) {
            const enCliente = (r.clienteNombre || '').toLowerCase().includes(textoBusqueda);
            const enFolio = (r.folioBoleta || '').toLowerCase().includes(textoBusqueda);
            if (!enCliente && !enFolio) return false;
        }
        return true;
    });

    actualizarPanelFiltros('boletasEmitidas', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { boletasEmitidasFiltroDesde.value = ''; boletasEmitidasFiltroHasta.value = ''; aplicarFiltroBoletasEmitidas(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente/folio: "${boletasEmitidasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { boletasEmitidasFiltroBuscar.value = ''; aplicarFiltroBoletasEmitidas(); }
        }
    ], { mostrados: filtrados.length, total: boletasEmitidasCache.length });

    boletasEmitidasFiltrado = filtrados;
    boletasEmitidasMes.textContent = filtrados.length;
    const montoEmitidoClp = filtrados
        .filter(r => (r.monedaEnviado || '').toUpperCase() === 'CLP')
        .reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    boletasEmitidasMonto.textContent = formatMoney(montoEmitidoClp, 'CLP');
    boletasEmitidasBody.innerHTML = '';
    if (filtrados.length === 0) {
        boletasEmitidasEmpty.style.display = 'block';
        boletasEmitidasTableWrap.style.display = 'none';
        boletasEmitidasEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay boletas emitidas que coincidan con el filtro.'
            : 'Todavía no has marcado ninguna boleta como emitida.';
        return;
    }
    boletasEmitidasEmpty.style.display = 'none';
    boletasEmitidasTableWrap.style.display = 'block';

    // Para las boletas agrupadas, se calcula el total real del grupo
    // (puede incluir remesas que no vinieron en este mismo listado filtrado).
    const totalesPorGrupo = {};
    boletasEmitidasCache.forEach(r => {
        if (!r.grupoBoletaId) return;
        totalesPorGrupo[r.grupoBoletaId] = (totalesPorGrupo[r.grupoBoletaId] || 0) + (r.montoEnviado || 0);
    });

    filtrados.forEach(r => {
        const tr = document.createElement('tr');
        const esFactura = tipoDocumento(r) === 'factura';
        const grupoInfo = r.grupoBoletaId
            ? `<div class="cell-subtext">${esFactura ? 'Factura' : 'Boleta'} agrupada · total ${formatMoney(totalesPorGrupo[r.grupoBoletaId], r.monedaEnviado)}</div>`
            : '';
        tr.innerHTML = `
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}${grupoInfo}</td>
            <td>${tipoDocumentoBadgeHtmlEstatico(r)}</td>
            <td>${escapeHtml(r.folioBoleta) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-id="${r.id}">Quitar marca</button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => quitarMarcaBoleta(r.id));
        boletasEmitidasBody.appendChild(tr);
    });
}


// ============================================
// EXPORTAR BOLETAS (Pendientes de boleta) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const boletasPendientesExportarPdfBtn = document.getElementById('boletasPendientesExportarPdfBtn');
const boletasPendientesExportarExcelBtn = document.getElementById('boletasPendientesExportarExcelBtn');

function filasExportBoletasPendientes() {
    return boletasPendientesFiltrado.map(r => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Monto: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Tipo: tipoDocumentoLabel(r),
        Estado: badgeLabel(r.estado)
    }));
}



// ============================================
// EXPORTAR BOLETAS (Boletas emitidas) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const boletasEmitidasExportarPdfBtn = document.getElementById('boletasEmitidasExportarPdfBtn');
const boletasEmitidasExportarExcelBtn = document.getElementById('boletasEmitidasExportarExcelBtn');

function filasExportBoletasEmitidas() {
    const totalesPorGrupo = {};
    boletasEmitidasCache.forEach(r => {
        if (!r.grupoBoletaId) return;
        totalesPorGrupo[r.grupoBoletaId] = (totalesPorGrupo[r.grupoBoletaId] || 0) + (r.montoEnviado || 0);
    });

    return boletasEmitidasFiltrado.map(r => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Monto: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Tipo: tipoDocumentoLabel(r),
        Folio: r.folioBoleta || '—',
        'Total del grupo': r.grupoBoletaId ? moneyTexto(totalesPorGrupo[r.grupoBoletaId], r.monedaEnviado) : '—'
    }));
}



export function initBoletas() {
    [boletasPendientesFiltroDesde, boletasPendientesFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroBoletasPendientes);
    });
    boletasPendientesFiltroBuscar.addEventListener('input', aplicarFiltroBoletasPendientes);
    boletasPendientesFiltroLimpiar.addEventListener('click', () => {
        boletasPendientesFiltroDesde.value = '';
        boletasPendientesFiltroHasta.value = '';
        boletasPendientesFiltroBuscar.value = '';
        aplicarFiltroBoletasPendientes();
    });
    initFiltrosToggle('boletasPendientes');

    boletasPendientesExportarPdfBtn.addEventListener('click', () => {
        if (boletasPendientesFiltrado.length === 0) {
            alert('No hay remesas pendientes para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBoletasPendientes();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Boletas — Pendientes de boleta', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} remesa(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'Cliente', 'Monto', 'Tipo', 'Estado']],
            body: filas.map(f => [f.Fecha, f.Cliente, f.Monto, f.Tipo, f.Estado]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`boletas-pendientes-${fechaArchivo()}.pdf`);
    });

    boletasPendientesExportarExcelBtn.addEventListener('click', () => {
        if (boletasPendientesFiltrado.length === 0) {
            alert('No hay remesas pendientes para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBoletasPendientes();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Pendientes de boleta');
        XLSX.writeFile(libro, `boletas-pendientes-${fechaArchivo()}.xlsx`);
    });

    [boletasEmitidasFiltroDesde, boletasEmitidasFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroBoletasEmitidas);
    });
    boletasEmitidasFiltroBuscar.addEventListener('input', aplicarFiltroBoletasEmitidas);
    boletasEmitidasFiltroLimpiar.addEventListener('click', () => {
        boletasEmitidasFiltroDesde.value = '';
        boletasEmitidasFiltroHasta.value = '';
        boletasEmitidasFiltroBuscar.value = '';
        aplicarFiltroBoletasEmitidas();
    });
    initFiltrosToggle('boletasEmitidas');

    boletasEmitidasExportarPdfBtn.addEventListener('click', () => {
        if (boletasEmitidasFiltrado.length === 0) {
            alert('No hay boletas emitidas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBoletasEmitidas();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Boletas — Boletas emitidas', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} boleta(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'Cliente', 'Monto', 'Tipo', 'Folio', 'Total del grupo']],
            body: filas.map(f => [f.Fecha, f.Cliente, f.Monto, f.Tipo, f.Folio, f['Total del grupo']]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`boletas-emitidas-${fechaArchivo()}.pdf`);
    });

    boletasEmitidasExportarExcelBtn.addEventListener('click', () => {
        if (boletasEmitidasFiltrado.length === 0) {
            alert('No hay boletas emitidas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBoletasEmitidas();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 18 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Boletas emitidas');
        XLSX.writeFile(libro, `boletas-emitidas-${fechaArchivo()}.xlsx`);
    });

    boletasMarcarGrupoBtn.addEventListener('click', async () => {
        const ids = Array.from(boletasSeleccionadas);
        if (ids.length < 2) return;
        const seleccionadas = ids.map(id => pendientesPorId[id]).filter(Boolean);

        const monedas = new Set(seleccionadas.map(r => (r.monedaEnviado || '').toUpperCase()));
        if (monedas.size > 1) {
            alert('Las remesas seleccionadas tienen monedas distintas. Solo puedes agrupar remesas en la misma moneda (lo que realmente pagó el cliente).');
            return;
        }

        const tipos = new Set(seleccionadas.map(r => tipoDocumento(r)));
        if (tipos.size > 1) {
            alert(`Las remesas seleccionadas requieren documentos distintos (boleta y factura, según si superan los ${formatMoney(UMBRAL_FACTURA_CLP, 'CLP')}). Solo puedes agrupar remesas que usen el mismo tipo de documento.`);
            return;
        }
        const esFactura = tipos.has('factura');

        const moneda = seleccionadas[0].monedaEnviado;
        const total = seleccionadas.reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
        const folio = prompt(
            `Vas a agrupar ${seleccionadas.length} remesas en una sola ${esFactura ? 'factura' : 'boleta'} por ${formatMoney(total, moneda)}.\n\nNúmero de folio de la ${esFactura ? 'factura' : 'boleta'} en e-Boleta (opcional):`,
            ''
        );
        if (folio === null) return; // canceló

        try {
            const grupoBoletaId = `grupo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const batch = db.batch();
            seleccionadas.forEach(r => {
                batch.update(db.collection('remesas').doc(r.id), {
                    boletaEmitida: true,
                    folioBoleta: folio.trim(),
                    grupoBoletaId,
                    fechaBoleta: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            boletasSeleccionadas.clear();
        } catch (error) {
            console.error('Error al agrupar boletas:', error);
            alert('No se pudo agrupar la boleta. Intenta de nuevo.');
        }
    });

}

async function marcarBoletaEmitida(remesaId) {
    const r = pendientesPorId[remesaId];
    const esFactura = r && tipoDocumento(r) === 'factura';
    const folio = prompt(
        `Número de folio de la ${esFactura ? 'factura' : 'boleta'} en e-Boleta (opcional, puedes dejarlo en blanco):`,
        ''
    );
    if (folio === null) return; // canceló el prompt
    try {
        await db.collection('remesas').doc(remesaId).update({
            boletaEmitida: true,
            folioBoleta: folio.trim(),
            fechaBoleta: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error al marcar boleta emitida:', error);
        alert(`No se pudo marcar la ${esFactura ? 'factura' : 'boleta'}. Intenta de nuevo.`);
    }
}

async function quitarMarcaBoleta(remesaId) {
    if (!confirm('¿Quitar la marca de documento emitido (boleta/factura) de esta remesa? Volverá a aparecer como pendiente.')) return;
    try {
        await db.collection('remesas').doc(remesaId).update({
            boletaEmitida: false,
            folioBoleta: '',
            grupoBoletaId: firebase.firestore.FieldValue.delete(),
            fechaBoleta: null
        });
    } catch (error) {
        console.error('Error al quitar marca de boleta:', error);
        alert('No se pudo actualizar. Intenta de nuevo.');
    }
}

// ============================================
