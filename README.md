
# ethers-provider-blxroute-bundle

This repository contains the `BlxrouteBundleProvider` ethers.js provider, a provider class that enables high-level access to Bloxroute's `blxr_simulate_bundle` and `blxr_submit_bundle` methods for its professional RPC endpoints. **Unlike Flashbots, Bloxroute supports multiple relays and miners across different chains and does not require running any local relay software.**

Bloxroute relays expose custom JSON-RPC endpoints for bundle sending and simulation. Since these endpoints are non-standard, `ethers.js` and similar libraries don't support them natively. This provider extends ethers to make Bloxroute bundle interaction easier.

Unlike Flashbots, this library does not handle **payload signing**, which is necessary for authentication when sending bundles. This is because bloXroute provides the account key that must be used when sending the bundle.

This library works as an extension to your existing [ethers.js v5](https://github.com/ethers-io/ethers.js/) setup.

## Installation

Install both `ethers` and `@flashbots-sdk/ethers-provider-blxroute-bundle`:

```bash
npm install --save ethers
npm install --save @flashbots-sdk/ethers-provider-blxroute-bundle
```

## Quick Start Example

```ts
import { providers, Wallet } from "ethers"
import { BlxrouteBundleProvider } from "@flashbots-sdk/ethers-provider-blxroute-bundle"

const provider = new providers.JsonRpcProvider({ url: ETHEREUM_RPC_URL }, 1)

const authSigner = Wallet.createRandom()

const blxrouteProvider = await BlxrouteBundleProvider.create(
  "M2MzNzA2YWQtNTQ4OC00..." // bloXroute account key
  provider, // Ethereum node RPC
  "mainnet"
)
```

You now have a `blxrouteProvider` instance that can `simulate()` bundles or `sendRawBundle()` to miners.

## Bundle Format

```ts
const wallet = new Wallet(PRIVATE_KEY)
const transaction = {
  to: CONTRACT_ADDRESS,
  data: CALL_DATA
}
const transactionBundle = [
  {
    signedTransaction: SIGNED_TX_HEX
  },
  {
    signer: wallet,
    transaction
  }
]
```

## Target Block

```ts
const targetBlockNumber = (await provider.getBlockNumber()) + 1
```

## EIP-1559 Gas Strategy

```ts
const block = await provider.getBlock("latest")
const maxBaseFee = BlxrouteBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, BLOCKS_AHEAD)

const eip1559Tx = {
  to: wallet.address,
  type: 2,
  maxFeePerGas: PRIORITY_FEE.add(maxBaseFee),
  maxPriorityFeePerGas: PRIORITY_FEE,
  gasLimit: 21000,
  chainId: CHAIN_ID
}
```

## Simulation and Submission

```ts
const signedBundle = await blxrouteProvider.signBundle(transactionBundle)

const simulation = await blxrouteProvider.simulate(signedBundle, targetBlockNumber)
console.log(JSON.stringify(simulation, null, 2))

const response = await blxrouteProvider.sendRawBundle(transactionBundle, targetBlockNumber)
```

## `BlxrouteTransactionResponse` Methods

- `bundleTransactions()` – Array of bundle details
- `receipts()` – Returns receipts without waiting
- `wait()` – Waits for block inclusion or bundle invalidation
- `simulate()` – Re-simulates when the block height is reached

## Optional Parameters

```ts
{
  minTimestamp: 1645753192,
  maxTimestamp: 1645753500,
  revertingTxHashes: ["0x..."]
}
```

### Reverting Transactions

bloXroute supports selective reverts within bundles using `revertingTxHashes`.

## Miner Payments

bloXroute bundles can pay miners via:
```solidity
block.coinbase.transfer(minerTip)
```
or
```solidity
(bool sent, ) = block.coinbase.call{value: minerTip}("");
```

## Statistics

- `getUserStats()` – Shows relay submission metrics
- `getBundleStats(bundleHash, blockNumber)` – Tracks individual bundle performance

## Private Transaction

You can also send a single private transaction:

```ts
const privateTx = {
  transaction: {
    to: wallet.address,
    value: ethers.utils.parseEther("0.01"),
    gasPrice: ethers.utils.parseUnits("99", "gwei"),
    gasLimit: 21000
  },
  signer: wallet
}

const res = await blxrouteProvider.sendPrivateTransaction(privateTx, {
  maxBlockNumber: (await provider.getBlockNumber()) + 10
})
```

## bloXroute on Binance Smart Chain

bloXroute supports BSC chain. Use the correct RPC URL and chain name:

```ts
const provider = new providers.JsonRpcProvider("https://sepolia.infura.io/v3/YOUR_KEY")

const blxrouteProvider = await BlxrouteBundleProvider.create(
  "M2MzNzA2YWQtNTQ4OC00..." // bloXroute account key
  provider, // BSC node RPC
  "bsc"
)
```

## bloXroute on Testnets

bloXroute does not support testnet