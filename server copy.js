const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

require('dotenv').config();

const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

// 🔥 Config MongoDB
const connectionString = process.env.MONGODB_URI;
const client = new MongoClient(connectionString);
const dbName = process.env.MONGODB_DBNAME;
let db;

// Connexion MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log('Connecté à MongoDB ✔');
  } catch (err) {
    console.error('Erreur de connexion à MongoDB :', err);
    process.exit(1);
  }
}
connectDB();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// Cache local
let cachedPrice = null;
let lastUpdate = null;

// 🔥 Fonction de mise à jour du prix
async function updateBitcoinPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const now = new Date().toLocaleString();

    let oldPrice = null;
    let variation = null;

    if (db) {
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
      oldPrice = lastEntry[0]?.price ?? null;

      if (oldPrice) {
        variation = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
      }

      await collection.insertOne({ price: newPrice, updatedAt: now });
    }

    cachedPrice = newPrice;
    lastUpdate = now;

    console.log(
      `[✔] BTC: $${newPrice} (à ${now}) ${
        variation !== null ? `| Δ ${variation}%` : ""
      }`
    );

    return variation;
  } catch (err) {
    console.error('[❌] Erreur CoinGecko :', err.message);
  }
}

// Mise à jour immédiate
updateBitcoinPrice();

// Toutes les 15 minutes
setInterval(updateBitcoinPrice, 15 * 60 * 1000);

// 🔥 Route API demandée par TON script.js
app.get('/btc-price', async (req, res) => {
  try {
    if (!cachedPrice || !db) {
      return res.status(503).json({ error: "Prix non disponible" });
    }

    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const lastTwo = await collection.find().sort({ _id: -1 }).limit(2).toArray();

    let variation = null;
    if (lastTwo.length === 2) {
      const old = lastTwo[1].price;
      variation = ((cachedPrice - old) / old * 100).toFixed(2);
    }

    res.json({
      price: cachedPrice,
      updatedAt: lastUpdate,
      variation: variation
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-price" });
  }
});

// 🔥 Route historique
app.get('/btc-history', async (req, res) => {
  try {
    const collection = db.collection(process.env.MONGODB_COLLECTION);
    const history = await collection.find().sort({ _id: 1 }).toArray();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur /btc-history" });
  }
});

// Lancement
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé : http://localhost:${PORT}`);
});
