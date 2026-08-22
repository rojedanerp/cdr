import { escapeHtml, formatMoney } from './shared.js';
import { historialCache } from './remesas.js';
import { calcularGananciaNeta } from './reportes.js';
import { movimientosCajaActuales, cierreAbiertoActual, calcularSaldosActuales } from './caja.js';
import { convertirMoneda } from './tasas.js';

// ============================================
// DASHBOARD EJECUTIVO — caja disponible, totales convertidos,
// ganancia del día, operaciones y clientes atendidos hoy, y la
// última tasa realmente usada en una remesa.
// Se recalcula cada vez que cambian remesas, caja, cierres o tasas
// (remesas.js, caja.js y tasas.js llaman a actualizarDashboardEjecutivo
// dentro de sus respectivas escuchas en tiempo real).
// ============================================
export function actualizarDashboardEjecutivo() {
    const hoy = new Date();
    const esHoy = (ts) => ts && ts.toDate && ts.toDate().toDateString() === hoy.toDateString();
    const remesasHoy = historialCache.filter(({ r }) => esHoy(r.createdAt));

    const operacionesEl = document.querySelector('[data-stat="operaciones-dia"]');
    if (operacionesEl) operacionesEl.textContent = remesasHoy.length;

    const clientesHoy = new Set(remesasHoy.map(({ r }) => r.clienteNombre).filter(Boolean)).size;
    const clientesEl = document.querySelector('[data-stat="clientes-dia"]');
    if (clientesEl) clientesEl.textContent = clientesHoy;

    // Ganancia del día, agrupada por moneda de envío (igual que en Reportes),
    // solo considerando remesas que tienen tasa de referencia guardada.
    const gananciaPorMoneda = {};
    remesasHoy.forEach(({ r }) => {
        if (r.tasaReferencia == null || !(r.tasaReferencia > 0) || r.montoRecibido == null) return;
        const moneda = r.monedaEnviado || '?';
        gananciaPorMoneda[moneda] = (gananciaPorMoneda[moneda] || 0) + calcularGananciaNeta(r);
    });
    const gananciaEl = document.querySelector('[data-stat="ganancia-dia"]');
    if (gananciaEl) {
        const entradas = Object.entries(gananciaPorMoneda);
        gananciaEl.textContent = entradas.length === 0 ? '$0' : entradas.map(([m, v]) => formatMoney(v, m)).join(' · ');
    }

    // Última tasa realmente usada: la remesa más reciente con tasa registrada
    // (historialCache ya viene ordenado por createdAt descendente).
    const ultimaTasaEl = document.querySelector('[data-stat="ultima-tasa"]');
    const ultimaTasaHint = document.getElementById('dashUltimaTasaHint');
    const ultimaConTasa = historialCache.find(({ r }) => r.tasaCambio && r.monedaEnviado && r.monedaRecibido);
    if (ultimaTasaEl) {
        if (ultimaConTasa) {
            const { r } = ultimaConTasa;
            ultimaTasaEl.textContent = `1 ${r.monedaEnviado} = ${r.tasaCambio} ${r.monedaRecibido}`;
            if (ultimaTasaHint) {
                const fecha = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString('es-CL') : '—';
                ultimaTasaHint.textContent = `Usada el ${fecha}${r.clienteNombre ? ` · ${r.clienteNombre}` : ''}`;
            }
        } else {
            ultimaTasaEl.textContent = '—';
            if (ultimaTasaHint) ultimaTasaHint.textContent = 'Aún no hay remesas registradas';
        }
    }

    // Caja disponible: saldo real por moneda (caja abierta en vivo, o el
    // último saldo contado si está cerrada), igual que en la sección Caja.
    const { saldosPorMoneda } = calcularSaldosActuales(movimientosCajaActuales);
    const monedas = Object.keys(saldosPorMoneda).sort();
    const cajaDisponibleEl = document.getElementById('dashCajaDisponible');
    const cajaDisponibleHint = document.getElementById('dashCajaDisponibleHint');
    if (cajaDisponibleEl) {
        if (monedas.length === 0) {
            cajaDisponibleEl.textContent = '—';
            if (cajaDisponibleHint) cajaDisponibleHint.textContent = 'Sin movimientos de caja todavía';
        } else {
            cajaDisponibleEl.innerHTML = monedas.map(m => `
                <span class="stat-value-list-row">
                    <span class="stat-value-list-moneda">${escapeHtml(m)}</span>
                    <span>${formatMoney(saldosPorMoneda[m], '')}</span>
                </span>
            `).join('');
            if (cajaDisponibleHint) {
                cajaDisponibleHint.textContent = cierreAbiertoActual
                    ? 'Caja abierta · saldo en vivo'
                    : 'Caja cerrada · último saldo contado';
            }
        }
    }

    // Totales convertidos a USD y a moneda local (CLP), usando las tasas
    // configuradas en Configuración. Si falta una tasa para alguna moneda,
    // el total queda incompleto y se avisa en el hint (no se inventa un valor).
    let totalUsd = 0, totalUsdCompleto = true;
    let totalLocal = 0, totalLocalCompleto = true;
    monedas.forEach(m => {
        const enUsd = convertirMoneda(saldosPorMoneda[m], m, 'USDT');
        if (enUsd === null) totalUsdCompleto = false; else totalUsd += enUsd;
        const enLocal = convertirMoneda(saldosPorMoneda[m], m, 'CLP');
        if (enLocal === null) totalLocalCompleto = false; else totalLocal += enLocal;
    });

    const totalUsdEl = document.querySelector('[data-stat="total-usd"]');
    const totalUsdHint = document.getElementById('dashTotalUsdHint');
    if (totalUsdEl) {
        totalUsdEl.textContent = monedas.length === 0 ? '—' : formatMoney(totalUsd, 'USDT');
        if (totalUsdHint) {
            totalUsdHint.textContent = monedas.length === 0
                ? 'Sin saldo en caja'
                : (totalUsdCompleto ? 'Convertido con tus tasas configuradas' : 'Incompleto: falta una tasa a USDT para alguna moneda');
        }
    }

    const totalLocalEl = document.querySelector('[data-stat="total-local"]');
    const totalLocalHint = document.getElementById('dashTotalLocalHint');
    if (totalLocalEl) {
        totalLocalEl.textContent = monedas.length === 0 ? '—' : formatMoney(totalLocal, 'CLP');
        if (totalLocalHint) {
            totalLocalHint.textContent = monedas.length === 0
                ? 'Sin saldo en caja'
                : (totalLocalCompleto ? 'Convertido con tus tasas configuradas' : 'Incompleto: falta una tasa a CLP para alguna moneda');
        }
    }
}

// Fecha límite (hace N meses, a medianoche) usada por remesas.js y caja.js
// para acotar la ventana por defecto de sus escuchas en tiempo real.
export function fechaLimiteVentana(meses) {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() - meses);
    fecha.setHours(0, 0, 0, 0);
    return fecha;
}
