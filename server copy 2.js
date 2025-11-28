// ======================
//      DEPENDANCES
// ======================
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
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
//    VARIABLES LOCALES
// ======================
let cachedPrice = null;
let lastUpdate = null;

// ======================
//  FONCTION UPDATE BTC
// ======================
async function updateBitcoinPrice() {
  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const now = new Date(); // ← ISO

    const collection = db.collection(process.env.MONGODB_COLLECTION);

    // Récupérer ancien prix pour variation
    const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
    let variation = null;

    if (lastEntry.length > 0) {
      const oldPrice = lastEntry[0].price;
      variation = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    }

    // Insérer dans MongoDB
    await collection.insertOne({
      price: newPrice,
      updatedAt: now
    });

    cachedPrice = newPrice;
    lastUpdate = now;

    console.log(`✔ BTC: $${newPrice} — ${now.toISOString()} Δ${variation}%`);

  } catch (err) {
    console.error("❌ Erreur récupération BTC :", err.message);
  }
}

// ======================
//        MIDDLEWARE
// ======================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// ======================
//        ROUTES API
// ======================

// Prix actuel
app.get('/btc-price', async (req, res) => {
  if (!cachedPrice) return res.status(503).json({ error: "Prix non disponible" });

  res.json({
    price: cachedPrice,
    updatedAt: lastUpdate,
    variation: null
  });
});

// Historique complet
app.get('/btc-history', async (req, res) => {
  try {
    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const history = await collection.find().sort({ _id: 1 }).toArray();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur historique" });
  }
});

// ======================
//  DEMARRAGE DU SERVEUR
// ======================
async function start() {
  await connectDB();
  await updateBitcoinPrice();                // première maj
  setInterval(updateBitcoinPrice, 60 * 1000); // toutes les minutes

  app.listen(PORT, () =>
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`)
  );
}

start();
