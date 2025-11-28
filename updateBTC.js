// ======================
//      DEPENDANCES
// ======================
const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

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
//  FONCTION UPDATE BTC
// ======================
async function updateBitcoinPrice() {
  try {
    if (!db) await connectDB();

    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
    const res = await axios.get(url);

    const newPrice = res.data.bitcoin.usd;
    const now = new Date();

    const collection = db.collection(process.env.MONGODB_COLLECTION);

    // Récupérer ancien prix pour calcul variation
    const lastEntry = await collection.find().sort({ _id: -1 }).limit(1).toArray();
    let variation = null;
    if (lastEntry.length > 0) {
      variation = ((newPrice - lastEntry[0].price) / lastEntry[0].price * 100).toFixed(2);
    }

    // Insérer dans MongoDB
    await collection.insertOne({
      price: newPrice,
      updatedAt: now
    });

    const nowFR = now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
    console.log(`✔ BTC: $${newPrice} — ${nowFR} Δ${variation}%`);

    return variation;

  } catch (err) {
    console.error("❌ Erreur récupération BTC :", err.message);
    throw err;
  }
}

module.exports = { updateBitcoinPrice };

// ======================
//  Si lancé en ligne de commande (node updateBTC.js)
// ======================
if (require.main === module) {
  (async () => {
    await updateBitcoinPrice();
    process.exit(0);
  })();
}
