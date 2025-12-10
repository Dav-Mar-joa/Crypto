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
const SEUIL = 0.0001 // % variation 
// const commisionPrice = 0.15; // frais de commission en $
const feeRate = 0.000015; // 0.15%
// ======== VARIABLES DE TENDANCE =========
let lastPrice = null;
let lastTrend = null;   // "up" ou "down"
let lastBuy = null;
let lastSell = null;
let inPosition = false;

// ========> VARIABLES POUR CALCUL PROFIT <========
let variationProfit = null;
let profit = null;
let nbBTC = 0.01; // nbre BTC

async function loadWallet() {
    const db = client.db(DB_NAME);
    const col = db.collection("Wallet");

    let w = await col.findOne({ type: "wallet" });
    if (w) return w;

    const newWallet = {
        type: "wallet",
        usdt: 400,
        btc: 0,
        totalInvested: 400,
        totalFeesPaid: 0,
        totalProfit: 0,
        lastUpdate: new Date(),
        history: [] 
    };

    await col.insertOne(newWallet);
    return newWallet;
}

async function simulateBuy(price, amountUSDT) {
    // const feeRate = 0.0015; // 0.15%

    const wallet = await loadWallet();
    if (wallet.usdt < amountUSDT) {
        console.log("❌ Pas assez d'USDT");
        return wallet;
    }

    const btcBought = amountUSDT / price;
    const feeBTC = btcBought * feeRate;

    wallet.btc += btcBought - feeBTC;
    wallet.usdt -= amountUSDT;
    wallet.totalFeesPaid += feeBTC * price;

    wallet.lastUpdate = new Date();
    if (!wallet.history) wallet.history = [];
    wallet.history.push({
    type: "BUY",
    price,
    amountUSDT,
    btcBought: btcBought - feeBTC,
    feePaid: feeBTC * price,
    date: new Date()
});

    await client.db(DB_NAME).collection("Wallet").updateOne(
        { type: "wallet" },
        { $set: wallet }
    );

    await saveTrade("BUY", price, amountUSDT, btcBought - feeBTC);

    return wallet;
}

async function simulateSell(price) {
    // const feeRate = 0.0015;

    const wallet = await loadWallet();
    if (wallet.btc <= 0) {
        console.log("❌ Pas de BTC à vendre");
        return wallet;
    }

    const usdtReceived = wallet.btc * price;
    const feeUSDT = usdtReceived * feeRate;

    wallet.usdt += (usdtReceived - feeUSDT);
    wallet.totalFeesPaid += feeUSDT;
    wallet.totalProfit = wallet.usdt - wallet.totalInvested;
    wallet.btc = 0;

    wallet.lastUpdate = new Date();
    if (!wallet.history) wallet.history = [];
    wallet.history.push({
    type: "SELL",
    price,
    usdtReceived: usdtReceived - feeUSDT,
    btcSold: wallet.btc,
    feePaid: feeUSDT,
    date: new Date()
});


    await client.db(DB_NAME).collection("Wallet").updateOne(
        { type: "wallet" },
        { $set: wallet }
    );

    await saveTrade("SELL", price, usdtReceived - feeUSDT, wallet.btc);

    return wallet;
}

async function saveTrade(type, price, amountUSDT, btcAmount) {
    const col = client.db(DB_NAME).collection(COLLECTION_TRADES);

    await col.insertOne({
        type,
        price,
        amountUSDT,
        btcAmount,
        date: new Date()
    });

    console.log(`💼 Trade enregistré : ${type} @ ${price}`);
}


// ======== RÉCUPÉRATION DU PRIX BTC =========
// async function getPrice() {
//     try {
//         const r = await axios.get(
//             "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
//         );
//         return parseFloat(r.data.price);
//     } catch (err) {
//         console.error("Erreur API Binance :", err.message);
//         return null;
//     }
// }

// ======== RÉCUPÉRATION DU PRIX BTC via CoinGecko =========
async function getPrice() {
    try {
        const r = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        );

        const price = r.data.bitcoin.usd;

        return parseFloat(price);
    } catch (err) {
        console.error("Erreur API CoinGecko :", err.message);
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

    // if (lastPrice === null) {
    //     lastPrice = price;
    //     lastLow = price;
    //     lastHigh = price;
    //     return "HOLD (init)";
    // }
    // PREMIÈRE EXÉCUTION
    if (lastPrice === null) {
        lastPrice = price;
        lastLow = price;
        lastHigh = price;
        lastTrend = "up"; // ou "down", juste pour initialiser
        if (!inPosition) {
            signal = "BUY";    // force le premier achat
            lastBuy = price;
            inPosition = true;
        }
        return signal;
    }

    const trend = price > lastPrice ? "up" : "down";

    // === CAS HAUSSE
    if (trend === "up") {
        lastHigh = Math.max(lastHigh, price);

        if (lastTrend === "down" && !inPosition ) {
            const variation = (price - lastLow) / lastLow*100;
            // console.log("Variation pour BUY :", variation);
            // console.log("prix vente et achat : gap", lastSell, price , lastSell - price);

            if (variation > SEUIL) {
                signal = "BUY";
                lastBuy = price
                // inPosition = true;
            }    
        }
    }

    // === CAS BAISSE
    if (trend === "down") {
        lastLow = Math.min(lastLow, price);

        if (lastTrend === "up" && inPosition) {
            const gain = price - lastBuy; // calcul du gain 
            // réel
            // const commission = price * (commisionPrice / 100); // 0.15% du prix de vente

            const commission = price * feeRate;
            const gainNet = gain - commission;
            const variation = (price- lastHigh) / lastHigh*100;
            console.log("Variation pour SELL :", variation);
            console.log("prix achat et vente : gain", lastBuy, price , price-lastBuy);
            if (variation < -SEUIL && gainNet > 0) {
                signal = "SELL";
                lastSell = price
                // inPosition = false;
                console.log("------------------------------");
                console.log("Variation pour SELL validé:", variation);
            console.log("prix achat et vente : gain", lastBuy, price , price-lastBuy);
            console.log("------------------------------");
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

        if (signal === "SELL" && lastBuy) {
            profit = price - lastBuy;
            variationProfit = ((price - lastBuy) / lastBuy) * 100;
        } else {
            profit = null;
            variationProfit = null;
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
            date: new Date(),
	    inPosition
           
        });

        console.log("💾 Données enregistrées dans MongoDB !");
    } catch (err) {
        console.error("❌ Erreur MongoDB :", err.message);
    }
}

async function loadLastState() {
  const db = client.db(DB_NAME);
  const signalsCol = db.collection(COLLECTION_SIGNALS);
  const lastSignal = await signalsCol.find().sort({ date: -1 }).limit(1).toArray();
  if (lastSignal[0]) {
    lastPrice = lastSignal[0].price;
    lastLow = lastSignal[0].low;
    lastHigh = lastSignal[0].high;
    lastTrend = lastSignal[0].trend;
    lastBuy = lastSignal[0].lastBuy;
    lastSell = lastSignal[0].lastSell;
    inPosition = lastSignal[0].inPosition || false;
  }
  console.log("État restauré :", {
        lastBuy,
        lastSell,
        inPosition,
        lastLow,
        lastHigh,
        lastTrend
    });
}


// ======== LOOP =========
async function loop() {
// async function updateBitcoinPrice() {
    const price = await getPrice();
    if (!price) return;

    const signal = getSignal(price);

    console.log(
        new Date().toLocaleTimeString("fr-FR", { hour12: false }),
        "| Price:", price,
        "| Trend:", lastTrend,
        "| Signal:", signal
    );

    if (signal === "BUY" && !inPosition) {
        await simulateBuy(price, 400); // montant d’achat
        inPosition = true;
    }

    if (signal === "SELL" && inPosition) {
        await simulateSell(price);
        inPosition = false;
    }
    await saveToDB(price, signal);
}

// lance toutes les 60 secondes
// setInterval(loop, 60_000);
// ========= DÉMARRAGE =========
// (async () => {
//     console.log("Chargement de l'état du bot...");
//     await loadLastState();   // ⬅️ IMPORTANT : retrouver position + low/high + tendance

//     console.log("Lancement de la première analyse...");
//     await loop();            // ⬅️ Première exécution non différée

//     console.log("Démarrage de la boucle toutes les 60 secondes...");
//     //  process.exit(0);
//     setInterval(loop, 60_000);   // ⬅️ Pour toi si tu restes sur setInterval
// })();



// ======================
// Si exécuté directement (cron)
// ======================

async function updateBitcoinPrice() {
    await loadLastState();
    await loop();
}

if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}

// =========================
// EXPORT pour server.js
// =========================

module.exports = { updateBitcoinPrice };

// ======================
// Si exécuté directement (cron)
// ======================

