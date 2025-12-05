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

// ===========================
//        VARIABLES
// ===========================
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;

let positionOpen = null; // prix d’achat ouvert

// ===========================
//    CONFIGURATION TRADING
// ===========================
const SEUIL = 0.01;        // % variation pour signal
const EMA_WINDOW = 10;    // lissage EMA
const STOP_LOSS = 0.15;    // -0.15% sous le prix d'achat
const TAKE_PROFIT = 0.2;    // +0.2% au-dessus du prix d'achat

// ===========================
//         EMA smoothing
// ===========================
function ema(history, window = EMA_WINDOW) {
  if (!history.length) return null;
  const k = 2 / (window + 1);
  let emaPrev = history[0].price;
  for (let i = 1; i < history.length; i++) {
    emaPrev = history[i].price * k + emaPrev * (1 - k);
  }
  return emaPrev;
}

// ===========================
//   CALCUL SIGNAUX BUY/SELL
// ===========================
function calculateSignal(currentSmooth) {
  let signal = "Hold";

  if (lastSmooth === null) {
    lastSmooth = currentSmooth;
    lastLow = currentSmooth;
    lastHigh = currentSmooth;
    return signal;
  }

  // HAUSSE
  if (currentSmooth > lastSmooth) {
    lastHigh = Math.max(lastHigh, currentSmooth);

    if (lastTrend === "down") {
      const variation = ((currentSmooth - lastLow) / lastLow) * 100;
      if (variation >= SEUIL) signal = "Buy";
    }

    lastTrend = "up";
  }

  // BAISSE
  else if (currentSmooth < lastSmooth) {
    lastLow = Math.min(lastLow, currentSmooth);

    if (lastTrend === "up") {
      const variation = ((lastHigh - currentSmooth) / lastHigh) * 100;
      if (variation >= SEUIL) signal = "Sell";
    }

    lastTrend = "down";
  }

  lastSmooth = currentSmooth;
  return signal;
}

// ===========================
//     TRADE MANAGER
// ===========================
async function processTrade(signal, price, tradesCol) {
  if (signal === "Buy") {
    if (positionOpen !== null) return "Hold"; // déjà une position

    positionOpen = price;

    await tradesCol.insertOne({
      type: "BUY",
      price,
      date: new Date()
    });

    console.log(`🟢 BUY exécuté à ${price} USD`);
    return "Buy";
  }

  if (signal === "Sell" && positionOpen !== null) {
    const buyPrice = positionOpen;

    // Stop-loss
    if (price <= buyPrice * (1 - STOP_LOSS / 100)) {
      console.log("⚠ STOP LOSS déclenché !");
    }
    // Take-profit
    else if (price >= buyPrice * (1 + TAKE_PROFIT / 100)) {
      console.log("🎯 TAKE PROFIT atteint !");
    }
    // Vente non profitable → ne rien faire
    else if (price <= buyPrice) {
      return "Hold";
    }

    const profitUSD = price - buyPrice;
    const profitPercent = (profitUSD / buyPrice) * 100;

    await tradesCol.insertOne({
      type: "SELL",
      buyPrice,
      sellPrice: price,
      profitUSD,
      profitPercent,
      date: new Date()
    });

    console.log(
      `🔴 SELL exécuté à ${price} USD | Profit : ${profitUSD.toFixed(2)} USD (${profitPercent.toFixed(2)}%)`
    );

    positionOpen = null;
    return "Sell";
  }

  return "Hold";
}

// ===========================
//      UPDATE PRINCIPAL
// ===========================
async function updateBitcoinPrice() {
  try {
    if (!client.topology || client.topology.isDestroyed()) {
      await client.connect();
    }

    const db = client.db(DB_NAME);
    const colPrice = db.collection(COLLECTION_PRICE);
    const colSignals = db.collection(COLLECTION_SIGNALS);
    const colTrades = db.collection(COLLECTION_TRADES);

    // API Prix BTC
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true"
    );

    const price = res.data.bitcoin.usd;
    const marketCap = res.data.bitcoin.usd_market_cap;
    const volume = res.data.bitcoin.usd_24h_vol;

    // Historique pour EMA
    const history = await colPrice.find().sort({ updatedAt: 1 }).toArray();
    const smooth = ema(history.concat([{ price }]));

    // Variation instantanée
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // Signal
    const rawSignal = calculateSignal(smooth);

    // INSERT dans Signals
    await colSignals.insertOne({
      price,
      smoothPrice: smooth,
      signal: rawSignal,
      variation,
      positionOpen: positionOpen !== null,
      marketCap,
      volume,
      date: new Date()
    });

    // Exécuter trade si nécessaire
    const action = await processTrade(rawSignal, price, colTrades);

    // INSERT dans Bitcoin (historique complet)
    await colPrice.insertOne({
      price,
      smoothPrice: smooth,
      variation,
      positionOpen: positionOpen !== null,
      marketCap,
      volume,
      updatedAt: new Date()
    });

    console.log("✔ Mise à jour BTC :", {
      price,
      smooth,
      rawSignal,
      action,
      positionOpen
    });

  } catch (err) {
    console.error("❌ Erreur update BTC :", err);
  }
}

// ===========================
//          CRON
// ===========================
setInterval(() => {
  console.log("\n----- Nouvelle itération -----");
  updateBitcoinPrice();
}, 60000);

module.exports = { updateBitcoinPrice };
