const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');
const { connectToDatabase, Message } = require('./db');
const { default: puppeteer } = require('puppeteer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();
// const axios = require('axios');

connectToDatabase();

class TaskQueue {
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (err) {
                    reject(err);
                } finally {
                    this.running--;
                    this.next();
                }
            });
            this.next();
        });
    }

    next() {
        if (this.running < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            this.running++;
            task();
        }
    }
}

const messageQueue = new TaskQueue(5);

async function stopClient(client, sessionName) {
    try {
        console.log('Stopping client :', sessionName);
        await client.close();
    } catch (error) {
        console.log('Error stopping client : ', error);
    }
}

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
    }, 13 * 60 * 1000);
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
                    // if (statusSession === 'browserClose') {
                    //     console.log(`Session ${sessionName} closed. Reconnecting...`);
                    //     setTimeout(() => {
                    //         startClient();
                    //     }, 10000)
                    // }
                },
                folderNameToken: sessionDir,
            });
            start(client, sessionName);
            // keepAlive(client);

            setTimeout(async () => {
                await stopClient(client, sessionName);
                startClient();
            }, 60 * 60 * 1000);

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

async function uploadToCloudinary(buffer, mType, fileName, type) {
    return new Promise((resolve, reject) => {
        const resourceType = (type == 'document') ? 'raw' : 'auto';
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: resourceType,
                public_id: fileName
            },
            (error, result) => {
                if (error) {
                    console.error('Error uploading to Cloudinary:', error);
                    return reject(error);
                }
                resolve(result.secure_url);
            }
        );
        uploadStream.end(buffer);
    });
}

async function handleMediaMessages(client, message) {
    const fileName = message.filename;
    const type = message.type;
    let mType = message.mimetype;
    const data = await client.decryptFile(message);

    if (mType == 'audio/ogg; codecs=opus') { mType = 'audio/ogg'; }

    if (message.from == 'status@broadcast') {
        const url = await uploadToCloudinary(data, mType)

        const newMessage = new Message({
            sender: message.author,
            receiver: message.to,
            body: message.body,
            type: message.from,
            mimeType: mType,
            url: url
        })
        try {
            await newMessage.save();
        } catch (error) {
            console.log('Error while storing data in MongoDB: ', error);
        }

    }
    else {
        const url = await uploadToCloudinary(data, mType, fileName, type)

        const newMessage = new Message({
            sender: message.from,
            receiver: message.to,
            body: message.body,
            type: type,
            mimeType: mType,
            url: url
        })
        try {
            await newMessage.save();
        } catch (error) {
            console.log('Error while storing data in MongoDB: ', error);
        }
    }

}

async function start(client, sessionName) {
    client.onAnyMessage(async (message) => {
        messageQueue.add(async () => {
            try {
                const type = message.type;

                if (type == 'chat') {
                    const newMessage = new Message({
                        sender: message.from,
                        receiver: message.to,
                        body: message.body
                    });
                    await newMessage.save();
                } else {
                    await handleMediaMessages(client, message);
                }
            } catch (error) {
                console.log('Error processing message:', error);
            }
        });
    });
}

createClient('account1');
createClient('account2');
