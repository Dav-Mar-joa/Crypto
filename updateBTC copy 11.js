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
// VARIABLES GLOBALES
// ===========================
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;

// Stock signal pour calcul ratio signaux
let lastBuySignal = null;
let lastSellSignal = null;
let ratioSignal = null;

// Stock trades réels pour ratio trades
let lastBuyTrade = null;
let lastSellTrade = null;
let ratioTrade = null;

let positionOpen = null;

// ===========================
// CONFIG TRADING
// ===========================
const SEUIL = 0.010;      // Seuil de variation % pour signal
const EMA_WINDOW = 4;
const STOP_LOSS = 0.15;
const TAKE_PROFIT = 0.20;

// ===========================
//       EMA smoothing
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
      if (variation >= SEUIL) {
        signal = "Buy";
        lastBuySignal = currentSmooth; // 🔥 FIXED
        lastSellSignal = null;         // Reset pour cycle propre
      }
    }

    lastTrend = "up";
  }

  // BAISSE
  else if (currentSmooth < lastSmooth) {
    lastLow = Math.min(lastLow, currentSmooth);

    if (lastTrend === "up") {
      const variation = ((lastHigh - currentSmooth) / lastHigh) * 100;
      if (variation >= SEUIL) {
        signal = "Sell";

        if (lastBuySignal) {
          // 🔥 On a un cycle complet BUY → SELL
          lastSellSignal = currentSmooth;
          ratioSignal =
            ((lastSellSignal - lastBuySignal) / lastBuySignal) * 100;
        }
      }
    }

    lastTrend = "down";
  }

  lastSmooth = currentSmooth;
  return signal;
}

// ===========================
//      PROCESS TRADE
// ===========================
async function processTrade(signal, price, tradesCol) {
  // ---------------- BUY ----------------
  if (signal === "Buy") {
    if (positionOpen !== null) return "Hold";

    positionOpen = price;
    lastBuyTrade = price; // 🔥 Stock Buy réel
    lastSellTrade = null;

    await tradesCol.insertOne({
      type: "BUY",
      price,
      date: new Date()
    });

    console.log(`🟢 BUY exécuté à ${price}`);
    return "Buy";
  }

  // ---------------- SELL ----------------
  if (positionOpen !== null) {
    const buyPrice = positionOpen;
    let sellTriggered = false;

    // Stop-loss
    if (price <= buyPrice * (1 - STOP_LOSS / 100)) {
      console.log(`⚠ STOP LOSS déclenché`);
      sellTriggered = true;
    }

    // Take profit
    else if (price >= buyPrice * (1 + TAKE_PROFIT / 100)) {
      console.log(`🎯 TAKE PROFIT atteint`);
      sellTriggered = true;
    }

    // Signal Sell
    else if (signal === "Sell") {
      sellTriggered = true;
    }

    if (sellTriggered) {
      lastSellTrade = price; // 🔥 Stock Sell réel

      ratioTrade =
        ((lastSellTrade - lastBuyTrade) / lastBuyTrade) * 100;

      await tradesCol.insertOne({
        type: "SELL",
        buyPrice,
        sellPrice: price,
        profitUSD: price - buyPrice,
        profitPercent: ratioTrade,
        date: new Date()
      });

      console.log(
        `🔴 SELL exécuté à ${price} | Profit : ${ratioTrade.toFixed(2)}%`
      );

      positionOpen = null;
      return "Sell";
    }
  }

  return "Hold";
}

// ===========================
//   UPDATE PRIX & SIGNALS
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

    // Prix BTC
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
    const signal = calculateSignal(smooth);

    // Enregistre signal
    await colSignals.insertOne({
      price,
      smooth,
      signal,
      variation,
      ratioSignal,
      date: new Date()
    });

    // Trade
    const action = await processTrade(signal, price, colTrades);

    // Enregistre prix
    await colPrice.insertOne({
      price,
      smooth,
      variation,
      marketCap,
      volume,
      updatedAt: new Date()
    });

    console.log("✔️ Update BTC :", {
      price,
      smooth,
      signal,
      action,
      ratioSignal,
      ratioTrade,
    });

  } catch (err) {
    console.error("❌ Erreur update BTC :", err);
  }
}

// ===========================
//         CRON
// ===========================
setInterval(() => {
  console.log("\n----- Nouvelle itération -----");
  updateBitcoinPrice();
}, 60000);

module.exports = { updateBitcoinPrice };
