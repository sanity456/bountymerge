# BountyMerge

BountyMerge helps two people discover whether their feature requests can be served by one deliverable. It is **not** a bounty-payment or escrow product. The first release records requests, compares a pair using GenLayer, proposes a requirement-traced brief, and merges only after both request owners approve that exact brief.

## Current status

The contract and web app are implemented locally. The frontend starts in an explicitly labelled sample preview until `VITE_BOUNTYMERGE_CONTRACT` points at a deployment. No GenLayer deployment, live consensus result, two-wallet approval, public site, or GitHub release has been verified yet. Do not submit the preview as a live on-chain demo.

## How the workflow works

1. A wallet creates a project. Two different wallets each publish a request with 1–4 requirements and optional exclusions. Request content is immutable.
2. Anyone can request a comparison of two open requests in the same project. The GenLayer leader proposes `MERGEABLE`, `SEPARATE`, or `UNCLEAR`; independent validators reclassify and audit the leader's reason, every requirement-to-brief mapping, and exclusions.
3. A `MERGEABLE` comparison remains pending. Each original author may approve, withdraw an approval, or reject the brief. Only two approvals mark the pair merged. A rejection leaves history intact and permits another comparison round. `SEPARATE` and `UNCLEAR` create no approval path.

Request text and model output are untrusted. The validator does not merely accept the leader's status or explanation. No automatic payment, funding, mutable proposal text, or owner override is present.

## Local development

Requires Node 24+ and a GenLayer Python environment for contract checks. Python-only test dependencies are listed in `tests/requirements.txt`; they are not installed by Vercel.

```powershell
npm ci
npm run dev
npm test
npm run build
```

The Vite app runs at `http://127.0.0.1:5173` by default. To connect a deployment, copy `.env.example` to `.env.local`, set `VITE_BOUNTYMERGE_CONTRACT` to the verified contract address, then restart or rebuild the app. The client targets **Studio Next, chain 61997**, and supports discovered EVM wallets. Wallet actions simulate first, display the estimated test-GEN protocol deposit, require wallet confirmation, and wait for finalization. No signed transaction injects a custom chain timestamp.

## Contract checks

The contract pins a concrete GenVM runner in the first line. From a Python environment with `genlayer`/GenVM tools installed:

```powershell
$env:GENVM_VERSION = 'v0.6.0-rc5'
genvm-lint check contracts/bountymerge.py --json
python -m pytest tests/direct -q
```

The direct tests exercise author binding, duplicate guards, immutability, rejection/retry, approval withdrawal, two-owner completion, and validator disagreement/audit failures. Their LLM responses are mocked; **they do not prove live validator consensus**. A clean live Studio Next test with two funded wallets is required before a submission-ready claim.

## Reviewer verification after deployment

Use two separate Studio Next wallet accounts, each with enough free test GEN for the displayed fees. Create a project, publish one CSV-export request from each wallet, compare them, inspect the status and mapped brief, approve from wallet A and then wallet B, and verify both originals remain visible while the comparison becomes `MERGED`. Also compare a materially different request, and reject a draft to verify a new round can be run without rewriting the originals. Record the contract address, transaction hashes, public source revision, and the exact result; do not substitute local mocked tests for this proof.
