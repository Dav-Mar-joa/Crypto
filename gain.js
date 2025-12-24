const {MongoClient}=require("mongodb")
require("dotenv").config()

const url=process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGODB_URL;

const client = new MongoClient(url)

const DB_NAME= "Crypto"

async function gain () {
    try{
        await client.connect()    
        const db = client.db(DB_NAME)
        const signals = db.collection("Signals")

        const data = await signals.find({signal:"SELL",profit:{$ne:null}}).toArray();
        // console.log("📊 Signals :", data);

        const gain = data.reduce((sum,s)=>sum+s.profit,0)
        console.log("gains total = ",gain)

        console.log("taux en btc = ",(gain+86000)/86000)
        console.log("taux en dollar = ",401.83/400)

    }
    catch (err) {
    console.error("❌ Erreur lors du vidage :", err);
    }

}

gain()

