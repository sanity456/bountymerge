// Resumable, two-account Studio Next smoke test. Never reads a user wallet key.
import { abi, createAccount, createClient, createFeesDistribution, normalizeMessageFeeAllocations } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

assert.ok(process.argv.includes("--execute"), "Explicit --execute required.");
const runtime = new URL("../.sites-runtime/", import.meta.url);
const keys = JSON.parse(await readFile(new URL("bountymerge-live-accounts.json", runtime), "utf8"));
assert.ok(Array.isArray(keys) && keys.length === 2 && keys.every(k => /^0x[0-9a-fA-F]{64}$/.test(k)));
const clients = keys.map(key => createClient({ chain: studioDevnet, account: createAccount(key) }));
const [a, b] = clients;
assert.equal(Number(await a.request({ method: "eth_chainId" })), 61997);
assert.equal(Number(await b.request({ method: "eth_chainId" })), 61997);
const code = await readFile(new URL("../contracts/bountymerge.py", import.meta.url), "utf8");
const sourceHash = createHash("sha256").update(code).digest("hex");
const reportPath = new URL(`bountymerge-live-report-${sourceHash.slice(0, 12)}.json`, runtime);
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
let report;
try { report = JSON.parse(await readFile(reportPath, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  report = { chain_id: 61997, rpc: studioDevnet.rpcUrls.default.http[0], source_sha256: sourceHash,
    accounts: clients.map(c => c.account.address), project_name: `BountyMerge live proof ${new Date().toISOString().slice(0, 16)}`,
    transactions: [], created_at: new Date().toISOString(), complete: false };
}
const save = () => writeFile(reportPath, json(report));
assert.equal(report.chain_id, 61997);
assert.equal(report.source_sha256, sourceHash, "Source changed since live test began.");
assert.deepEqual(report.accounts, clients.map(c => c.account.address));
await save();
function plain(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}
function executionSucceeded(value) {
  const record = plain(value);
  const result = record.txExecutionResultName ?? record.txExecutionResult;
  if (result != null) return result === 1 || result === "FINISHED_WITH_RETURN" || result === "SUCCESS";
  const leaders = record.consensus_data?.leader_receipt;
  const receipts = Array.isArray(leaders) ? leaders : leaders ? [leaders] : [];
  return receipts.length > 0 && receipts.every(r => r.execution_result === "SUCCESS" || r.execution_result === "FINISHED_WITH_RETURN");
}
async function finishPending() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const receipt = plain(await a.getTransaction({ hash: report.pending.hash }));
    const status = String(receipt.statusName ?? receipt.status ?? "UNKNOWN").toUpperCase();
    if (attempt % 5 === 0) console.log(json({ action: report.pending.action, hash: report.pending.hash, status }));
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) {
      const success = status === "FINALIZED" && executionSucceeded(receipt);
      report.transactions.push({ ...report.pending, status, execution_success: success,
        execution_result: receipt.txExecutionResultName ?? receipt.txExecutionResult ?? null,
        validators: receipt.consensus_data?.validators?.map(v => ({ mode: v.mode, vote: v.vote, execution_result: v.execution_result })),
        completed_at: new Date().toISOString() });
      if (success && report.pending.action === "deploy") {
        report.address = receipt.recipient || receipt.to_address || receipt.txDataDecoded?.contractAddress;
        report.deployment_tx = report.pending.hash;
      }
      delete report.pending;
      await save();
      assert.ok(success, `Transaction ${status} with execution error. Inspect the report before any retry.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
  throw Error("Transaction remains pending. Rerun --execute to resume the same hash, not submit again.");
}
async function feeQuote(client, request) {
  const baseline = await client.estimateTransactionFees();
  if (!request) return baseline;
  const block = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  assert.match(block?.timestamp, /^0x[0-9a-f]+$/i);
  const seconds = Number(BigInt(block.timestamp));
  assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
  const data = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(request.functionName, request.args, undefined)), false]);
  const fees = JSON.parse(JSON.stringify({ distribution: baseline.distribution, feeValue: baseline.feeValue,
    messageAllocations: baseline.messageAllocations }, (_, v) => typeof v === "bigint" ? v.toString() : v));
  let simulation;
  try {
    simulation = await client.request({ method: "sim_estimateTransactionFees", params: [{ type: "write",
      to: request.address, from: client.account.address, data, transaction_hash_variant: "latest-final", fees,
      sim_config: { genvm_datetime: new Date(seconds * 1000).toISOString() } }] });
  } catch (error) {
    const encoded = error?.cause?.data?.receipt?.result;
    const detail = typeof encoded === "string" ? Buffer.from(encoded, "base64").toString("utf8").replace(/[\x00-\x1f]/g, " ") : error.message;
    throw Error(`Studio Next write simulation failed: ${detail.slice(0, 500)}. No transaction sent.`);
  }
  const preset = simulation.recommendedPreset;
  assert.equal(simulation.receipt?.execution_result, "SUCCESS", "Write simulation failed. Nothing sent.");
  assert.ok(preset?.distribution && /^\d+$/.test(String(preset.feeValue)), "Invalid Studio fee quote.");
  return { distribution: createFeesDistribution(preset.distribution), feeValue: BigInt(preset.feeValue),
    messageAllocations: preset.messageAllocations ? normalizeMessageFeeAllocations(preset.messageAllocations) : undefined };
}
async function affordable(client, fees) {
  assert.ok(fees.feeValue > 0n && fees.feeValue <= 1000000000000000000n, "Fee quote outside 0–1 test GEN bound.");
  const balance = BigInt(await client.request({ method: "eth_getBalance", params: [client.account.address, "pending"] }));
  assert.ok(balance >= fees.feeValue, `Insufficient free test GEN at ${client.account.address}. No transaction sent.`);
  console.log(json({ from: client.account.address, fee_deposit_wei: fees.feeValue, balance_wei: balance }));
}
async function write(action, client, functionName, args) {
  if (report.transactions.some(tx => tx.action === action && tx.execution_success)) return;
  assert.ok(!report.transactions.some(tx => tx.action === action), `Previous ${action} failed. Manual inspection required.`);
  const request = { address: report.address, functionName, args, leaderOnly: false, value: 0n };
  const fees = await feeQuote(client, request);
  await affordable(client, fees);
  const hash = await client.writeContract({ ...request, fees });
  report.pending = { action, hash, account: client.account.address, functionName, args };
  await save();
  await finishPending();
}
const read = async (method, args = []) => plain(await a.readContract({ address: report.address,
  functionName: method, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
if (report.pending) await finishPending();
if (!report.address) {
  await a.getContractSchemaForCode(code);
  const fees = await feeQuote(a);
  await affordable(a, fees);
  const hash = await a.deployContract({ code, args: [], leaderOnly: false, fees });
  report.pending = { action: "deploy", hash, account: a.account.address };
  await save();
  await finishPending();
}
assert.match(report.address, /^0x[0-9a-fA-F]{40}$/);
const deployed = await a.getContractCode(report.address);
const deployedCode = deployed.startsWith("0x") ? Buffer.from(deployed.slice(2), "hex") : Buffer.from(deployed);
assert.equal(createHash("sha256").update(deployedCode).digest("hex"), sourceHash, "On-chain source mismatch.");
assert.equal((await read("get_config")).policy, "bountymerge/pair-v4");
await write("create_project", a, "create_project", [report.project_name, "Live verification of two-owner feature-request merging."]);
const projects = (await read("list_projects", [0, 20])).items;
const project = projects.find(p => p.name === report.project_name && p.owner === a.account.address.toLowerCase());
assert.ok(project, "Project not found after finalized write.");
report.project_id = project.id; await save();
const requests = [
  { title: "Export transaction history as CSV", details: "Download wallet transaction history for bookkeeping.",
    requirements: ["Include date, token, amount and transaction hash.", "Let me select a date range."],
    exclusions: ["Do not export private notes."] },
  { title: "Wallet activity spreadsheet export", details: "Open wallet activity in a spreadsheet to reconcile records.",
    requirements: ["Provide an Excel-compatible CSV file.", "Include dates, token amounts and transaction IDs."],
    exclusions: [] },
];
for (let i = 0; i < 2; i++) await write(`submit_request_${i}`, clients[i], "submit_request",
  [project.id, requests[i].title, requests[i].details, JSON.stringify(requests[i].requirements), JSON.stringify(requests[i].exclusions)]);
const storedRequests = (await read("list_requests", [project.id, 0, 20])).items;
const owned = requests.map((request, i) => storedRequests.find(r => r.title === request.title && r.author === clients[i].account.address.toLowerCase()));
assert.ok(owned.every(Boolean), "One or both requests missing after finalization.");
report.request_ids = owned.map(r => r.id); await save();
await write("compare_requests", a, "compare_requests", report.request_ids);
const comparisons = (await read("list_comparisons", [project.id, 0, 20])).items;
const comparison = comparisons.find(c => c.request_a_id === owned[0].id && c.request_b_id === owned[1].id);
assert.ok(comparison, "Comparison missing after finalization.");
report.comparison_id = comparison.id;
report.comparison_result = comparison.result;
await save();
assert.equal(comparison.result.status, "MERGEABLE", "Live model did not produce a mergeable brief. Inspect before proceeding.");
assert.equal(comparison.state, "AWAITING_APPROVAL");
assert.equal(comparison.result.coverage_a.length, owned[0].requirements.length);
assert.equal(comparison.result.coverage_b.length, owned[1].requirements.length);
await write("approve_a", a, "set_approval", [comparison.id, true]);
assert.equal((await read("get_comparison", [comparison.id])).state, "AWAITING_APPROVAL");
await write("approve_b", b, "set_approval", [comparison.id, true]);
const merged = await read("get_comparison", [comparison.id]);
assert.equal(merged.state, "MERGED");
assert.equal((await read("get_request", [owned[0].id])).merged_into, comparison.id);
assert.equal((await read("get_request", [owned[1].id])).merged_into, comparison.id);
report.complete = true;
report.completed_at = new Date().toISOString();
await save();
console.log(json({ verified: true, address: report.address, source_sha256: sourceHash,
  project_id: project.id, comparison_id: comparison.id, result: merged.result, transactions: report.transactions }));
