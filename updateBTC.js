const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ======================
// Variables lissage et signal
// ======================
let lastTrend = null;
let lastSmoothPrice = null;
let lastLow = null;
let lastHigh = null;
const SEUIL = 0.2; // Variation seuil en %

let priceHistory = []; // historique en mémoire pour le lissage

// ======================
// Lissage par moyenne mobile
// ======================
function smoothPrice(data, windowSize = 3) {
  const smoothed = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
    const window = data.slice(start, end);
    const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
    smoothed.push(avg);
  }
  return smoothed;
}

// ======================
// Calcul du signal achat/vente
// ======================
function calculateTrendSignalSmoothed(currentSmooth) {
  let signal = "";

  if (lastSmoothPrice === null) {
    lastSmoothPrice = currentSmooth;
    lastLow = currentSmooth;
    lastHigh = currentSmooth;
    return "";
  }

  if (currentSmooth > lastSmoothPrice) {
    lastHigh = Math.max(lastHigh, currentSmooth);
    if (lastTrend === "down") {
      const variation = ((currentSmooth - lastLow) / lastLow) * 100;
      if (variation >= SEUIL) signal = "Buy";
    }
    lastTrend = "up";
  } else if (currentSmooth < lastSmoothPrice) {
    lastLow = Math.min(lastLow, currentSmooth);
    if (lastTrend === "up") {
      const variation = ((lastHigh - currentSmooth) / lastHigh) * 100;
      if (variation >= SEUIL) signal = "Sell";
    }
    lastTrend = "down";
  }

  lastSmoothPrice = currentSmooth;
  return signal;
}

// ======================
// Connexion MongoDB
// ======================
const client = new MongoClient(process.env.MONGODB_URI);
let db;
async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.MONGODB_DBNAME);
  }
  return db;
}

// ======================
// Récupération prix BTC et update DB
// ======================
async function updateBitcoinPrice() {
  try {
    const db = await connectDB();
    const collection = db.collection(process.env.MONGODB_COLLECTION);

    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true";
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const marketCap = res.data.bitcoin.usd_market_cap;
    const volume = res.data.bitcoin.usd_24h_vol;

    // Historique DB
    const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
    let variation = null;
    if (lastEntry.length > 0) {
      variation = ((newPrice - lastEntry[0].price) / lastEntry[0].price * 100).toFixed(2);
    }

    await collection.insertOne({
      price: newPrice,
      updatedAt: new Date(),
      variation: variation,
      marketCap: marketCap,
      volume: volume
    });

    // ======================
    // Calcul lissage + signal
    // ======================
    priceHistory.push(newPrice);
    const smoothedHistory = smoothPrice(priceHistory);
    const lastSmooth = smoothedHistory[smoothedHistory.length - 1];
    const actionSignal = calculateTrendSignalSmoothed(lastSmooth);

    console.log(`Prix: $${newPrice} | Δ: ${variation}% | Signal: ${actionSignal}`);
    return { price: newPrice, signal: actionSignal };
  } catch (err) {
    console.error("Erreur updateBTC :", err.message);
    return null;
  }
}

// ======================
// Si lancé en cron
// ======================
if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}

module.exports = { updateBitcoinPrice };
