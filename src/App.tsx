import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, GitMerge, Layers3, Link2, Plus, RefreshCw, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { configured, CONTRACT, quoteAndSubmit, read, waitFinal } from "./chain";
import { Action, Comparison, Page, Project, Request, cleanLines, selectedDistinctPair, shortAddress, validateRequest } from "./model";
import { CHAIN_ID, EXPLORER, Provider, WalletOption, connectWallet, watchWallets } from "./wallet";

const SAMPLE_PROJECT: Project = { id: "preview-project", name: "Signal Garden", description: "A place for useful product ideas to find each other.", owner: "0x0000000000000000000000000000000000000000", created_at: "" };
const SAMPLE_REQUESTS: Request[] = [
  { id: "sample-one", project_id: SAMPLE_PROJECT.id, title: "Download my transaction history as CSV", details: "I want a file of wallet transactions that I can open in a spreadsheet.", requirements: ["Include date, amount, token and transaction hash.", "Export the complete date range I select."], exclusions: ["Do not include private notes."], author: "0x1111111111111111111111111111111111111111", created_at: "", merged_into: "" },
  { id: "sample-two", project_id: SAMPLE_PROJECT.id, title: "Export wallet activity for Excel", details: "Give me a spreadsheet ready copy of my wallet activity for bookkeeping.", requirements: ["Provide a CSV file Excel can open.", "Include dates, token amounts and transaction IDs."], exclusions: [], author: "0x2222222222222222222222222222222222222222", created_at: "", merged_into: "" },
  { id: "sample-three", project_id: SAMPLE_PROJECT.id, title: "Live balances inside Excel", details: "I need a live spreadsheet connection that refreshes current balances.", requirements: ["Refresh balances automatically."], exclusions: [], author: "0x3333333333333333333333333333333333333333", created_at: "", merged_into: "" },
];
const SAMPLE_COMPARISON: Comparison = { id: "preview-comparison", project_id: SAMPLE_PROJECT.id, request_a_id: "sample-one", request_b_id: "sample-two", author_a: SAMPLE_REQUESTS[0].author, author_b: SAMPLE_REQUESTS[1].author, result: { status: "MERGEABLE", reason: "Both ask for wallet history as a CSV spreadsheet. A single export can include their requested fields and date range while omitting private notes.", brief_lines: ["Export wallet transaction history as an Excel compatible CSV file.", "Include date, amount, token and transaction ID or hash for each row.", "Let the user choose a date range and exclude private notes."], coverage_a: [1, 2], coverage_b: [0, 1] }, state: "AWAITING_APPROVAL", approved_a: false, approved_b: false, created_at: "" };
const emptyPage = <T,>(): Page<T> => ({ items: [], total: 0, next_offset: 0 });
const idShort = (id: string) => id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
const isOwner = (wallet: string, author: string) => Boolean(wallet) && wallet.toLowerCase() === author.toLowerCase();
type FormName = "project" | "request" | null;

async function readAll<T>(method: string, project?: string): Promise<Page<T>> {
  const items: T[] = [];
  let total = 0;
  for (let offset = 0; offset < 1000; offset += 20) {
    const args = project ? [project, offset, 20] : [offset, 20];
    const page = await read<Page<T>>(method, args);
    items.push(...page.items);
    total = page.total;
    if (page.next_offset >= total) return { items, total, next_offset: total };
    if (page.next_offset <= offset) throw Error("Invalid pagination response from GenLayer.");
  }
  throw Error("This board exceeds the 1,000-item display limit.");
}

export default function App() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [walletMenu, setWalletMenu] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [account, setAccount] = useState<`0x${string}` | "">("");
  const [projectPage, setProjectPage] = useState<Page<Project>>(emptyPage());
  const [projectId, setProjectId] = useState("");
  const [requestPage, setRequestPage] = useState<Page<Request>>(emptyPage());
  const [comparisonPage, setComparisonPage] = useState<Page<Comparison>>(emptyPage());
  const [selected, setSelected] = useState<string[]>([]);
  const [activeComparisonId, setActiveComparisonId] = useState("");
  const [form, setForm] = useState<FormName>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requirements, setRequirements] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | "">("");
  const [txStatus, setTxStatus] = useState("");
  const [tab, setTab] = useState<"requests" | "matches">("requests");

  const preview = !configured;
  const projects = preview ? [SAMPLE_PROJECT] : projectPage.items;
  const requests = preview ? SAMPLE_REQUESTS : requestPage.items;
  const comparisons = preview ? [SAMPLE_COMPARISON] : comparisonPage.items;
  const currentProjectId = preview ? SAMPLE_PROJECT.id : projectId;
  const currentProject = projects.find(p => p.id === currentProjectId);
  const activeComparison = comparisons.find(c => c.id === activeComparisonId) || null;
  const comparedA = activeComparison && requests.find(r => r.id === activeComparison.request_a_id);
  const comparedB = activeComparison && requests.find(r => r.id === activeComparison.request_b_id);
  const chosenA = requests.find(r => r.id === selected[0]);
  const chosenB = requests.find(r => r.id === selected[1]);
  const requestError = useMemo(() => validateRequest(title, details, cleanLines(requirements, 4), cleanLines(exclusions, 3)), [title, details, requirements, exclusions]);

  useEffect(() => watchWallets(setWallets), []);
  useEffect(() => {
    if (!provider || !account) return;
    const invalidate = () => { setAccount(""); setProvider(null); setNotice("Wallet changed. Reconnect to continue."); };
    const accountChanged = (value: unknown) => { if (!Array.isArray(value) || String(value[0]).toLowerCase() !== account.toLowerCase()) invalidate(); };
    const chainChanged = (value: unknown) => { if (Number(value) !== CHAIN_ID) invalidate(); };
    provider.on?.("accountsChanged", accountChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", invalidate);
    return () => { provider.removeListener?.("accountsChanged", accountChanged); provider.removeListener?.("chainChanged", chainChanged); provider.removeListener?.("disconnect", invalidate); };
  }, [provider, account]);

  const refreshProjects = useCallback(async (preferredName?: string) => {
    if (!configured) return;
    try {
      const page = await readAll<Project>("list_projects");
      setProjectPage(page);
      setProjectId(id => page.items.find(project => preferredName && project.name === preferredName.trim() && isOwner(account, project.owner))?.id ||
        (page.items.some(project => project.id === id) ? id : page.items[0]?.id || ""));
    } catch (e) { setError(String(e)); }
  }, [account]);
  const refreshProject = useCallback(async () => {
    if (!configured || !projectId) return;
    try {
      const [newRequests, newComparisons] = await Promise.all([
        readAll<Request>("list_requests", projectId),
        readAll<Comparison>("list_comparisons", projectId),
      ]);
      setRequestPage(newRequests);
      setComparisonPage(newComparisons);
    } catch (e) { setError(String(e)); }
  }, [projectId]);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { setSelected([]); setActiveComparisonId(""); void refreshProject(); }, [refreshProject]);

  const connect = async (option: WalletOption) => {
    setError(""); setWalletMenu(false);
    try { const address = await connectWallet(option.provider); setProvider(option.provider); setAccount(address); setNotice(`Connected ${option.name} on Studio Next.`); }
    catch (e) { setError((e as Error).message); }
  };
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  const requestAction = (next: Action) => { setError(""); setNotice(""); setAction(next); };
  const execute = async () => {
    if (!action || !provider || !account) { setError("Connect a wallet before signing."); return; }
    const current = action;
    setAction(null); setBusy(true); setError(""); setTxHash("");
    try {
      const hash = await quoteAndSubmit(provider, account, current.method, current.args, setNotice);
      setTxHash(hash);
      setTxStatus("SUBMITTED");
      localStorage.setItem(`bountymerge:pending:${account.toLowerCase()}`, hash);
      await waitFinal(hash, setTxStatus);
      localStorage.removeItem(`bountymerge:pending:${account.toLowerCase()}`);
      setNotice(`${current.label} finalized successfully.`);
      if (current.method === "create_project") await refreshProjects(String(current.args[0]));
      else await refreshProject();
      setForm(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    if (!account) return;
    const hash = localStorage.getItem(`bountymerge:pending:${account.toLowerCase()}`);
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return;
    setBusy(true); setTxHash(hash as `0x${string}`); setError("");
    try { await waitFinal(hash as `0x${string}`, setTxStatus); localStorage.removeItem(`bountymerge:pending:${account.toLowerCase()}`); setNotice("Transaction finalized."); await refreshProjects(); await refreshProject(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="app-shell">
    <header className="topbar">
      <a href="/" className="brand" aria-label="BountyMerge home"><span className="brand-symbol"><GitMerge size={22} strokeWidth={2.5}/></span><span>Bounty<span>Merge</span></span></a>
      <nav className="top-links" aria-label="Main"><a href="#workspace">Workspace</a><a href="#how-it-works">How it works</a><a href="#about">About</a></nav>
      <div className="wallet-area"><span className="network"><span className="network-dot"/>Studio Next</span><button className="wallet-button" onClick={() => setWalletMenu(x => !x)}><Wallet size={16}/>{account ? shortAddress(account) : "Connect wallet"}<ChevronDown size={14}/></button>
        {walletMenu && <div className="wallet-menu"><strong>Choose a wallet</strong>{wallets.length ? wallets.map(w => <button key={w.id} onClick={() => void connect(w)}>{w.name}<ArrowRight size={14}/></button>) : <p>No EVM wallet found in this browser.</p>}</div>}</div>
    </header>
    <main>
      <section className="hero" id="about"><div className="hero-inner"><div className="hero-copy"><div className="eyebrow"><span className="tiny-star">✳</span> FEWER DUPLICATES. BETTER IDEAS.</div><h1>Two requests.<br/><em>One better build.</em></h1><p>Find the real overlap in community feature requests. Shape a shared brief. Let both owners decide if it moves forward.</p><a className="hero-cta" href="#workspace">Explore the workspace <ArrowRight size={18}/></a><div className="hero-note"><ShieldCheck size={17}/> Compared by GenLayer validators. Approved by the people who asked.</div></div>
        <div className="hero-art" aria-hidden="true"><div className="art-glow"/><div className="art-card art-left"><span className="art-tag">REQUEST 01</span><strong>Export history<br/>as CSV</strong><span className="art-mini">Dates • amounts • tokens</span></div><div className="art-card art-right"><span className="art-tag">REQUEST 02</span><strong>Activity for<br/>Excel</strong><span className="art-mini">Spreadsheet ready</span></div><div className="art-merge"><GitMerge size={24}/></div><div className="art-brief"><span>SHARED BRIEF</span><strong>One export. Both needs.</strong><div className="brief-line"/><div className="brief-line short"/></div></div></div></section>
      <section className="workspace-wrap" id="workspace"><div className="workspace-heading"><div><span className="section-kicker">THE WORKSPACE</span><h2>Find the common thread.</h2><p>Explore requests, compare a pair, and track their owners’ decisions.</p></div><div className="workspace-actions"><button className="ghost-button" onClick={() => { void refreshProjects(); void refreshProject(); }} disabled={busy || preview}><RefreshCw size={16}/> Refresh</button><button className="dark-button" onClick={() => setForm("project")} disabled={busy || preview}><Plus size={17}/> New project</button></div></div>
        {preview && <div className="preview-banner"><Sparkles size={18}/><span><strong>Product preview.</strong> These sample requests show the intended workflow. Live GenLayer actions become available after deployment.</span></div>}
        {(error || notice || txHash) && <div className={`notice ${error ? "is-error" : ""}`} role="status">{error || notice}{txHash && <a href={`${EXPLORER}/transactions/${txHash}`} target="_blank" rel="noreferrer">Transaction {idShort(txHash)} <ArrowUpRight size={13}/></a>}{account && !busy && localStorage.getItem(`bountymerge:pending:${account.toLowerCase()}`) && <button onClick={() => void resume()}>Resume tracking</button>}{busy && txStatus && <small>{txStatus}</small>}</div>}
        <div className="workspace-grid"><aside className="side-panel"><div className="side-label">PROJECT SPACE</div><div className="project-select"><Layers3 size={18}/><select aria-label="Select project" value={currentProjectId} onChange={e => setProjectId(e.target.value)} disabled={preview || busy}>{projects.length ? projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">No projects yet</option>}</select><ChevronDown size={14}/></div><p className="project-description">{currentProject?.description || "Create a project to start collecting requests."}</p><div className="side-divider"/><div className="side-label">YOUR BOARD</div><button className={`side-link ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}><Layers3 size={17}/> Feature requests <span>{requests.length}</span></button><button className={`side-link ${tab === "matches" ? "active" : ""}`} onClick={() => setTab("matches")}><GitMerge size={17}/> Comparisons <span>{comparisons.length}</span></button><div className="side-bottom"><div className="side-illustration"><span>✳</span><span>✴</span><span>✳</span></div><strong>More signal.<br/>Less repetition.</strong><p>Good ideas find more support when they work together.</p></div></aside>
          <div className="board-panel"><div className="board-top"><div><span className="section-kicker">{tab === "requests" ? "COMMUNITY IDEAS" : "SHARED POSSIBILITIES"}</span><h3>{tab === "requests" ? "Feature requests" : "Comparisons"}</h3></div>{tab === "requests" && <button className="dark-button" onClick={() => setForm("request")} disabled={!currentProject || preview || busy}><Plus size={17}/> Add request</button>}</div>
          {tab === "requests" ? <><div className="board-instruction"><CircleHelp size={17}/><span>Select two requests from different owners to compare their overlap.</span></div><div className="request-list">{requests.length ? requests.map((request, index) => <button key={request.id} className={`request-card ${selected.includes(request.id) ? "selected" : ""}`} onClick={() => toggle(request.id)} aria-pressed={selected.includes(request.id)}><span className="pick-box">{selected.includes(request.id) && <Check size={14}/>}</span><span className="request-content"><span className="request-eyebrow">REQUEST {String(index + 1).padStart(2, "0")} <span>·</span> {request.merged_into ? "MERGED" : "OPEN"}</span><strong>{request.title}</strong><span className="request-description">{request.details}</span><span className="request-meta">{request.requirements.length} requirements <span>·</span> {shortAddress(request.author)}</span></span><ArrowUpRight className="request-arrow" size={18}/></button>) : <div className="empty-state"><Layers3 size={25}/><strong>No requests yet</strong><p>Start with two requests from different owners.</p></div>}</div><div className="comparison-dock"><div className="dock-icons"><span>{selected[0] ? "1" : "+"}</span><span>{selected[1] ? "2" : "+"}</span></div><div><strong>{selected.length === 2 ? "Ready to compare" : selected.length === 1 ? "Choose one more request" : "Start with two requests"}</strong><p>{selected.length === 2 ? `${chosenA?.title} + ${chosenB?.title}` : "Different owners make a shared brief meaningful."}</p></div><button onClick={() => { if (selectedDistinctPair(selected[0], selected[1])) requestAction({ method: "compare_requests", args: [selected[0], selected[1]], label: "Compare requests", description: `Ask GenLayer validators whether “${chosenA?.title}” and “${chosenB?.title}” can share a brief. The result will be public.` }); }} disabled={!selectedDistinctPair(selected[0], selected[1]) || chosenA?.author === chosenB?.author || preview || busy}>Compare pair <ArrowRight size={16}/></button></div>{selected.length === 2 && chosenA?.author === chosenB?.author && <p className="inline-error">Choose requests from two different wallets.</p>}</> : <div className="comparison-list">{comparisons.length ? comparisons.map(c => <button key={c.id} className={`comparison-row ${activeComparisonId === c.id ? "active" : ""}`} onClick={() => setActiveComparisonId(c.id)}><span className={`result-dot ${c.result.status.toLowerCase()}`}/><span><strong>{requests.find(r => r.id === c.request_a_id)?.title || "Request A"}</strong><small>with {requests.find(r => r.id === c.request_b_id)?.title || "Request B"}</small></span><em>{c.result.status === "MERGEABLE" ? c.state === "MERGED" ? "Merged" : "Mergeable" : c.result.status === "SEPARATE" ? "Separate" : "Unclear"}</em><ArrowRight size={16}/></button>) : <div className="empty-state"><GitMerge size={25}/><strong>No comparisons yet</strong><p>Choose two requests to see what they share.</p></div>}</div>}</div>
          <aside className="detail-panel"><span className="section-kicker">{activeComparison ? "COMPARISON DETAIL" : "HOW IT WORKS"}</span>{activeComparison && comparedA && comparedB ? <><h3>{activeComparison.result.status === "MERGEABLE" ? "A shared direction." : activeComparison.result.status === "SEPARATE" ? "Better apart." : "Needs a closer look."}</h3><p className="detail-intro">{activeComparison.result.reason}</p><div className="pair-head"><span>{comparedA.title}</span><GitMerge size={17}/><span>{comparedB.title}</span></div>{activeComparison.result.status === "MERGEABLE" && <><div className="side-label">PROPOSED SHARED BRIEF</div><ol className="brief-list">{activeComparison.result.brief_lines.map((line, i) => <li key={i}>{line}</li>)}</ol><div className="coverage"><CheckCheck size={16}/> Every requirement is mapped to a brief line.</div><div className="side-label">OWNER APPROVALS</div><div className="approval"><span>Request A · {shortAddress(comparedA.author)}</span><strong className={activeComparison.approved_a ? "yes" : ""}>{activeComparison.approved_a ? "Approved" : "Waiting"}</strong></div><div className="approval"><span>Request B · {shortAddress(comparedB.author)}</span><strong className={activeComparison.approved_b ? "yes" : ""}>{activeComparison.approved_b ? "Approved" : "Waiting"}</strong></div>{activeComparison.state === "AWAITING_APPROVAL" && (isOwner(account, comparedA.author) || isOwner(account, comparedB.author)) && <div className="approval-actions"><button className="dark-button" onClick={() => requestAction({ method: "set_approval", args: [activeComparison.id, !(isOwner(account, comparedA.author) ? activeComparison.approved_a : activeComparison.approved_b)], label: "Update approval", description: "Your wallet updates its approval for this exact, immutable brief. Two approvals complete the merge." })}>{(isOwner(account, comparedA.author) ? activeComparison.approved_a : activeComparison.approved_b) ? "Withdraw approval" : "Approve brief"}</button><button className="text-button" onClick={() => requestAction({ method: "reject_comparison", args: [activeComparison.id], label: "Reject comparison", description: "Reject this brief. The original requests remain intact and a new comparison round can be requested." })}>Reject brief</button></div>}{activeComparison.state === "MERGED" && <div className="merged-state"><CheckCheck size={18}/> Both owners approved. Original requests remain preserved.</div>}</>}{activeComparison.state === "CLOSED" && <p className="closed-note">No shared brief was created for this pair.</p>}{activeComparison.state === "REJECTED" && <p className="closed-note">An owner rejected this brief. The original comparison remains in the history.</p>}</> : <><div className="detail-icon"><GitMerge size={28}/></div><h3>Let the ideas meet.</h3><p className="detail-intro">Select two requests. GenLayer compares their actual requirements and checks whether one deliverable could serve both.</p><div className="how-steps"><div><span>01</span><p><strong>Spot the overlap</strong>Compare the work, not just similar words.</p></div><div><span>02</span><p><strong>Keep every need</strong>Trace each requirement into a shared brief.</p></div><div><span>03</span><p><strong>Both owners choose</strong>A merge needs approval from each wallet.</p></div></div></>}<div className="detail-foot"><ShieldCheck size={16}/><span>Original requests remain on-chain. No funds or escrow.</span></div></aside></div></section>
      <section className="bottom-section" id="how-it-works"><div className="bottom-inner"><div><span className="section-kicker">BUILT FOR COLLABORATION</span><h2>Better together<br/><em>when it makes sense.</em></h2></div><p>One brief can carry more than one person’s need. When the work differs, the requests stay separate. Either way, everyone keeps their voice.</p><div className="bottom-mark"><GitMerge size={48}/></div></div></section>
    </main><footer><span className="brand brand-footer"><span className="brand-symbol"><GitMerge size={17}/></span>Bounty<span>Merge</span></span><span>Built with GenLayer · Studio Next</span><span>Unfunded briefs · Public test network</span></footer>
    {form && <div className="overlay" role="presentation" onClick={() => setForm(null)}><div className="modal" role="dialog" aria-modal="true" aria-label={form === "project" ? "Create project" : "Add request"} onClick={e => e.stopPropagation()}><div className="modal-top"><span className="section-kicker">{form === "project" ? "NEW PROJECT SPACE" : "NEW FEATURE REQUEST"}</span><button aria-label="Close" onClick={() => setForm(null)}><X size={20}/></button></div><h2>{form === "project" ? "Make room for ideas." : "What should be built?"}</h2><p className="modal-lead">{form === "project" ? "Give people a clear place to share product needs." : "Be specific so another request owner can see where your needs meet."}</p>{form === "project" ? <><label>Project name<input value={projectName} maxLength={80} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Wallet Tools"/></label><label>What is this project for?<textarea value={projectDescription} maxLength={400} onChange={e => setProjectDescription(e.target.value)} placeholder="Describe the shared product space."/></label><button className="dark-button modal-submit" disabled={busy || !account || !projectName.trim() || !projectDescription.trim()} onClick={() => requestAction({ method: "create_project", args: [projectName, projectDescription], label: "Create project", description: "Create this public project space on GenLayer. The project title and description cannot be edited." })}>Create project <ArrowRight size={17}/></button></> : <><label>Request title<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="A clear name for the feature"/></label><label>Describe the feature<textarea value={details} maxLength={800} onChange={e => setDetails(e.target.value)} placeholder="What problem does this solve?"/></label><label>Must have · one per line<textarea value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="Include dates and amounts&#10;Let users choose a date range"/></label><label>Must avoid · optional<textarea value={exclusions} onChange={e => setExclusions(e.target.value)} placeholder="Do not include private notes"/></label><div className="form-hint">Up to four requirements and three exclusions. Everything is public and permanent.</div><button className="dark-button modal-submit" disabled={busy || !account || Boolean(requestError)} onClick={() => requestAction({ method: "submit_request", args: [currentProjectId, title, details, JSON.stringify(cleanLines(requirements, 4)), JSON.stringify(cleanLines(exclusions, 3))], label: "Publish request", description: "Publish your feature request on GenLayer. Its requirements and exclusions become the source for future comparisons." })}>Publish request <ArrowRight size={17}/></button>{requestError && <p className="inline-error">{requestError}</p>}</>}{!account && <p className="form-hint">Connect your wallet to publish.</p>}</div></div>}
    {action && <div className="overlay" role="presentation" onClick={() => setAction(null)}><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label={action.label} onClick={e => e.stopPropagation()}><div className="modal-top"><span className="section-kicker">REVIEW YOUR ACTION</span><button aria-label="Close" onClick={() => setAction(null)}><X size={20}/></button></div><div className="detail-icon"><Wallet size={24}/></div><h2>{action.label}</h2><p className="modal-lead">{action.description}</p><p className="form-hint">Network: Studio Next (61997). Your wallet displays the test GEN protocol deposit before approval.</p><div className="confirm-actions"><button className="ghost-button" onClick={() => setAction(null)}>Cancel</button><button className="dark-button" onClick={() => void execute()} disabled={!account}>Continue to wallet <ArrowRight size={17}/></button></div></div></div>}
  </div>;
}
