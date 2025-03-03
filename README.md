# **Overview:**  
This code is built for integration with TradingView. Use it as your webhook endpoint:  
https://yourip-or-domain/webhook

------------------------------------------
How to Use the Code:
------------------------------------------
1. **Configure Environment:**  
   - Create a `.env` file in the root directory.
   - Format of the `.env` file:
     ```
     PORT=3000
     TELEGRAM_CHANNEL_ID=@YourChannelID or -100ID
     TELEGRAM_BOT_TOKEN=BOT_FATHER_TOKEN
     ```
2. **Running the Code:**  
   - Install dependencies:  
     ```
     npm install
     ```
   - Run the application:  
     ```
     npm start
     ```

------------------------------------------
Running in Background with PM2 (Windows):
------------------------------------------
- Install PM2 globally if not already installed:  

`npm install -g pm2`

- Start the application with PM2:  

`pm2 start index.js –name “tradingview-webhook”`

------------------------------------------
**Expected Response:**  
- When TradingView sends a webhook to your endpoint, the code processes the payload and returns a JSON response confirming receipt. It will format the message to something like: 

```text
🔴 SHORT

#MKR/USDT

Entry : 1499.7 - 1514.7


Targets :

🎯 1498.2
🎯 1496.7
🎯 1495.2
🎯 1493.7


🛑 Stop : 1514.7
```

or 

```
🟢 Long

#BTC/USDT

Entry : 23000 - 23230


Targets :

🎯 23500
🎯 24000


🛑 Stop : 22800
```