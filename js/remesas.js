import { auth, db } from './firebase-config.js';
import { escapeHtml, formatMoney, formatDate, fechaEnRango, badgeClass, badgeLabel, moneyTexto, fechaArchivo, normalizarNombre, initFiltrosToggle, actualizarPanelFiltros } from './shared.js';
import { showSection } from './ui.js';
import { registrarAuditoria } from './auditoria.js';
import { clientesCache } from './clientes.js';
import { claveTasa, tasasCache, tasasMercadoCache, obtenerTasaEnVivo } from './tasas.js';
import { sincronizarCajaDeRemesa, eliminarMovimientosCajaDeRemesa } from './caja.js';
import { renderBoletas } from './boletas.js';
import { actualizarDashboardEjecutivo, fechaLimiteVentana } from './dashboard.js';
import { renderizarReportes, poblarPaisesReportes } from './reportes.js';

// ============================================
// NUEVA REMESA — cálculo en vivo del monto a recibir
// ============================================
const montoEnviadoInput = document.getElementById('montoEnviado');
const tasaCambioInput = document.getElementById('tasaCambio');
const montoRecibidoInput = document.getElementById('montoRecibido');
const monedaEnviadoInput = document.getElementById('monedaEnviado');
const monedaRecibidoInput = document.getElementById('monedaRecibido');
const tasaHint = document.getElementById('tasaHint');
const modoCalculoEnviadoBtn = document.getElementById('modoCalculoEnviadoBtn');
const modoCalculoRecibidoBtn = document.getElementById('modoCalculoRecibidoBtn');
const calcBadgeEnviado = document.getElementById('calcBadgeEnviado');
const calcBadgeRecibido = document.getElementById('calcBadgeRecibido');

// El usuario puede elegir si ingresa el "monto enviado" (y la app calcula
// cuánto se recibe) o el "monto a recibir" (y la app calcula cuánto hay que
// enviar para lograrlo). El campo que no se está ingresando queda de solo
// lectura y se recalcula en vivo.
let modoCalculo = 'enviado'; // 'enviado' | 'recibido'

function aplicarModoCalculo() {
    const esEnviado = modoCalculo === 'enviado';

    modoCalculoEnviadoBtn.classList.toggle('active', esEnviado);
    modoCalculoRecibidoBtn.classList.toggle('active', !esEnviado);

    montoEnviadoInput.readOnly = !esEnviado;
    montoEnviadoInput.classList.toggle('input-readonly', !esEnviado);
    calcBadgeEnviado.classList.toggle('hidden', esEnviado);

    montoRecibidoInput.readOnly = esEnviado;
    montoRecibidoInput.classList.toggle('input-readonly', esEnviado);
    calcBadgeRecibido.classList.toggle('hidden', !esEnviado);

    recalcularMontos();
}

function recalcularMontos() {
    const tasa = parseFloat(tasaCambioInput.value);

    if (modoCalculo === 'enviado') {
        const enviado = parseFloat(montoEnviadoInput.value);
        if (!isNaN(enviado) && !isNaN(tasa)) {
            montoRecibidoInput.value = (enviado * tasa).toFixed(2);
        } else {
            montoRecibidoInput.value = '';
        }
    } else {
        const recibido = parseFloat(montoRecibidoInput.value);
        if (!isNaN(recibido) && !isNaN(tasa) && tasa > 0) {
            montoEnviadoInput.value = (recibido / tasa).toFixed(2);
        } else {
            montoEnviadoInput.value = '';
        }
    }
}

// ============================================
// FORMA DE PAGO — mostrar banco solo si es transferencia
// ============================================
const formaPagoSelect = document.getElementById('formaPago');
const bancoGroup = document.getElementById('bancoGroup');
const bancoOrigenInput = document.getElementById('bancoOrigen');
const comisionDestinoInput = document.getElementById('comisionDestino');
const comisionDestinoActivaInput = document.getElementById('comisionDestinoActiva');

function actualizarVisibilidadBanco() {
    if (formaPagoSelect.value === 'transferencia') {
        bancoGroup.classList.remove('hidden');
        bancoOrigenInput.required = true;
    } else {
        bancoGroup.classList.add('hidden');
        bancoOrigenInput.required = false;
        bancoOrigenInput.value = '';
    }
}

const badgePagoLabel = (formaPago, banco) => {
    if (formaPago === 'transferencia') return `Transferencia${banco ? ' · ' + escapeHtml(banco) : ''}`;
    if (formaPago === 'caja_vecina') return 'Caja Vecina';
    return 'Efectivo';
};

// ============================================
// TASAS DE CAMBIO EN NUEVA REMESA — autocompletado automático (API en vivo)
// o desde lo configurado en Configuración (tasas.js).
// ============================================
let isAutoFilling = false;    // evita marcar como "manual" el autollenado
let tasaManual = false;       // el usuario editó la tasa a mano para este par
let tasaReferenciaActual = null; // última tasa configurada/en vivo sugerida (para calcular margen luego)
let autocompletarTimeout = null;
let autocompletarToken = 0;

function aplicarTasaAlFormulario(valor, tasaReferenciaReal) {
    isAutoFilling = true;
    tasaCambioInput.value = valor;
    isAutoFilling = false;
    // Si hay una tasa de mercado real guardada (costo, sin margen), esa es la referencia
    // para calcular ganancia. Si no, se usa la misma tasa ofrecida (comportamiento anterior).
    tasaReferenciaActual = (tasaReferenciaReal !== undefined && tasaReferenciaReal !== null)
        ? tasaReferenciaReal
        : valor;
    recalcularMontos();
}

export async function intentarAutocompletarTasa() {
    const origen = monedaEnviadoInput.value.trim().toUpperCase();
    const destino = monedaRecibidoInput.value.trim().toUpperCase();

    if (!origen || !destino) {
        tasaHint.textContent = '';
        tasaHint.classList.remove('input-hint-active');
        return;
    }

    const guardada = tasasCache[claveTasa(origen, destino)];
    const mercadoGuardada = tasasMercadoCache[claveTasa(origen, destino)];

    // El usuario ya editó la tasa a mano para este par: no la pisamos,
    // solo avisamos si existe una tasa configurada distinta.
    if (tasaManual) {
        if (guardada !== undefined) {
            tasaHint.textContent = `Hay una tasa configurada (${guardada}), pero se mantiene el valor ingresado manualmente.`;
        } else {
            tasaHint.textContent = '';
        }
        tasaHint.classList.remove('input-hint-active');
        return;
    }

    // 1) Prioridad: tasa configurada manualmente en "Configuración"
    if (guardada !== undefined) {
        aplicarTasaAlFormulario(guardada, mercadoGuardada);
        tasaHint.textContent = `Tasa configurada manualmente (1 ${origen} = ${guardada} ${destino}).`;
        tasaHint.classList.add('input-hint-active');
        return;
    }

    // 2) No hay tasa configurada para este par: se limpia cualquier valor
    // anterior (puede ser de otro par de monedas, ej. quedó de CLP→VES)
    // para no confundir mientras se busca una tasa en vivo.
    isAutoFilling = true;
    tasaCambioInput.value = '';
    isAutoFilling = false;
    recalcularMontos();

    const token = ++autocompletarToken;
    tasaHint.textContent = 'Buscando tasa en vivo...';
    tasaHint.classList.remove('input-hint-active');

    try {
        const tasaViva = await obtenerTasaEnVivo(origen, destino);

        if (token !== autocompletarToken || tasaManual) return; // el usuario siguió escribiendo o editó a mano

        if (tasaViva !== undefined) {
            const tasaRedondeada = Number(tasaViva.toFixed(6));
            aplicarTasaAlFormulario(tasaRedondeada);
            tasaHint.textContent = `Tasa en vivo aproximada (1 ${origen} = ${tasaViva.toFixed(4)} ${destino}). Verifícala antes de confirmar.`;
            tasaHint.classList.add('input-hint-active');
        } else {
            tasaHint.textContent = `No se encontró una tasa en vivo para ${origen} → ${destino}. Ingresa el valor manualmente.`;
            tasaHint.classList.remove('input-hint-active');
        }
    } catch (error) {
        if (token !== autocompletarToken) return;
        console.error('Error obteniendo tasa en vivo:', error);
        tasaHint.textContent = 'No se pudo obtener una tasa en vivo. Ingresa el valor manualmente.';
        tasaHint.classList.remove('input-hint-active');
    }
}

function onMonedaInputChange() {
    clearTimeout(autocompletarTimeout);
    autocompletarTimeout = setTimeout(intentarAutocompletarTasa, 400);
}

// ============================================
// NUEVA REMESA — envío del formulario
// ============================================
const remesaForm = document.getElementById('remesaForm');
const remesaDocIdInput = document.getElementById('remesaDocId');
const remesaSubmitBtn = document.getElementById('remesaSubmitBtn');
const remesaCancelBtn = document.getElementById('remesaCancelBtn');
const remesaMessage = document.getElementById('remesaMessage');
export let remesasPorId = {};

function resetRemesaForm() {
    remesaForm.reset();
    remesaDocIdInput.value = '';
    modoCalculo = 'enviado';
    aplicarModoCalculo();
    actualizarVisibilidadBanco();
    comisionDestinoInput.disabled = false;
    comisionDestinoInput.classList.remove('input-readonly');
    clienteIdInput.value = '';
    clienteHint.textContent = '';
    clienteHint.classList.remove('input-hint-active');
    tasaManual = false;
    tasaReferenciaActual = null;
    tasaHint.textContent = '';
    tasaHint.classList.remove('input-hint-active');
    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Registrar remesa';
    remesaCancelBtn.classList.add('hidden');
    remesaMessage.textContent = '';
    intentarAutocompletarTasa(); // CLP/VES quedan precargados por defecto tras el reset, así que se reintenta el autocompletado
    remesaMessage.className = 'form-message';
}

window.editarRemesa = (docId) => {
    const r = remesasPorId[docId];
    if (!r) return;

    remesaDocIdInput.value = docId;
    clienteNombreInput.value = r.clienteNombre || '';
    clienteIdInput.value = r.clienteId || '';
    clienteTelefonoInput.value = r.clienteTelefono || '';
    document.getElementById('paisOrigen').value = r.paisOrigen || '';
    document.getElementById('paisDestino').value = r.paisDestino || '';
    modoCalculo = 'enviado'; // al editar siempre se parte desde el monto enviado guardado
    aplicarModoCalculo();
    montoEnviadoInput.value = r.montoEnviado != null ? r.montoEnviado : '';
    document.getElementById('monedaEnviado').value = r.monedaEnviado || '';
    tasaManual = true; // evita que el autocompletado pise la tasa original al editar
    tasaReferenciaActual = r.tasaReferencia != null ? r.tasaReferencia : null;
    tasaCambioInput.value = r.tasaCambio != null ? r.tasaCambio : '';
    monedaRecibidoInput.value = r.monedaRecibido || '';
    recalcularMontos();
    document.getElementById('estado').value = r.estado || 'pendiente';
    formaPagoSelect.value = r.formaPago || 'efectivo';
    actualizarVisibilidadBanco();
    bancoOrigenInput.value = r.bancoOrigen || '';
    comisionDestinoActivaInput.checked = !!(r.comisionDestino && r.comisionDestino > 0);
    comisionDestinoInput.value = r.comisionDestino != null && r.comisionDestino > 0 ? r.comisionDestino : 0.3;
    comisionDestinoInput.disabled = !comisionDestinoActivaInput.checked;
    comisionDestinoInput.classList.toggle('input-readonly', !comisionDestinoActivaInput.checked);

    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar remesa';
    remesaCancelBtn.classList.remove('hidden');
    remesaMessage.textContent = '';
    remesaMessage.className = 'form-message';

    showSection('nueva');
};

window.eliminarRemesa = async (docId) => {
    if (!confirm('¿Eliminar esta remesa? Esta acción no se puede deshacer.')) return;
    const remesaEliminada = remesasPorId[docId] || null;
    try {
        await db.collection('remesas').doc(docId).delete();
        await eliminarMovimientosCajaDeRemesa(docId);
        registrarAuditoria('remesa', 'eliminar', {
            remesaId: docId,
            cliente: remesaEliminada ? remesaEliminada.clienteNombre : null,
            montoEnviado: remesaEliminada ? remesaEliminada.montoEnviado : null,
            monedaEnviado: remesaEliminada ? remesaEliminada.monedaEnviado : null
        });
    } catch (error) {
        console.error('Error al eliminar remesa:', error);
        alert('No se pudo eliminar la remesa. Intenta de nuevo.');
    }
};

// Autocompletar teléfono en "Nueva Remesa" si el nombre coincide con un cliente existente
const clienteNombreInput = document.getElementById('clienteNombre');
const clienteIdInput = document.getElementById('clienteId');
const clienteTelefonoInput = document.getElementById('clienteTelefono');
const clienteHint = document.getElementById('clienteHint');

// ============================================
// HISTORIAL + DASHBOARD — escucha en tiempo real
// ============================================
const historialBody = document.getElementById('historialBody');
const historialEmpty = document.getElementById('historialEmpty');
const historialEmptyText = document.getElementById('historialEmptyText');
const historialTableWrap = document.querySelector('#historial .table-wrap');
const dashboardPanel = document.querySelector('#dashboard .panel');

const historialFiltroEstado = document.getElementById('historialFiltroEstado');
const historialFiltroPago = document.getElementById('historialFiltroPago');
const historialFiltroOrigen = document.getElementById('historialFiltroOrigen');
const historialFiltroDestino = document.getElementById('historialFiltroDestino');
const historialFiltroBuscar = document.getElementById('historialFiltroBuscar');
const historialFiltroDesde = document.getElementById('historialFiltroDesde');
const historialFiltroHasta = document.getElementById('historialFiltroHasta');
const historialFiltroLimpiar = document.getElementById('historialFiltroLimpiar');

export let historialCache = []; // [{ id, r }] — todas las remesas, sin filtrar
let historialFiltrado = []; // [{ id, r }] — subconjunto actualmente visible (según filtros), usado para exportar

function routeTagHTML(origen, destino) {
    const o = escapeHtml(origen);
    const d = escapeHtml(destino);
    return `
        <span class="route-tag" title="${o} → ${d}">
            <i class="dot dot-origin"></i><i class="route-line"></i><i class="dot dot-dest"></i>
        </span>
        <span class="route-text">${o} → ${d}</span>
    `;
}

function renderHistorialRow(id, r) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${formatDate(r.createdAt)}</td>
        <td>${escapeHtml(r.clienteNombre) || '—'}</td>
        <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
        <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
        <td class="mono-cell">${formatMoney(r.montoRecibido, r.monedaRecibido)}</td>
        <td>${badgePagoLabel(r.formaPago, r.bancoOrigen)}</td>
        <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
        <td>
            <button type="button" class="btn-icon-action" onclick="editarRemesa('${id}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarRemesa('${id}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

// Rellena un <select> de país con las opciones disponibles en los datos,
// conservando la selección actual si sigue siendo válida.
function poblarSelectPaises(selectEl, paises) {
    const valorActual = selectEl.value;
    selectEl.innerHTML = '<option value="todos">Todos</option>' +
        paises.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (paises.includes(valorActual)) {
        selectEl.value = valorActual;
    } else {
        selectEl.value = 'todos';
    }
}

// Aplica los filtros de estado, forma de pago, país de origen/destino y
// búsqueda por cliente sobre historialCache, y vuelve a pintar la tabla.
function aplicarFiltroHistorial() {
    const estadoFiltro = historialFiltroEstado.value;
    const pagoFiltro = historialFiltroPago.value;
    const origenFiltro = historialFiltroOrigen.value;
    const destinoFiltro = historialFiltroDestino.value;
    const textoBusqueda = historialFiltroBuscar.value.trim().toLowerCase();
    const desdeFiltro = historialFiltroDesde.value;
    const hastaFiltro = historialFiltroHasta.value;
    const hayFiltrosActivos = estadoFiltro !== 'todos' || pagoFiltro !== 'todos' ||
        origenFiltro !== 'todos' || destinoFiltro !== 'todos' || textoBusqueda !== '' ||
        desdeFiltro !== '' || hastaFiltro !== '';

    const filtrados = historialCache.filter(({ r }) => {
        if (estadoFiltro !== 'todos' && (r.estado || 'pendiente') !== estadoFiltro) return false;
        if (pagoFiltro !== 'todos' && (r.formaPago || 'efectivo') !== pagoFiltro) return false;
        if (origenFiltro !== 'todos' && r.paisOrigen !== origenFiltro) return false;
        if (destinoFiltro !== 'todos' && r.paisDestino !== destinoFiltro) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        return true;
    });

    actualizarPanelFiltros('historial', [
        {
            label: 'Estado', activo: estadoFiltro !== 'todos',
            texto: historialFiltroEstado.options[historialFiltroEstado.selectedIndex].text,
            onQuitar: () => { historialFiltroEstado.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'Forma de pago', activo: pagoFiltro !== 'todos',
            texto: historialFiltroPago.options[historialFiltroPago.selectedIndex].text,
            onQuitar: () => { historialFiltroPago.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'País de origen', activo: origenFiltro !== 'todos',
            texto: `Desde: ${origenFiltro}`,
            onQuitar: () => { historialFiltroOrigen.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'País de destino', activo: destinoFiltro !== 'todos',
            texto: `Hacia: ${destinoFiltro}`,
            onQuitar: () => { historialFiltroDestino.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { historialFiltroDesde.value = ''; historialFiltroHasta.value = ''; aplicarFiltroHistorial(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente: "${historialFiltroBuscar.value.trim()}"`,
            onQuitar: () => { historialFiltroBuscar.value = ''; aplicarFiltroHistorial(); }
        }
    ], { mostrados: filtrados.length, total: historialCache.length });

    historialFiltrado = filtrados;

    historialBody.innerHTML = '';
    if (filtrados.length === 0) {
        historialEmpty.style.display = 'block';
        historialTableWrap.style.display = 'none';
        historialEmptyText.textContent = hayFiltrosActivos
            ? 'No hay remesas que coincidan con el filtro.'
            : 'Todavía no hay remesas registradas.';
        return;
    }
    historialEmpty.style.display = 'none';
    historialTableWrap.style.display = 'block';
    filtrados.forEach(({ id, r }) => {
        historialBody.appendChild(renderHistorialRow(id, r));
    });
}

// ============================================
// EXPORTAR HISTORIAL — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla, es decir,
// historialFiltrado (respeta los filtros activos).
// ============================================
const historialExportarPdfBtn = document.getElementById('historialExportarPdfBtn');
const historialExportarExcelBtn = document.getElementById('historialExportarExcelBtn');

// Variante de texto plano (sin escapado HTML) del formateador de pago de la
// tabla, para no arrastrar entidades como "&amp;" a un PDF o Excel.
const pagoTexto = (formaPago, banco) => {
    if (formaPago === 'transferencia') return `Transferencia${banco ? ' · ' + banco : ''}`;
    if (formaPago === 'caja_vecina') return 'Caja Vecina';
    return 'Efectivo';
};

function filasExportHistorial() {
    return historialFiltrado.map(({ r }) => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Origen: r.paisOrigen || '—',
        Destino: r.paisDestino || '—',
        Enviado: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Recibido: moneyTexto(r.montoRecibido, r.monedaRecibido),
        Pago: pagoTexto(r.formaPago, r.bancoOrigen),
        Estado: badgeLabel(r.estado)
    }));
}

const VENTANA_HISTORIAL_MESES = 12; // ventana por defecto para Historial/Reportes (remesas)
let verTodoHistorialRemesas = false;
let unsubscribeRemesas = null;

function actualizarAvisoRangoHistorial() {
    const aviso = document.getElementById('historialRangoAvisoTexto');
    const checkbox = document.getElementById('historialVerTodoCheckbox');
    if (checkbox) checkbox.checked = verTodoHistorialRemesas;
    if (aviso) {
        aviso.innerHTML = verTodoHistorialRemesas
            ? '<i class="ti ti-clock-hour-4" aria-hidden="true"></i> Mostrando todo el historial.'
            : `<i class="ti ti-clock-hour-4" aria-hidden="true"></i> Mostrando los últimos ${VENTANA_HISTORIAL_MESES} meses (afecta también a Reportes).`;
    }
}

function suscribirRemesas() {
    if (unsubscribeRemesas) unsubscribeRemesas();
    actualizarAvisoRangoHistorial();

    let query = db.collection('remesas').orderBy('createdAt', 'desc');
    if (!verTodoHistorialRemesas) {
        query = db.collection('remesas')
            .where('createdAt', '>=', fechaLimiteVentana(VENTANA_HISTORIAL_MESES))
            .orderBy('createdAt', 'desc');
    }

    unsubscribeRemesas = query.onSnapshot(snapshot => {
    // --- Historial completo ---
    remesasPorId = {};
    historialCache = [];
    snapshot.forEach(doc => {
        remesasPorId[doc.id] = doc.data();
        historialCache.push({ id: doc.id, r: doc.data() });
    });

    const paisesOrigen = [...new Set(historialCache.map(({ r }) => r.paisOrigen).filter(Boolean))].sort();
    const paisesDestino = [...new Set(historialCache.map(({ r }) => r.paisDestino).filter(Boolean))].sort();
    poblarSelectPaises(historialFiltroOrigen, paisesOrigen);
    poblarSelectPaises(historialFiltroDestino, paisesDestino);
    poblarPaisesReportes(paisesOrigen, paisesDestino);

    aplicarFiltroHistorial();

    renderBoletas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));

    // --- Dashboard ejecutivo: operaciones, clientes, ganancia y última tasa ---
    actualizarDashboardEjecutivo();

    // --- Últimas remesas en el dashboard (máx 5) ---
    const ultimasWrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
    const ultimasEmpty = dashboardPanel.querySelector('.empty-state');

    if (snapshot.empty) {
        if (ultimasWrap) ultimasWrap.remove();
        if (ultimasEmpty) ultimasEmpty.style.display = 'block';
    } else {
        if (ultimasEmpty) ultimasEmpty.style.display = 'none';

        let wrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'dashboard-latest-wrap table-wrap';
            dashboardPanel.appendChild(wrap);
        }
        wrap.innerHTML = '<table class="data-table"><tbody></tbody></table>';
        const tbody = wrap.querySelector('tbody');
        snapshot.docs.slice(0, 5).forEach(doc => {
            const r = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(r.createdAt)}</td>
                <td>${escapeHtml(r.clienteNombre) || '—'}</td>
                <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
                <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
                <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderizarReportes();
}, error => {
    console.error('Error escuchando remesas:', error);
});
}

const historialVerTodoCheckbox = document.getElementById('historialVerTodoCheckbox');

// Inicializa el formulario de Nueva Remesa (cálculo en vivo, forma de pago,
// autocompletado de tasa y cliente, envío), el Historial (filtros,
// exportación) y la escucha en tiempo real de la colección remesas. Se
// llama una sola vez desde app.js al arrancar.
export function initRemesas() {
    modoCalculoEnviadoBtn.addEventListener('click', () => {
        if (modoCalculo === 'enviado') return;
        modoCalculo = 'enviado';
        aplicarModoCalculo();
    });

    modoCalculoRecibidoBtn.addEventListener('click', () => {
        if (modoCalculo === 'recibido') return;
        modoCalculo = 'recibido';
        aplicarModoCalculo();
    });

    [montoEnviadoInput, montoRecibidoInput, tasaCambioInput].forEach(el => {
        el.addEventListener('input', recalcularMontos);
    });

    comisionDestinoActivaInput.addEventListener('change', () => {
        comisionDestinoInput.disabled = !comisionDestinoActivaInput.checked;
        comisionDestinoInput.classList.toggle('input-readonly', !comisionDestinoActivaInput.checked);
    });

    formaPagoSelect.addEventListener('change', actualizarVisibilidadBanco);
    actualizarVisibilidadBanco();

    [monedaEnviadoInput, monedaRecibidoInput].forEach(el => {
        el.addEventListener('input', onMonedaInputChange);
    });

    tasaCambioInput.addEventListener('input', () => {
        if (!isAutoFilling) tasaManual = true;
    });

    remesaCancelBtn.addEventListener('click', resetRemesaForm);

    remesaForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const remesaDocId = remesaDocIdInput.value;
        const montoEnviado = parseFloat(montoEnviadoInput.value);
        const tasaCambio = parseFloat(tasaCambioInput.value);
        const monedaRecibido = monedaRecibidoInput.value.trim().toUpperCase();
        // El monto a recibir se toma directamente del campo (ya sea que el
        // usuario lo haya ingresado a mano o que se haya calculado en vivo a
        // partir del monto enviado), para que ambos modos de cálculo queden
        // consistentes al guardar.
        const montoRecibido = parseFloat(montoRecibidoInput.value);
        const clienteNombre = clienteNombreInput.value.trim();
        const clienteTelefono = clienteTelefonoInput.value.trim();
        const formaPago = formaPagoSelect.value;
        const bancoOrigen = formaPago === 'transferencia' ? bancoOrigenInput.value.trim() : '';
        const comisionDestino = comisionDestinoActivaInput.checked ? (parseFloat(comisionDestinoInput.value) || 0) : 0;

        remesaSubmitBtn.disabled = true;
        remesaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
        remesaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
        remesaMessage.textContent = '';
        remesaMessage.className = 'form-message';

        try {
            // Resolver el cliente: reutilizar uno existente o crear uno nuevo automáticamente
            let clienteId = clienteIdInput.value || null;
            const existente = clientesCache[normalizarNombre(clienteNombre)];

            if (existente) {
                clienteId = existente.id;
            } else {
                const nuevoCliente = await db.collection('clientes').add({
                    nombre: clienteNombre,
                    telefono: clienteTelefono,
                    paisDestino: document.getElementById('paisDestino').value.trim(),
                    notas: '',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    actualizadoPor: auth.currentUser ? auth.currentUser.email : null
                });
                clienteId = nuevoCliente.id;
            }

            const data = {
                clienteId,
                clienteNombre,
                clienteTelefono,
                paisOrigen: document.getElementById('paisOrigen').value.trim(),
                paisDestino: document.getElementById('paisDestino').value.trim(),
                montoEnviado,
                monedaEnviado: document.getElementById('monedaEnviado').value.trim().toUpperCase(),
                tasaCambio,
                // Si no hay tasa de referencia (ej. la tasa se ingresó a mano y nunca se
                // autocompletó), se usa la misma tasa ofrecida como respaldo para que la
                // remesa igual aparezca en reportes (con ganancia $0 en vez de quedar oculta).
                tasaReferencia: tasaReferenciaActual != null ? tasaReferenciaActual : tasaCambio,
                montoRecibido,
                monedaRecibido,
                estado: document.getElementById('estado').value,
                formaPago,
                bancoOrigen,
                comisionDestino
            };

            let remesaIdGuardada = remesaDocId;
            const remesaAnterior = remesaDocId ? remesasPorId[remesaDocId] : null;
            if (remesaDocId) {
                data.actualizadoEn = firebase.firestore.FieldValue.serverTimestamp();
                data.actualizadoPor = auth.currentUser ? auth.currentUser.email : null;
                await db.collection('remesas').doc(remesaDocId).update(data);
            } else {
                data.creadoPor = auth.currentUser ? auth.currentUser.uid : null;
                data.creadoPorEmail = auth.currentUser ? auth.currentUser.email : null;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                const nuevaRemesa = await db.collection('remesas').add(data);
                remesaIdGuardada = nuevaRemesa.id;
            }

            if (remesaAnterior) {
                // Solo se registran los campos que realmente cambiaron
                const cambios = {};
                ['montoEnviado', 'monedaEnviado', 'tasaCambio', 'montoRecibido', 'monedaRecibido', 'estado', 'formaPago', 'comisionDestino'].forEach(campo => {
                    if (data[campo] !== undefined && data[campo] !== remesaAnterior[campo]) {
                        cambios[campo] = { antes: remesaAnterior[campo] ?? null, despues: data[campo] };
                    }
                });
                registrarAuditoria('remesa', 'editar', {
                    remesaId: remesaIdGuardada,
                    cliente: clienteNombre,
                    cambios
                });
            } else {
                registrarAuditoria('remesa', 'crear', {
                    remesaId: remesaIdGuardada,
                    cliente: clienteNombre,
                    montoEnviado,
                    monedaEnviado: data.monedaEnviado,
                    tasaCambio
                });
            }

            // Crear/actualizar/quitar el movimiento de caja automático ligado a esta remesa.
            // La remesa (documento en /remesas) ya quedó guardada arriba; esto es aparte.
            // Se espera el resultado (ya no es fire-and-forget) porque, si falla, es crítico
            // avisarte de inmediato: de lo contrario la caja queda descuadrada en silencio
            // (ver comentario en caja.js sobre por qué antes esto pasaba desapercibido).
            let errorSincronizandoCaja = null;
            try {
                await sincronizarCajaDeRemesa(remesaIdGuardada, data);
            } catch (err) {
                console.error('No se pudo sincronizar la caja con la remesa:', err);
                errorSincronizandoCaja = err;
            }

            // Marcar la fecha de última remesa en el cliente (no bloqueante para el flujo principal)
            db.collection('clientes').doc(clienteId).update({
                ultimaRemesaEn: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.warn('No se pudo actualizar ultimaRemesaEn:', err));

            const fueEdicion = !!remesaDocId;
            resetRemesaForm();
            if (errorSincronizandoCaja) {
                // La remesa SÍ se guardó; lo que falló es el movimiento de caja asociado.
                // Se avisa explícitamente en pantalla (no solo en consola) para que se
                // revise y corrija en la sección Caja, en vez de descubrirlo días después
                // al cuadrar el arqueo.
                remesaMessage.textContent = `Remesa ${fueEdicion ? 'actualizada' : 'registrada'}, pero no se pudo sincronizar el movimiento de caja. Revisa la sección Caja para esta remesa y vuelve a intentar (editar y guardar de nuevo la remesa reintenta la sincronización).`;
                remesaMessage.className = 'form-message form-message-error';
            } else {
                remesaMessage.textContent = fueEdicion ? 'Remesa actualizada correctamente.' : 'Remesa registrada correctamente.';
                remesaMessage.className = 'form-message form-message-success';
            }
        } catch (error) {
            console.error('Error al guardar remesa:', error);
            remesaMessage.textContent = 'No se pudo guardar la remesa. Intenta de nuevo.';
            remesaMessage.className = 'form-message form-message-error';
        } finally {
            remesaSubmitBtn.disabled = false;
            remesaSubmitBtn.querySelector('.btn-text').textContent = remesaDocIdInput.value ? 'Actualizar remesa' : 'Registrar remesa';
            remesaSubmitBtn.querySelector('.spinner').classList.add('hidden');
        }
    });

    clienteNombreInput.addEventListener('input', () => {
        const match = clientesCache[normalizarNombre(clienteNombreInput.value)];
        if (match) {
            clienteIdInput.value = match.id;
            if (!clienteTelefonoInput.value.trim() && match.telefono) {
                clienteTelefonoInput.value = match.telefono;
            }
            clienteHint.textContent = 'Cliente existente — se vinculará a su historial.';
            clienteHint.classList.add('input-hint-active');
        } else {
            clienteIdInput.value = '';
            clienteHint.textContent = clienteNombreInput.value.trim() ? 'Cliente nuevo — se creará al guardar.' : '';
            clienteHint.classList.remove('input-hint-active');
        }
    });

    [historialFiltroEstado, historialFiltroPago, historialFiltroOrigen, historialFiltroDestino, historialFiltroDesde, historialFiltroHasta].forEach(el => {
        el.addEventListener('change', aplicarFiltroHistorial);
    });
    historialFiltroBuscar.addEventListener('input', aplicarFiltroHistorial);
    historialFiltroLimpiar.addEventListener('click', () => {
        historialFiltroEstado.value = 'todos';
        historialFiltroPago.value = 'todos';
        historialFiltroOrigen.value = 'todos';
        historialFiltroDestino.value = 'todos';
        historialFiltroBuscar.value = '';
        historialFiltroDesde.value = '';
        historialFiltroHasta.value = '';
        aplicarFiltroHistorial();
    });
    initFiltrosToggle('historial');

    historialExportarPdfBtn.addEventListener('click', () => {
        if (historialFiltrado.length === 0) {
            alert('No hay remesas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportHistorial();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Historial de remesas', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} remesa(s)`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Fecha', 'Cliente', 'Origen', 'Destino', 'Enviado', 'Recibido', 'Pago', 'Estado']],
            body: filas.map(f => [f.Fecha, f.Cliente, f.Origen, f.Destino, f.Enviado, f.Recibido, f.Pago, f.Estado]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });

        doc.save(`historial-remesas-${fechaArchivo()}.pdf`);
    });

    historialExportarExcelBtn.addEventListener('click', () => {
        if (historialFiltrado.length === 0) {
            alert('No hay remesas para exportar con los filtros actuales.');
            return;
        }
        const filas = filasExportHistorial();
        const hoja = XLSX.utils.json_to_sheet(filas);
        hoja['!cols'] = [
            { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 14 },
            { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 12 }
        ];
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Historial');
        XLSX.writeFile(libro, `historial-remesas-${fechaArchivo()}.xlsx`);
    });

    suscribirRemesas();

    if (historialVerTodoCheckbox) {
        historialVerTodoCheckbox.addEventListener('change', () => {
            verTodoHistorialRemesas = historialVerTodoCheckbox.checked;
            suscribirRemesas();
        });
    }
}
