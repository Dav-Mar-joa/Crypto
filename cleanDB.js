const { MongoClient } = require("mongodb");
require("dotenv").config();

const url = process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGODB_URL;

if (!url) {
  console.error("❌ Pas d'URL MongoDB définie !");
  process.exit(1);
}

const client = new MongoClient(url);

const DB_NAME = "Crypto";
const COLLECTIONS = ["Bitcoin", "Signals", "Trades","Wallet","WalletHistory"];

async function clearDB() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    for (const colName of COLLECTIONS) {
      const col = db.collection(colName);
      const result = await col.deleteMany({});
      console.log(`✅ ${colName} vidé, ${result.deletedCount} documents supprimés`);
    }

    console.log("✔ Toutes les collections ont été vidées !");
  } catch (err) {
    console.error("❌ Erreur lors du vidage :", err);
  } finally {
    await client.close();
  }
}

clearDB();

