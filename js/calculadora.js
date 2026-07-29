// ============================================
// CALCULADORA — script independiente, SIN dependencia de Firebase.
// Se carga aparte para que funcione siempre, incluso si Firebase
// tarda o falla en cargar (red lenta, bloqueador, etc.).
// ============================================

// ============================================
// De compra/venta de USDT a la tasa full del formulario de Tasas de cambio.
// Flujo real del negocio: compras USDT pagando en la moneda de origen
// (ej. CLP) y vendes ese mismo USDT recibiendo la moneda de destino
// (ej. VES). El cruce (venta/compra) es la tasa full del día para ese
// par, que se guarda en el campo "tasaBase" del formulario de abajo;
// app.js se encarga de aplicarle los márgenes de compra/venta.
// ============================================
const calcCompraValorInput = document.getElementById('calcCompraValor');
const calcVentaValorInput = document.getElementById('calcVentaValor');
const tasaBaseInputCalc = document.getElementById('tasaBase');

function recalcularTasaBaseDesdeUsdt() {
    const compraValor = parseFloat(calcCompraValorInput.value);
    const ventaValor = parseFloat(calcVentaValorInput.value);

    if (!compraValor || !ventaValor || compraValor <= 0 || ventaValor <= 0) {
        return;
    }

    const tasaFull = ventaValor / compraValor;
    tasaBaseInputCalc.value = Number(tasaFull.toFixed(6));

    // Disparar 'input' para que app.js recalcule la vista previa de compra/venta.
    tasaBaseInputCalc.dispatchEvent(new Event('input', { bubbles: true }));
}

[calcCompraValorInput, calcVentaValorInput].forEach(el => {
    el.addEventListener('input', recalcularTasaBaseDesdeUsdt);
});

// Calcular de inmediato con los valores ya presentes al cargar la página
// (por si el navegador restauró valores de un formulario sin disparar 'input').
recalcularTasaBaseDesdeUsdt();
