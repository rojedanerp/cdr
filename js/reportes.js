import { formatMoney, formatDate, moneyTexto, fechaArchivo, escapeHtml, initFiltrosToggle, actualizarPanelFiltros } from './shared.js';
import { remesasPorId } from './remesas.js';

// ============================================
// REPORTES — ganancia por remesa (margen de tasa), volumen mensual
// por moneda destino, y gráfico de remesas por día. Lee remesasPorId
// (remesas.js) directamente; se repinta cuando remesas.js llama a
// renderizarReportes() dentro de su escucha en tiempo real.
// ============================================
const reportesPeriodo = document.getElementById('reportesPeriodo');
const reportesDesdeInput = document.getElementById('reportesDesde');
const reportesHastaInput = document.getElementById('reportesHasta');
const reportesRangoCustom = document.getElementById('reportesRangoCustom');
const reportesRangoCustomHasta = document.getElementById('reportesRangoCustomHasta');
const repStatCantidad = document.getElementById('repStatCantidad');
const repStatTicket = document.getElementById('repStatTicket');
const repStatGanancia = document.getElementById('repStatGanancia');
const repStatSinRef = document.getElementById('repStatSinRef');
const repChart = document.getElementById('repChart');
const repChartWrap = document.getElementById('repChartWrap');
const repChartEmpty = document.getElementById('repChartEmpty');
const repChartSubtitulo = document.getElementById('repChartSubtitulo');
const repVolumenBody = document.getElementById('repVolumenBody');
const repVolumenWrap = document.getElementById('repVolumenWrap');
const repVolumenEmpty = document.getElementById('repVolumenEmpty');
const repGananciaBody = document.getElementById('repGananciaBody');
const repGananciaWrap = document.getElementById('repGananciaWrap');
const repGananciaEmpty = document.getElementById('repGananciaEmpty');
const repMonedaBody = document.getElementById('repMonedaBody');
const repMonedaWrap = document.getElementById('repMonedaWrap');
const repMonedaEmpty = document.getElementById('repMonedaEmpty');

// Snapshot del último render, usado por los botones de exportar (PDF/Excel)
// para que siempre exporten exactamente lo que se ve en pantalla.
let reportesExportState = {
    periodoLabel: '',
    stats: { cantidad: 0, ticket: '—', ganancia: '—', sinRef: 0 },
    volumen: [],   // [{ mes, moneda, count, total }]
    ganancia: [],  // [{ fecha, cliente, enviado, tasaAplicada, tasaReferencia, gananciaNeta, monedaGanancia }]
    resumenMoneda: [] // [{ moneda, entradasCount, entradasTotal, salidasCount, salidasTotal, comisionTotal }]
};

// Filtros avanzados de Reportes (mismo patrón colapsable de Historial/Caja/Billetera)
const reportesFiltroEstado = document.getElementById('reportesFiltroEstado');
const reportesFiltroPago = document.getElementById('reportesFiltroPago');
const reportesFiltroOrigen = document.getElementById('reportesFiltroOrigen');
const reportesFiltroDestino = document.getElementById('reportesFiltroDestino');
const reportesFiltroBuscar = document.getElementById('reportesFiltroBuscar');
const reportesFiltroLimpiar = document.getElementById('reportesFiltroLimpiar');

function claveDiaLocal(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function claveMesLocal(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function nombreMesCapitalizado(claveMes) {
    const [y, m] = claveMes.split('-').map(Number);
    const fecha = new Date(y, m - 1, 1);
    const texto = fecha.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Ganancia neta de una remesa: la diferencia entre lo que cobraste (montoEnviado)
// y lo que realmente te costó en tu moneda, valorado a la tasa de mercado
// (tasaReferencia, sin margen). Esto incluye TANTO el monto enviado al destinatario
// COMO la comisión bancaria extra (si aplica) — ambos salen de tu bolsillo.
export function calcularGananciaNeta(r) {
    const comisionMonto = (r.montoRecibido || 0) * ((r.comisionDestino || 0) / 100);
    const costoTotalDestino = (r.montoRecibido || 0) + comisionMonto;
    return r.montoEnviado - (costoTotalDestino / r.tasaReferencia);
}

// Calcula el rango [desde, hasta) para cada opción de Periodo.
// "hasta" es un límite superior EXCLUSIVO (o null si no hay límite, es decir, incluye hasta ahora).
function calcularRangoPeriodo(periodo) {
    const ahora = new Date();
    let desde = null;
    let hasta = null;

    if (periodo === 'hoy') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (periodo === 'ayer') {
        const ayer = new Date(ahora);
        ayer.setDate(ayer.getDate() - 1);
        desde = new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate());
        hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (periodo === '7d') {
        desde = new Date(ahora);
        desde.setDate(desde.getDate() - 6);
        desde.setHours(0, 0, 0, 0);
    } else if (periodo === '30d') {
        desde = new Date(ahora);
        desde.setDate(desde.getDate() - 29);
        desde.setHours(0, 0, 0, 0);
    } else if (periodo === 'mes') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } else if (periodo === 'mesAnterior') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } else if (periodo === 'anio') {
        desde = new Date(ahora.getFullYear(), 0, 1);
    } else if (periodo === 'custom') {
        const desdeStr = reportesDesdeInput ? reportesDesdeInput.value : '';
        const hastaStr = reportesHastaInput ? reportesHastaInput.value : '';
        if (desdeStr) {
            const [y, m, d] = desdeStr.split('-').map(Number);
            desde = new Date(y, m - 1, d);
        }
        if (hastaStr) {
            const [y, m, d] = hastaStr.split('-').map(Number);
            hasta = new Date(y, m - 1, d);
            hasta.setDate(hasta.getDate() + 1); // incluye todo el día "hasta"
        }
    } // 'todo' -> sin límites

    return { desde, hasta };
}

// Repuebla los selects de país de origen/destino de Reportes. La llama
// remesas.js con cada actualización de su escucha en tiempo real, junto
// con los selects equivalentes de Historial.
export function poblarPaisesReportes(paisesOrigen, paisesDestino) {
    poblarSelectPaisesReportes(reportesFiltroOrigen, paisesOrigen);
    poblarSelectPaisesReportes(reportesFiltroDestino, paisesDestino);
}

function poblarSelectPaisesReportes(selectEl, paises) {
    const valorActual = selectEl.value;
    selectEl.innerHTML = '<option value="todos">Todos</option>' +
        paises.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    selectEl.value = paises.includes(valorActual) ? valorActual : 'todos';
}

export function renderizarReportes() {
    if (!reportesPeriodo) return;

    const periodo = reportesPeriodo.value;
    const { desde, hasta } = calcularRangoPeriodo(periodo);

    // Primero se acota solo por periodo (esto es lo que se usa como "total"
    // de referencia en el contador "X de Y" del panel de filtros).
    const enPeriodoSinFiltrosExtra = Object.entries(remesasPorId)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => {
            if (r.estado === 'cancelado') return false;
            if (!r.createdAt || !r.createdAt.toDate) return false;
            const fecha = r.createdAt.toDate();
            if (desde && fecha < desde) return false;
            if (hasta && fecha >= hasta) return false;
            return true;
        });

    // Luego se aplican los filtros avanzados (estado, forma de pago,
    // país de origen/destino y búsqueda por cliente).
    const estadoFiltro = reportesFiltroEstado.value;
    const pagoFiltro = reportesFiltroPago.value;
    const origenFiltro = reportesFiltroOrigen.value;
    const destinoFiltro = reportesFiltroDestino.value;
    const textoBusqueda = reportesFiltroBuscar.value.trim().toLowerCase();

    const enPeriodo = enPeriodoSinFiltrosExtra.filter(r => {
        if (estadoFiltro !== 'todos' && (r.estado || 'pendiente') !== estadoFiltro) return false;
        if (pagoFiltro !== 'todos' && (r.formaPago || 'efectivo') !== pagoFiltro) return false;
        if (origenFiltro !== 'todos' && r.paisOrigen !== origenFiltro) return false;
        if (destinoFiltro !== 'todos' && r.paisDestino !== destinoFiltro) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('reportes', [
        {
            label: 'Estado', activo: estadoFiltro !== 'todos',
            texto: reportesFiltroEstado.options[reportesFiltroEstado.selectedIndex].text,
            onQuitar: () => { reportesFiltroEstado.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'Forma de pago', activo: pagoFiltro !== 'todos',
            texto: reportesFiltroPago.options[reportesFiltroPago.selectedIndex].text,
            onQuitar: () => { reportesFiltroPago.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'País de origen', activo: origenFiltro !== 'todos',
            texto: `Desde: ${origenFiltro}`,
            onQuitar: () => { reportesFiltroOrigen.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'País de destino', activo: destinoFiltro !== 'todos',
            texto: `Hacia: ${destinoFiltro}`,
            onQuitar: () => { reportesFiltroDestino.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'Cliente', activo: textoBusqueda !== '',
            texto: `Cliente: "${reportesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { reportesFiltroBuscar.value = ''; renderizarReportes(); }
        }
    ], { mostrados: enPeriodo.length, total: enPeriodoSinFiltrosExtra.length });

    // --- Stat: cantidad ---
    repStatCantidad.textContent = enPeriodo.length;

    // --- Stat: monto enviado (total, en la moneda de envío más frecuente del periodo) ---
    const conteoMonedaEnviado = {};
    enPeriodo.forEach(r => {
        const m = (r.monedaEnviado || '').toUpperCase();
        if (m) conteoMonedaEnviado[m] = (conteoMonedaEnviado[m] || 0) + 1;
    });
    const monedaPrincipal = Object.entries(conteoMonedaEnviado).sort((a, b) => b[1] - a[1])[0];

    if (monedaPrincipal) {
        const moneda = monedaPrincipal[0];
        const delGrupo = enPeriodo.filter(r => (r.monedaEnviado || '').toUpperCase() === moneda);
        const totalEnviado = delGrupo.reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
        repStatTicket.textContent = formatMoney(totalEnviado, moneda);
    } else {
        repStatTicket.textContent = '—';
    }

    // --- Stat: ganancia estimada (solo remesas con tasa de referencia guardada) ---
    const conReferencia = enPeriodo.filter(r => r.tasaReferencia != null && r.tasaReferencia > 0 && r.tasaCambio != null && r.montoRecibido != null);
    repStatSinRef.textContent = enPeriodo.length - conReferencia.length;

    const gananciaPorMoneda = {};
    conReferencia.forEach(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        gananciaPorMoneda[moneda] = (gananciaPorMoneda[moneda] || 0) + ganancia;
    });
    const entradasGanancia = Object.entries(gananciaPorMoneda);
    repStatGanancia.textContent = entradasGanancia.length === 0
        ? '—'
        : entradasGanancia.map(([moneda, total]) => formatMoney(total, moneda)).join(' · ');

    reportesExportState.periodoLabel = reportesPeriodo.options[reportesPeriodo.selectedIndex].text;
    reportesExportState.stats = {
        cantidad: repStatCantidad.textContent,
        ticket: repStatTicket.textContent,
        ganancia: repStatGanancia.textContent,
        sinRef: repStatSinRef.textContent
    };

    renderizarGraficoDiario(enPeriodo, periodo, desde, hasta);
    renderizarResumenPorMoneda(enPeriodo);
    renderizarVolumenMensual(enPeriodo);
    renderizarGananciaPorRemesa(conReferencia);
}

// Resumen por moneda: cuánto dinero entró (montoEnviado, lo que pagó el
// cliente) y salió (montoRecibido, lo que recibió el destinatario) en cada
// moneda, más la comisión total cobrada (comisionDestino aplicado sobre
// montoRecibido), agrupado por la moneda en la que ocurre cada movimiento.
// Una misma moneda puede tener entradas y salidas a la vez (ej. CLP como
// moneda de envío en unas remesas y como moneda de destino en otras).
function renderizarResumenPorMoneda(remesas) {
    if (!repMonedaBody) return;

    const grupos = {};
    const getGrupo = (moneda) => {
        if (!grupos[moneda]) {
            grupos[moneda] = {
                moneda,
                entradasCount: 0, entradasTotal: 0,
                salidasCount: 0, salidasTotal: 0,
                comisionTotal: 0
            };
        }
        return grupos[moneda];
    };

    remesas.forEach(r => {
        const monedaEnv = (r.monedaEnviado || '').toUpperCase();
        const monedaRec = (r.monedaRecibido || '').toUpperCase();

        if (monedaEnv && r.montoEnviado != null) {
            const g = getGrupo(monedaEnv);
            g.entradasCount += 1;
            g.entradasTotal += r.montoEnviado;
        }
        if (monedaRec && r.montoRecibido != null) {
            const g = getGrupo(monedaRec);
            g.salidasCount += 1;
            g.salidasTotal += r.montoRecibido;
            g.comisionTotal += r.montoRecibido * ((r.comisionDestino || 0) / 100);
        }
    });

    const filas = Object.values(grupos).sort((a, b) => a.moneda.localeCompare(b.moneda));

    repMonedaBody.innerHTML = '';
    if (filas.length === 0) {
        repMonedaWrap.style.display = 'none';
        repMonedaEmpty.style.display = 'block';
        reportesExportState.resumenMoneda = [];
        return;
    }
    repMonedaWrap.style.display = 'block';
    repMonedaEmpty.style.display = 'none';

    reportesExportState.resumenMoneda = filas.map(f => ({
        moneda: f.moneda,
        entradasCount: f.entradasCount,
        entradasTotal: moneyTexto(f.entradasTotal, f.moneda),
        salidasCount: f.salidasCount,
        salidasTotal: moneyTexto(f.salidasTotal, f.moneda),
        comisionTotal: moneyTexto(f.comisionTotal, f.moneda)
    }));

    filas.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(f.moneda)}</td>
            <td>${f.entradasCount}</td>
            <td class="mono-cell">${formatMoney(f.entradasTotal, f.moneda)}</td>
            <td>${f.salidasCount}</td>
            <td class="mono-cell">${formatMoney(f.salidasTotal, f.moneda)}</td>
            <td class="mono-cell">${formatMoney(f.comisionTotal, f.moneda)}</td>
        `;
        repMonedaBody.appendChild(tr);
    });
}

// Dibuja las barras del gráfico a partir de una lista de "buckets"
// ({ valor, label, mostrarEtiqueta, tooltip }). Usado tanto para vista diaria como mensual.
function pintarBarrasReportes(items) {
    const totalEnRango = items.reduce((sum, item) => sum + item.valor, 0);

    if (totalEnRango === 0) {
        repChartWrap.style.display = 'none';
        repChartEmpty.style.display = 'block';
        return;
    }
    repChartWrap.style.display = 'block';
    repChartEmpty.style.display = 'none';

    const max = Math.max(...items.map(item => item.valor), 1);
    repChart.innerHTML = '';
    items.forEach(item => {
        const alturaPct = item.valor > 0 ? Math.max((item.valor / max) * 100, 4) : 0;
        const bar = document.createElement('div');
        bar.className = 'rep-chart-bar';
        bar.title = item.tooltip;
        bar.innerHTML = `
            <div class="rep-chart-bar-fill" style="height:${alturaPct}%"></div>
            ${item.mostrarEtiqueta ? `<span class="rep-chart-bar-label">${item.label}</span>` : ''}
        `;
        repChart.appendChild(bar);
    });
}

function renderizarGraficoDiario(remesas, periodo, desde, hasta) {
    const ahora = new Date();
    let dias = [];
    let modoMensual = false;

    if (periodo === 'hoy') {
        dias = [new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())];
        repChartSubtitulo.textContent = 'Hoy';
    } else if (periodo === 'ayer') {
        const ayer = new Date(ahora);
        ayer.setDate(ayer.getDate() - 1);
        dias = [new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate())];
        repChartSubtitulo.textContent = 'Ayer';
    } else if (periodo === '7d') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(ahora);
            d.setDate(d.getDate() - i);
            dias.push(d);
        }
        repChartSubtitulo.textContent = 'Últimos 7 días';
    } else if (periodo === 'mes') {
        const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
        for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        repChartSubtitulo.textContent = 'Este mes';
    } else if (periodo === 'mesAnterior') {
        const inicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        const fin = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
        for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        repChartSubtitulo.textContent = 'Mes anterior';
    } else if (periodo === 'anio') {
        modoMensual = true;
    } else if (periodo === 'custom' && desde) {
        const finInclusive = new Date((hasta || ahora));
        if (hasta) finInclusive.setDate(finInclusive.getDate() - 1); // "hasta" es exclusivo
        const rangoDias = Math.round((finInclusive - desde) / 86400000) + 1;
        if (rangoDias > 62) {
            modoMensual = true;
        } else {
            for (let d = new Date(desde); d <= finInclusive; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
            repChartSubtitulo.textContent = 'Rango personalizado';
        }
    } else {
        // '30d' y 'todo' (el gráfico siempre se acota a los últimos 30 días para que sea legible)
        for (let i = 29; i >= 0; i--) {
            const d = new Date(ahora);
            d.setDate(d.getDate() - i);
            dias.push(d);
        }
        repChartSubtitulo.textContent = periodo === 'todo' ? 'Últimos 30 días (de todo el historial)' : 'Últimos 30 días';
    }

    if (modoMensual) {
        renderizarGraficoMensual(remesas, periodo, desde, hasta);
        return;
    }

    const conteoPorDia = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const clave = claveDiaLocal(r.createdAt.toDate());
        conteoPorDia[clave] = (conteoPorDia[clave] || 0) + 1;
    });

    const items = dias.map((d, i) => ({
        valor: conteoPorDia[claveDiaLocal(d)] || 0,
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        mostrarEtiqueta: d.getDate() === 1 || i === 0 || i === dias.length - 1,
        tooltip: `${d.toLocaleDateString('es-CL')}: ${conteoPorDia[claveDiaLocal(d)] || 0} remesa(s)`
    }));

    pintarBarrasReportes(items);
}

// Vista mensual del gráfico (usada para "Este año" y rangos personalizados largos,
// donde mostrar un punto por día dejaría de ser legible).
function renderizarGraficoMensual(remesas, periodo, desde, hasta) {
    const ahora = new Date();
    let inicioMes;
    let finMes; // primer día del último mes a incluir

    if (periodo === 'anio') {
        inicioMes = new Date(ahora.getFullYear(), 0, 1);
        finMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        repChartSubtitulo.textContent = 'Este año, por mes';
    } else {
        inicioMes = new Date(desde.getFullYear(), desde.getMonth(), 1);
        const finReferencia = hasta ? new Date(hasta.getTime() - 1) : ahora;
        finMes = new Date(finReferencia.getFullYear(), finReferencia.getMonth(), 1);
        repChartSubtitulo.textContent = 'Rango personalizado, por mes';
    }

    const meses = [];
    for (let m = new Date(inicioMes); m <= finMes; m.setMonth(m.getMonth() + 1)) meses.push(new Date(m));

    const conteoPorMes = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const clave = claveMesLocal(r.createdAt.toDate());
        conteoPorMes[clave] = (conteoPorMes[clave] || 0) + 1;
    });

    const items = meses.map(m => {
        const clave = claveMesLocal(m);
        const valor = conteoPorMes[clave] || 0;
        return {
            valor,
            label: m.toLocaleDateString('es-CL', { month: 'short' }).replace('.', ''),
            mostrarEtiqueta: true,
            tooltip: `${nombreMesCapitalizado(clave)}: ${valor} remesa(s)`
        };
    });

    pintarBarrasReportes(items);
}

function renderizarVolumenMensual(remesas) {
    const grupos = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const mes = claveMesLocal(r.createdAt.toDate());
        const moneda = (r.monedaRecibido || '—').toUpperCase();
        const clave = `${mes}|${moneda}`;
        if (!grupos[clave]) grupos[clave] = { mes, moneda, count: 0, total: 0 };
        grupos[clave].count += 1;
        grupos[clave].total += (r.montoRecibido || 0);
    });

    const filas = Object.values(grupos).sort((a, b) => {
        if (a.mes !== b.mes) return b.mes.localeCompare(a.mes);
        return b.total - a.total;
    });

    repVolumenBody.innerHTML = '';
    if (filas.length === 0) {
        repVolumenWrap.style.display = 'none';
        repVolumenEmpty.style.display = 'block';
        reportesExportState.volumen = [];
        return;
    }
    repVolumenWrap.style.display = 'block';
    repVolumenEmpty.style.display = 'none';

    reportesExportState.volumen = filas.map(f => ({
        mes: nombreMesCapitalizado(f.mes),
        moneda: f.moneda,
        count: f.count,
        total: f.total,
        totalTexto: moneyTexto(f.total, f.moneda)
    }));

    filas.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${nombreMesCapitalizado(f.mes)}</td>
            <td>${escapeHtml(f.moneda)}</td>
            <td>${f.count}</td>
            <td class="mono-cell">${formatMoney(f.total, f.moneda)}</td>
        `;
        repVolumenBody.appendChild(tr);
    });
}

function renderizarGananciaPorRemesa(conReferencia) {
    const filas = [...conReferencia].sort((a, b) => {
        const fa = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
        const fb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
        return fb - fa;
    });

    repGananciaBody.innerHTML = '';
    if (filas.length === 0) {
        repGananciaWrap.style.display = 'none';
        repGananciaEmpty.style.display = 'block';
        reportesExportState.ganancia = [];
        return;
    }
    repGananciaWrap.style.display = 'block';
    repGananciaEmpty.style.display = 'none';

    reportesExportState.ganancia = filas.map(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        return {
            fecha: formatDate(r.createdAt),
            cliente: r.clienteNombre || '—',
            enviado: moneyTexto(r.montoEnviado, r.monedaEnviado),
            tasaAplicada: r.tasaCambio,
            tasaReferencia: r.tasaReferencia,
            gananciaNeta: moneyTexto(ganancia, moneda)
        };
    });

    filas.forEach(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        const claseGanancia = ganancia > 0 ? 'rep-ganancia-positiva' : (ganancia < 0 ? 'rep-ganancia-negativa' : 'rep-ganancia-cero');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
            <td class="mono-cell">${r.tasaCambio}</td>
            <td class="mono-cell">${r.tasaReferencia}</td>
            <td class="mono-cell ${claseGanancia}">${formatMoney(ganancia, moneda)}</td>
        `;
        repGananciaBody.appendChild(tr);
    });
}

// --- Exportar Reportes — PDF (jsPDF) y Excel (SheetJS) ---
// Exporta siempre lo que está visible en pantalla (respeta el periodo y los
// filtros avanzados activos), usando el snapshot guardado en reportesExportState.
const reportesExportarPdfBtn = document.getElementById('reportesExportarPdfBtn');
const reportesExportarExcelBtn = document.getElementById('reportesExportarExcelBtn');



// ============================================

// Inicializa los filtros y la exportación de Reportes. Se llama una sola
// vez desde app.js al arrancar.
export function initReportes() {
    initFiltrosToggle('reportes');

    [reportesFiltroEstado, reportesFiltroPago, reportesFiltroOrigen, reportesFiltroDestino].forEach(el => {
        el.addEventListener('change', renderizarReportes);
    });

    reportesFiltroBuscar.addEventListener('input', renderizarReportes);

    reportesFiltroLimpiar.addEventListener('click', () => {
        reportesFiltroEstado.value = 'todos';
        reportesFiltroPago.value = 'todos';
        reportesFiltroOrigen.value = 'todos';
        reportesFiltroDestino.value = 'todos';
        reportesFiltroBuscar.value = '';
        renderizarReportes();
    });

    reportesPeriodo.addEventListener('change', () => {
        const esCustom = reportesPeriodo.value === 'custom';
        reportesRangoCustom.classList.toggle('hidden', !esCustom);
        reportesRangoCustomHasta.classList.toggle('hidden', !esCustom);
        if (esCustom && !reportesDesdeInput.value) {
            // Rango por defecto al abrir "personalizado": este mes hasta hoy.
            const ahora = new Date();
            const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
            reportesDesdeInput.value = claveDiaLocal(inicioMes);
            reportesHastaInput.value = claveDiaLocal(ahora);
        }
        renderizarReportes();
    });

    reportesDesdeInput.addEventListener('change', renderizarReportes);

    reportesHastaInput.addEventListener('change', renderizarReportes);

    reportesExportarPdfBtn.addEventListener('click', () => {
        const { stats, volumen, ganancia, resumenMoneda, periodoLabel } = reportesExportState;
        if (Number(stats.cantidad) === 0 && volumen.length === 0 && ganancia.length === 0 && resumenMoneda.length === 0) {
            alert('No hay datos para exportar con los filtros actuales.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(14);
        doc.text('Reportes', 14, 15);
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · Periodo: ${periodoLabel}`, 14, 21);

        doc.autoTable({
            startY: 26,
            head: [['Remesas', 'Monto enviado', 'Ganancia neta estimada', 'Sin tasa de referencia']],
            body: [[stats.cantidad, stats.ticket, stats.ganancia, stats.sinRef]],
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] }
        });

        let cursorY = doc.lastAutoTable.finalY + 10;

        if (resumenMoneda.length > 0) {
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text('Resumen por moneda', 14, cursorY);
            doc.autoTable({
                startY: cursorY + 4,
                head: [['Moneda', '# Entradas', 'Total entrado', '# Salidas', 'Total salido', 'Comisión total']],
                body: resumenMoneda.map(f => [f.moneda, f.entradasCount, f.entradasTotal, f.salidasCount, f.salidasTotal, f.comisionTotal]),
                styles: { fontSize: 8.5, cellPadding: 3 },
                headStyles: { fillColor: [30, 41, 59] },
                alternateRowStyles: { fillColor: [245, 246, 248] }
            });
            cursorY = doc.lastAutoTable.finalY + 10;
        }

        if (volumen.length > 0) {
            if (cursorY > 180) { doc.addPage(); cursorY = 15; }
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text('Volumen mensual por moneda destino', 14, cursorY);
            doc.autoTable({
                startY: cursorY + 4,
                head: [['Mes', 'Moneda', '# Remesas', 'Monto total recibido']],
                body: volumen.map(f => [f.mes, f.moneda, f.count, f.totalTexto]),
                styles: { fontSize: 8.5, cellPadding: 3 },
                headStyles: { fillColor: [30, 41, 59] },
                alternateRowStyles: { fillColor: [245, 246, 248] }
            });
            cursorY = doc.lastAutoTable.finalY + 10;
        }

        if (ganancia.length > 0) {
            if (cursorY > 180) { doc.addPage(); cursorY = 15; }
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text('Ganancia por remesa', 14, cursorY);
            doc.autoTable({
                startY: cursorY + 4,
                head: [['Fecha', 'Cliente', 'Enviado', 'Tasa aplicada', 'Tasa referencia', 'Ganancia neta']],
                body: ganancia.map(g => [g.fecha, g.cliente, g.enviado, g.tasaAplicada, g.tasaReferencia, g.gananciaNeta]),
                styles: { fontSize: 8.5, cellPadding: 3 },
                headStyles: { fillColor: [30, 41, 59] },
                alternateRowStyles: { fillColor: [245, 246, 248] }
            });
        }

        doc.save(`reportes-${fechaArchivo()}.pdf`);
    });

    reportesExportarExcelBtn.addEventListener('click', () => {
        const { stats, volumen, ganancia, resumenMoneda, periodoLabel } = reportesExportState;
        if (Number(stats.cantidad) === 0 && volumen.length === 0 && ganancia.length === 0 && resumenMoneda.length === 0) {
            alert('No hay datos para exportar con los filtros actuales.');
            return;
        }
        const libro = XLSX.utils.book_new();

        const hojaResumen = XLSX.utils.json_to_sheet([{
            Periodo: periodoLabel,
            'Remesas en el periodo': stats.cantidad,
            'Monto enviado': stats.ticket,
            'Ganancia neta estimada': stats.ganancia,
            'Sin tasa de referencia': stats.sinRef
        }]);
        hojaResumen['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');

        if (resumenMoneda.length > 0) {
            const hojaResumenMoneda = XLSX.utils.json_to_sheet(resumenMoneda.map(f => ({
                Moneda: f.moneda,
                '# Entradas': f.entradasCount,
                'Total entrado': f.entradasTotal,
                '# Salidas': f.salidasCount,
                'Total salido': f.salidasTotal,
                'Comisión total': f.comisionTotal
            })));
            hojaResumenMoneda['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(libro, hojaResumenMoneda, 'Resumen por moneda');
        }

        if (volumen.length > 0) {
            const hojaVolumen = XLSX.utils.json_to_sheet(volumen.map(f => ({
                Mes: f.mes,
                Moneda: f.moneda,
                '# Remesas': f.count,
                'Monto total recibido': f.totalTexto
            })));
            hojaVolumen['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 20 }];
            XLSX.utils.book_append_sheet(libro, hojaVolumen, 'Volumen mensual');
        }

        if (ganancia.length > 0) {
            const hojaGanancia = XLSX.utils.json_to_sheet(ganancia.map(g => ({
                Fecha: g.fecha,
                Cliente: g.cliente,
                Enviado: g.enviado,
                'Tasa aplicada': g.tasaAplicada,
                'Tasa referencia': g.tasaReferencia,
                'Ganancia neta': g.gananciaNeta
            })));
            hojaGanancia['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(libro, hojaGanancia, 'Ganancia por remesa');
        }

        XLSX.writeFile(libro, `reportes-${fechaArchivo()}.xlsx`);
    });

}
