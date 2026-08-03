import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml, formatMoney, fechaEnRango, badgeClass, badgeLabel,
    badgePagoLabel, claveTasa, normalizarNombre, normalizarTexto,
    detectarDelimitador, parsearLinea, parsearMontoCLP, parsearFechaSII,
    diferenciaEnDias, parsearBoletasPegadas, montoCLPDeRemesa,
    calcularTasaCruzada, calcularCompraVentaUSDT
} from './utils.js';

// --- escapeHtml ---
test('escapeHtml escapa caracteres peligrosos', () => {
    assert.equal(escapeHtml(`<b>"O'Brien" & Cía</b>`), '&lt;b&gt;&quot;O&#039;Brien&quot; &amp; Cía&lt;/b&gt;');
});
test('escapeHtml maneja null/undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});

// --- formatMoney ---
test('formatMoney formatea con separador de miles chileno', () => {
    assert.equal(formatMoney(15000, 'CLP'), '15.000 CLP');
});
test('formatMoney devuelve — para valores inválidos', () => {
    assert.equal(formatMoney(null, 'CLP'), '—');
    assert.equal(formatMoney(NaN, 'CLP'), '—');
});

// --- fechaEnRango ---
test('fechaEnRango sin timestamp respeta rango vacío', () => {
    assert.equal(fechaEnRango(null, '', ''), true);
    assert.equal(fechaEnRango(null, '2026-01-01', ''), false);
});
test('fechaEnRango filtra correctamente dentro y fuera de rango', () => {
    const ts = { toDate: () => new Date('2026-03-15T12:00:00') };
    assert.equal(fechaEnRango(ts, '2026-03-01', '2026-03-31'), true);
    assert.equal(fechaEnRango(ts, '2026-04-01', ''), false);
    assert.equal(fechaEnRango(ts, '', '2026-03-01'), false);
});

// --- badges ---
test('badgeClass y badgeLabel mapean los tres estados', () => {
    assert.equal(badgeClass('completado'), 'badge badge-success');
    assert.equal(badgeClass('cancelado'), 'badge badge-danger');
    assert.equal(badgeClass('pendiente'), 'badge badge-pending');
    assert.equal(badgeLabel('completado'), 'Completado');
    assert.equal(badgeLabel('cancelado'), 'Cancelado');
    assert.equal(badgeLabel('otracosa'), 'Pendiente');
});
test('badgePagoLabel incluye el banco solo si es transferencia', () => {
    assert.equal(badgePagoLabel('transferencia', 'BancoEstado'), 'Transferencia · BancoEstado');
    assert.equal(badgePagoLabel('transferencia', ''), 'Transferencia');
    assert.equal(badgePagoLabel('caja_vecina', ''), 'Caja Vecina');
    assert.equal(badgePagoLabel('efectivo', ''), 'Efectivo');
});

// --- claveTasa / normalizarNombre ---
test('claveTasa normaliza a mayúsculas sin espacios', () => {
    assert.equal(claveTasa(' clp ', 'pen'), 'CLP_PEN');
});
test('normalizarNombre colapsa espacios y pasa a minúsculas', () => {
    assert.equal(normalizarNombre('  Juan   Pérez  '), 'juan   pérez'.replace(/\s+/g, ' '));
});

// --- normalizarTexto ---
test('normalizarTexto quita tildes y mayúsculas', () => {
    assert.equal(normalizarTexto('Fecha Emisión'), 'fecha emision');
});

// --- detectarDelimitador ---
test('detectarDelimitador reconoce tab, punto y coma, coma', () => {
    assert.equal(detectarDelimitador('a\tb\tc'), '\t');
    assert.equal(detectarDelimitador('a;b;c'), ';');
    assert.equal(detectarDelimitador('a,b,c'), ',');
    assert.equal(detectarDelimitador('sin delimitador'), '\t');
});

// --- parsearLinea ---
test('parsearLinea respeta comillas con delimitador coma', () => {
    assert.deepEqual(parsearLinea('"a, b",c,d', ','), ['a, b', 'c', 'd']);
});
test('parsearLinea con tab no usa lógica de comillas', () => {
    assert.deepEqual(parsearLinea('a\tb\tc', '\t'), ['a', 'b', 'c']);
});

// --- parsearMontoCLP ---
// Nota sobre el comportamiento real: un solo punto se interpreta como
// separador decimal ("15.000" -> 15); solo con 2+ puntos se asume que
// son separadores de miles. Es el comportamiento preexistente de la
// función, documentado aquí para que un futuro cambio accidental lo note.
test('parsearMontoCLP con un solo punto lo trata como decimal', () => {
    assert.equal(parsearMontoCLP('$ 15.000'), 15);
});
test('parsearMontoCLP con varios puntos los trata como miles', () => {
    assert.equal(parsearMontoCLP('1.500.000'), 1500000);
});
test('parsearMontoCLP interpreta coma como decimal', () => {
    assert.equal(parsearMontoCLP('1.234,50'), 1235); // redondeado
});
test('parsearMontoCLP con texto vacío devuelve NaN', () => {
    assert.ok(isNaN(parsearMontoCLP('')));
    assert.ok(isNaN(parsearMontoCLP(null)));
});

// --- parsearFechaSII ---
test('parsearFechaSII soporta yyyy-mm-dd', () => {
    const d = parsearFechaSII('2026-03-15');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2);
    assert.equal(d.getDate(), 15);
});
test('parsearFechaSII soporta dd-mm-yyyy y dd/mm/yyyy', () => {
    const d1 = parsearFechaSII('15-03-2026');
    const d2 = parsearFechaSII('15/03/2026');
    assert.equal(d1.getTime(), d2.getTime());
});
test('parsearFechaSII con valor vacío devuelve null', () => {
    assert.equal(parsearFechaSII(''), null);
    assert.equal(parsearFechaSII(null), null);
});

// --- diferenciaEnDias ---
test('diferenciaEnDias calcula días absolutos entre fechas', () => {
    const a = new Date(2026, 2, 1);
    const b = new Date(2026, 2, 5);
    assert.equal(diferenciaEnDias(a, b), 4);
    assert.equal(diferenciaEnDias(b, a), 4);
});

// --- parsearBoletasPegadas ---
test('parsearBoletasPegadas extrae boletas válidas e ignora anuladas', () => {
    const texto = [
        'Folio;Fecha Emisión;Monto Total;Estado',
        '1;15-03-2026;1.500.000;Vigente',
        '2;16-03-2026;2.000.000;Anulada',
        '3;17-03-2026;500.000;'
    ].join('\n');
    const { boletas, error } = parsearBoletasPegadas(texto);
    assert.equal(error, null);
    assert.equal(boletas.length, 2);
    assert.equal(boletas[0].folio, '1');
    assert.equal(boletas[0].monto, 1500000);
});
test('parsearBoletasPegadas exige columna de monto', () => {
    const { error } = parsearBoletasPegadas('Folio;Fecha\n1;15-03-2026');
    assert.match(error, /Monto/);
});
test('parsearBoletasPegadas exige al menos encabezado + una fila', () => {
    const { error } = parsearBoletasPegadas('Folio;Monto');
    assert.match(error, /al menos/);
});

// --- montoCLPDeRemesa ---
test('montoCLPDeRemesa toma el lado en CLP, sea origen o destino', () => {
    assert.equal(montoCLPDeRemesa({ monedaEnviado: 'CLP', montoEnviado: 15000 }), 15000);
    assert.equal(montoCLPDeRemesa({ monedaRecibido: 'CLP', montoRecibido: 20000 }), 20000);
    assert.equal(montoCLPDeRemesa({ monedaEnviado: 'USD', monedaRecibido: 'PEN' }), null);
});

// --- calcularTasaCruzada ---
test('calcularTasaCruzada aplica el margen sobre la tasa de mercado', () => {
    const r = calcularTasaCruzada(1, 950, 5); // 1 USD = 950 CLP, margen 5%
    assert.equal(r.tasaMercado, 950);
    assert.equal(r.tasaResultado, 950 * 0.95);
});
test('calcularTasaCruzada devuelve null con valores inválidos', () => {
    assert.equal(calcularTasaCruzada(0, 950, 5), null);
    assert.equal(calcularTasaCruzada(1, 0, 5), null);
});

// --- calcularCompraVentaUSDT ---
test('calcularCompraVentaUSDT compra bajo el mercado y vende sobre el mercado', () => {
    const r = calcularCompraVentaUSDT(950, 2, 3);
    assert.equal(r.tasaCompra, 950 * 0.98);
    assert.equal(r.tasaVenta, 950 * 1.03);
});
test('calcularCompraVentaUSDT devuelve null sin valor de mercado', () => {
    assert.equal(calcularCompraVentaUSDT(0, 2, 3), null);
});
