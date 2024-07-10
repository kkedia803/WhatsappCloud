const mongoose = require('mongoose');
require('dotenv').config();

const messageSchema = new mongoose.Schema({
    sender: String,
    receiver: String,
    body: String,
    type: String,
    mimeType: String,
    url: String,
    timestamp: { type: Date, default: Date.now }
})

const Message = mongoose.model('Message', messageSchema);

const connectToDatabase = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URL);
        console.log('MongoDb connected successfully');
    }
    catch (error) {
        console.log('Error connecting to database', error);
    }
};

module.exports = { connectToDatabase, Message }; 