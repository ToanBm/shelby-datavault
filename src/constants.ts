import type { Network } from "@aptos-labs/wallet-adapter-react";

export const NETWORK: Network = (process.env.NEXT_PUBLIC_APP_NETWORK as Network) ?? "testnet";
export const MODULE_ADDRESS = process.env.NEXT_PUBLIC_MODULE_ADDRESS;
export const APTOS_API_KEY = process.env.NEXT_PUBLIC_APTOS_API_KEY;
/** Custom fullnode URL — overrides the SDK default for the selected network. */
export const APTOS_NODE_URL = process.env.NEXT_PUBLIC_APTOS_NODE_URL;
