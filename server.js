// ======================
//      DEPENDANCES
// ======================
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const regression = require ("regression");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
//  MONGODB CONNECTION
// ======================
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db(process.env.MONGODB_DBNAME);
    console.log("✔ Connecté à MongoDB");
  } catch (err) {
    console.error("❌ MongoDB erreur :", err);
    process.exit(1);
  }
}

// ======================
//  MIDDLEWARE
// ======================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// ======================
//  ROUTES API
// ======================

async function loadWallet() {
  const wallet = await db.collection("Wallet").findOne({ type: "wallet" });

  if (!wallet) {
    throw new Error("Wallet introuvable");
  }

  return wallet;
}

// Prix actuel
app.get('/btc-price', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "DB non dispo" });

    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const lastTwo = await collection.find().sort({ _id: -1 }).limit(2).toArray();
    

    if (lastTwo.length === 0) return res.status(503).json({ error: "Pas de prix" });

    const cachedPrice = lastTwo[0].price;
    const lastUpdate = lastTwo[0].updatedAt;

    let variation = null;
    if (lastTwo.length === 2) {
      variation = ((cachedPrice - lastTwo[1].price) / lastTwo[1].price * 100).toFixed(2);
    }
    // console.log("Prix servi :", cachedPrice, "Variation :", variation, "Date :", lastUpdate);
    
    console.log("****************************************")
    console.log("****************************************")
    console.log("btc-price canForceTrade:", canForceTrade);
    console.log("****************************************")
    console.log("****************************************")

    res.json({ price: cachedPrice, updatedAt: lastUpdate, variation,marketCap: lastTwo[0].marketCap, volume: lastTwo[0].volume,canForceTrade });

  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-price" });
  }
});

// Historique complet
app.get('/btc-history', async (req, res) => {
  try {
    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const history = await collection.find().sort({ _id: 1 }).toArray();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-history" });
  }
});

// ======================
//  ROUTE CRON (optionnel, si tu veux déclencher via URL)
// ======================
const { updateBitcoinPrice } = require('./updateBTC.js');

app.get('/updateBTC', async (req, res) => {
  try {
    await updateBitcoinPrice();
    res.send("Mise à jour BTC OK");
  } catch (err) {
    res.status(500).send("Erreur update BTC");
  }
});

// // ======================
// // HISTORIQUE DES TRADES
// // ======================
// app.get('/btc-trades', async (req, res) => {
//   try {
//     const collection = db.collection(process.env.MONGODB_COLLECTION);

//     // On récupère uniquement les documents avec un signal Buy ou Sell
//     const trades = await collection
//       .find({ signal: { $in: ["Buy", "Sell"] } })
//       .sort({ updatedAt: -1 })
//       .toArray();

//     res.json(trades);
//   } catch (err) {
//     console.error("Erreur /btc-trades :", err);
//     res.status(500).json({ error: "Erreur serveur" });
//   }
// });

// ======================
// HISTORIQUE DES TRADES
// ======================
app.get('/btc-trades', async (req, res) => {
  try {
    const collection = db.collection("Trades"); // <-- nouvelle collection

    // On récupère tous les trades réels
    const trades = await collection
      .find()
      .sort({ date: -1 }) // tri du plus récent au plus ancien
      .toArray();

    res.json(trades);
  } catch (err) {
    console.error("Erreur /btc-trades :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE DES SIGNALS
// ======================
app.get('/btc-signals', async (req, res) => {
  try {
    const col = db.collection("Signals");  // ta collection Signals

    const signals = await col
      .find()
      .sort({ date: -1 })
      .toArray();

    res.json(signals);
  } catch (err) {
    console.error("Erreur /btc-signals :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE Du WALLET
// ======================
app.get('/btc-wallet', async (req, res) => {
  try {
    const col = db.collection("Wallet");  // ta collection Wallet

    // On récupère LE wallet
    const wallet = await col.findOne({ type: "wallet" });

    if (!wallet) {
      return res.status(404).json({ error: "Aucun wallet trouvé" });
    } 

    res.json(wallet);
  } catch (err) {
    console.error("Erreur /btc-wallet :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// HISTORIQUE DU WALLET (GRAPHIQUE)
// ======================

// app.get('/btc-wallet-history', async (req, res) => {
//   try {
//     const col = db.collection("Wallet");
//     const wallet = await col.findOne({ type: "wallet" });

//     if (!wallet || !Array.isArray(wallet.history)) return res.json([]);

//     let balance = 0;
//     const formatted = wallet.history.map(item => {
//       if(item.type === "SELL") balance += item.usdtReceived;
//       if(item.type === "BUY") balance -= item.amountUSDT;
//       return {
//         timestamp: new Date(item.date).getTime(),
//         usdt: parseFloat(balance.toFixed(2)) // solde cumulé
//       };
//     });

//     res.json(formatted);

//   } catch (err) {
//     console.error("Erreur /btc-wallet-history :", err);
//     res.status(500).json({ error: "Erreur serveur" });
//   }
// });

// app.get('/btc-wallet-history', async (req, res) => {
//   try {
//     const col = db.collection("Wallet");
//     const wallet = await col.findOne({ type: "wallet" });

//     if (!wallet || !Array.isArray(wallet.history)) return res.json([]);

//     let profit = 0;
//     const formatted = wallet.history.map(item => {
//       if(item.type === "SELL") profit += item.usdtReceived - wallet.totalInvested; // gain net
//       if(item.type === "BUY") profit -= 0; // pas de perte à l'achat, seulement au SELL
//       return {
//         timestamp: new Date(item.date).getTime(),
//         usdt: parseFloat(profit.toFixed(2)) // profit net
//       };
//     });

//     res.json(formatted);

//   } catch (err) {
//     console.error("Erreur /btc-wallet-history :", err);
//     res.status(500).json({ error: "Erreur serveur" });
//   }
// });

// ======================
//  IMPORT DES FONCTIONS DE TRADING
// ======================
// const {
//   simulateBuy,
//   simulateSell,
//   getPrice
// } = require('./updateBTC.js');   // Assure-toi que c'est bien exporté

const { simulateBuy, simulateSell, getPrice, getState } = require('./updateBTC.js');
let { lastBuy, lastSell, lastTrend, lastLow, lastHigh, inPosition, lastTradeForced, canForceTrade } = getState();


// app.get("/force-buy", async (req, res) => {
//     let wallet = await db.collection("wallet").findOne({ _id: "main" });

//     // // Position actuelle = USDT (donc achat possible)
//     // if (wallet.btc === 0 && wallet.usdt > 0) {
//     //     const price = lastPrice;
//     //     const amountBTC = wallet.usdt / price;

//     //     wallet.btc = amountBTC;
//     //     wallet.usdt = 0;

//     //     await db.collection("wallet").updateOne(
//     //         { _id: "main" },
//     //         { $set: wallet }
//     //     );

//     //     return res.json({
//     //         status: "success",
//     //         action: "BUY",
//     //         price,
//     //         wallet
//     //     });
//     // }

//     // // Sinon : aucune action possible
//     // return res.json({
//     //     status: "ignored",
//     //     reason: "already-in-position"
//     // });
//     console.log("achat forcée reçue");
// });

// app.get("/force-sell", async (req, res) => {
//     let wallet = await db.collection("wallet").findOne({ _id: "main" });

//     // // Position actuelle = BTC (donc vente possible)
//     // if (wallet.btc > 0) {
//     //     const price = lastPrice;
//     //     const amountUSDT = wallet.btc * price;

//     //     wallet.usdt = amountUSDT;
//     //     wallet.btc = 0;

//     //     await db.collection("wallet").updateOne(
//     //         { _id: "main" },
//     //         { $set: wallet }
//     //     );

//     //     return res.json({
//     //         status: "success",
//     //         action: "SELL",
//     //         price,
//     //         wallet
//     //     });
//     // }

//     // return res.json({
//     //     status: "ignored",
//     //     reason: "no-btc"
//     // });
//     console.log("vente forcée reçue");
// });

// app.get("/force-sell", async (req, res) => {
//   try {
//     const price = await getPrice();
//     if (!price) return res.status(500).json({ error: "Prix indisponible" });

//     const wallet = await loadWallet();
//     if (!wallet || !Array.isArray(wallet.history) || wallet.history.length === 0) {
//       return res.status(400).json({ error: "Aucun historique pour forcer la vente" });
//     }

//     // Cherche le dernier BUY dans l'historique
//     const lastBuyEntry = [...wallet.history].reverse().find(h => h.type === "BUY");
//     if (!lastBuyEntry) {
//       return res.status(400).json({ error: "Aucun achat précédent pour vendre" });
//     }

//     const btcToSell = lastBuyEntry.btcBought;
//     const usdtReceived = btcToSell * price;

//     // Mise à jour du wallet
//     const updatedWallet = {
//       ...wallet,
//       btc: wallet.btc - btcToSell,
//       usdt: wallet.usdt + usdtReceived,
//       totalProfit: wallet.totalProfit + (usdtReceived - lastBuyEntry.amountUSDT),
//       lastUpdate: new Date(),
//       history: [
//         ...wallet.history,
//         {
//           type: "SELL",
//           price,
//           usdtReceived,
//           btcSold: btcToSell,
//           feePaid: 0, // si tu veux gérer les fees
//           date: new Date()
//         }
//       ]
//     };

//     await db.collection("Wallet").updateOne(
//       { type: "wallet" },
//       { $set: updatedWallet }
//     );

//     // Calcul profit
//     const profit = usdtReceived - lastBuyEntry.amountUSDT;
//     const variationProfit = ((price - lastBuyEntry.price) / lastBuyEntry.price) * 100;

//     // Mise à jour état bot
//     inPosition = false;
//     lastSell = price;

//     // Ajout du signal manuel
//     await db.collection("Signals").insertOne({
//       price,
//       signal: "SELL_MANUAL",
//       trend: lastTrend,
//       low: lastLow,
//       high: lastHigh,
//       lastBuy: lastBuyEntry.price,
//       lastSell: price,
//       btcSold: btcToSell,
//       variationProfit,
//       profit,
//       inPosition,
//       date: new Date()
//     });

//     res.json({
//       status: "success",
//       action: "SELL_MANUAL",
//       price,
//       profit,
//       variationProfit,
//       wallet: {
//         btc: updatedWallet.btc,
//         usdt: updatedWallet.usdt
//       }
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Erreur force-sell" });
//   }
// });

// app.get("/force-sell", async (req, res) => {
//   try {
//     const price = await getPrice();
//     console.log("Prix pour force-sell :", price);
//     if (!price) return res.status(500).json({ error: "Prix indisponible" });

//     const wallet = await loadWallet();
//     console.log("Wallet avant force-sell :", wallet);

//     // // Vérifie si le bot est en position (dernier achat non vendu)
//     // if (!inPosition || wallet.btc <= 0) {
//     //   return res.json({ status: "ignored", reason: "Pas de BTC à vendre / déjà vendu" });
//     // }

//     // Cherche le dernier achat valide
//     // const lastBuyEntry = [...wallet.history].reverse().find(h => h.type === "BUY");
//     // const lastBuyEntry = [...wallet.history].reverse();
//     // console.log("Dernier achat trouvé pour force-sell :", lastBuyEntry.type);

//     const lastEntry = wallet.history.at(-1);

// console.log("Dernière action :", lastEntry);
//     // if (!lastBuyEntry) {
//     //   return res.status(400).json({ error: "Aucun achat précédent pour vendre" });
//     // }

//     // ✅ Vente forcée : une seule fois
//     const btcToSell = wallet.btc;
//     const usdtReceived = btcToSell * price;

//     wallet.usdt += usdtReceived;
//     wallet.btc = 0;
//     wallet.totalProfit += (usdtReceived - lastBuyEntry.amountUSDT);
//     wallet.lastUpdate = new Date();
//     wallet.history.push({
//       type: "SELL",
//       price,
//       btcSold: btcToSell,
//       usdtReceived,
//       date: new Date()
//     });

//     await db.collection("Wallet").updateOne({ type: "wallet" }, { $set: wallet });

//     // Met à jour l'état du bot pour bloquer toute vente future tant qu'un nouvel achat n'a pas eu lieu
//     inPosition = false;
//     lastSell = price;

//     // Insert signal manuel
//     await db.collection("Signals").insertOne({
//       price,
//       signal: "SELL_MANUAL",
//       lastBuy: lastBuyEntry.price,
//       lastSell: price,
//       btcSold: btcToSell,
//       profit: usdtReceived - lastBuyEntry.amountUSDT,
//       variationProfit: ((price - lastBuyEntry.price) / lastBuyEntry.price) * 100,
//       inPosition,
//       date: new Date()
//     });

//     res.json({
//       status: "success",
//       action: "SELL_MANUAL",
//       price,
//       profit: usdtReceived - lastBuyEntry.amountUSDT,
//       variationProfit: ((price - lastBuyEntry.price) / lastBuyEntry.price) * 100,
//       wallet: { btc: wallet.btc, usdt: wallet.usdt }
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Erreur force-sell" });
//   }
// });

app.get("/btc-wallet-history", async (req, res) => {
  const data = await db
    .collection("WalletHistory")
    .find()
    .sort({ timestamp: 1 })
    .toArray();

  res.json(data);
});


app.get("/force-sell", async (req, res) => {
  try {
    const price = await getPrice();
    if (!price) {
      return res.status(500).json({ error: "Prix indisponible" });
    }
    if (!canForceTrade) {
      return res.status(400).json({
        status: "ignored",
        reason: "Forçage désactivé actuellement"
      });
    }
    const wallet = await loadWallet();

    if (!wallet.history || wallet.history.length === 0) {
      return res.status(400).json({
        status: "ignored",
        reason: "Aucune opération précédente"
      });
    }

    const lastEntry = wallet.history.at(-1);
    console.log("Dernière action :", lastEntry.type);

    // 🔒 Bloque si la dernière action n'est pas un BUY
    if (lastEntry.type !== "BUY" ) {
      return res.json({
        status: "ignored",
        reason: "Dernière action déjà vendue"
      });
    }

    // 🔒 Bloque si aucun BTC
    if (wallet.btc <= 0) {
      return res.json({
        status: "ignored",
        reason: "Pas de BTC à vendre"
      });
    }

    // ✅ FORCE SELL (une seule fois après un BUY)
    const btcToSell = wallet.btc;
    const usdtReceived = btcToSell * price;
    const profit = usdtReceived - lastEntry.amountUSDT;
    const variationProfit =
      ((price - lastEntry.price) / lastEntry.price) * 100;

    wallet.usdt += usdtReceived;
    wallet.btc = 0;
    wallet.totalProfit += profit;
    wallet.lastUpdate = new Date();

    wallet.history.push({
      type: "SELL",
      price,
      btcSold: btcToSell,
      usdtReceived,
      profit,
      date: new Date()
    });

    await db
      .collection("Wallet")
      .updateOne({ type: "wallet" }, { $set: wallet });

    // Signal manuel
    await db.collection("Signals").insertOne({
      signal: "SELL",
      price,
      lastBuyPrice: lastEntry.price,
      btcSold: btcToSell,
      profit,
      variationProfit,
      date: new Date(),
      inPosition: false,
      trend:"SELL FORCED",
      lastTradeForced:"SELL-FORCED"
    });

    res.json({
      status: "success",
      action: "SELL",
      price,
      profit,
      variationProfit,
      wallet: {
        btc: wallet.btc,
        usdt: wallet.usdt
      }
    });


  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur force-sell" });
  }
});

app.get("/force-buy", async (req, res) => {
  try {
    const price = await getPrice();
    if (!price) {
      return res.status(500).json({ error: "Prix indisponible" });
    }
    if (!canForceTrade) {
      return res.status(400).json({
        status: "ignored",
        reason: "Forçage désactivé actuellement"
      });
    }

    const wallet = await loadWallet();

    // 🔒 Si historique existe, on vérifie la dernière action
    if (wallet.history && wallet.history.length > 0) {
      const lastEntry = wallet.history.at(-1);
      console.log("Dernière action :", lastEntry.type);

      // Bloque si déjà en BUY
      if (lastEntry.type === "BUY") {
        return res.json({
          status: "ignored",
          reason: "Déjà en position (BUY actif)"
        });
      }
    }

    // 🔒 Bloque si pas d’USDT
    if (wallet.usdt <= 0) {
      return res.json({
        status: "ignored",
        reason: "Pas d'USDT pour acheter"
      });
    }

    // ✅ FORCE BUY (une seule fois après un SELL)
    const usdtToSpend = wallet.usdt;
    const btcBought = usdtToSpend / price;

    wallet.btc += btcBought;
    wallet.usdt = 0;
    wallet.totalInvested += usdtToSpend;
    wallet.lastUpdate = new Date();

    wallet.history.push({
      type: "BUY",
      price,
      amountUSDT: usdtToSpend,
      btcBought,
      date: new Date()
    });

    await db
      .collection("Wallet")
      .updateOne({ type: "wallet" }, { $set: wallet });

    // Signal manuel
    await db.collection("Signals").insertOne({
      signal: "BUY",
      price,
      amountUSDT: usdtToSpend,
      btcBought,
      date: new Date(),
      inPosition: true,
      trend:"BUY FORCED",
      lastTradeForced:"BUY-FORCED"

    });

    res.json({
      status: "success",
      action: "BUY",
      price,
      btcBought,
      canForceTrade,
      wallet: {
        btc: wallet.btc,
        usdt: wallet.usdt
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur force-buy" });
  }
});

async function ensureWallet() {
  const wallet = await db.collection("Wallet").findOne({ type: "wallet" });
  if (!wallet) {
    console.log("⚡ Création d'un wallet initial...");
    await db.collection("Wallet").insertOne({
      type: "wallet",
      usdt: 400,          // capital initial
      btc: 0,
      totalInvested: 0,
      totalProfit: 0,
      totalFeesPaid: 0,
      lastUpdate: new Date(),
      history: []
    });
  } else {
    console.log("✔ Wallet existant trouvé");
  }
}

// // État du bot : est-ce qu'on a un BTC en portefeuille ?
// let inPosition = false;

// Chargement de l'état réel au démarrage
async function loadInitialPosition() {
  try {
    const col = db.collection("Wallet");
    const wallet = await col.findOne({ type: "wallet" });

    if (wallet && wallet.btcAmount > 0) {
      inPosition = true;
    } else {
      inPosition = false;
    }

    console.log("📌 inPosition initial :", inPosition);

  } catch (err) {
    console.error("Erreur loadInitialPosition :", err);
  }
}

// ======================
//  DEMARRAGE DU SERVEUR
// ======================
async function start() {
  await connectDB();
  ensureWallet();
  await loadInitialPosition();
  app.listen(PORT, () => console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
}

start();
