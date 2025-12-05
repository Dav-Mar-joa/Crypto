const axios = require("axios");

// ======== PARAMÈTRES =========
const SEUIL = 0.01;  // % variation 

// ======== VARIABLES DE TENDANCE =========
let lastPrice = null;
let lastTrend = null;   // "up" ou "down"

// ======== RÉCUPÉRATION DU PRIX BTC =========
async function getPrice() {
    try {
        const r = await axios.get(
            "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
        );
        return parseFloat(r.data.price);
    } catch (err) {
        console.error("Erreur API Binance :", err.message);
        return null;
    }
}

// ======== LOGIQUE DE SIGNAL =========
// function getSignal(price) {
//     if (lastPrice === null) {
//         lastPrice = price;
//         lastTrend = null;
//         return "HOLD (init)";
//     }

//     const variation = (price - lastPrice) / lastPrice;
//     const currentTrend = variation > 0 ? "up" : "down";

//     // BUY = passage de down → up avec seuil
//     if (lastTrend === "down" && currentTrend === "up" && Math.abs(variation) >= SEUIL) {
//         lastTrend = currentTrend;
//         lastPrice = price;
//         return "BUY";
//     }

//     // SELL = passage de up → down avec seuil
//     if (lastTrend === "up" && currentTrend === "down" && Math.abs(variation) >= SEUIL) {
//         lastTrend = currentTrend;
//         lastPrice = price;
//         return "SELL";
//     }

//     // Sinon HOLD normal
//     lastTrend = currentTrend;
//     lastPrice = price;

//     return "HOLD";
// }
let lastLow = null;
let lastHigh = null;

function getSignal(price) {
    let signal = "HOLD";

    if (lastPrice === null) {
        lastPrice = price;
        lastLow = price;
        lastHigh = price;
        return "HOLD (init)";
    }

    const trend = price > lastPrice ? "up" : "down";

    // === CAS HAUSSE
    if (trend === "up") {
        lastHigh = Math.max(lastHigh, price);

        if (lastTrend === "down") {
            const variation = (price - lastLow) / lastLow*100;
            console.log("Variation pour BUY :", variation);

            if (variation > SEUIL) signal = "BUY";
        }
    }

    // === CAS BAISSE
    if (trend === "down") {
        lastLow = Math.min(lastLow, price);

        if (lastTrend === "up") {
            const variation = (price- lastHigh) / lastHigh*100;
            console.log("Variation pour SELL :", variation);
            if (variation < SEUIL) signal = "SELL";
        }
    }

    lastTrend = trend;
    lastPrice = price;

    return signal;
}


// ======== LOOP =========
async function loop() {
    const price = await getPrice();
    if (!price) return;

    const signal = getSignal(price);

    console.log(
        new Date().toLocaleTimeString("fr-FR", { hour12: false }),
        "| Price:", price,
        "| Trend:", lastTrend,
        "| Signal:", signal
    );
}

// lance toutes les 20 secondes
setInterval(loop, 20_000);
