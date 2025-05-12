import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  MASTER_MNEMONIC: process.env.MASTER_MNEMONIC || "",
  SERVER_SECRET: process.env.SERVER_SECRET || "server_secret",

  CHAIN_ID: Number(process.env.CHAIN_ID || ""),
  RPC_URL: process.env.RPC_URL || "",
};

if (!CONFIG.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

if (!CONFIG.MASTER_MNEMONIC) {
  throw new Error("MASTER_MNEMONIC is required");
}
