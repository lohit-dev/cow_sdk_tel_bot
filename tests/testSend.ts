import { ethers } from "ethers";

const privateKey = process.env.MY_PRIVATE_KEY || "";

const provider = new ethers.providers.JsonRpcProvider(
  "https://sepolia.drpc.org"
);

const wallet = new ethers.Wallet(privateKey, provider);

async function checkBalance() {
  const balance = await wallet.getBalance();
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
}

async function sendETH(toAddress, amountInEther) {
  const tx = {
    to: toAddress,
    value: ethers.utils.parseEther(amountInEther),
  };

  try {
    console.log(`Sending ${amountInEther} ETH to ${toAddress}...`);
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`Transaction hash: ${txResponse.hash}`);

    const receipt = await txResponse.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
  } catch (error) {
    console.error("Error sending transaction:", error);
  }
}

checkBalance().then(() => {
  sendETH("0xF811631fd34d1580EF7FeEbC120327700713740d", "0.02");
});
