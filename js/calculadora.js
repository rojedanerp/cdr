// ============================================
// CALCULADORA — script independiente, SIN dependencia de Firebase.
// Se carga aparte para que funcione siempre, incluso si Firebase
// tarda o falla en cargar (red lenta, bloqueador, etc.).
// ============================================

// ============================================
// CALCULADORA DE TASAS — tasa cruzada a partir del valor de cada moneda vs USD
// ============================================
const calcOrigenCodigoInput = document.getElementById('calcOrigenCodigo');
const calcOrigenValorInput = document.getElementById('calcOrigenValor');
const calcDestinoCodigoInput = document.getElementById('calcDestinoCodigo');
const calcDestinoValorInput = document.getElementById('calcDestinoValor');
const calcMargenInput = document.getElementById('calcMargen');
const calcResultLabel = document.getElementById('calcResultLabel');
const calcResultValue = document.getElementById('calcResultValue');
const calcResultValueMercado = document.getElementById('calcResultValueMercado');
const calcGuardarBtn = document.getElementById('calcGuardarBtn');

let calcTasaResultado = null;      // tasa final, ya con el margen descontado (la que se ofrece/guarda)
let calcTasaMercado = null;        // tasa cruzada cruda, sin margen

function recalcularTasaCruzada() {
    const origenCodigo = calcOrigenCodigoInput.value.trim().toUpperCase();
    const destinoCodigo = calcDestinoCodigoInput.value.trim().toUpperCase();
    const origenValor = parseFloat(calcOrigenValorInput.value);
    const destinoValor = parseFloat(calcDestinoValorInput.value);
    const margen = parseFloat(calcMargenInput.value) || 0;

    if (!origenValor || !destinoValor || origenValor <= 0) {
        calcTasaResultado = null;
        calcTasaMercado = null;
        calcResultLabel.textContent = 'Tasa a ofrecer (con margen descontado)';
        calcResultValue.textContent = '—';
        calcResultValueMercado.textContent = '—';
        calcGuardarBtn.disabled = true;
        return;
    }

    calcTasaMercado = destinoValor / origenValor;
    calcTasaResultado = calcTasaMercado * (1 - margen / 100);

    const origenTxt = origenCodigo || 'ORIGEN';
    const destinoTxt = destinoCodigo || 'DESTINO';

    calcResultValueMercado.textContent = calcTasaMercado.toFixed(6);
    calcResultLabel.textContent = `1 ${origenTxt} = ${calcTasaResultado.toFixed(6)} ${destinoTxt} (margen ${margen}%)`;
    calcResultValue.textContent = calcTasaResultado.toFixed(3);
    calcGuardarBtn.disabled = !(origenCodigo && destinoCodigo);
}

[calcOrigenCodigoInput, calcOrigenValorInput, calcDestinoCodigoInput, calcDestinoValorInput, calcMargenInput].forEach(el => {
    el.addEventListener('input', recalcularTasaCruzada);
});

calcGuardarBtn.addEventListener('click', () => {
    if (calcTasaResultado === null) return;

    const tasaMonedaOrigenInput = document.getElementById('tasaMonedaOrigen');
    const tasaMonedaDestinoInput = document.getElementById('tasaMonedaDestino');
    const tasaValorInput = document.getElementById('tasaValor');
    const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');

    tasaMonedaOrigenInput.value = calcOrigenCodigoInput.value.trim().toUpperCase();
    tasaMonedaDestinoInput.value = calcDestinoCodigoInput.value.trim().toUpperCase();
    tasaValorInput.value = Number(calcTasaResultado.toFixed(6));
    // Se guarda también la tasa de mercado (sin margen) para que el reporte
    // de ganancia pueda comparar contra el costo real, no contra la tasa ya con margen.
    if (tasaMercadoValorInput && calcTasaMercado !== null) {
        tasaMercadoValorInput.value = Number(calcTasaMercado.toFixed(6));
    }

    document.querySelector('.nav-links li[data-section="config"]').click();
    tasaMonedaOrigenInput.focus();
});

// --- Compra y venta de USDT ---
const calcUsdtMonedaInput = document.getElementById('calcUsdtMoneda');
const calcUsdtValorMercadoInput = document.getElementById('calcUsdtValorMercado');
const calcUsdtMargenCompraInput = document.getElementById('calcUsdtMargenCompra');
const calcUsdtMargenVentaInput = document.getElementById('calcUsdtMargenVenta');
const calcUsdtMontoInput = document.getElementById('calcUsdtMonto');
const calcUsdtCompraLabel = document.getElementById('calcUsdtCompraLabel');
const calcUsdtCompraValue = document.getElementById('calcUsdtCompraValue');
const calcUsdtVentaLabel = document.getElementById('calcUsdtVentaLabel');
const calcUsdtVentaValue = document.getElementById('calcUsdtVentaValue');
const calcUsdtCompraMontoLabel = document.getElementById('calcUsdtCompraMontoLabel');
const calcUsdtCompraMontoValue = document.getElementById('calcUsdtCompraMontoValue');
const calcUsdtVentaMontoLabel = document.getElementById('calcUsdtVentaMontoLabel');
const calcUsdtVentaMontoValue = document.getElementById('calcUsdtVentaMontoValue');

function recalcularCompraVentaUSDT() {
    const moneda = calcUsdtMonedaInput.value.trim().toUpperCase() || 'MONEDA';
    const valorMercado = parseFloat(calcUsdtValorMercadoInput.value);
    const margenCompra = parseFloat(calcUsdtMargenCompraInput.value) || 0;
    const margenVenta = parseFloat(calcUsdtMargenVentaInput.value) || 0;
    const monto = parseFloat(calcUsdtMontoInput.value);

    if (!valorMercado || valorMercado <= 0) {
        calcUsdtCompraValue.textContent = '—';
        calcUsdtVentaValue.textContent = '—';
        calcUsdtCompraMontoValue.textContent = '—';
        calcUsdtVentaMontoValue.textContent = '—';
        calcUsdtCompraLabel.textContent = 'Tasa de compra (pagas por cada USDT que te venden)';
        calcUsdtVentaLabel.textContent = 'Tasa de venta (cobras por cada USDT que vendes)';
        calcUsdtCompraMontoLabel.textContent = 'USDT que recibes al comprar con ese monto';
        calcUsdtVentaMontoLabel.textContent = 'USDT que entregas al vender por ese monto';
        return;
    }

    // Compras USDT más barato que el mercado, vendes USDT más caro que el mercado — ahí está tu margen.
    const tasaCompra = valorMercado * (1 - margenCompra / 100);
    const tasaVenta = valorMercado * (1 + margenVenta / 100);

    calcUsdtCompraLabel.textContent = `Pagas 1 USDT = ${tasaCompra.toFixed(2)} ${moneda} (compra, −${margenCompra}%)`;
    calcUsdtCompraValue.textContent = tasaCompra.toFixed(2);
    calcUsdtVentaLabel.textContent = `Cobras 1 USDT = ${tasaVenta.toFixed(2)} ${moneda} (venta, +${margenVenta}%)`;
    calcUsdtVentaValue.textContent = tasaVenta.toFixed(2);

    if (!monto || monto <= 0) {
        calcUsdtCompraMontoValue.textContent = '—';
        calcUsdtVentaMontoValue.textContent = '—';
        calcUsdtCompraMontoLabel.textContent = 'USDT que recibes al comprar con ese monto';
        calcUsdtVentaMontoLabel.textContent = 'USDT que entregas al vender por ese monto';
        return;
    }

    // Con ese monto en pesos: cuántos USDT te entrega el cliente (a la tasa de compra)
    // y cuántos USDT le entregas tú al cliente (a la tasa de venta).
    const usdtCompra = monto / tasaCompra;
    const usdtVenta = monto / tasaVenta;

    calcUsdtCompraMontoLabel.textContent = `Con ${monto.toLocaleString('es-CL')} ${moneda} compras ${usdtCompra.toFixed(2)} USDT`;
    calcUsdtCompraMontoValue.textContent = `${usdtCompra.toFixed(2)} USDT`;
    calcUsdtVentaMontoLabel.textContent = `Con ${monto.toLocaleString('es-CL')} ${moneda} vendes ${usdtVenta.toFixed(2)} USDT`;
    calcUsdtVentaMontoValue.textContent = `${usdtVenta.toFixed(2)} USDT`;
}

[calcUsdtMonedaInput, calcUsdtValorMercadoInput, calcUsdtMargenCompraInput, calcUsdtMargenVentaInput, calcUsdtMontoInput].forEach(el => {
    el.addEventListener('input', recalcularCompraVentaUSDT);
});

// Calcular de inmediato con los valores ya presentes al cargar la página
// (por si el navegador restauró valores de un formulario sin disparar 'input').
recalcularTasaCruzada();
recalcularCompraVentaUSDT();
