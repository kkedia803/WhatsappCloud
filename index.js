const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');
const { connectToDatabase, Message } = require('./db');
const { default: puppeteer } = require('puppeteer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();
// const axios = require('axios');/

connectToDatabase();

async function keepAlive(client) {
    setInterval(async () => {
        try {
            const isConnected = await client.isConnected();
            if (isConnected) {
                console.log('Keep Alive Ping Sent');
                await client.page.evaluate(() => console.log('Keep Alive Ping'))
            }
        } catch (error) {
            console.log('Error during keeping alive : ', error);
        }
    }, 15 * 60 * 1000);
}

async function createClient(sessionName) {
    const sessionDir = path.join(__dirname, 'sessions', sessionName);

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    async function startClient() {
        try {
            const client = await wppconnect.create({
                session: sessionName,
                puppeteerOptions: {
                    executablePath: puppeteer.executablePath(),
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-extensions'
                    ],
                },
                statusFind: (statusSession, session) => {
                    console.log(`Session ${sessionName} Status:`, statusSession);
                    if (statusSession === 'browserClose') {
                        console.log(`Session ${sessionName} closed. Reconnecting...`);
                        setTimeout(() => {
                            startClient();
                        }, 10000)
                    }
                },
                folderNameToken: sessionDir,
            });
            start(client, sessionName);
            keepAlive(client);
        } catch (error) {
            console.log(`Error creating client for session ${sessionName}:`, error);
            setTimeout(() => {
                startClient();
            }, 10000)
        }
    }

    startClient();

}

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
});

async function uploadToCloudinary(base64Data, mediaType) {
    try {
        const result = await cloudinary.uploader.upload(`data:${mediaType};base64,${base64Data}`, {
            resource_type: 'auto'
        });
        return result.secure_url;
    } catch (error) {
        console.error('Error uploading to Cloudinary:', error);
        throw error;
    }
}

async function handleMediaMessages(client, message) {
    const type = message.type;
    let mType = message.mimetype;
    const data = await client.decryptFile(message);
    const base64Data = data.toString('base64');

    if (mType == 'audio/ogg; codecs=opus') { mType = 'audio/ogg'; }
    const url = await uploadToCloudinary(base64Data, mType)

    const newMessage = new Message({
        sender: message.from,
        receiver: message.to,
        body: message.body,
        type: type,
        mimeType: mType,
        url: url
    })
    try {
        newMessage.save();
    } catch (error) {
        console.log('Error while storing data in MongoDB: ', error);
    }
}

async function start(client, sessionName) {
    client.onAnyMessage(async (message) => {
        const type = message.type;

        if (type == 'chat') {
            const newMessage = new Message({
                sender: message.from,
                receiver: message.to,
                body: message.body
            });
            try {
                await newMessage.save();
            } catch (error) {
                console.log('Error while storing data in MongoDB: ', error);
            }
        }
        else {
            handleMediaMessages(client, message);
        }
    })
}

createClient('account1');
