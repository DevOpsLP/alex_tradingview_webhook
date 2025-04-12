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
const TELEGRAM_BOT_TOKEN_2 = process.env.TELEGRAM_BOT_TOKEN_2;
const TELEGRAM_CHANNEL_PROMOTION = process.env.TELEGRAM_CHANNEL_PROMOTION;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// Real trading channel
const TELEGRAM_CHANNEL_ID_REAL = process.env.TELEGRAM_CHANNEL_ID_REAL;
const TELEGRAM_BOT_TOKEN_REAL = process.env.TELEGRAM_BOT_TOKEN_REAL;

// Initialize the Telegraf bots (we don't need polling here)
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const promotionBot = new Telegraf(TELEGRAM_BOT_TOKEN_2);
const mainBot = new Telegraf(TELEGRAM_BOT_TOKEN_REAL);

// Signal tracking map
const signalMap = new Map();

// Simple health-check route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Escape text for Telegram Markdown V2
 */
const escapeMarkdownV2 = (text) => {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&'); 
};

/**
 * Format a price to preserve original decimals if present
 */
function formatPrice(price) {
  if (typeof price !== 'number') {
    price = parseFloat(price);
  }
  if (isNaN(price)) {
    return price; // Return original value if it's not a valid number
  }
  const str = price.toString();
  if (str.includes('.')) {
    const decimals = str.split('.')[1].length;
    return price.toFixed(decimals);
  }
  return str;
}

/**
 * Normalize a symbol (e.g. remove .P, ensure /USDT, etc.)
 */
function normalizeSymbol(sym) {
  let clean = sym.replace('.P', '');
  if (clean.includes('/')) {
    return clean;
  }
  if (clean.endsWith('USDT')) {
    return clean.slice(0, clean.indexOf('USDT')) + '/USDT';
  }
  return clean.slice(0, 3) + '/' + clean.slice(3);
}

/**
 * Format the main signal message
 */
function formatMessage(data) {
  // e.g. side: "long" or "short", symbol: "OM/USDT", ...
  const sideText = data.side.toLowerCase() === 'long' ? '🟢 Long' : '🔴 SHORT';
  const symbolText = `#${normalizeSymbol(data.symbol)}`;

  // Use formatPrice to preserve decimals
  const entryPriceStr = formatPrice(data.entryPrice);
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

  // Just use the mention directly without escaping
  const mention = '@AI_tradesbot';

  return (
    `${sideText}\n\n` +
    `${symbolText}\n\n` +
    `${entryLine}\n\n\n` +
    `${targetsLine}\n\n` +
    `${stopLine}\n\n\n` +
    mention
  );
}

/**
 * Store signal message ID in the map
 */
async function storeSignalMessage(symbol, messageId, data) {
  signalMap.set(symbol, {
    messageId,
    entryPrice: data.entryPrice,
    side: data.side,
    timestamp: Date.now()
  });
  console.log(`Stored signal for ${symbol}:`, signalMap.get(symbol));
}

/**
 * Get stored signal data
 */
function getStoredSignal(symbol) {
  return signalMap.get(symbol);
}

/**
 * Remove signal from map
 */
function removeSignal(symbol) {
  const removed = signalMap.delete(symbol);
  console.log(`Removed signal for ${symbol}: ${removed}`);
}

/**
 * Webhook endpoint for the main channel
 */
app.post('/webhook', async (req, res) => {
  const data = req.body;
  console.log(data);

  if (data && data.symbol) {
    data.symbol = normalizeSymbol(data.symbol);
  }

  // Handle close message
  if (data && data.message === 'close') {
    if (!data.symbol || !data.side) {
      return res.status(400).json({ error: 'Invalid close payload: symbol and side are required' });
    }

    const storedSignal = getStoredSignal(data.symbol);
    const closeMsg = `#${data.symbol} #${data.side}\nClose the Signal`;

    try {
      if (storedSignal) {
        await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, closeMsg, {
          reply_to_message_id: storedSignal.messageId
        });
        removeSignal(data.symbol);
      } else {
        await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, closeMsg);
      }
      return res.status(200).json({ status: 'Close message sent', message: closeMsg });
    } catch (error) {
      console.error('Error sending close message:', error);
      return res.status(500).json({ error: 'Failed to send close message' });
    }

  // Handle TP messages
  } else if (data && (data.message === 'lastTp' || data.message === 'tp')) {
    if (
      !data.symbol ||
      !data.entryPrice ||
      !data.side ||
      (!data.tpPrice && data.message === 'tp') ||
      (!data.finalTpPrice && data.message === 'lastTp')
    ) {
      return res
        .status(400)
        .json({ error: `Invalid ${data.message} payload: required fields are missing` });
    }

    const storedSignal = getStoredSignal(data.symbol);
    const positionSize = 100;
    const leverage = 20;
    const entryPrice = parseFloat(data.entryPrice);
    const takeProfitPrice = data.message === "tp" ? parseFloat(data.tpPrice) : parseFloat(data.finalTpPrice);
    const profit = data.side.toLowerCase() === "long"
      ? (positionSize * leverage / entryPrice) * (takeProfitPrice - entryPrice)
      : (positionSize * leverage / entryPrice) * (entryPrice - takeProfitPrice);

    const sideEscaped = escapeMarkdownV2(data.side.toUpperCase());
    const symbolEscaped = escapeMarkdownV2(data.symbol);
    const entryPriceEscaped = escapeMarkdownV2(entryPrice.toFixed(8));
    const tpPriceEscaped = escapeMarkdownV2(takeProfitPrice.toFixed(8));
    const profitEscaped = escapeMarkdownV2(profit.toFixed(8));
    const positionSizeEscaped = escapeMarkdownV2(positionSize.toString());
  
    const promotionMsg = `🔥 *Trading Bot Results* 🔥\n\n` +
      `📊 *Results:* \\#${sideEscaped} \\#${symbolEscaped}\n` +
      `💰 *Entry Price:* \`${entryPriceEscaped}\`\n` +
      `🎯 *${escapeMarkdownV2(data.message === "tp" ? "TP Price" : "Final TP Price")}* \`${tpPriceEscaped}\`\n` +
      `📈 *Profit:* \`${profitEscaped}\` USDT\n` +
      `📊 *Position Size:* \`${positionSizeEscaped}\` USDT\n\n` +
      `📈 *Leverage:* 20x\n\n` +
      `🚀 *Enjoy profit from the free automated trading bot\\!* \n` +
      `👉 Click the link, then [*START*](https://ai\\-trade\\.io/sign\\-up)\n\n` +
      `@AI\\_tradesbot`;

    try {
      const messageOptions = {
        parse_mode: 'MarkdownV2'
      };

      if (storedSignal) {
        messageOptions.reply_to_message_id = storedSignal.messageId;
      }

      await promotionBot.telegram.sendMessage(TELEGRAM_CHANNEL_PROMOTION, promotionMsg, messageOptions);
      
      // If it's the last TP, remove the signal from the map
      if (data.message === 'lastTp') {
        removeSignal(data.symbol);
      }
      
      return res.status(200).json({ status: `${data.message} message sent`, message: promotionMsg });
    } catch (error) {
      console.error(`Error sending ${data.message} message:`, error);
      return res.status(500).json({ error: `Failed to send ${data.message} message` });
    }

  // Handle new trade entries
  } else {
    if (!data || !data.side || !data.symbol || !data.entryPrice || !data.targets || !data.stopLoss) {
      return res.status(400).json({ error: 'Invalid payload: required fields are missing' });
    }

    const message = formatMessage(data);
    try {
      const sentMessage = await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, message);
      // Store the message ID for future reference
      await storeSignalMessage(data.symbol, sentMessage.message_id, data);
      return res.status(200).json({ status: 'Message sent', message });
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }
});

/**
 * Webhook endpoint for the real channel
 */
app.post('/real-channel', async (req, res) => {
  const data = req.body;
  console.log(data);

  // If close
  if (data && data.message === 'close') {
    if (!data.symbol || !data.side) {
      return res.status(400).json({ error: 'Invalid close payload' });
    }
    const closeMsg = `#${data.symbol} #${data.side}\nClose the Signal`;

    try {
      const messageId = await findLatestMessageWithSymbol(data.symbol);
      if (messageId) {
        await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, closeMsg, {
          reply_to_message_id: messageId
        });
      } else {
        await bot.telegram.sendMessage(TELEGRAM_CHANNEL_ID, closeMsg);
      }
      return res.status(200).json({ status: 'Close message sent', message: closeMsg });
    } catch (error) {
      console.error('Error sending close message:', error);
      return res.status(500).json({ error: 'Failed to send close message' });
    }

  // If TP or lastTp
  } else if (data && (data.message === 'lastTp' || data.message === 'tp')) {
    if (
      !data.symbol ||
      !data.entryPrice ||
      !data.side ||
      (!data.tpPrice && data.message === 'tp') ||
      (!data.finalTpPrice && data.message === 'lastTp')
    ) {
      return res.status(400).json({ error: `Invalid ${data.message} payload` });
    }

    const positionSize = 100;
    const leverage = 20;
    const entryPrice = parseFloat(data.entryPrice);
    const takeProfitPrice = data.message === "tp" ? parseFloat(data.tpPrice) : parseFloat(data.finalTpPrice);
    const profit = data.side.toLowerCase() === "long"
      ? (positionSize * leverage / entryPrice) * (takeProfitPrice - entryPrice)
      : (positionSize * leverage / entryPrice) * (entryPrice - takeProfitPrice);

    const sideEscaped = escapeMarkdownV2(data.side.toUpperCase());
    const symbolEscaped = escapeMarkdownV2(data.symbol);
    const entryPriceEscaped = escapeMarkdownV2(entryPrice.toFixed(8));
    const tpPriceEscaped = escapeMarkdownV2(takeProfitPrice.toFixed(8));
    const profitEscaped = escapeMarkdownV2(profit.toFixed(8));
    const positionSizeEscaped = escapeMarkdownV2(positionSize.toString());
    const mention = escapeMarkdownV2('@AI_tradesbot'); // or escapeMarkdownV2('@AI_tradesbot')
  
    const promotionMsg = `🔥 *Trading Bot Results* 🔥\n\n` +
      `📊 *Results:* \\#${sideEscaped} \\#${symbolEscaped}\n` +
      `💰 *Entry Price:* \`${entryPriceEscaped}\`\n` +
      `🎯 *${escapeMarkdownV2(data.message === "tp" ? "TP Price" : "Final TP Price")}* \`${tpPriceEscaped}\`\n` +
      `📈 *Profit:* \`${profitEscaped}\` USDT\n` +
      `📊 *Position Size:* \`${positionSizeEscaped}\` USDT\n\n` +
      `📈 *Leverage:* 20x\n\n` +
      `🚀 *Enjoy profit from the free automated trading bot\\!* \n` +
      `👉 Click the link, then [*START*](https://ai\\-trade\\.io/sign\\-up)\n\n` +
      `@AI\\_tradesbot`;


    try {
      // Send to real channel's promotion
      await mainBot.telegram.sendMessage(TELEGRAM_CHANNEL_PROMOTION, promotionMsg, {
        parse_mode: 'MarkdownV2'
      });
      return res.status(200).json({ status: `${data.message} message sent`, message: promotionMsg });
    } catch (error) {
      console.error(`Error sending ${data.message} message:`, error);
      return res.status(500).json({ error: `Failed to send ${data.message} message` });
    }

  // Else handle new trade entry
  } else {
    if (!data || !data.side || !data.symbol || !data.entryPrice || !data.targets || !data.stopLoss) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Format normal signal message
    const message = formatMessage(data);
    try {
      await mainBot.telegram.sendMessage(TELEGRAM_CHANNEL_ID_REAL, message);
      return res.status(200).json({ status: 'Message sent', message });
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});