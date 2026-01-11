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
const SEUIL = 0.0001; // % variation
const feeRate = 0.000015; // 0.15%

// ======== VARIABLES DE TENDANCE =========
let lastPrice = null;
let lastTrend = null;   // "up" ou "down"
let lastBuy = null;
let lastSell = null;
let inPosition = false;
let lastTradeForced = null;
let canForceTrade = true;

// ========> VARIABLES POUR CALCUL PROFIT <========
let variationProfit = null;
let profit = null;
let nbBTC = 0.01; // nbre BTC

// ================= Wallet =================
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
  const wallet = await loadWallet();
  if (wallet.btc <= 0) {
    console.log("❌ Pas de BTC à vendre");
    return wallet;
  }

  const usdtReceived = wallet.btc * price;
  const feeUSDT = usdtReceived * feeRate;

  const btcSold = wallet.btc; // pour l’historique
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
    btcSold,
    feePaid: feeUSDT,
    date: new Date()
  });

  await client.db(DB_NAME).collection("Wallet").updateOne(
    { type: "wallet" },
    { $set: wallet }
  );

  await saveTrade("SELL", price, usdtReceived - feeUSDT, btcSold);
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

// ==================== Récupération prix BTC ====================
async function getPrice() {
  try {
    const r = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    const price = r.data.bitcoin.usd;
    canForceTrade = true;
    return parseFloat(price);
  } catch (err) {
    console.error("Erreur API CoinGecko :", err.message);
    if (err.response && err.response.status === 429) canForceTrade = false;
    return null;
  }
}

// ==================== LOGIQUE DE SIGNAL ====================
let lastLow = null;
let lastHigh = null;

function getSignal(price) {
  let signal = "HOLD";

  if (lastPrice === null) {
    lastPrice = price;
    lastLow = price;
    lastHigh = price;
    lastTrend = "up";
    return "HOLD"; // ⛔ PLUS DE BUY AUTO
  }

  const trend = price > lastPrice ? "up" : "down";

  // ===== HAUSSE =====
  if (trend === "up") {
    lastHigh = Math.max(lastHigh, price);

    if (lastTrend === "down" && !inPosition) {
      const variation = (price - lastLow) / lastLow;
      if (variation > SEUIL) {
        signal = "BUY";
        lastBuy = price;
      }
    }
  }

  // ===== BAISSE =====
  if (trend === "down") {
    lastLow = Math.min(lastLow, price);

    if (lastTrend === "up" && inPosition) {
      const gain = price - lastBuy;
      const commission = price * feeRate;
      const gainNet = gain - commission;
      const variation = (price - lastHigh) / lastHigh;

      if (variation < -SEUIL && gainNet > 0) {
        signal = "SELL";
        lastSell = price;
      }
    }
  }

  lastTrend = trend;
  lastPrice = price;

  return signal;
}



// function getSignal(price) {
//   let signal = "HOLD";

//   if (lastPrice === null) {
//     lastPrice = price;
//     lastLow = price;
//     lastHigh = price;
//     lastTrend = "up";
//     if (!inPosition) {
//       signal = "BUY";
//       lastBuy = price;
//       inPosition = true;
//     }
//     return signal;
//   }

//   const trend = price > lastPrice ? "up" : "down";

//   if (trend === "up") {
//     lastHigh = Math.max(lastHigh, price);
//     if (lastTrend === "down" && !inPosition) {
//       const variation = (price - lastLow) / lastLow;
//       if (variation > SEUIL) {
//         signal = "BUY";
//         lastBuy = price;
//       }
//     }
//   }

//   if (trend === "down") {
//     lastLow = Math.min(lastLow, price);
//     if (lastTrend === "up" && inPosition) {
//       const gain = price - lastBuy;
//       const commission = price * feeRate;
//       const gainNet = gain - commission;
//       const variation = (price - lastHigh) / lastHigh;
//       if (variation < -SEUIL && gainNet > 0) {
//         signal = "SELL";
//         lastSell = price;
//       }
//     }
//   }

//   lastTrend = trend;
//   lastPrice = price;

//   return signal;
// }

// ==================== SAVE TO DB ====================
async function saveToDB(price, signal) {
  try {
    if (!client.topology || client.topology.isDestroyed()) {
      await client.connect();
    }

    const db = client.db(DB_NAME);
    const colPrice = db.collection(COLLECTION_PRICE);
    const colSignals = db.collection(COLLECTION_SIGNALS);

    await colPrice.insertOne({ price, updatedAt: new Date() });

    if (signal === "SELL" && lastBuy) {
      profit = price - lastBuy;
      variationProfit = ((price - lastBuy) / lastBuy) * 100;
    } else {
      profit = null;
      variationProfit = null;
    }

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
      inPosition,
      lastTradeForced
    });

    console.log("💾 Données enregistrées dans MongoDB !");
  } catch (err) {
    console.error("❌ Erreur MongoDB :", err.message);
  }
}

// ==================== LOAD LAST STATE ====================
async function loadLastState() {
  const db = client.db(DB_NAME);
  const signalsCol = db.collection(COLLECTION_SIGNALS);
  const lastSignal = await signalsCol.find().sort({ date: -1 }).limit(1).toArray();
  if (lastSignal[0]) {
    lastPrice = lastSignal[0].price;
    lastLow = typeof lastSignal[0].low === "number" ? lastSignal[0].low : lastSignal[0].price;
    lastHigh = typeof lastSignal[0].high === "number" ? lastSignal[0].high : lastSignal[0].price;
    lastTrend = lastSignal[0].trend;
    lastBuy = lastSignal[0].lastBuy;
    lastSell = lastSignal[0].lastSell;
    inPosition = lastSignal[0].inPosition || false;
    lastTradeForced = lastSignal[0].lastTradeForced || false;
  }
  console.log("État restauré :", {
    lastBuy,
    lastSell,
    inPosition,
    lastLow,
    lastHigh,
    lastTrend,
    lastTradeForced
  });
}

// ==================== WALLET SNAPSHOT ====================
async function saveWalletSnapshot(price) {
  const wallet = await loadWallet();

  await client.db(DB_NAME).collection("WalletHistory").insertOne({
    timestamp: Date.now(),
    usdt: wallet.usdt,
    btc: wallet.btc,
    btcPrice: price,
    totalValue: wallet.usdt + wallet.btc * price,
    amountInvested: wallet.totalInvested
  });
}

// ==================== LOOP PRINCIPALE ====================
async function loop() {
  const price = await getPrice();
  if (!price) return;

  const wallet = await loadWallet();
  inPosition = wallet.btc > 0;

  const signal = getSignal(price);

  console.log(
    new Date().toLocaleTimeString("fr-FR", { hour12: false }),
    "| Price:", price,
    "| Trend:", lastTrend,
    "| Signal:", signal,
    "| inPosition:", inPosition
  );

  if (signal === "BUY" && !inPosition) {
    await simulateBuy(price, wallet.usdt);
    inPosition = true;
    await saveWalletSnapshot(price);
  }

  if (signal === "SELL" && inPosition) {
    await simulateSell(price);
    inPosition = false;
    await saveWalletSnapshot(price);
  }

  await saveToDB(price, signal);
}

// ==================== EXPORT ====================
module.exports = {
  simulateBuy,
  simulateSell,
  getPrice,
  getState: () => ({ lastBuy, lastSell, lastTrend, lastLow, lastHigh, inPosition, lastTradeForced, canForceTrade }),
};

// ==================== DEMARRAGE ====================
(async () => {
  console.log("Chargement de l'état du bot...");
  await loadLastState();

  console.log("Lancement de la première analyse...");
  await loop();

  console.log("Démarrage de la boucle toutes les 60 secondes...");
  setInterval(loop, 60_000);
})();
