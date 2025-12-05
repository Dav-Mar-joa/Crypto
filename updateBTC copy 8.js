const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ===========================
//       MONGO URL
// ===========================
const url =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL;

if (!url) {
  console.error("❌ ERREUR : aucune variable MONGO n’est définie dans .env !");
  process.exit(1);
}

const client = new MongoClient(url);

const DB_NAME = "Crypto";
const COLLECTION = "Bitcoin";

// ===========================
//   VARIABLES EN MÉMOIRE
// ===========================
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;

let lastBuyForProfit = null; // prix du dernier BUY réel (position ouverte)
let lastBuyPrice = null;
let sellPrice = null;
let profitUSD = null;
let profitPercent = null;

// ===========================
//      CONFIGURATION
// ===========================
const SEUIL = 0.5;       // variation minimale pour signal en %
const EMA_WINDOW = 10;    // window EMA
const STOP_LOSS = 1.5;    // % en dessous du BUY pour forcer vente
const TAKE_PROFIT = 2;    // % au-dessus du BUY pour vendre automatiquement

// ===========================
//      EMA LONGUE
// ===========================
function ema(history, window = EMA_WINDOW) {
  if (history.length === 0) return null;
  const k = 2 / (window + 1);
  let emaPrev = history[0].price;
  for (let i = 1; i < history.length; i++) {
    emaPrev = history[i].price * k + emaPrev * (1 - k);
  }
  return emaPrev;
}

// ===========================
//      CALCUL SIGNAL
// ===========================
function calculateSignal(currentSmooth) {
  let signal = "";

  if (lastSmooth === null) {
    lastSmooth = currentSmooth;
    lastLow = currentSmooth;
    lastHigh = currentSmooth;
    return "";
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
//   BUY / SELL SÉCURISÉE
// ===========================
function processTrade(signal, price) {
  let action = "Hold";

  // ========= BUY =========
  if (signal === "Buy") {
    if (lastBuyForProfit !== null) return "Hold";
    lastBuyForProfit = price;
    console.log(`🟢 BUY exécuté à ${price} USD`);
    return "Buy";
  }

  // ========= SELL =========
  if (signal === "Sell") {
    if (lastBuyForProfit === null) return "Hold";

    // Stop-loss
    if (price <= lastBuyForProfit * (1 - STOP_LOSS / 100)) {
      console.log(`⚠️ STOP-LOSS déclenché à ${price} USD`);
    }
    // Take-profit
    else if (price >= lastBuyForProfit * (1 + TAKE_PROFIT / 100)) {
      console.log(`🎯 TAKE-PROFIT atteint à ${price} USD`);
    }
    // Vente normale si profitable
    else if (price <= lastBuyForProfit) {
      return "Hold";
    }

    lastBuyPrice = lastBuyForProfit;
    sellPrice = price;

    profitUSD = sellPrice - lastBuyPrice;
    profitPercent = (profitUSD / lastBuyPrice) * 100;

    console.log(
      `🔴 SELL exécuté à ${price} USD (profit : ${profitUSD.toFixed(2)} USD / ${profitPercent.toFixed(2)}%)`
    );

    lastBuyForProfit = null;
    return "Sell";
  }

  return "Hold";
}

// ===========================
//  UPDATE PRINCIPAL
// ===========================
async function updateBitcoinPrice() {
  try {
    if (!client.topology || client.topology.isDestroyed()) {
      await client.connect();
    }

    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // 1) Récup API
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true"
    );
    const price = res.data.bitcoin.usd;
    const marketCap = res.data.bitcoin.usd_market_cap;
    const volume = res.data.bitcoin.usd_24h_vol;

    // 2) Historique
    const history = await col.find().sort({ updatedAt: 1 }).toArray();
    const smooth = ema(history.concat([{ price }]));

    // 3) Variation
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // 4) Signal
    const rawSignal = calculateSignal(smooth);

    // 5) BUY / SELL sécurisé
    const action = processTrade(rawSignal, price);

    // 6) Insert DB
    await col.insertOne({
      price,
      smoothPrice: smooth,
      signal: action,
      variation,
      lastBuyValue: lastBuyForProfit,
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,
      marketCap,
      volume,
      updatedAt: new Date()
    });

    console.log("✔️ BTC enregistré :", {
      price,
      smooth,
      action,
      lastBuyValue: lastBuyForProfit,
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent
    });

  } catch (err) {
    console.error("❌ Erreur update BTC :", err);
  }
}

// ===========================
//  CRON 60 SECONDES
// ===========================
setInterval(async () => {
  console.log("\n----- Nouvelle itération -----");
  await updateBitcoinPrice();
}, 60000);

module.exports = { updateBitcoinPrice };
