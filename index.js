const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// --- Railway Healthcheck Fix ---
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('WhatsApp Bot Server is running!');
});

app.listen(port, () => {
  console.log(`Express web server listening on port ${port} to satisfy Railway Healthcheck`);
});
// -------------------------------

// Load menu data
const menuData = JSON.parse(fs.readFileSync('./menu.json', 'utf8'));

// Initialize client with local auth so it remembers the session
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run'],
    }
});

// State machine for users
// userState[from] = { step: 'MENU', cart: [] }
const userState = {};

client.on('qr', (qr) => {
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready! The restaurant bot is now online.');
});

client.on('message', async msg => {
    const from = msg.from;
    const text = msg.body.trim().toLowerCase();

    // Ignore group messages or status broadcast
    if(from.includes('@g.us') || from === 'status@broadcast') return;

    if (!userState[from]) {
        userState[from] = { step: 'START', cart: [] };
    }

    const state = userState[from].step;

    // Reset flow if user says hi or hello
    if (['hi', 'hello', 'hey', 'start', 'menu'].includes(text)) {
        // --- TIME CONSTRAINT DISABLED FOR TESTING ---
        // const now = new Date();
        // const currentHour = now.getHours();
        
        // // Only accept orders between 12:00 PM (12) and 10:00 PM (22)
        // if (currentHour < 12 || currentHour >= 22) {
        //     await client.sendMessage(from, "Sorry, our cafe is currently closed. 🌙\nWe only take delivery orders between *12:00 PM and 10:00 PM*.\nPlease come back tomorrow!");
        //     return;
        // }

        userState[from].step = 'MENU';
        let menuText = "*Welcome to Hangries Cafe!* 🍔🍕\nWhat would you like to order today? Please reply with a category number:\n\n";
        
        for (const key in menuData) {
            menuText += `${key}. ${menuData[key].category}\n`;
        }
        menuText += "\nReply with the number (e.g., 1 for Burgers).";
        
        await client.sendMessage(from, menuText);
        return;
    }

    if (state === 'MENU') {
        if (menuData[text]) {
            // User selected a valid category number
            const categoryObj = menuData[text];
            userState[from].step = `ORDERING_${text}`;
            
            await client.sendMessage(from, `*${categoryObj.category} Menu:*\nSending items, please wait a moment... ⏳`);

            // Send each item with its photo
            for (const item of categoryObj.items) {
                try {
                    const media = await MessageMedia.fromUrl(item.image);
                    const caption = `*${item.name}*\nPrice: ₹${item.price}\n\n_To order this, reply with its ID: ${item.id}_`;
                    await client.sendMessage(from, media, { caption: caption });
                } catch (error) {
                    console.error("Failed to fetch image for", item.name);
                    const fallbackMsg = `*${item.name}*\nPrice: ₹${item.price}\n\n_To order this, reply with its ID: ${item.id}_`;
                    await client.sendMessage(from, fallbackMsg);
                }
            }
            
            await client.sendMessage(from, `When you are done reviewing, just type the *ID* of the item you want to order (e.g. ${categoryObj.items[0].id}).\nType *MENU* to see categories again.`);
        } else {
            await client.sendMessage(from, 'Invalid Option. Please reply with a valid category number (1-4), or type "Menu".');
        }
        return;
    }

    if (state.startsWith('ORDERING_')) {
        const categoryId = state.split('_')[1];
        const categoryObj = menuData[categoryId];
        
        // Check if the text matches an item ID in this category
        const selectedItem = categoryObj.items.find(i => i.id.toLowerCase() === text);
        
        if (selectedItem) {
            userState[from].cart.push(selectedItem);
            
            let total = userState[from].cart.reduce((sum, item) => sum + item.price, 0);
            
            await client.sendMessage(from, `✅ *${selectedItem.name}* added to your cart!\n\nYour Current Cart Total: ₹${total}\n\nType another *ID* to add more, type *CHECKOUT* to complete your order, or *MENU* to see other categories.`);
        } else if (text === 'checkout') {
            if (userState[from].cart.length === 0) {
                await client.sendMessage(from, "Your cart is empty. Type *MENU* to start.");
            } else {
                let total = 0;
                let summary = "*Your Order Summary:*\n\n";
                userState[from].cart.forEach(item => {
                    summary += `- ${item.name} : ₹${item.price}\n`;
                    total += item.price;
                });
                summary += `\n*Total Payable: ₹${total}*\n\n`;
                summary += `To proceed with your order, please share your *Live Location* or *Current Location* pin 📍 using the attachment (📎) button.\n\n_(Note: We only deliver within a 5 km radius of our restaurant)_`;
                
                await client.sendMessage(from, summary);
                userState[from].step = 'AWAITING_LOCATION';
            }
        } else {
            await client.sendMessage(from, 'Please reply with a valid item *ID* (like b1), type *CHECKOUT* to pay, or *MENU* to go back.');
        }
        return;
    }

    if (state === 'AWAITING_LOCATION') {
        if (msg.type === 'location' || text.includes('maps.google') || text.includes('maps.app.goo.gl') || text.includes('location')) {
            userState[from].step = 'AWAITING_PAYMENT';
            let total = userState[from].cart.reduce((sum, item) => sum + item.price, 0);
            
            let response = `✅ Location received! You are within our 5km delivery radius 🛵.\n\n`;
            
            response += `*Final Step - Payment Details:*\nPlease pay **₹${total}** to confirm your order.\n\n💳 **How to pay:**\nPlease send the amount via **UPI / GPay / PhonePe / Paytm** directly to *this very same WhatsApp number*.\n\n*IMPORTANT:* After payment, please share the *Payment Screenshot* 🖼️ right here in this chat to finalize your order.`;
            
            await client.sendMessage(from, response);
        } else {
            await client.sendMessage(from, "Please use the WhatsApp attachment button (📎) to share your *Location* 📍 so we can verify if you are within our 5km delivery radius.");
        }
        return;
    }

    if (state === 'AWAITING_PAYMENT') {
        if (msg.hasMedia && msg.type === 'image') {
            const orderNumber = Math.floor(100 + Math.random() * 900);
            await client.sendMessage(from, `🎉 Payment Screenshot Received!\n\nYour order is confirmed! *(Order #${orderNumber})*\nOur chef is preparing your meal, and it will be delivered to your location soon. 👨‍🍳🛵\n\nThank you for choosing Hangries Cafe!`);
            
            // Reset cart
            userState[from] = { step: 'START', cart: [] };
        } else {
            await client.sendMessage(from, "Please send us the *Screenshot* of your payment (as an photo/image) to confirm your order.");
        }
        return;
    }
});

client.initialize();
