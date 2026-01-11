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

// ================= PARAMÈTRES =================
const SEUIL = 0.0001;
const feeRate = 0.000015; // 0.15%

// ================= ÉTAT MARCHÉ =================
let lastPrice = null;
let lastTrend = null;
let lastLow = null;
let lastHigh = null;
let lastBuy = null;
let lastSell = null;

// ================= API =================
let canForceTrade = false;

// ================= WALLET =================
async function loadWallet() {
  const col = client.db(DB_NAME).collection("Wallet");
  let w = await col.findOne({ type: "wallet" });

  if (w) return w;

  const wallet = {
    type: "wallet",
    usdt: 400,
    btc: 0,
    totalInvested: 400,
    totalFeesPaid: 0,
    totalProfit: 0,
    history: [],
    lastUpdate: new Date()
  };

  await col.insertOne(wallet);
  return wallet;
}

// ================= TRADES =================
async function simulateBuy(price, amountUSDT) {
  const wallet = await loadWallet();
  if (wallet.usdt <= 0) return wallet;

  const btcBought = amountUSDT / price;
  const feeBTC = btcBought * feeRate;
  const btcNet = btcBought - feeBTC;

  wallet.btc += btcNet;
  wallet.usdt -= amountUSDT;
  wallet.totalFeesPaid += feeBTC * price;
  wallet.lastUpdate = new Date();

  wallet.history.push({
    type: "BUY",
    price,
    btc: btcNet,
    usdt: amountUSDT,
    date: new Date()
  });

  await client.db(DB_NAME).collection("Wallet").updateOne(
    { type: "wallet" },
    { $set: wallet }
  );

  await saveTrade("BUY", price, amountUSDT, btcNet);
  lastBuy = price;

  return wallet;
}

async function simulateSell(price) {
  const wallet = await loadWallet();
  if (wallet.btc <= 0) return wallet;

  const btcToSell = wallet.btc;
  const usdtGross = btcToSell * price;
  const feeUSDT = usdtGross * feeRate;
  const usdtNet = usdtGross - feeUSDT;

  wallet.usdt += usdtNet;
  wallet.btc = 0;
  wallet.totalFeesPaid += feeUSDT;
  wallet.totalProfit = wallet.usdt - wallet.totalInvested;
  wallet.lastUpdate = new Date();

  wallet.history.push({
    type: "SELL",
    price,
    btc: btcToSell,
    usdt: usdtNet,
    date: new Date()
  });

  await client.db(DB_NAME).collection("Wallet").updateOne(
    { type: "wallet" },
    { $set: wallet }
  );

  await saveTrade("SELL", price, usdtNet, btcToSell);
  lastSell = price;

  return wallet;
}

async function saveTrade(type, price, amountUSDT, btcAmount) {
  await client.db(DB_NAME).collection(COLLECTION_TRADES).insertOne({
    type,
    price,
    amountUSDT,
    btcAmount,
    date: new Date()
  });

  console.log(`💼 Trade enregistré : ${type} @ ${price}`);
}

// ================= PRIX BTC =================
async function getPrice() {
  try {
    const r = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    canForceTrade = true;
    return r.data.bitcoin.usd;
  } catch (err) {
    if (err.response?.status === 429) canForceTrade = false;
    console.error("Erreur CoinGecko :", err.message);
    return null;
  }
}

// ================= SIGNAL (PUR) =================
function getSignal(price, inPosition) {
  if (lastPrice === null) {
    lastPrice = price;
    lastLow = price;
    lastHigh = price;
    lastTrend = "up";
    return "HOLD";
  }

  const trend = price > lastPrice ? "up" : "down";

  if (trend === "up") {
    lastHigh = Math.max(lastHigh, price);

    if (lastTrend === "down" && !inPosition) {
      const variation = (price - lastLow) / lastLow;
      if (variation > SEUIL) return "BUY";
    }
  }

  if (trend === "down") {
    lastLow = Math.min(lastLow, price);

    if (lastTrend === "up" && inPosition) {
      const variation = (price - lastHigh) / lastHigh;
      if (variation < -SEUIL && price > lastBuy) return "SELL";
    }
  }

  lastTrend = trend;
  lastPrice = price;
  return "HOLD";
}

// ================= DB =================
async function saveToDB(price, signal, inPosition) {
  const db = client.db(DB_NAME);

  await db.collection(COLLECTION_PRICE).insertOne({
    price,
    date: new Date()
  });

  await db.collection(COLLECTION_SIGNALS).insertOne({
    price,
    signal,
    trend: lastTrend,
    low: lastLow,
    high: lastHigh,
    lastBuy,
    lastSell,
    inPosition,
    date: new Date()
  });
}

// ================= LOOP =================
async function loop() {
  const price = await getPrice();
  if (!price) return;

  const wallet = await loadWallet();
  const inPosition = wallet.btc > 0;

  const signal = getSignal(price, inPosition);

  console.log(
    new Date().toLocaleTimeString("fr-FR", { hour12: false }),
    "| Price:", price,
    "| Trend:", lastTrend,
    "| Signal:", signal,
    "| inPosition:", inPosition
  );

  if (signal === "BUY" && !inPosition) {
    await simulateBuy(price, wallet.usdt);
  }

  if (signal === "SELL" && inPosition) {
    await simulateSell(price);
  }

  await saveToDB(price, signal, wallet.btc > 0);
}

function getState() {
  return {
    lastPrice,
    lastTrend,
    lastLow,
    lastHigh,
    lastBuy,
    lastSell,
    canForceTrade
  };
}

module.exports = {
  getPrice,
  getSignal,
  simulateBuy,
  simulateSell,
  getState
};


// ================= START =================
(async () => {
  await client.connect();
  console.log("🤖 Bot démarré");
  await loop();
  setInterval(loop, 60_000);
})();
