const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ====== MONGO URL ======
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

// ====== VARIABLES MÉMOIRE ======
let lastSmooth = null;
let lastLow = null;
let lastHigh = null;
let lastTrend = null;
let lastBuyForProfit = null; // mémorise le vrai BUY local

const SEUIL = 0.01; // 0.01% de variation pour déclencher signal

// ====== LISSAGE (moyenne mobile simple) ======
function smoothPrice(history, window = 2) {
  if (history.length === 0) return null;
  const take = history.slice(-window);
  const avg = take.reduce((s, v) => s + v.price, 0) / take.length;
  return avg;
}

// ====== SIGNAL ======
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

// ====== UPDATE PRINCIPAL ======
async function updateBitcoinPrice() {
  try {
    // 👉 empêche multi-connexion
    if (!client.topology || client.topology.isDestroyed()) {
      await client.connect();
    }

    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    // --- 1) API
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const price = res.data.bitcoin.usd;

    // --- 2) Historique
    const history = await col.find().sort({ updatedAt: 1 }).toArray();
    const smooth = smoothPrice(history.concat([{ price }]));

    // --- 3) Variation
    let variation = null;
    if (history.length > 0) {
      const lastPrice = history[history.length - 1].price;
      variation = ((price - lastPrice) / lastPrice) * 100;
    }

    // --- 4) Signal
    const signal = calculateSignal(smooth);

    // --- PROFIT ---
    let profitUSD = null;
    let profitPercent = null;
    let lastBuyPrice = null;
    let sellPrice = null;

    if (signal === "Buy") {
      lastBuyForProfit = price;
      console.log(`🔔 BUY détecté à ${price} USD`);
    }

    if (signal === "Sell" && lastBuyForProfit !== null) {
      lastBuyPrice = lastBuyForProfit;
      sellPrice = price;
      profitUSD = sellPrice - lastBuyPrice;
      profitPercent = (profitUSD / lastBuyPrice) * 100;

      console.log(
        `🔔 SELL détecté ! BUY: ${lastBuyPrice}, SELL: ${sellPrice}, Profit USD: ${profitUSD.toFixed(
          2
        )}, Profit %: ${profitPercent.toFixed(2)}`
      );

      lastBuyForProfit = null;
    }

    // --- Stocke dernier BUY (même hors SELL)
    const lastBuyValueForDB = lastBuyForProfit;

    // --- 5) Insert MongoDB
    await col.insertOne({
      price,
      smoothPrice: smooth,
      signal,
      variation,

      lastBuyValue: lastBuyValueForDB,

      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,

      updatedAt: new Date()
    });

    console.log("✔️ BTC enregistré :", {
      price,
      smooth,
      signal,
      lastBuyValue: lastBuyValueForDB,
      lastBuyPrice,
      sellPrice,
      profitUSD,
      profitPercent,
      variation
    });

  } catch (err) {
    console.error("Erreur update BTC :", err);
  }
}

// ======================
// Si exécuté directement (cron)
// ======================
if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}

// 👉 Export correct !
module.exports = { updateBitcoinPrice };
