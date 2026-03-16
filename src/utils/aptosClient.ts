import { APTOS_API_KEY, APTOS_NODE_URL, NETWORK } from "@/constants";
import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";

const aptos = new Aptos(
  new AptosConfig({
    network: NETWORK,
    // Use the staging testnet node URL when provided (overrides SDK default).
    ...(APTOS_NODE_URL ? { fullnode: APTOS_NODE_URL } : {}),
    clientConfig: { API_KEY: APTOS_API_KEY },
  }),
);

// Reuse same Aptos instance to utilize cookie based sticky routing
export function aptosClient() {
  return aptos;
}
