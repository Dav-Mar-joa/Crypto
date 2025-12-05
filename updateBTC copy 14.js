const axios = require("axios");
const { MongoClient } = require("mongodb");
require("dotenv").config();

// ===========================
//     MONGO CONNECTION
// ===========================
const url =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL;

if (!url) {
  console.error("❌ ERREUR : pas d’URL MongoDB !");
  process.exit(1);
}

const client = new MongoClient(url);

const DB_NAME = "Crypto";
const COLLECTION_PRICE = "Bitcoin";
const COLLECTION_SIGNALS = "Signals";
const COLLECTION_TRADES = "Trades";

// ======== PARAMÈTRES =========
const SEUIL = 0.01 // % variation 

// ======== VARIABLES DE TENDANCE =========
let lastPrice = null;
let lastTrend = null;   // "up" ou "down"
let lastBuy = null;
let lastSell = null;

// ========> VARIABLES POUR CALCUL PROFIT <========
let variationProfit = null;
let profit = null;

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
            // console.log("Variation pour BUY :", variation);
            // console.log("prix vente et achat : gap", lastSell, price , lastSell - price);

            if (variation > SEUIL) {
                signal = "BUY";
                lastBuy = price
            }    
        }
    }

    // === CAS BAISSE
    if (trend === "down") {
        lastLow = Math.min(lastLow, price);

        if (lastTrend === "up") {
            const variation = (price- lastHigh) / lastHigh*100;
            console.log("Variation pour SELL :", variation);
            console.log("prix achat et vente : gain", lastBuy, price , price-lastBuy);
            if (variation < -SEUIL) {
                signal = "SELL";
                lastSell = price
            }
                
        }
    }

    lastTrend = trend;
    lastPrice = price;

    return signal;
}

async function saveToDB(price, signal) {
    try {
        if (!client.topology || client.topology.isDestroyed()) {
            await client.connect();
        }

        const db = client.db(DB_NAME);
        const colPrice = db.collection(COLLECTION_PRICE);
        const colSignals = db.collection(COLLECTION_SIGNALS);

        // Enregistrer le prix brut
        await colPrice.insertOne({
            price,
            updatedAt: new Date()
        });
        // Calculer la variation profit si possible

        if(signal==="SELL"){
            variationProfit=price && lastBuy ? (lastBuy- price) / price * 100 : null;
            // Gain
            profit = price && lastBuy ? lastBuy-price: null;
        } 
        else {
            variationProfit = null;
            profit = null;
        }
        // Enregistrer le signal
        await colSignals.insertOne({
            price,
            signal,
            trend: lastTrend,
            low: lastLow,
            high: lastHigh,
            lastBuy,
            lastSell,
            variationProfit,
            profit,
            date: new Date()
        });

        console.log("💾 Données enregistrées dans MongoDB !");
    } catch (err) {
        console.error("❌ Erreur MongoDB :", err.message);
    }
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
    await saveToDB(price, signal);
}

// lance toutes les 20 secondes
setInterval(loop, 20_000);
