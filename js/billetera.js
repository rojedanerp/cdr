import { db } from './firebase-config.js';
import { escapeHtml, formatMoney, formatDate, moneyTexto, fechaArchivo, fechaEnRango, initFiltrosToggle, actualizarPanelFiltros, initPanelCollapseToggle } from './shared.js';
import { cajaColeccion, origenBadgeHTML, tipoBadgeHTML, origenTexto, tipoTexto } from './caja.js';

// ============================================
// BILLETERA — control de compras/ventas de USDT. Cada compra o venta se
// registra como dos movimientos ligados en movimientosCaja (colección de
// caja.js), así que "Caja" siempre refleja el saldo real automáticamente.
// renderBilletera se exporta porque caja.js la llama con cada actualización
// de movimientosCaja (misma escucha en tiempo real).
// ============================================
const billeteraForm = document.getElementById('billeteraForm');
const billeteraClpGastadoInput = document.getElementById('billeteraClpGastado');
const billeteraUsdtCompradoInput = document.getElementById('billeteraUsdtComprado');
const billeteraTasaCompraInput = document.getElementById('billeteraTasaCompra');
const billeteraConceptoInput = document.getElementById('billeteraConcepto');
const billeteraMessage = document.getElementById('billeteraMessage');
const billeteraSubmitBtn = document.getElementById('billeteraSubmitBtn');
const billeteraBody = document.getElementById('billeteraBody');
const billeteraTableWrap = document.getElementById('billeteraTableWrap');
const billeteraEmpty = document.getElementById('billeteraEmpty');
const billeteraComprasFiltroDesde = document.getElementById('billeteraComprasFiltroDesde');
const billeteraComprasFiltroHasta = document.getElementById('billeteraComprasFiltroHasta');
const billeteraComprasFiltroBuscar = document.getElementById('billeteraComprasFiltroBuscar');
const billeteraComprasFiltroLimpiar = document.getElementById('billeteraComprasFiltroLimpiar');
// Guarda el listado completo de compras de USDT para poder re-filtrar en el
// cliente sin volver a consultar.
let billeteraComprasCache = [];
// Subconjunto actualmente visible según los filtros de Historial de compras, usado para exportar.
let billeteraComprasFiltrado = [];
const billeteraSaldoUsdtEl = document.getElementById('billeteraSaldoUsdt');
const billeteraClpInvertidoEl = document.getElementById('billeteraClpInvertido');
const billeteraTasaPromedioEl = document.getElementById('billeteraTasaPromedio');
const billeteraTasaPromedioVentaEl = document.getElementById('billeteraTasaPromedioVenta');
const billeteraMovsBody = document.getElementById('billeteraMovsBody');
const billeteraMovsTableWrap = document.getElementById('billeteraMovsTableWrap');
const billeteraMovsEmpty = document.getElementById('billeteraMovsEmpty');
const billeteraMovsEmptyText = document.getElementById('billeteraMovsEmptyText');
const billeteraMovsFiltroTipo = document.getElementById('billeteraMovsFiltroTipo');
const billeteraMovsFiltroOrigen = document.getElementById('billeteraMovsFiltroOrigen');
const billeteraMovsFiltroBuscar = document.getElementById('billeteraMovsFiltroBuscar');
const billeteraMovsFiltroDesde = document.getElementById('billeteraMovsFiltroDesde');
const billeteraMovsFiltroHasta = document.getElementById('billeteraMovsFiltroHasta');
const billeteraMovsFiltroLimpiar = document.getElementById('billeteraMovsFiltroLimpiar');
// Guarda el listado completo (con saldo acumulado ya calculado) para poder
// re-filtrar en el cliente sin tener que recalcular saldos ni volver a
// consultar Firestore cada vez que cambia un filtro.
let billeteraMovsConSaldoCache = [];
// Subconjunto actualmente visible según los filtros de Todos los movimientos, usado para exportar.
let billeteraMovsFiltrado = [];
const billeteraVentaForm = document.getElementById('billeteraVentaForm');
const billeteraUsdtVendidoInput = document.getElementById('billeteraUsdtVendido');
const billeteraVesRecibidoInput = document.getElementById('billeteraVesRecibido');
const billeteraComisionUsdtInput = document.getElementById('billeteraComisionUsdt');
const billeteraTasaVentaInput = document.getElementById('billeteraTasaVenta');
const billeteraVentaConceptoInput = document.getElementById('billeteraVentaConcepto');
const billeteraVentaMessage = document.getElementById('billeteraVentaMessage');
const billeteraVentaSubmitBtn = document.getElementById('billeteraVentaSubmitBtn');
const billeteraVentasBody = document.getElementById('billeteraVentasBody');
const billeteraVentasTableWrap = document.getElementById('billeteraVentasTableWrap');
const billeteraVentasEmpty = document.getElementById('billeteraVentasEmpty');
const billeteraVentasFiltroDesde = document.getElementById('billeteraVentasFiltroDesde');
const billeteraVentasFiltroHasta = document.getElementById('billeteraVentasFiltroHasta');
const billeteraVentasFiltroBuscar = document.getElementById('billeteraVentasFiltroBuscar');
const billeteraVentasFiltroLimpiar = document.getElementById('billeteraVentasFiltroLimpiar');
// Guarda el listado completo de ventas de USDT para poder re-filtrar en el
// cliente sin volver a consultar.
let billeteraVentasCache = [];
// Subconjunto actualmente visible según los filtros de Historial de ventas, usado para exportar.
let billeteraVentasFiltrado = [];

function recalcularTasaCompraBilletera() {
    const clp = parseFloat(billeteraClpGastadoInput.value);
    const usdt = parseFloat(billeteraUsdtCompradoInput.value);
    billeteraTasaCompraInput.value = (!isNaN(clp) && !isNaN(usdt) && usdt > 0)
        ? formatMoney(clp / usdt, 'CLP')
        : '—';
}

function recalcularTasaVentaBilletera() {
    const usdt = parseFloat(billeteraUsdtVendidoInput.value);
    const ves = parseFloat(billeteraVesRecibidoInput.value);
    billeteraTasaVentaInput.value = (!isNaN(usdt) && !isNaN(ves) && usdt > 0)
        ? formatMoney(ves / usdt, 'VES')
        : '—';
}

export function renderBilletera(movimientos) {
    // Saldo actual de USDT: TODO lo que entra y sale en esa moneda, incluyendo
    // compras aquí y lo enviado en remesas pagadas directo en USDT.
    let entradasUsdt = 0;
    let salidasUsdt = 0;
    let clpInvertidoTotal = 0;
    let usdtCompradoTotal = 0;
    let vesRecibidoTotal = 0;
    let usdtVendidoTotal = 0;
    const compras = [];
    const ventas = [];
    const movimientosUsdt = [];

    movimientos.forEach(mov => {
        if ((mov.moneda || '').toUpperCase() === 'USDT') {
            if (mov.tipo === 'entrada') entradasUsdt += (mov.monto || 0);
            else salidasUsdt += (mov.monto || 0);
            movimientosUsdt.push(mov);
        }
        if (mov.origen === 'compra_usdt' && mov.tipo === 'entrada') {
            compras.push(mov);
            clpInvertidoTotal += (mov.clpGastado || 0);
            usdtCompradoTotal += (mov.monto || 0);
        }
        if (mov.origen === 'venta_usdt' && mov.tipo === 'salida') {
            ventas.push(mov);
            vesRecibidoTotal += (mov.vesRecibido || 0);
            usdtVendidoTotal += (mov.monto || 0);
        }
    });

    const saldoUsdt = entradasUsdt - salidasUsdt;
    billeteraSaldoUsdtEl.textContent = formatMoney(saldoUsdt, 'USDT');
    billeteraSaldoUsdtEl.classList.toggle('stat-value-negative', saldoUsdt < 0);
    billeteraClpInvertidoEl.textContent = formatMoney(clpInvertidoTotal, 'CLP');
    billeteraTasaPromedioEl.textContent = usdtCompradoTotal > 0
        ? formatMoney(clpInvertidoTotal / usdtCompradoTotal, 'CLP')
        : '—';
    billeteraTasaPromedioVentaEl.textContent = usdtVendidoTotal > 0
        ? formatMoney(vesRecibidoTotal / usdtVendidoTotal, 'VES')
        : '—';

    renderBilleteraCompras(compras);
    renderBilleteraVentas(ventas);
    renderBilleteraMovimientos(movimientosUsdt);
}

function renderBilleteraMovimientos(movimientosUsdt) {
    // movimientosUsdt viene ordenado de más nuevo a más antiguo (así llega la
    // consulta de Caja). Para calcular el saldo acumulado hay que recorrerlo
    // de más antiguo a más nuevo, y luego mostrarlo en el orden original.
    const cronologico = movimientosUsdt.slice().reverse();
    let saldoCorrido = 0;
    const conSaldo = cronologico.map(mov => {
        saldoCorrido += (mov.tipo === 'entrada' ? 1 : -1) * (mov.monto || 0);
        return { mov, saldo: saldoCorrido };
    }).reverse();

    billeteraMovsConSaldoCache = conSaldo;
    aplicarFiltroBilleteraMovs();
}

// Aplica los filtros de tipo, origen y búsqueda por concepto sobre el listado
// ya calculado en billeteraMovsConSaldoCache. El saldo mostrado en cada fila
// siempre corresponde al histórico completo (no cambia según el filtro), solo
// se decide qué filas mostrar.
function aplicarFiltroBilleteraMovs() {
    const tipoFiltro = billeteraMovsFiltroTipo.value;
    const origenFiltro = billeteraMovsFiltroOrigen.value;
    const textoBusqueda = billeteraMovsFiltroBuscar.value.trim().toLowerCase();
    const desdeFiltro = billeteraMovsFiltroDesde.value;
    const hastaFiltro = billeteraMovsFiltroHasta.value;
    const hayFiltrosActivos = tipoFiltro !== 'todos' || origenFiltro !== 'todos' || textoBusqueda !== '' ||
        desdeFiltro !== '' || hastaFiltro !== '';

    const filtrados = billeteraMovsConSaldoCache.filter(({ mov }) => {
        if (tipoFiltro !== 'todos' && mov.tipo !== tipoFiltro) return false;
        if (origenFiltro !== 'todos' && (mov.origen || 'manual') !== origenFiltro) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraMovs', [
        {
            label: 'Tipo', activo: tipoFiltro !== 'todos',
            texto: billeteraMovsFiltroTipo.options[billeteraMovsFiltroTipo.selectedIndex].text,
            onQuitar: () => { billeteraMovsFiltroTipo.value = 'todos'; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Origen', activo: origenFiltro !== 'todos',
            texto: billeteraMovsFiltroOrigen.options[billeteraMovsFiltroOrigen.selectedIndex].text,
            onQuitar: () => { billeteraMovsFiltroOrigen.value = 'todos'; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraMovsFiltroDesde.value = ''; billeteraMovsFiltroHasta.value = ''; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraMovsFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraMovsFiltroBuscar.value = ''; aplicarFiltroBilleteraMovs(); }
        }
    ], { mostrados: filtrados.length, total: billeteraMovsConSaldoCache.length });

    billeteraMovsFiltrado = filtrados;
    billeteraMovsBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraMovsEmpty.style.display = 'block';
        billeteraMovsTableWrap.style.display = 'none';
        billeteraMovsEmptyText.textContent = hayFiltrosActivos
            ? 'No hay movimientos que coincidan con el filtro.'
            : 'Todavía no hay movimientos de USDT.';
        return;
    }
    billeteraMovsEmpty.style.display = 'none';
    billeteraMovsTableWrap.style.display = 'block';

    filtrados.forEach(({ mov, saldo }) => {
        const signo = mov.tipo === 'entrada' ? '+' : '−';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(mov.createdAt)}</td>
            <td>${tipoBadgeHTML(mov.tipo)}</td>
            <td class="mono-cell">${signo} ${formatMoney(mov.monto, 'USDT')}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td>${origenBadgeHTML(mov)}</td>
            <td class="mono-cell ${saldo < 0 ? 'stat-value-negative' : ''}">${formatMoney(saldo, 'USDT')}</td>
        `;
        billeteraMovsBody.appendChild(tr);
    });
}

// ============================================
// EXPORTAR BILLETERA (Todos los movimientos) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraMovsExportarPdfBtn = document.getElementById('billeteraMovsExportarPdfBtn');
const billeteraMovsExportarExcelBtn = document.getElementById('billeteraMovsExportarExcelBtn');

function filasExportBilleteraMovs() {
    return billeteraMovsFiltrado.map(({ mov, saldo }) => ({
        Fecha: formatDate(mov.createdAt),
        Tipo: tipoTexto(mov.tipo),
        Monto: moneyTexto(mov.monto, 'USDT'),
        Concepto: mov.concepto || '—',
        Origen: origenTexto(mov),
        Saldo: moneyTexto(saldo, 'USDT')
    }));
}

function renderBilleteraCompras(compras) {
    billeteraComprasCache = compras;
    aplicarFiltroBilleteraCompras();
}

// Aplica los filtros de fecha y búsqueda por concepto sobre
// billeteraComprasCache, y vuelve a pintar la tabla de Historial de compras.
function aplicarFiltroBilleteraCompras() {
    const desdeFiltro = billeteraComprasFiltroDesde.value;
    const hastaFiltro = billeteraComprasFiltroHasta.value;
    const textoBusqueda = billeteraComprasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = billeteraComprasCache.filter(mov => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraCompras', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraComprasFiltroDesde.value = ''; billeteraComprasFiltroHasta.value = ''; aplicarFiltroBilleteraCompras(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraComprasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraComprasFiltroBuscar.value = ''; aplicarFiltroBilleteraCompras(); }
        }
    ], { mostrados: filtrados.length, total: billeteraComprasCache.length });

    billeteraComprasFiltrado = filtrados;
    billeteraBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraEmpty.style.display = 'block';
        billeteraTableWrap.style.display = 'none';
        billeteraEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay compras que coincidan con el filtro.'
            : 'Todavía no has registrado compras de USDT.';
        return;
    }
    billeteraEmpty.style.display = 'none';
    billeteraTableWrap.style.display = 'block';

    filtrados.forEach(mov => {
        const tasa = mov.monto > 0 ? mov.clpGastado / mov.monto : 0;
        const fecha = formatDate(mov.createdAt);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td class="mono-cell">${formatMoney(mov.clpGastado, 'CLP')}</td>
            <td class="mono-cell">${formatMoney(mov.monto, 'USDT')}</td>
            <td class="mono-cell">${formatMoney(tasa, 'CLP')}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-compra-id="${mov.compraId}"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => eliminarCompraUsdt(mov.compraId));
        billeteraBody.appendChild(tr);
    });
}

// ============================================
// EXPORTAR BILLETERA (Historial de compras) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraComprasExportarPdfBtn = document.getElementById('billeteraComprasExportarPdfBtn');
const billeteraComprasExportarExcelBtn = document.getElementById('billeteraComprasExportarExcelBtn');

function filasExportBilleteraCompras() {
    return billeteraComprasFiltrado.map(mov => {
        const tasa = mov.monto > 0 ? mov.clpGastado / mov.monto : 0;
        return {
            Fecha: formatDate(mov.createdAt),
            'CLP gastado': moneyTexto(mov.clpGastado, 'CLP'),
            'USDT comprado': moneyTexto(mov.monto, 'USDT'),
            Tasa: moneyTexto(tasa, 'CLP'),
            Concepto: mov.concepto || '—'
        };
    });
}

async function eliminarCompraUsdt(compraId) {
    if (!compraId) return;
    if (!confirm('¿Eliminar esta compra de USDT? Se borrarán también sus movimientos de Caja (CLP y USDT).')) return;
    try {
        const existentes = await cajaColeccion.where('compraId', '==', compraId).get();
        await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
    } catch (error) {
        console.error('Error al eliminar compra de USDT:', error);
        alert('No se pudo eliminar la compra. Intenta de nuevo.');
    }
}

function renderBilleteraVentas(ventas) {
    billeteraVentasCache = ventas;
    aplicarFiltroBilleteraVentas();
}

// Aplica los filtros de fecha y búsqueda por concepto sobre
// billeteraVentasCache, y vuelve a pintar la tabla de Historial de ventas.
function aplicarFiltroBilleteraVentas() {
    const desdeFiltro = billeteraVentasFiltroDesde.value;
    const hastaFiltro = billeteraVentasFiltroHasta.value;
    const textoBusqueda = billeteraVentasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = billeteraVentasCache.filter(mov => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraVentas', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraVentasFiltroDesde.value = ''; billeteraVentasFiltroHasta.value = ''; aplicarFiltroBilleteraVentas(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraVentasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraVentasFiltroBuscar.value = ''; aplicarFiltroBilleteraVentas(); }
        }
    ], { mostrados: filtrados.length, total: billeteraVentasCache.length });

    billeteraVentasFiltrado = filtrados;
    billeteraVentasBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraVentasEmpty.style.display = 'block';
        billeteraVentasTableWrap.style.display = 'none';
        billeteraVentasEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay ventas que coincidan con el filtro.'
            : 'Todavía no has registrado ventas de USDT.';
        return;
    }
    billeteraVentasEmpty.style.display = 'none';
    billeteraVentasTableWrap.style.display = 'block';

    filtrados.forEach(mov => {
        const vesRecibido = mov.vesRecibido || 0;
        const tasa = mov.monto > 0 ? vesRecibido / mov.monto : 0;
        const fecha = formatDate(mov.createdAt);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td class="mono-cell">${formatMoney(mov.monto, 'USDT')}</td>
            <td class="mono-cell">${formatMoney(vesRecibido, 'VES')}</td>
            <td class="mono-cell">${formatMoney(tasa, 'VES')}</td>
            <td class="mono-cell">${mov.comisionUsdt ? formatMoney(mov.comisionUsdt, 'USDT') : '—'}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-venta-id="${mov.ventaId}"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => eliminarVentaUsdt(mov.ventaId));
        billeteraVentasBody.appendChild(tr);
    });
}

// ============================================
// EXPORTAR BILLETERA (Historial de ventas) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraVentasExportarPdfBtn = document.getElementById('billeteraVentasExportarPdfBtn');
const billeteraVentasExportarExcelBtn = document.getElementById('billeteraVentasExportarExcelBtn');

function filasExportBilleteraVentas() {
    return billeteraVentasFiltrado.map(mov => {
        const vesRecibido = mov.vesRecibido || 0;
        const tasa = mov.monto > 0 ? vesRecibido / mov.monto : 0;
        return {
            Fecha: formatDate(mov.createdAt),
            'USDT vendido': moneyTexto(mov.monto, 'USDT'),
            'VES recibido': moneyTexto(vesRecibido, 'VES'),
            Tasa: moneyTexto(tasa, 'VES'),
            'Comisión USDT': mov.comisionUsdt ? moneyTexto(mov.comisionUsdt, 'USDT') : '—',
            Concepto: mov.concepto || '—'
        };
    });
}

async function eliminarVentaUsdt(ventaId) {
    if (!ventaId) return;
    if (!confirm('¿Eliminar esta venta de USDT? Se borrarán también sus movimientos de Caja (USDT y VES).')) return;
    try {
        const existentes = await cajaColeccion.where('ventaId', '==', ventaId).get();
        await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
    } catch (error) {
        console.error('Error al eliminar venta de USDT:', error);
        alert('No se pudo eliminar la venta. Intenta de nuevo.');
    }
}

// Inicializa los formularios de compra/venta, los filtros y exportación de
// Billetera, y los paneles minimizables. Se llama una sola vez desde app.js
// al arrancar (renderBilletera() la invoca caja.js con cada actualización
// de movimientosCaja, así que Billetera no abre su propia escucha).
export function initBilletera() {
    [billeteraClpGastadoInput, billeteraUsdtCompradoInput].forEach(el => {
        el.addEventListener('input', recalcularTasaCompraBilletera);
    });
    [billeteraUsdtVendidoInput, billeteraVesRecibidoInput].forEach(el => {
        el.addEventListener('input', recalcularTasaVentaBilletera);
    });

    [billeteraMovsFiltroTipo, billeteraMovsFiltroOrigen, billeteraMovsFiltroDesde, billeteraMovsFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroBilleteraMovs);
    });
    billeteraMovsFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraMovs);
    billeteraMovsFiltroLimpiar.addEventListener('click', () => {
        billeteraMovsFiltroTipo.value = 'todos';
        billeteraMovsFiltroOrigen.value = 'todos';
        billeteraMovsFiltroBuscar.value = '';
        billeteraMovsFiltroDesde.value = '';
        billeteraMovsFiltroHasta.value = '';
        aplicarFiltroBilleteraMovs();
    });
    initFiltrosToggle('billeteraMovs');

    billeteraMovsExportarPdfBtn.addEventListener('click', () => {
        if (billeteraMovsFiltrado.length === 0) {
            alert('No hay movimientos para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraMovs();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Billetera — Todos los movimientos de USDT', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} movimiento(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'Tipo', 'Monto', 'Concepto', 'Origen', 'Saldo']],
            body: filas.map(f => [f.Fecha, f.Tipo, f.Monto, f.Concepto, f.Origen, f.Saldo]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`billetera-movimientos-${fechaArchivo()}.pdf`);
    });

    billeteraMovsExportarExcelBtn.addEventListener('click', () => {
        if (billeteraMovsFiltrado.length === 0) {
            alert('No hay movimientos para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraMovs();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Movimientos USDT');
        XLSX.writeFile(libro, `billetera-movimientos-${fechaArchivo()}.xlsx`);
    });

    [billeteraComprasFiltroDesde, billeteraComprasFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroBilleteraCompras);
    });
    billeteraComprasFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraCompras);
    billeteraComprasFiltroLimpiar.addEventListener('click', () => {
        billeteraComprasFiltroDesde.value = '';
        billeteraComprasFiltroHasta.value = '';
        billeteraComprasFiltroBuscar.value = '';
        aplicarFiltroBilleteraCompras();
    });
    initFiltrosToggle('billeteraCompras');

    billeteraComprasExportarPdfBtn.addEventListener('click', () => {
        if (billeteraComprasFiltrado.length === 0) {
            alert('No hay compras para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraCompras();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Billetera — Historial de compras', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} compra(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'CLP gastado', 'USDT comprado', 'Tasa', 'Concepto']],
            body: filas.map(f => [f.Fecha, f['CLP gastado'], f['USDT comprado'], f.Tasa, f.Concepto]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`billetera-compras-${fechaArchivo()}.pdf`);
    });

    billeteraComprasExportarExcelBtn.addEventListener('click', () => {
        if (billeteraComprasFiltrado.length === 0) {
            alert('No hay compras para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraCompras();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Compras USDT');
        XLSX.writeFile(libro, `billetera-compras-${fechaArchivo()}.xlsx`);
    });

    billeteraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const clpGastado = parseFloat(billeteraClpGastadoInput.value);
        const usdtComprado = parseFloat(billeteraUsdtCompradoInput.value);
        const concepto = billeteraConceptoInput.value.trim() || 'Compra de USDT';

        if (isNaN(clpGastado) || clpGastado <= 0 || isNaN(usdtComprado) || usdtComprado <= 0) {
            billeteraMessage.textContent = 'Ingresa montos válidos en ambos campos.';
            billeteraMessage.className = 'form-message form-message-error';
            return;
        }

        billeteraSubmitBtn.disabled = true;
        billeteraSubmitBtn.querySelector('.btn-text').classList.add('hidden');
        billeteraSubmitBtn.querySelector('.spinner').classList.remove('hidden');

        try {
            const compraId = `compra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const batch = db.batch();

            const salidaRef = cajaColeccion.doc();
            batch.set(salidaRef, {
                tipo: 'salida',
                moneda: 'CLP',
                monto: clpGastado,
                concepto,
                origen: 'compra_usdt',
                compraId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const entradaRef = cajaColeccion.doc();
            batch.set(entradaRef, {
                tipo: 'entrada',
                moneda: 'USDT',
                monto: usdtComprado,
                clpGastado,
                concepto,
                origen: 'compra_usdt',
                compraId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();

            billeteraMessage.textContent = 'Compra registrada. Caja se actualizó sola (CLP −, USDT +).';
            billeteraMessage.className = 'form-message form-message-success';
            billeteraForm.reset();
            billeteraTasaCompraInput.value = '—';
        } catch (error) {
            console.error('Error al registrar compra de USDT:', error);
            billeteraMessage.textContent = 'Ocurrió un error al registrar la compra. Intenta de nuevo.';
            billeteraMessage.className = 'form-message form-message-error';
        } finally {
            billeteraSubmitBtn.disabled = false;
            billeteraSubmitBtn.querySelector('.btn-text').classList.remove('hidden');
            billeteraSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    [billeteraVentasFiltroDesde, billeteraVentasFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroBilleteraVentas);
    });
    billeteraVentasFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraVentas);
    billeteraVentasFiltroLimpiar.addEventListener('click', () => {
        billeteraVentasFiltroDesde.value = '';
        billeteraVentasFiltroHasta.value = '';
        billeteraVentasFiltroBuscar.value = '';
        aplicarFiltroBilleteraVentas();
    });
    initFiltrosToggle('billeteraVentas');

    billeteraVentasExportarPdfBtn.addEventListener('click', () => {
        if (billeteraVentasFiltrado.length === 0) {
            alert('No hay ventas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraVentas();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Billetera — Historial de ventas', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} venta(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'USDT vendido', 'VES recibido', 'Tasa', 'Comisión USDT', 'Concepto']],
            body: filas.map(f => [f.Fecha, f['USDT vendido'], f['VES recibido'], f.Tasa, f['Comisión USDT'], f.Concepto]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`billetera-ventas-${fechaArchivo()}.pdf`);
    });

    billeteraVentasExportarExcelBtn.addEventListener('click', () => {
        if (billeteraVentasFiltrado.length === 0) {
            alert('No hay ventas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportBilleteraVentas();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Ventas USDT');
        XLSX.writeFile(libro, `billetera-ventas-${fechaArchivo()}.xlsx`);
    });

    billeteraVentaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usdtVendido = parseFloat(billeteraUsdtVendidoInput.value);
        const vesRecibido = parseFloat(billeteraVesRecibidoInput.value);
        const comisionUsdt = parseFloat(billeteraComisionUsdtInput.value) || 0;
        const concepto = billeteraVentaConceptoInput.value.trim() || 'Venta de USDT';

        if (isNaN(usdtVendido) || usdtVendido <= 0 || isNaN(vesRecibido) || vesRecibido <= 0) {
            billeteraVentaMessage.textContent = 'Ingresa montos válidos en ambos campos.';
            billeteraVentaMessage.className = 'form-message form-message-error';
            return;
        }

        billeteraVentaSubmitBtn.disabled = true;
        billeteraVentaSubmitBtn.querySelector('.btn-text').classList.add('hidden');
        billeteraVentaSubmitBtn.querySelector('.spinner').classList.remove('hidden');

        try {
            const ventaId = `venta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const batch = db.batch();

            const salidaRef = cajaColeccion.doc();
            batch.set(salidaRef, {
                tipo: 'salida',
                moneda: 'USDT',
                monto: usdtVendido,
                vesRecibido,
                comisionUsdt,
                concepto,
                origen: 'venta_usdt',
                ventaId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const entradaRef = cajaColeccion.doc();
            batch.set(entradaRef, {
                tipo: 'entrada',
                moneda: 'VES',
                monto: vesRecibido,
                concepto,
                origen: 'venta_usdt',
                ventaId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();

            billeteraVentaMessage.textContent = 'Venta registrada. Caja se actualizó sola (USDT −, VES +).';
            billeteraVentaMessage.className = 'form-message form-message-success';
            billeteraVentaForm.reset();
            billeteraTasaVentaInput.value = '—';
        } catch (error) {
            console.error('Error al registrar venta de USDT:', error);
            billeteraVentaMessage.textContent = 'Ocurrió un error al registrar la venta. Intenta de nuevo.';
            billeteraVentaMessage.className = 'form-message form-message-error';
        } finally {
            billeteraVentaSubmitBtn.disabled = false;
            billeteraVentaSubmitBtn.querySelector('.btn-text').classList.remove('hidden');
            billeteraVentaSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    // Los tres empiezan minimizados para ahorrar espacio en Billetera.
    initPanelCollapseToggle('billeteraVentasPanel', 'billeteraVentasCollapseToggle', false);
    initPanelCollapseToggle('billeteraComprasPanel', 'billeteraComprasCollapseToggle', false);
    initPanelCollapseToggle('billeteraMovsPanel', 'billeteraMovsCollapseToggle', false);
}
