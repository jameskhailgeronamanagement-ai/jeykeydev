const express = require('express');
const axios = require('axios');
const app = express().use(express.json());

// Set these in your Render "Environment Variables"
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 1. HANDSHAKE: Verifies your server with Meta
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 2. LISTENER: Catches the user when they click your web button
app.post('/webhook', (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(function(entry) {
            let webhook_event = entry.messaging[0];
            
            // This captures the user's ID (PSID)
            const sender_psid = webhook_event.sender.id;

            // Log it so you can see it in your Render logs
            console.log('User Linked! ID:', sender_psid);

            // Send an immediate confirmation to the user
            if (webhook_event.optin || webhook_event.message) {
                sendNotification(sender_psid, "You are now linked to the Queue! We will notify you when it's your turn.");
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 3. TRIGGER: The function you call to alert the user
async function sendNotification(psid, text) {
    const payload = {
        recipient: { id: psid },
        message: { text: text }
    };

    try {
        await axios.post(`https://graph.facebook.com/v29.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, payload);
        console.log('Message sent to:', psid);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Queue Server is Online on Port ${PORT}`));
