const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Telegraf } = require('telegraf');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Get values from .env
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // e.g. @channelusername or a numeric id

// Initialize the Telegraf bot (we don't need polling here)
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);


const formatPrice = (price) => {
    const str = price.toString();
    if (str.indexOf('.') !== -1) {
      const decimals = str.split('.')[1].length;
      return price.toFixed(decimals);
    }
    return str;
  };
  
// Helper: Normalize symbol
const normalizeSymbol = (sym) => {
    // Remove ".P" if it exists
    let clean = sym.replace('.P', '');
    // If it already contains a slash, return as-is
    if (clean.includes('/')) {
      return clean;
    }
    // If it ends with "USDT", insert a slash before "USDT"
    if (clean.endsWith("USDT")) {
      return clean.slice(0, clean.indexOf("USDT")) + "/USDT";
    }
    // Fallback: insert a slash after the first 3 characters
    return clean.slice(0, 3) + "/" + clean.slice(3);
  };
  
// Helper: format incoming webhook message
const formatMessage = (data) => {
  // Expected structure:
  // {
  //   side: "long" or "short",
  //   symbol: "OM/USDT",
  //   entryPrice: number,
  //   targets: [number, ...],
  //   stopLoss: number
  // }
  const sideText = data.side.toLowerCase() === 'long' ? '🟢 Long' : '🔴 SHORT';
  const symbolText = `#${normalizeSymbol(data.symbol)}`;

  // Use formatPrice to preserve decimals
  const entryPriceStr = formatPrice(data.entryPrice);
  // Calculate second entry value using the same decimal count as the original
  const decimals = entryPriceStr.includes('.') ? entryPriceStr.split('.')[1].length : 0;
  const entryCalc = (data.entryPrice * 1.01).toFixed(decimals);
  const entryLine = `Entry : ${entryPriceStr} - ${entryCalc}`;

  let targetsLine = 'Targets :\n\n';
  if (Array.isArray(data.targets)) {
    data.targets.forEach(target => {
      targetsLine += `🎯 ${target}\n`;
    });
  } else {
    targetsLine += `🎯 ${data.targets}\n`;
  }

  const stopLine = `🛑 Stop : ${data.stopLoss}`;

  return `${sideText}\n\n${symbolText}\n\n${entryLine}\n\n\n${targetsLine}\n\n${stopLine}`;
};

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const data = req.body;
  console.log(data)
  // Basic payload validation
  if (
    !data ||
    !data.side ||
    !data.symbol ||
    !data.entryPrice ||
    !data.targets ||
    !data.stopLoss
  ) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const message = formatMessage(data);

  try {
    // Send the message to the Telegram channel using Telegraf
    await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, message);
    res.status(200).json({ status: 'Message sent', message });
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/*
Example JSON payload to send via POST to /webhook:

For a long signal:
{
  "side": "long",
  "symbol": "OM/USDT",
  "entryPrice": 7.53114,
  "targets": [7.55183],
  "stopLoss": 7.49000
}

For a short signal with multiple targets:
{
  "side": "short",
  "symbol": "BNB/USDT",
  "entryPrice": 652.2,
  "targets": [651.5, 651, 650.8, 650],
  "stopLoss": 660
}
*/