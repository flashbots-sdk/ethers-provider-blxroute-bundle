import {
  BlockTag,
  TransactionRequest,
  Provider,
  Signer,
  Transaction,
  Wallet,
} from "ethers";

import axios, { AxiosRequestConfig } from "axios";

export enum BlockchainNetwork {
  Mainnet = "Mainnet", // Ethereum Mainnet
  BSCMainnet = "BSC-Mainnet", // Binance Smart Chain Mainnet
}

export interface BlxrouteBundleTransaction {
  transaction: TransactionRequest;
  signer: Signer;
}

export interface BlxrouteBundleRawTransaction {
  signedTransaction: string;
}

type RpcParams = any;

const TIMEOUT_MS = 10 * 1000;

export class BlxrouteBundleProvider {
  private genericProvider: Provider;
  private apiKey: string;
  private network: BlockchainNetwork;
  #nextId: number;

  constructor(
    apiKey: string,
    genericProvider: Provider,
    network: BlockchainNetwork
  ) {
    this.apiKey = apiKey;
    this.genericProvider = genericProvider;
    this.network = network;
    this.#nextId = 1;
  }

  static async throttleCallback(): Promise<boolean> {
    console.warn("Rate limited");
    return false;
  }

  /**
   * Creates a new bloXRoute provider instance.
   * @param apiKey bloXRoute api key string
   * @param genericProvider ethers.js mainnet provider
   * @param network (optional) blockchain network
   *
   * @example
   * ```typescript
   * const {providers, Wallet} = require("ethers")
   * const {BlxrouteBundleProvider} = require("@blxroute-sdk/ethers-provider-bundle")
   * const provider = new providers.JsonRpcProvider("http://localhost:8545")
   * const brProvider = BlxrouteBundleProvider.create(apiKey: string, provider, BlockchainNetwork.Mainnet)
   * ```
   */
  static create(
    apiKey: string,
    genericProvider: Provider,
    network: BlockchainNetwork = BlockchainNetwork.Mainnet
  ): BlxrouteBundleProvider {
    return new BlxrouteBundleProvider(apiKey, genericProvider, network);
  }

  /**
   * Calculates maximum base fee in a future block.
   * @param baseFee current base fee
   * @param blocksInFuture number of blocks in the future
   */
  static getMaxBaseFeeInFutureBlock(
    baseFee: bigint,
    blocksInFuture: number
  ): bigint {
    let maxBaseFee = BigInt(baseFee);
    for (let i = 0; i < blocksInFuture; i++) {
      maxBaseFee = (maxBaseFee * 1125n) / 1000n + 1n;
    }
    return maxBaseFee;
  }

  private prepareRelayRequest(
    method:
      | "blxr_simulate_bundle"
      | "blxr_submit_bundle"
      | "blxr_tx"
      | "blxr_batch_tx"
      | "blxr_private_tx"
      | "blxr_get_bundle_refund"
      | "blxr_get_latest_bundle_refunds"
      | "submit_arb_only_bundle"
      | "blxr_snipe_me"
      | "get_external_mev_builders"
      | "ping",
    params: RpcParams = {}
  ) {
    return {
      method,
      params,
      id: this.#nextId++,
      jsonrpc: "2.0",
    };
  }

  private async requestRpc(
    url: string,
    method: "GET" | "POST",
    body?: any,
    timeout: number = TIMEOUT_MS // default timeout in ms
  ): Promise<any> {
    const config: AxiosRequestConfig = {
      method,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      timeout,
    };

    if (body && method === "POST") {
      config.data = body;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        return error.response.data;
      } else if (error.request) {
        return {
          error: {
            code: -1,
            message: "rpc error: no response received from server",
          },
        };
      } else {
        return {
          error: {
            code: -1,
            message: `rpc error: ${error.message}`,
          },
        };
      }
    }
  }

  /**
   * Signs a bundle of transactions, handling both raw transactions and pre-signed ones.
   *
   * This method iterates over the array of bundled transactions, signs any unsigned transactions
   * using the provided signer, manages nonce values to prevent conflicts, estimates gas limits if necessary,
   * and returns an array of signed transactions as hex strings (without the '0x' prefix).
   *
   * For pre-signed transactions, it decodes the transaction to update nonce tracking.
   *
   * @param bundledTransactions - Array of transactions to sign. Each item can be either:
   *   - An unsigned transaction with a signer and transaction data, or
   *   - A pre-signed raw transaction string.
   *
   * @returns Promise resolving to an array of signed transaction hex strings (without '0x').
   *
   * @throws Will throw an error if a pre-signed transaction cannot be decoded,
   *         or if the nonce is malformed.
   *
   * @example
   * ```typescript
   * const signedTxs = await provider.signBundle([
   *   { signer: wallet1, transaction: txData1 },
   *   { signedTransaction: "0xabc123..." }
   * ]);
   * console.log("Signed transactions:", signedTxs);
   * ```
   */

  public async signBundle(
    bundledTransactions: Array<
      BlxrouteBundleTransaction | BlxrouteBundleRawTransaction
    >
  ): Promise<Array<string>> {
    const nonces: { [address: string]: number } = {};
    const signedTransactions = new Array<string>();
    for (const tx of bundledTransactions) {
      if ("signedTransaction" in tx) {
        // in case someone is mixing pre-signed and signing transactions, decode to add to nonce object
        const transactionDetails = Transaction.from(tx.signedTransaction);
        if (
          transactionDetails.from === undefined ||
          transactionDetails.from === null
        )
          throw new Error("Could not decode signed transaction");
        nonces[transactionDetails.from] = transactionDetails.nonce + 1;
        signedTransactions.push(tx.signedTransaction?.slice(2));
        continue;
      }
      const transaction = { ...tx.transaction };
      const address = await tx.signer.getAddress();
      if (typeof transaction.nonce === "string") throw new Error("Bad nonce");
      const nonce =
        transaction.nonce !== undefined && transaction.nonce !== null
          ? transaction.nonce
          : nonces[address] ??
            (await this.genericProvider.getTransactionCount(
              address,
              "pending"
            ));
      nonces[address] = nonce + 1;
      transaction.nonce = nonce;

      if (
        (transaction.type == null || transaction.type == 0) &&
        transaction.gasPrice === undefined
      )
        transaction.gasPrice = 0n;
      if (transaction.gasLimit === undefined)
        transaction.gasLimit = await tx.signer.estimateGas(transaction); // TODO: Add target block number and timestamp when supported by geth

      const signedTransaction: string = await tx.signer.signTransaction(
        transaction
      );
      signedTransactions.push(signedTransaction?.slice(2));
    }

    return signedTransactions;
  }

  /**
   * Sends a raw signed transaction bundle to the bloXroute MEV relay.
   *
   * This function targets a specific future block and submits the signed transactions to bloXroute
   * infrastructure for potential inclusion by participating block builders. Optionally, you can
   * configure the number of blocks the bundle remains valid and specify particular MEV builders.
   *
   * @param signedBundledTransactions - An array of raw signed Ethereum transactions (hex strings).
   * @param targetBlockNumber - The block number to target for bundle inclusion.
   * @param blocksCount - (Optional) Number of consecutive blocks to attempt sending the bundle.
   * @param mevBuilders - (Optional) Custom object defining MEV builders to receive the bundle.
   * @returns A promise resolving to the response from the bloXroute RPC endpoint.
   *
   * @example
   * ```typescript
   * const bundle: Array<string> = [
   *    "02f8...signedTx1",
   *    "02f8...signedTx2"
   * ];
   * const targetBlock = await provider.getBlockNumber() + 1;
   * const response = await brProvider.sendRawBundle(bundle, targetBlock, 1);
   * console.log("Bundle submission result:", response);
   * ```
   */

  public async sendRawBundle(
    signedBundledTransactions: Array<string>,
    targetBlockNumber: number,
    blocksCount?: number,
    mevBuilders?: any
  ): Promise<any> {
    if (!mevBuilders) {
      mevBuilders = {
        all: "",
      };
    }

    const request: any = this.prepareRelayRequest("blxr_submit_bundle", {
      transaction: signedBundledTransactions,
      blockchain_network: this.network.toString(),
      block_number: `0x${targetBlockNumber.toString(16)}`,
      mev_builders: mevBuilders,
    });

    if (blocksCount) {
      request.params.blocks_count = 1;
    }

    return await this.requestRpc("https://api.blxrbdn.com", "POST", request);
  }

  /**
   * Retrieves detailed trace information for a given transaction bundle hash.
   *
   * This method queries the bloXroute tools endpoint to fetch execution traces
   * and diagnostic data for a specific bundle hash on the selected blockchain network.
   *
   * @param hash - The hash of the transaction bundle to trace.
   * @returns A promise resolving to the trace details of the bundle.
   *
   * @example
   * ```typescript
   * const bundleHash = "0xabc123...def456";
   * const traceResult = await brProvider.traceBundle(bundleHash);
   * console.log("Bundle trace data:", traceResult);
   * ```
   */

  public async traceBundle(hash: string) {
    const actionName =
      this.network === BlockchainNetwork.BSCMainnet
        ? "bscbundletrace"
        : "ethbundletrace";

    return await this.requestRpc(
      `https://tools.bloxroute.com/${actionName}/${hash}`,
      "GET"
    );
  }

  /**
   * Simulates the execution of a signed transaction bundle on a specified block.
   *
   * This method sends the signed bundle to the BloxRoute simulation endpoint,
   * allowing you to test how the bundle would execute on a given block and optional state.
   *
   * @param signedBundledTransactions - An array of signed raw transaction strings.
   * @param blockTag - The target block number or tag (e.g., "latest") to simulate against.
   * @param stateBlockTag - (Optional) The block number or tag representing the state for simulation.
   *                        Defaults to "latest" if not provided.
   * @param blockTimestamp - (Optional) The timestamp to simulate the block at.
   *
   * @returns A Promise resolving to an object containing simulation results, including gas usage,
   *          bundle hash, gas fees, and any revert errors found.
   *
   * @example
   * ```typescript
   * const bundle: Array<string> = [
   *   "0x02abc123...",
   *   "0x02def456..."
   * ];
   * const blockNum = await provider.getBlockNumber();
   * const simulationResult = await brProvider.simulate(bundle, blockNum + 1);
   *
   * if (simulationResult.firstRevert) {
   *   console.error("Transaction reverted:", simulationResult.firstRevert);
   * } else {
   *   console.log("Simulation successful:", simulationResult);
   * }
   * ```
   */

  public async simulate(
    signedBundledTransactions: Array<string>,
    blockTag: BlockTag,
    stateBlockTag?: BlockTag,
    blockTimestamp?: number
  ): Promise<any> {
    let evmBlockNumber: string;
    if (typeof blockTag === "number") {
      evmBlockNumber = `0x${blockTag.toString(16)}`;
    } else {
      const blockTagDetails = await this.genericProvider.getBlock(blockTag);
      const blockDetails =
        blockTagDetails !== null
          ? blockTagDetails
          : await this.genericProvider.getBlock("latest");
      if (blockDetails === null) throw new Error("Unable to get latest block");
      evmBlockNumber = `0x${blockDetails.number.toString(16)}`;
    }

    let evmBlockStateNumber: string | bigint;
    if (typeof stateBlockTag === "number") {
      evmBlockStateNumber = `0x${stateBlockTag.toString(16)}`;
    } else if (!stateBlockTag) {
      evmBlockStateNumber = "latest";
    } else {
      evmBlockStateNumber = stateBlockTag;
    }

    const params: RpcParams = {
      transaction: signedBundledTransactions,
      block_number: evmBlockNumber,
      state_block_number: evmBlockStateNumber,
      blockchain_network: this.network.toString(),
    };

    if (blockTimestamp) {
      params.timestamp = blockTimestamp;
    }

    const request = JSON.stringify(
      this.prepareRelayRequest("blxr_simulate_bundle", params)
    );
    const response = await this.requestRpc(
      "https://api.blxrbdn.com",
      "POST",
      request
    );
    if (response.error !== undefined && response.error !== null) {
      return {
        error: {
          message: response.error.message,
          code: response.error.code,
        },
      };
    }

    const callResult = response.result;
    return {
      bundleGasPrice: BigInt(callResult.bundleGasPrice ?? 0),
      bundleHash: callResult.bundleHash,
      coinbaseDiff: BigInt(callResult.coinbaseDiff ?? 0),
      ethSentToCoinbase: BigInt(callResult.ethSentToCoinbase ?? 0),
      gasFees: BigInt(callResult.gasFees ?? 0),
      results: callResult.results,
      stateBlockNumber: callResult.stateBlockNumber ?? 0,
      totalGasUsed: callResult.results.reduce(
        (a: number, b: any) => a + b.gasUsed,
        0
      ),
      firstRevert: callResult.results.find(
        (txSim: any) => "revert" in txSim || "error" in txSim
      ),
    };
  }

  /**
   * Computes the transaction hash (txHash) from a raw signed transaction string.
   *
   * This function takes the RLP-encoded signed transaction (as a hex string),
   * and returns its keccak256 hash, which is the transaction hash (txHash)
   * used on the blockchain to identify the transaction.
   *
   * @param signedTransaction - A raw signed transaction string, in hex format (with or without the '0x' prefix).
   * @returns The 32-byte keccak256 transaction hash as a hex string with '0x' prefix.
   *
   * @example
   * const txHash = deriveTxHash('0xf86c...');
   * console.log(txHash); // e.g., '0xabc123...'
   */
  public deriveTxHash(signedTransaction: string): string {
    return Transaction.from(signedTransaction).hash ?? "0x";
  }
}
