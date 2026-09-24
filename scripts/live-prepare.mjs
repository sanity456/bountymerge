// Creates only disposable Studio Next identities. No transaction is sent.
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { mkdir, readFile, writeFile } from "node:fs/promises";

if (studioDevnet.id !== 61997) throw Error("SDK Studio Next chain changed.");
const runtime = new URL("../.sites-runtime/", import.meta.url);
const path = new URL("bountymerge-live-accounts.json", runtime);
await mkdir(runtime, { recursive: true });
let keys;
try {
  keys = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  keys = [generatePrivateKey(), generatePrivateKey()];
  await writeFile(path, JSON.stringify(keys), { flag: "wx", mode: 0o600 });
}
if (!Array.isArray(keys) || keys.length !== 2 || keys.some(k => !/^0x[0-9a-fA-F]{64}$/.test(k)))
  throw Error("Invalid local test account file. Do not fund these identities.");
const addresses = keys.map(key => createAccount(key).address);
if (addresses[0].toLowerCase() === addresses[1].toLowerCase()) throw Error("Test identities must differ.");
for (let i = 0; i < addresses.length; i++) {
  const client = createClient({ chain: studioDevnet, account: createAccount(keys[i]) });
  const chain = Number(await client.request({ method: "eth_chainId" }));
  if (chain !== 61997) throw Error(`Unexpected RPC chain ${chain}.`);
  const balance = await client.request({ method: "eth_getBalance", params: [addresses[i], "pending"] });
  const baseline = await client.estimateTransactionFees();
  console.log(JSON.stringify({ role: i === 0 ? "request_owner_a_and_deployer" : "request_owner_b",
    address: addresses[i], chain_id: chain, balance_wei: BigInt(balance).toString(),
    baseline_protocol_deposit_wei: baseline.feeValue.toString() }));
}
console.log("Disposable keys are in ignored .sites-runtime/bountymerge-live-accounts.json. Never share them or send mainnet assets.");
