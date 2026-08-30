import { auth, db } from './firebase-config.js';
import { escapeHtml, formatMoney, formatDate, moneyTexto, fechaArchivo, initFiltrosToggle, actualizarPanelFiltros, initPanelCollapseToggle } from './shared.js';
import { registrarAuditoria } from './auditoria.js';
import { claveTasa, tasasCache } from './tasas.js';
import { renderBilletera } from './billetera.js';
import { actualizarDashboardEjecutivo, fechaLimiteVentana } from './dashboard.js';

// ============================================
// CAJA — control de efectivo por moneda, cierre de caja diario y arqueo.
// cajaColeccion, sincronizarCajaDeRemesa y eliminarMovimientosCajaDeRemesa
// se exportan para que remesas.js mantenga sincronizados los movimientos
// de caja de cada remesa. movimientosCajaActuales/calcularSaldosActuales
// se exportan para que dashboard.js calcule el saldo disponible.
// ============================================
export const cajaColeccion = db.collection('movimientosCaja');

// --- Sincronización automática: cada remesa puede generar hasta TRES
// movimientos en movimientosCaja, ligados por remesaId y diferenciados por "rol":
//   - "ingreso_cliente": entrada en la moneda que paga el cliente, SIEMPRE que la
//      remesa esté activa, sin importar si pagó en efectivo o por transferencia.
//   - "salida_destino": salida en la moneda de destino, SIEMPRE que la remesa esté
//      activa, porque el envío al destino siempre se transfiere desde el saldo de
//      esa moneda en caja, sin importar cómo pagó el cliente.
//   - "comision_destino": salida EXTRA en la moneda de destino, solo si la remesa
//      tiene un % de comisión bancaria de destino (ej. 0.3% en pago móvil/
//      transferencias interbancarias en Venezuela). El destinatario recibe el
//      monto completo; esta comisión sale aparte de tu saldo.
// Si la remesa se edita (cambia forma de pago, monto, moneda, comisión o se
// cancela) o se elimina, los tres movimientos se actualizan/borran solos. ---
// IMPORTANTE: los hasta 3 movimientos de una remesa (ingreso_cliente,
// salida_destino, comision_destino) se preparan sobre un mismo batch de
// Firestore y se confirman con un solo commit() al final. Esto los hace
// ATÓMICOS: o se guardan los tres juntos, o no se guarda ninguno. Antes cada
// movimiento se escribía por separado (await independiente), así que si el
// primero (ingreso en la moneda que paga el cliente) se guardaba bien pero el
// segundo (salida en la moneda de destino) fallaba a mitad de camino —por un
// corte de conexión, cerrar la pestaña antes de tiempo, etc.—, quedaba el
// ingreso registrado sin su salida correspondiente, descuadrando la caja sin
// ningún aviso visible (solo un console.warn). El batch evita ese escenario.
export async function sincronizarCajaDeRemesa(remesaId, data) {
    if (!remesaId) return;

    const activa = data.estado !== 'cancelado';
    const montoComision = (data.montoRecibido || 0) * ((data.comisionDestino || 0) / 100);
    const batch = db.batch();

    await prepararMovimientoCajaDeRemesa(batch, remesaId, 'ingreso_cliente', {
        debeExistir: activa && data.montoEnviado > 0 && !!data.monedaEnviado,
        tipo: 'entrada',
        moneda: data.monedaEnviado,
        monto: data.montoEnviado,
        concepto: (() => {
            if (data.formaPago === 'efectivo') return `Remesa en efectivo — ${data.clienteNombre}`;
            if (data.formaPago === 'caja_vecina') return `Remesa por Caja Vecina — ${data.clienteNombre}`;
            return `Remesa por transferencia — ${data.clienteNombre}`;
        })()
    });

    await prepararMovimientoCajaDeRemesa(batch, remesaId, 'salida_destino', {
        debeExistir: activa && data.montoRecibido > 0 && !!data.monedaRecibido,
        tipo: 'salida',
        moneda: data.monedaRecibido,
        monto: data.montoRecibido,
        concepto: `Envío a destino — ${data.clienteNombre}`
    });

    await prepararMovimientoCajaDeRemesa(batch, remesaId, 'comision_destino', {
        debeExistir: activa && montoComision > 0 && !!data.monedaRecibido,
        tipo: 'salida',
        moneda: data.monedaRecibido,
        monto: montoComision,
        concepto: `Comisión bancaria (${data.comisionDestino}%) — ${data.clienteNombre}`
    });

    // Un solo commit: si algo falla acá, NINGÚN movimiento quedó a medias
    // (a diferencia de antes, donde cada movimiento se confirmaba por su cuenta).
    await batch.commit();
}

// Agrega al batch la operación (set/update/delete) necesaria para un
// movimiento de caja de una remesa, sin confirmar nada todavía — el
// commit() lo hace sincronizarCajaDeRemesa() una sola vez por remesa.
async function prepararMovimientoCajaDeRemesa(batch, remesaId, rol, { debeExistir, tipo, moneda, monto, concepto }) {
    const existentes = await cajaColeccion
        .where('remesaId', '==', remesaId)
        .where('rol', '==', rol)
        .limit(1)
        .get();

    if (!debeExistir) {
        if (!existentes.empty) {
            existentes.docs.forEach(doc => batch.delete(doc.ref));
        }
        return;
    }

    const payload = {
        tipo,
        moneda,
        monto,
        concepto,
        origen: 'remesa',
        remesaId,
        rol,
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (existentes.empty) {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const nuevaRef = cajaColeccion.doc();
        batch.set(nuevaRef, payload);
    } else {
        batch.update(existentes.docs[0].ref, payload);
    }
}

export async function eliminarMovimientosCajaDeRemesa(remesaId) {
    const existentes = await cajaColeccion.where('remesaId', '==', remesaId).get();
    if (existentes.empty) return;
    await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
}

// --- Formulario de movimiento manual ---
const cajaForm = document.getElementById('cajaForm');
const cajaSubmitBtn = document.getElementById('cajaSubmitBtn');
const cajaMessage = document.getElementById('cajaMessage');

window.eliminarMovimientoCaja = async (docId) => {
    if (!confirm('¿Eliminar este movimiento de caja? Esta acción no se puede deshacer.')) return;
    try {
        await cajaColeccion.doc(docId).delete();
    } catch (error) {
        console.error('Error al eliminar movimiento de caja:', error);
        alert('No se pudo eliminar el movimiento. Intenta de nuevo.');
    }
};

// --- Listado + saldos por moneda, en tiempo real ---
const cajaBody = document.getElementById('cajaBody');
const cajaEmpty = document.getElementById('cajaEmpty');
const cajaEmptyText = document.getElementById('cajaEmptyText');
const cajaTableWrap = document.getElementById('cajaTableWrap');
const cajaSaldosGrid = document.getElementById('cajaSaldosGrid');
const cajaSaldosEmpty = document.getElementById('cajaSaldosEmpty');
const cajaFiltroDesde = document.getElementById('cajaFiltroDesde');
const cajaFiltroHasta = document.getElementById('cajaFiltroHasta');
const cajaFiltroTipo = document.getElementById('cajaFiltroTipo');
const cajaFiltroMoneda = document.getElementById('cajaFiltroMoneda');
const cajaFiltroOrigen = document.getElementById('cajaFiltroOrigen');
const cajaFiltroBuscar = document.getElementById('cajaFiltroBuscar');
const cajaFiltroLimpiar = document.getElementById('cajaFiltroLimpiar');
// Guarda el listado completo de movimientos de caja (tal como llega de
// Firestore) para poder re-filtrar en el cliente sin volver a consultar.
let cajaMovsCache = [];
// Subconjunto actualmente visible según los filtros de Caja, usado para exportar.
let cajaFiltrado = [];

export function origenBadgeHTML(mov) {
    if (mov.origen === 'remesa') return '<span class="badge badge-neutral">Remesa automática</span>';
    if (mov.origen === 'compra_usdt') return '<span class="badge badge-neutral">Compra USDT</span>';
    if (mov.origen === 'venta_usdt') return '<span class="badge badge-neutral">Venta USDT</span>';
    return '<span class="badge badge-pending">Manual</span>';
}

export function tipoBadgeHTML(tipo) {
    return tipo === 'entrada'
        ? '<span class="badge badge-success">Entrada</span>'
        : '<span class="badge badge-danger">Salida</span>';
}

// Variantes en texto plano de los badges de arriba, para exportar a PDF/Excel.
export function origenTexto(mov) {
    if (mov.origen === 'remesa') return 'Remesa automática';
    if (mov.origen === 'compra_usdt') return 'Compra USDT';
    if (mov.origen === 'venta_usdt') return 'Venta USDT';
    return 'Manual';
}

export function tipoTexto(tipo) {
    return tipo === 'entrada' ? 'Entrada' : 'Salida';
}

function renderCajaRow(id, mov) {
    const tr = document.createElement('tr');
    const signo = mov.tipo === 'entrada' ? '+' : '−';
    tr.innerHTML = `
        <td>${formatDate(mov.createdAt)}</td>
        <td>${tipoBadgeHTML(mov.tipo)}</td>
        <td>${escapeHtml(mov.moneda)}</td>
        <td class="mono-cell">${signo} ${formatMoney(mov.monto, '')}</td>
        <td>${escapeHtml(mov.concepto) || '—'}</td>
        <td>${origenBadgeHTML(mov)}</td>
        <td>
            ${mov.origen === 'remesa'
                ? '<span class="input-hint">Se edita desde la remesa</span>'
                : `<button type="button" class="btn-icon-action danger" onclick="eliminarMovimientoCaja('${id}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>`}
        </td>
    `;
    return tr;
}

// Calcula el saldo "real" por moneda: si hay una caja abierta hoy, es el
// mismo cálculo que "Saldo esperado ahora" en el Cierre de caja diario
// (saldo inicial de ESA apertura + entradas/salidas SOLO desde que se abrió).
// Si no hay caja abierta, se muestra el acumulado histórico de todos los
// movimientos (con aviso), porque no hay una apertura vigente que sirva de base.
export function calcularSaldosActuales(movimientos) {
    if (cierreAbiertoActual) {
        const { data } = cierreAbiertoActual;
        const abiertoEnFecha = data.abiertoEn && data.abiertoEn.toDate ? data.abiertoEn.toDate() : null;
        const abiertoEnMs = abiertoEnFecha ? abiertoEnFecha.getTime() : 0;
        const movsDesdeApertura = movimientos.filter(m => {
            const t = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().getTime() : 0;
            return t >= abiertoEnMs;
        });

        const monedas = new Set(Object.keys(data.saldosIniciales || {}));
        movsDesdeApertura.forEach(m => { if (m.moneda) monedas.add(m.moneda); });

        const saldosPorMoneda = {};
        monedas.forEach(moneda => {
            const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
            const entradas = movsDesdeApertura
                .filter(m => m.moneda === moneda && m.tipo === 'entrada')
                .reduce((s, m) => s + (m.monto || 0), 0);
            const salidas = movsDesdeApertura
                .filter(m => m.moneda === moneda && m.tipo === 'salida')
                .reduce((s, m) => s + (m.monto || 0), 0);
            saldosPorMoneda[moneda] = inicial + entradas - salidas;
        });
        return { saldosPorMoneda, cajaAbierta: true };
    }

    // Sin caja abierta: se usa lo último que contaste al cerrar la caja
    // anterior (dato real), en vez de sumar todo el historial (que no
    // significa nada útil sin una apertura de referencia).
    if (ultimoCierreCerrado && ultimoCierreCerrado.data.saldosContados) {
        return { saldosPorMoneda: { ...ultimoCierreCerrado.data.saldosContados }, cajaAbierta: false, esUltimoContado: true };
    }

    // Si tampoco hay ningún cierre cerrado todavía, se cae al acumulado
    // histórico total como último recurso (con aviso).
    const saldosPorMoneda = {};
    movimientos.forEach(mov => {
        const moneda = mov.moneda || '?';
        const signo = mov.tipo === 'entrada' ? 1 : -1;
        saldosPorMoneda[moneda] = (saldosPorMoneda[moneda] || 0) + signo * (mov.monto || 0);
    });
    return { saldosPorMoneda, cajaAbierta: false, esUltimoContado: false };
}

function renderCajaSaldos(movimientos) {
    const { saldosPorMoneda, cajaAbierta, esUltimoContado } = calcularSaldosActuales(movimientos);
    const monedas = Object.keys(saldosPorMoneda).sort();
    cajaSaldosGrid.innerHTML = '';

    if (monedas.length === 0) {
        cajaSaldosGrid.style.display = 'none';
        cajaSaldosEmpty.style.display = 'block';
        return;
    }
    cajaSaldosGrid.style.display = 'grid';
    cajaSaldosEmpty.style.display = 'none';

    let avisoHTML = '';
    if (!cajaAbierta) {
        avisoHTML = esUltimoContado
            ? '<span class="cell-subtext"><i class="ti ti-clipboard" aria-hidden="true"></i> Sin caja abierta — esto es lo último que contaste al cerrar. Abre caja para ver el saldo en vivo.</span>'
            : '<span class="cell-subtext"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Sin caja abierta ni cierres previos — esto es el acumulado histórico total, no el saldo real</span>';
    }

    monedas.forEach(moneda => {
        const saldo = saldosPorMoneda[moneda];
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <span class="stat-label">Saldo en caja · ${escapeHtml(moneda)}</span>
            <span class="stat-value ${saldo < 0 ? 'stat-value-negative' : ''}">${formatMoney(saldo, moneda)}</span>
            ${equivalenteClpHTML(moneda, saldo)}
            ${avisoHTML}
        `;
        cajaSaldosGrid.appendChild(card);
    });
}

// Muestra "≈ X CLP" debajo del saldo de una moneda distinta a CLP, usando la
// tasa vigente guardada en Configuración para ese par (la misma que se
// autocompleta en Nueva Remesa) — para que sepas cuánto vale tu saldo sin
// tener que ir a calcularlo aparte.
function equivalenteClpHTML(moneda, saldo) {
    if (moneda === 'CLP') return '';
    const tasa = tasasCache[claveTasa('CLP', moneda)];
    if (!tasa || tasa <= 0) return '';
    const equivalente = saldo / tasa;
    return `<span class="cell-subtext">≈ ${formatMoney(equivalente, 'CLP')} (tasa vigente: 1 CLP = ${tasa} ${escapeHtml(moneda)})</span>`;
}

const VENTANA_CAJA_MESES = 3; // ventana por defecto para la bitácora de caja (el saldo real no depende de esto)
let verTodoHistorialCaja = false;
let unsubscribeMovimientosCaja = null;

function actualizarAvisoRangoCaja() {
    const aviso = document.getElementById('cajaRangoAvisoTexto');
    const checkbox = document.getElementById('cajaVerTodoCheckbox');
    if (checkbox) checkbox.checked = verTodoHistorialCaja;
    if (aviso) {
        aviso.innerHTML = verTodoHistorialCaja
            ? '<i class="ti ti-clock-hour-4" aria-hidden="true"></i> Mostrando todo el historial de movimientos.'
            : `<i class="ti ti-clock-hour-4" aria-hidden="true"></i> Mostrando los últimos ${VENTANA_CAJA_MESES} meses de movimientos (el saldo actual siempre es exacto).`;
    }
}

function suscribirMovimientosCaja() {
    if (unsubscribeMovimientosCaja) unsubscribeMovimientosCaja();
    actualizarAvisoRangoCaja();

    let query = cajaColeccion.orderBy('createdAt', 'desc');
    if (!verTodoHistorialCaja) {
        query = cajaColeccion
            .where('createdAt', '>=', fechaLimiteVentana(VENTANA_CAJA_MESES))
            .orderBy('createdAt', 'desc');
    }

    unsubscribeMovimientosCaja = query.onSnapshot(snapshot => {
    const movimientos = [];
    snapshot.forEach(doc => movimientos.push({ id: doc.id, ...doc.data() }));
    renderCajaSaldos(movimientos);
    renderBilletera(movimientos);

    movimientosCajaActuales = movimientos;
    actualizarVistaCierre();
    actualizarDashboardEjecutivo();

    cajaMovsCache = movimientos.map(mov => ({ id: mov.id, mov }));
    const monedasCaja = [...new Set(movimientos.map(m => m.moneda).filter(Boolean))].sort();
    poblarSelectMonedasCaja(monedasCaja);
    aplicarFiltroCaja();
}, error => {
    console.error('Error al escuchar movimientos de caja:', error);
});
}

const cajaVerTodoCheckbox = document.getElementById('cajaVerTodoCheckbox');

// Repuebla el <select> de moneda con las monedas que realmente aparecen en
// los movimientos de caja, conservando la selección actual si sigue existiendo.
function poblarSelectMonedasCaja(monedas) {
    const valorActual = cajaFiltroMoneda.value;
    cajaFiltroMoneda.innerHTML = '<option value="todos">Todas</option>' +
        monedas.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    cajaFiltroMoneda.value = monedas.includes(valorActual) ? valorActual : 'todos';
}

// Lee un input type="date" (yyyy-mm-dd) como fecha local, evitando el
// desfase de timezone que da `new Date('yyyy-mm-dd')` (que lo interpreta en UTC).
function leerFechaLocal(valor) {
    if (!valor) return null;
    const [y, m, d] = valor.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Aplica los filtros de fecha, tipo, moneda, origen y búsqueda por concepto
// sobre cajaMovsCache, y vuelve a pintar la tabla de Movimientos de caja.
function aplicarFiltroCaja() {
    const desde = leerFechaLocal(cajaFiltroDesde.value);
    let hasta = leerFechaLocal(cajaFiltroHasta.value);
    if (hasta) hasta.setDate(hasta.getDate() + 1); // incluye todo el día "hasta"
    const tipoFiltro = cajaFiltroTipo.value;
    const monedaFiltro = cajaFiltroMoneda.value;
    const origenFiltro = cajaFiltroOrigen.value;
    const textoBusqueda = cajaFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desde || !!hasta || tipoFiltro !== 'todos' || monedaFiltro !== 'todos' || origenFiltro !== 'todos' || textoBusqueda !== '';

    const filtrados = cajaMovsCache.filter(({ mov }) => {
        if (desde || hasta) {
            const fecha = mov.createdAt && mov.createdAt.toDate ? mov.createdAt.toDate() : null;
            if (!fecha) return false;
            if (desde && fecha < desde) return false;
            if (hasta && fecha >= hasta) return false;
        }
        if (tipoFiltro !== 'todos' && mov.tipo !== tipoFiltro) return false;
        if (monedaFiltro !== 'todos' && mov.moneda !== monedaFiltro) return false;
        if (origenFiltro !== 'todos' && (mov.origen || 'manual') !== origenFiltro) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('caja', [
        {
            label: 'Rango de fechas', activo: !!cajaFiltroDesde.value || !!cajaFiltroHasta.value,
            texto: `Fecha: ${cajaFiltroDesde.value || '…'} – ${cajaFiltroHasta.value || '…'}`,
            onQuitar: () => { cajaFiltroDesde.value = ''; cajaFiltroHasta.value = ''; aplicarFiltroCaja(); }
        },
        {
            label: 'Tipo', activo: tipoFiltro !== 'todos',
            texto: cajaFiltroTipo.options[cajaFiltroTipo.selectedIndex].text,
            onQuitar: () => { cajaFiltroTipo.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Moneda', activo: monedaFiltro !== 'todos',
            texto: `Moneda: ${monedaFiltro}`,
            onQuitar: () => { cajaFiltroMoneda.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Origen', activo: origenFiltro !== 'todos',
            texto: cajaFiltroOrigen.options[cajaFiltroOrigen.selectedIndex].text,
            onQuitar: () => { cajaFiltroOrigen.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${cajaFiltroBuscar.value.trim()}"`,
            onQuitar: () => { cajaFiltroBuscar.value = ''; aplicarFiltroCaja(); }
        }
    ], { mostrados: filtrados.length, total: cajaMovsCache.length });

    cajaFiltrado = filtrados;
    cajaBody.innerHTML = '';
    if (filtrados.length === 0) {
        cajaEmpty.style.display = 'block';
        cajaTableWrap.style.display = 'none';
        cajaEmptyText.textContent = hayFiltrosActivos
            ? 'No hay movimientos que coincidan con el filtro.'
            : 'Todavía no hay movimientos registrados.';
        return;
    }
    cajaEmpty.style.display = 'none';
    cajaTableWrap.style.display = 'block';
    filtrados.forEach(({ id, mov }) => {
        cajaBody.appendChild(renderCajaRow(id, mov));
    });
}

// ============================================
// EXPORTAR CAJA (Movimientos) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const cajaExportarPdfBtn = document.getElementById('cajaExportarPdfBtn');
const cajaExportarExcelBtn = document.getElementById('cajaExportarExcelBtn');

function filasExportCaja() {
    return cajaFiltrado.map(({ mov }) => ({
        Fecha: formatDate(mov.createdAt),
        Tipo: tipoTexto(mov.tipo),
        Moneda: mov.moneda || '—',
        Monto: moneyTexto(mov.monto, ''),
        Concepto: mov.concepto || '—',
        Origen: origenTexto(mov)
    }));
}

// ============================================
// CIERRE DE CAJA DIARIO — apertura, resumen en vivo y cierre
// ============================================
const cierresColeccion = db.collection('cierresCaja');
export let movimientosCajaActuales = [];
export let cierreAbiertoActual = null; // { id, data } | null
let ultimoCierreCerrado = null; // { id, data } | null — el cierre cerrado más reciente
let resumenPorMoneda = {}; // saldo esperado por moneda de la caja abierta, recalculado en cada render

const cierreCerradoView = document.getElementById('cierreCerradoView');
const cierreAbiertoView = document.getElementById('cierreAbiertoView');
const cierreEstadoBadge = document.getElementById('cierreEstadoBadge');
const cierreAbiertoInfo = document.getElementById('cierreAbiertoInfo');
const cierreResumenBody = document.getElementById('cierreResumenBody');
const cierreFormWrap = document.getElementById('cierreFormWrap');
const cierreFormBody = document.getElementById('cierreFormBody');
const cierreNotasInput = document.getElementById('cierreNotas');
const cierreMessage = document.getElementById('cierreMessage');
const cierreSubmitBtn = document.getElementById('cierreSubmitBtn');
const abrirCierreFormBtn = document.getElementById('abrirCierreFormBtn');
const cierreCancelBtn = document.getElementById('cierreCancelBtn');
const cierresHistorialBody = document.getElementById('cierresHistorialBody');
const cierresHistorialEmpty = document.getElementById('cierresHistorialEmpty');
const cierresHistorialWrap = document.getElementById('cierresHistorialWrap');
const cierreUltimoArqueoBox = document.getElementById('cierreUltimoArqueoBox');
const cierreUltimoArqueoPdfBtn = document.getElementById('cierreUltimoArqueoPdfBtn');
const cierreUltimoArqueoExcelBtn = document.getElementById('cierreUltimoArqueoExcelBtn');
const cierreUltimoArqueoCerrarBtn = document.getElementById('cierreUltimoArqueoCerrarBtn');
let ultimoArqueoCerradoId = null; // id del cierre que se acaba de cerrar, para el botón de descarga rápida

function ocultarUltimoArqueoBox() {
    ultimoArqueoCerradoId = null;
    cierreUltimoArqueoBox.classList.add('hidden');
}

function mostrarUltimoArqueoBox(id) {
    ultimoArqueoCerradoId = id;
    cierreUltimoArqueoBox.classList.remove('hidden');
}

// --- Apertura: filas dinámicas de moneda + saldo inicial ---
const aperturaFilas = document.getElementById('aperturaFilas');
const aperturaAgregarFilaBtn = document.getElementById('aperturaAgregarFilaBtn');
const aperturaSubmitBtn = document.getElementById('aperturaSubmitBtn');
const aperturaMessage = document.getElementById('aperturaMessage');
const aperturaUsarUltimoCierreWrap = document.getElementById('aperturaUsarUltimoCierreWrap');
const aperturaUsarUltimoCierreBtn = document.getElementById('aperturaUsarUltimoCierreBtn');

function agregarFilaApertura() {
    const fila = document.createElement('div');
    fila.className = 'apertura-fila';
    fila.innerHTML = `
        <input type="text" class="apertura-moneda" placeholder="Moneda (ej. CLP)" maxlength="6">
        <input type="number" class="apertura-monto" placeholder="Saldo inicial" min="0" step="0.01">
        <input type="text" class="apertura-concepto" placeholder="Concepto (ej. BancoEstado, Banco de Chile)">
        <button type="button" class="btn-icon-action danger"><i class="ti ti-x" aria-hidden="true"></i></button>
    `;
    fila.querySelector('button').addEventListener('click', () => {
        if (aperturaFilas.children.length > 1) fila.remove();
    });
    aperturaFilas.appendChild(fila);
}

// Precarga el formulario de apertura con los saldos CONTADOS del último
// cierre (uno por cada moneda/banco), para no tener que volver a tipearlos
// cuando se abre la caja del día siguiente con lo mismo con lo que se cerró.
function usarSaldosUltimoCierre() {
    if (!ultimoCierreCerrado) return;
    const { data } = ultimoCierreCerrado;
    const saldosContados = data.saldosContados || {};
    const monedas = Object.keys(saldosContados);
    if (monedas.length === 0) return;

    aperturaFilas.innerHTML = '';
    monedas.sort().forEach(moneda => {
        const detalle = (data.saldosContadosDetalle && data.saldosContadosDetalle[moneda]) || [];
        const filasBanco = detalle.length > 0 ? detalle : [{ banco: '', monto: saldosContados[moneda] }];
        filasBanco.forEach(b => {
            agregarFilaApertura();
            const fila = aperturaFilas.lastElementChild;
            fila.querySelector('.apertura-moneda').value = moneda;
            fila.querySelector('.apertura-monto').value = b.monto;
            fila.querySelector('.apertura-concepto').value = (b.banco && b.banco !== 'Efectivo / Sin banco') ? b.banco : '';
        });
    });

    aperturaMessage.textContent = 'Datos cargados desde el último cierre. Revisa los montos antes de confirmar la apertura.';
    aperturaMessage.className = 'form-message form-message-success';
}

// --- Vista de caja abierta: resumen en vivo (inicial + movimientos desde la apertura) ---
function actualizarVistaCierre() {
    if (!cierreAbiertoActual) {
        cierreCerradoView.classList.remove('hidden');
        cierreAbiertoView.classList.add('hidden');
        cierreFormWrap.classList.add('hidden');
        cierreEstadoBadge.textContent = 'Sin abrir';
        cierreEstadoBadge.className = 'badge badge-neutral';
        if (aperturaUsarUltimoCierreWrap) {
            const hayDatosPrevios = !!(ultimoCierreCerrado && ultimoCierreCerrado.data.saldosContados
                && Object.keys(ultimoCierreCerrado.data.saldosContados).length > 0);
            aperturaUsarUltimoCierreWrap.classList.toggle('hidden', !hayDatosPrevios);
        }
        return;
    }

    cierreCerradoView.classList.add('hidden');
    cierreAbiertoView.classList.remove('hidden');
    cierreEstadoBadge.textContent = 'Abierta';
    cierreEstadoBadge.className = 'badge badge-success';

    const { data } = cierreAbiertoActual;
    const abiertoEnFecha = data.abiertoEn && data.abiertoEn.toDate ? data.abiertoEn.toDate() : null;
    cierreAbiertoInfo.textContent = abiertoEnFecha
        ? `Abierta el ${abiertoEnFecha.toLocaleString('es-CL')} por ${data.abiertoPorEmail || '—'}.`
        : `Abierta por ${data.abiertoPorEmail || '—'}.`;

    const abiertoEnMs = abiertoEnFecha ? abiertoEnFecha.getTime() : 0;
    const movsDesdeApertura = movimientosCajaActuales.filter(m => {
        const t = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().getTime() : 0;
        return t >= abiertoEnMs;
    });

    const monedas = new Set(Object.keys(data.saldosIniciales || {}));
    movsDesdeApertura.forEach(m => { if (m.moneda) monedas.add(m.moneda); });

    resumenPorMoneda = {};
    cierreResumenBody.innerHTML = '';
    cierreFormBody.innerHTML = '';

    [...monedas].sort().forEach(moneda => {
        const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
        const entradas = movsDesdeApertura
            .filter(m => m.moneda === moneda && m.tipo === 'entrada')
            .reduce((s, m) => s + (m.monto || 0), 0);
        const salidas = movsDesdeApertura
            .filter(m => m.moneda === moneda && m.tipo === 'salida')
            .reduce((s, m) => s + (m.monto || 0), 0);
        const esperado = inicial + entradas - salidas;
        resumenPorMoneda[moneda] = esperado;

        const bancosIniciales = (data.saldosInicialesDetalle && data.saldosInicialesDetalle[moneda]) || [];
        const conceptoInicial = (data.conceptosIniciales && data.conceptosIniciales[moneda]) || '';
        const subtextBancos = bancosIniciales.length > 0
            ? bancosIniciales.map(b => `<div class="cell-subtext">${escapeHtml(b.banco)}: ${formatMoney(b.monto, '')}</div>`).join('')
            : (conceptoInicial ? `<div class="cell-subtext">${escapeHtml(conceptoInicial)}</div>` : '');

        const trResumen = document.createElement('tr');
        trResumen.innerHTML = `
            <td>${escapeHtml(moneda)}${subtextBancos}</td>
            <td class="mono-cell">${formatMoney(inicial, '')}</td>
            <td class="mono-cell">${formatMoney(entradas, '')}</td>
            <td class="mono-cell">${formatMoney(salidas, '')}</td>
            <td class="mono-cell">${formatMoney(esperado, '')}</td>
        `;
        cierreResumenBody.appendChild(trResumen);

        // --- Grupo de conteo para esta moneda, con una fila editable por banco/cuenta ---
        const grupo = document.createElement('div');
        grupo.className = 'cierre-moneda-grupo';
        grupo.dataset.moneda = moneda;
        grupo.innerHTML = `
            <div class="cierre-moneda-header">
                <strong>${escapeHtml(moneda)}</strong>
                <span class="cell-subtext">Esperado: ${formatMoney(esperado, '')}</span>
            </div>
            <div class="cierre-bancos-filas" data-bancos-moneda="${escapeHtml(moneda)}"></div>
            <button type="button" class="btn-secondary btn-form-sm btn-agregar-banco-cierre" data-moneda="${escapeHtml(moneda)}">+ Agregar banco/cuenta</button>
            <div class="cierre-moneda-total">
                <span>Total contado: <span class="mono-cell" data-moneda-total="${escapeHtml(moneda)}">${formatMoney(0, '')}</span></span>
                <span class="mono-cell" data-moneda-diff="${escapeHtml(moneda)}">—</span>
            </div>
        `;
        cierreFormBody.appendChild(grupo);

        const bancosContainer = grupo.querySelector('.cierre-bancos-filas');
        if (bancosIniciales.length > 0) {
            bancosIniciales.forEach(b => agregarFilaBancoCierre(bancosContainer, moneda, b.banco));
        } else {
            agregarFilaBancoCierre(bancosContainer, moneda, conceptoInicial || '');
        }
    });
}

// Crea una fila editable (banco/cuenta + monto contado + botón eliminar) dentro
// del grupo de una moneda en el formulario de cierre, y la deja lista para
// recalcular el total/diferencia de esa moneda cada vez que cambia.
function agregarFilaBancoCierre(container, moneda, bancoNombre) {
    const fila = document.createElement('div');
    fila.className = 'cierre-banco-fila';
    fila.innerHTML = `
        <input type="text" class="cierre-banco-nombre-input" placeholder="Banco/cuenta (ej. BancoEstado)" value="${escapeHtml(bancoNombre || '')}">
        <input type="number" step="0.01" min="0" class="cierre-contado-input" data-moneda="${escapeHtml(moneda)}" placeholder="0">
        <button type="button" class="btn-icon-action danger" aria-label="Quitar banco"><i class="ti ti-x" aria-hidden="true"></i></button>
    `;
    fila.querySelector('.cierre-contado-input').addEventListener('input', () => recalcularTotalContadoMoneda(moneda));
    fila.querySelector('button').addEventListener('click', () => {
        if (container.children.length > 1) {
            fila.remove();
            recalcularTotalContadoMoneda(moneda);
        }
    });
    container.appendChild(fila);
}

// Suma los montos contados de todas las filas de banco de una moneda, y
// actualiza el total y la diferencia contra el saldo esperado de esa moneda.
function recalcularTotalContadoMoneda(moneda) {
    const grupo = cierreFormBody.querySelector(`.cierre-moneda-grupo[data-moneda="${moneda}"]`);
    if (!grupo) return;
    const inputs = grupo.querySelectorAll('.cierre-contado-input');
    let total = 0;
    let algunaValida = false;
    inputs.forEach(input => {
        const valor = parseFloat(input.value);
        if (!isNaN(valor)) { total += valor; algunaValida = true; }
    });

    const totalEl = grupo.querySelector(`[data-moneda-total="${moneda}"]`);
    const diffEl = grupo.querySelector(`[data-moneda-diff="${moneda}"]`);
    totalEl.textContent = formatMoney(total, '');

    if (!algunaValida) {
        diffEl.textContent = '—';
        diffEl.className = 'mono-cell';
        return;
    }
    const diferencia = total - (resumenPorMoneda[moneda] || 0);
    diffEl.textContent = formatMoney(diferencia, '');
    diffEl.className = 'mono-cell ' + (diferencia === 0 ? '' : (diferencia > 0 ? 'rep-ganancia-positiva' : 'rep-ganancia-negativa'));
}

// --- Historial de cierres cerrados ---
// Guarda los datos completos de cada cierre cerrado (por id) para poder
// armar el arqueo en PDF/Excel sin volver a consultar Firestore.
let cierresCerradosCache = {};

// Arma la lista de monedas (con su desglose por banco, si existe) de un
// cierre, para reutilizar tanto en el render de la tabla como en las
// exportaciones PDF/Excel.
function detalleMonedasCierre(data) {
    const monedas = new Set([
        ...Object.keys(data.saldosIniciales || {}),
        ...Object.keys(data.saldosContados || {})
    ]);
    return [...monedas].sort().map(moneda => {
        const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
        const esperado = (data.saldosEsperados && data.saldosEsperados[moneda]) || 0;
        const contado = (data.saldosContados && data.saldosContados[moneda]) || 0;
        const diferencia = (data.diferencias && data.diferencias[moneda]) || 0;
        const bancosIniciales = (data.saldosInicialesDetalle && data.saldosInicialesDetalle[moneda]) || [];
        const bancosContados = (data.saldosContadosDetalle && data.saldosContadosDetalle[moneda]) || [];
        return { moneda, inicial, esperado, contado, diferencia, bancosIniciales, bancosContados };
    });
}

function renderHistorialCierres(cerrados) {
    cierresHistorialBody.innerHTML = '';
    cierresCerradosCache = {};
    cerrados.forEach(({ id, data }) => { cierresCerradosCache[id] = data; });

    cerrados.forEach(({ id, data }) => {
        const monedas = detalleMonedasCierre(data);

        const detalleHTML = monedas.map(m => {
            const claseDiff = m.diferencia === 0 ? '' : (m.diferencia > 0 ? 'rep-ganancia-positiva' : 'rep-ganancia-negativa');
            const bancosHTML = m.bancosContados.length > 0
                ? m.bancosContados.map(b => `<div class="historial-cierre-bancos">${escapeHtml(b.banco)}: ${formatMoney(b.monto, '')}</div>`).join('')
                : '';
            return `
                <div class="historial-cierre-moneda-linea">
                    <strong>${escapeHtml(m.moneda)}</strong>
                    — Inicial: ${formatMoney(m.inicial, '')}
                    · Esperado: ${formatMoney(m.esperado, '')}
                    · Contado: ${formatMoney(m.contado, '')}
                    · Dif.: <span class="${claseDiff}">${formatMoney(m.diferencia, '')}</span>
                    ${bancosHTML}
                </div>
            `;
        }).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(data.cerradoEn || data.abiertoEn)}</td>
            <td><div class="historial-cierre-detalle">${detalleHTML}</div></td>
            <td>${escapeHtml(data.cerradoPorEmail) || '—'}</td>
            <td>
                <div class="historial-cierre-acciones">
                    <button type="button" class="btn-icon-action" onclick="descargarArqueoPDF('${id}')"><i class="ti ti-file-text" aria-hidden="true"></i> PDF</button>
                    <button type="button" class="btn-icon-action" onclick="descargarArqueoExcel('${id}')"><i class="ti ti-table" aria-hidden="true"></i> Excel</button>
                </div>
            </td>
        `;
        cierresHistorialBody.appendChild(tr);
    });

    if (cerrados.length === 0) {
        cierresHistorialEmpty.style.display = 'block';
        cierresHistorialWrap.style.display = 'none';
    } else {
        cierresHistorialEmpty.style.display = 'none';
        cierresHistorialWrap.style.display = 'block';
    }
}

// ============================================
// ARQUEO DE CAJA — PDF (jsPDF) y Excel (SheetJS)
// Genera el documento de un cierre puntual, con desglose por banco/cuenta.
// ============================================
function construirArqueoPDF(doc, data, startY) {
    const monedas = detalleMonedasCierre(data);
    let y = startY;

    doc.setFontSize(10);
    doc.setTextColor(60);
    const abiertoEnFecha = data.abiertoEn && data.abiertoEn.toDate ? data.abiertoEn.toDate() : null;
    const cerradoEnFecha = data.cerradoEn && data.cerradoEn.toDate ? data.cerradoEn.toDate() : null;
    doc.text(`Abierto: ${abiertoEnFecha ? abiertoEnFecha.toLocaleString('es-CL') : '—'} por ${data.abiertoPorEmail || '—'}`, 14, y);
    y += 5;
    doc.text(`Cerrado: ${cerradoEnFecha ? cerradoEnFecha.toLocaleString('es-CL') : '—'} por ${data.cerradoPorEmail || '—'}`, 14, y);
    y += 7;

    monedas.forEach(m => {
        doc.setFontSize(11);
        doc.setTextColor(30);
        doc.text(`Moneda: ${m.moneda}`, 14, y);
        y += 2;
        const filasBanco = m.bancosContados.length > 0
            ? m.bancosContados.map(b => [b.banco, formatMoney(b.monto, '')])
            : [['—', formatMoney(m.contado, '')]];

        doc.autoTable({
            startY: y + 3,
            head: [['Inicial', 'Esperado', 'Contado', 'Diferencia']],
            body: [[formatMoney(m.inicial, ''), formatMoney(m.esperado, ''), formatMoney(m.contado, ''), formatMoney(m.diferencia, '')]],
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            margin: { left: 14 }
        });
        y = doc.lastAutoTable.finalY + 3;

        doc.autoTable({
            startY: y,
            head: [['Banco / cuenta', 'Contado']],
            body: filasBanco,
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [90, 100, 115] },
            margin: { left: 14, right: 120 }
        });
        y = doc.lastAutoTable.finalY + 8;
    });

    if (data.notas) {
        doc.setFontSize(9);
        doc.setTextColor(90);
        doc.text(`Notas: ${data.notas}`, 14, y);
        y += 8;
    }
    return y;
}

window.descargarArqueoPDF = (cierreId) => {
    const data = cierresCerradosCache[cierreId];
    if (!data) { alert('No se encontró el cierre para exportar.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text('Arqueo de caja', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Fecha del cierre: ${formatDate(data.cerradoEn || data.abiertoEn)}`, 14, 21);
    construirArqueoPDF(doc, data, 30);
    doc.save(`arqueo-caja-${data.fecha || fechaArchivo()}.pdf`);
};

window.descargarArqueoExcel = (cierreId) => {
    const data = cierresCerradosCache[cierreId];
    if (!data) { alert('No se encontró el cierre para exportar.'); return; }
    const monedas = detalleMonedasCierre(data);
    const filas = [];
    monedas.forEach(m => {
        const bancos = m.bancosContados.length > 0 ? m.bancosContados : [{ banco: '—', monto: m.contado }];
        bancos.forEach((b, i) => {
            filas.push({
                Moneda: i === 0 ? m.moneda : '',
                Inicial: i === 0 ? moneyTexto(m.inicial, '') : '',
                Esperado: i === 0 ? moneyTexto(m.esperado, '') : '',
                'Total contado': i === 0 ? moneyTexto(m.contado, '') : '',
                Diferencia: i === 0 ? moneyTexto(m.diferencia, '') : '',
                'Banco / cuenta': b.banco,
                'Contado (banco)': moneyTexto(b.monto, '')
            });
        });
    });
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 16 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Arqueo');
    XLSX.writeFile(libro, `arqueo-caja-${data.fecha || fechaArchivo()}.xlsx`);
};

// --- Exportar TODO el historial de cierres (todos los días) ---
const cierresExportarPdfBtn = document.getElementById('cierresExportarPdfBtn');
const cierresExportarExcelBtn = document.getElementById('cierresExportarExcelBtn');

// Inicializa el formulario de movimiento manual, los filtros y exportación
// de Caja, el flujo de apertura/cierre de caja diaria y la escucha en
// tiempo real de movimientosCaja y cierresCaja. Se llama una sola vez desde
// app.js al arrancar.
export function initCaja() {
    cajaForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tipo = document.getElementById('cajaTipo').value;
        const moneda = document.getElementById('cajaMoneda').value.trim().toUpperCase();
        const monto = parseFloat(document.getElementById('cajaMonto').value);
        const concepto = document.getElementById('cajaConcepto').value.trim();

        cajaSubmitBtn.disabled = true;
        cajaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
        cajaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        cajaMessage.textContent = '';
        cajaMessage.className = 'form-message';

        try {
            await cajaColeccion.add({
                tipo,
                moneda,
                monto,
                concepto,
                origen: 'manual',
                remesaId: null,
                clienteNombre: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                creadoPorEmail: auth.currentUser ? auth.currentUser.email : null
            });

            cajaForm.reset();
            document.getElementById('cajaTipo').value = 'entrada';
            cajaMessage.textContent = 'Movimiento registrado correctamente.';
            cajaMessage.className = 'form-message form-message-success';
        } catch (error) {
            console.error('Error al registrar movimiento de caja:', error);
            cajaMessage.textContent = 'No se pudo registrar el movimiento. Intenta de nuevo.';
            cajaMessage.className = 'form-message form-message-error';
        } finally {
            cajaSubmitBtn.disabled = false;
            cajaSubmitBtn.querySelector('.btn-text').textContent = 'Registrar movimiento';
            cajaSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    suscribirMovimientosCaja();

    if (cajaVerTodoCheckbox) {
        cajaVerTodoCheckbox.addEventListener('change', () => {
            verTodoHistorialCaja = cajaVerTodoCheckbox.checked;
            suscribirMovimientosCaja();
        });
    }

    [cajaFiltroTipo, cajaFiltroMoneda, cajaFiltroOrigen].forEach(el => {
        el.addEventListener('change', aplicarFiltroCaja);
    });
    [cajaFiltroDesde, cajaFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroCaja);
    });
    cajaFiltroBuscar.addEventListener('input', aplicarFiltroCaja);
    cajaFiltroLimpiar.addEventListener('click', () => {
        cajaFiltroDesde.value = '';
        cajaFiltroHasta.value = '';
        cajaFiltroTipo.value = 'todos';
        cajaFiltroMoneda.value = 'todos';
        cajaFiltroOrigen.value = 'todos';
        cajaFiltroBuscar.value = '';
        aplicarFiltroCaja();
    });
    initFiltrosToggle('caja');
    initPanelCollapseToggle('cierresHistorialPanel', 'cierresHistorialCollapseToggle', false);

    cajaExportarPdfBtn.addEventListener('click', () => {
        if (cajaFiltrado.length === 0) {
            alert('No hay movimientos para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportCaja();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Caja — Movimientos', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} movimiento(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'Tipo', 'Moneda', 'Monto', 'Concepto', 'Origen']],
            body: filas.map(f => [f.Fecha, f.Tipo, f.Moneda, f.Monto, f.Concepto, f.Origen]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`caja-movimientos-${fechaArchivo()}.pdf`);
    });

    cajaExportarExcelBtn.addEventListener('click', () => {
        if (cajaFiltrado.length === 0) {
            alert('No hay movimientos para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportCaja();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 26 }, { wch: 18 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Caja');
        XLSX.writeFile(libro, `caja-movimientos-${fechaArchivo()}.xlsx`);
    });

    cierreUltimoArqueoPdfBtn.addEventListener('click', () => {
        if (ultimoArqueoCerradoId) window.descargarArqueoPDF(ultimoArqueoCerradoId);
    });
    cierreUltimoArqueoExcelBtn.addEventListener('click', () => {
        if (ultimoArqueoCerradoId) window.descargarArqueoExcel(ultimoArqueoCerradoId);
    });
    cierreUltimoArqueoCerrarBtn.addEventListener('click', ocultarUltimoArqueoBox);

    agregarFilaApertura();
    aperturaAgregarFilaBtn.addEventListener('click', agregarFilaApertura);

    if (aperturaUsarUltimoCierreBtn) {
        aperturaUsarUltimoCierreBtn.addEventListener('click', usarSaldosUltimoCierre);
    }

    aperturaSubmitBtn.addEventListener('click', async () => {
        const saldosIniciales = {};
        const conceptosIniciales = {};
        // Desglose por banco/cuenta dentro de cada moneda: cada fila del formulario
        // de apertura se guarda como una entrada separada (aunque comparta moneda
        // con otra fila), para poder contarlas por separado al cerrar la caja.
        const saldosInicialesDetalle = {};
        aperturaFilas.querySelectorAll('.apertura-fila').forEach(fila => {
            const moneda = fila.querySelector('.apertura-moneda').value.trim().toUpperCase();
            const monto = parseFloat(fila.querySelector('.apertura-monto').value);
            const concepto = fila.querySelector('.apertura-concepto').value.trim();
            if (moneda && !isNaN(monto) && monto >= 0) {
                // Si ya hay un monto cargado para esta moneda (dos filas con la misma
                // moneda), se SUMAN en vez de sobrescribirse.
                saldosIniciales[moneda] = (saldosIniciales[moneda] || 0) + monto;
                if (concepto) {
                    conceptosIniciales[moneda] = conceptosIniciales[moneda]
                        ? `${conceptosIniciales[moneda]}; ${concepto}`
                        : concepto;
                }
                if (!saldosInicialesDetalle[moneda]) saldosInicialesDetalle[moneda] = [];
                saldosInicialesDetalle[moneda].push({ banco: concepto || 'Efectivo / Sin banco', monto });
            }
        });

        if (Object.keys(saldosIniciales).length === 0) {
            aperturaMessage.textContent = 'Agrega al menos una moneda con su saldo inicial.';
            aperturaMessage.className = 'form-message form-message-error';
            return;
        }

        aperturaSubmitBtn.disabled = true;
        aperturaSubmitBtn.querySelector('.btn-text').textContent = 'Abriendo...';
        aperturaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        aperturaMessage.textContent = '';
        aperturaMessage.className = 'form-message';

        try {
            const nuevaCaja = await cierresColeccion.add({
                estado: 'abierto',
                fecha: new Date().toISOString().slice(0, 10),
                saldosIniciales,
                conceptosIniciales,
                saldosInicialesDetalle,
                abiertoEn: firebase.firestore.FieldValue.serverTimestamp(),
                abiertoPorEmail: auth.currentUser ? auth.currentUser.email : null,
                cerradoEn: null,
                cerradoPorEmail: null,
                saldosEsperados: null,
                saldosContados: null,
                saldosContadosDetalle: null,
                diferencias: null,
                notas: ''
            });
            registrarAuditoria('caja', 'abrir', {
                cierreId: nuevaCaja.id,
                saldosIniciales
            });
            aperturaFilas.innerHTML = '';
            agregarFilaApertura();
            aperturaMessage.textContent = '';
            ocultarUltimoArqueoBox();
        } catch (error) {
            console.error('Error al abrir caja:', error);
            aperturaMessage.textContent = 'No se pudo abrir la caja. Intenta de nuevo.';
            aperturaMessage.className = 'form-message form-message-error';
        } finally {
            aperturaSubmitBtn.disabled = false;
            aperturaSubmitBtn.querySelector('.btn-text').textContent = 'Abrir caja';
            aperturaSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    cierreFormBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-agregar-banco-cierre');
        if (!btn) return;
        const moneda = btn.dataset.moneda;
        const container = cierreFormBody.querySelector(`.cierre-bancos-filas[data-bancos-moneda="${moneda}"]`);
        if (container) {
            agregarFilaBancoCierre(container, moneda, '');
            recalcularTotalContadoMoneda(moneda);
        }
    });

    abrirCierreFormBtn.addEventListener('click', () => {
        cierreFormWrap.classList.remove('hidden');
    });

    cierreCancelBtn.addEventListener('click', () => {
        cierreFormWrap.classList.add('hidden');
        cierreMessage.textContent = '';
        cierreMessage.className = 'form-message';
    });

    cierreSubmitBtn.addEventListener('click', async () => {
        if (!cierreAbiertoActual) return;

        const saldosContados = {};
        const saldosContadosDetalle = {};
        let faltaAlguno = false;
        cierreFormBody.querySelectorAll('.cierre-moneda-grupo').forEach(grupo => {
            const moneda = grupo.dataset.moneda;
            let total = 0;
            let algunaValida = false;
            const detalle = [];
            grupo.querySelectorAll('.cierre-banco-fila').forEach(fila => {
                const banco = fila.querySelector('.cierre-banco-nombre-input').value.trim() || 'Efectivo / Sin banco';
                const monto = parseFloat(fila.querySelector('.cierre-contado-input').value);
                if (isNaN(monto)) return;
                total += monto;
                algunaValida = true;
                detalle.push({ banco, monto });
            });
            if (!algunaValida) { faltaAlguno = true; return; }
            saldosContados[moneda] = total;
            saldosContadosDetalle[moneda] = detalle;
        });

        if (faltaAlguno || Object.keys(saldosContados).length === 0) {
            cierreMessage.textContent = 'Ingresa el saldo contado de al menos un banco/cuenta para cada moneda antes de confirmar.';
            cierreMessage.className = 'form-message form-message-error';
            return;
        }

        const saldosEsperados = { ...resumenPorMoneda };
        const diferencias = {};
        Object.keys(saldosContados).forEach(moneda => {
            diferencias[moneda] = saldosContados[moneda] - (saldosEsperados[moneda] || 0);
        });

        cierreSubmitBtn.disabled = true;
        cierreSubmitBtn.querySelector('.btn-text').textContent = 'Cerrando...';
        cierreSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        cierreMessage.textContent = '';
        cierreMessage.className = 'form-message';

        try {
            const idCerrado = cierreAbiertoActual.id;
            const notas = cierreNotasInput.value.trim();
            await cierresColeccion.doc(idCerrado).update({
                estado: 'cerrado',
                cerradoEn: firebase.firestore.FieldValue.serverTimestamp(),
                cerradoPorEmail: auth.currentUser ? auth.currentUser.email : null,
                saldosEsperados,
                saldosContados,
                saldosContadosDetalle,
                diferencias,
                notas
            });
            registrarAuditoria('caja', 'cerrar', {
                cierreId: idCerrado,
                saldosEsperados,
                saldosContados,
                diferencias
            });

            // Guardamos localmente el arqueo recién cerrado (con la hora actual
            // como aproximación de cerradoEn) para poder ofrecer la descarga
            // inmediata del PDF/Excel de HOY, sin depender de que la escucha en
            // tiempo real de Firestore ya haya refrescado el historial completo.
            cierresCerradosCache[idCerrado] = {
                ...cierreAbiertoActual.data,
                estado: 'cerrado',
                cerradoEn: firebase.firestore.Timestamp.now(),
                cerradoPorEmail: auth.currentUser ? auth.currentUser.email : null,
                saldosEsperados,
                saldosContados,
                saldosContadosDetalle,
                diferencias,
                notas
            };
            mostrarUltimoArqueoBox(idCerrado);

            cierreFormWrap.classList.add('hidden');
            cierreNotasInput.value = '';
        } catch (error) {
            console.error('Error al cerrar caja:', error);
            cierreMessage.textContent = 'No se pudo cerrar la caja. Intenta de nuevo.';
            cierreMessage.className = 'form-message form-message-error';
        } finally {
            cierreSubmitBtn.disabled = false;
            cierreSubmitBtn.querySelector('.btn-text').textContent = 'Confirmar cierre';
            cierreSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    cierresExportarPdfBtn.addEventListener('click', () => {
        const ids = Object.keys(cierresCerradosCache);
        if (ids.length === 0) { alert('Todavía no hay cierres de caja para exportar.'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('Historial de arqueos de caja', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${ids.length} cierre(s)`, 14, 21);

        let y = 30;
        ids.forEach((id, idx) => {
            const data = cierresCerradosCache[id];
            if (idx > 0) {
                doc.addPage();
                y = 20;
            }
            doc.setFontSize(12);
            doc.setTextColor(30);
            doc.text(`Cierre del ${formatDate(data.cerradoEn || data.abiertoEn)}`, 14, y);
            y += 6;
            construirArqueoPDF(doc, data, y);
        });

        doc.save(`historial-arqueos-caja-${fechaArchivo()}.pdf`);
    });

    cierresExportarExcelBtn.addEventListener('click', () => {
        const ids = Object.keys(cierresCerradosCache);
        if (ids.length === 0) { alert('Todavía no hay cierres de caja para exportar.'); return; }
        const filas = [];
        ids.forEach(id => {
            const data = cierresCerradosCache[id];
            const monedas = detalleMonedasCierre(data);
            monedas.forEach(m => {
                const bancos = m.bancosContados.length > 0 ? m.bancosContados : [{ banco: '—', monto: m.contado }];
                bancos.forEach((b, i) => {
                    filas.push({
                        Fecha: formatDate(data.cerradoEn || data.abiertoEn),
                        Moneda: i === 0 ? m.moneda : '',
                        Inicial: i === 0 ? moneyTexto(m.inicial, '') : '',
                        Esperado: i === 0 ? moneyTexto(m.esperado, '') : '',
                        'Total contado': i === 0 ? moneyTexto(m.contado, '') : '',
                        Diferencia: i === 0 ? moneyTexto(m.diferencia, '') : '',
                        'Banco / cuenta': b.banco,
                        'Contado (banco)': moneyTexto(b.monto, ''),
                        'Cerrado por': i === 0 ? (data.cerradoPorEmail || '—') : ''
                    });
                });
            });
        });
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 22 }];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Historial arqueos');
        XLSX.writeFile(libro, `historial-arqueos-caja-${fechaArchivo()}.xlsx`);
    });

    cierresColeccion.orderBy('abiertoEn', 'desc').onSnapshot(snapshot => {
        let abierto = null;
        const cerrados = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.estado === 'abierto' && !abierto) {
                abierto = { id: doc.id, data };
            } else if (data.estado === 'cerrado') {
                cerrados.push({ id: doc.id, data });
            }
        });
        cierreAbiertoActual = abierto;
        ultimoCierreCerrado = cerrados.length > 0 ? cerrados[0] : null;
        actualizarVistaCierre();
        renderHistorialCierres(cerrados);
        renderCajaSaldos(movimientosCajaActuales); // re-sincroniza las tarjetas de arriba con la apertura vigente
        actualizarDashboardEjecutivo();
    }, error => {
        console.error('Error al escuchar cierres de caja:', error);
    });
}
