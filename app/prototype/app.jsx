/* ===== APP: top bar, state, interactions ===== */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* build annotation spans for a block from glossary + entities, with stale detection */
function buildSpans(block, glossary, entities) {
  const spans = [];
  glossary.forEach(t => t.occurrences.forEach(o => {
    if (o.block_id !== block.block_id) return;
    const cur = block.clean_text.slice(o.span[0], o.span[1]);
    spans.push({ start: o.span[0], end: o.span[1], kind: "glossary",
      label: `${t.source_term} → ${t.expected_target}`, id: t.term_id,
      stale: cur.toLowerCase() !== t.source_term.toLowerCase() });
  }));
  entities.forEach(e => e.mentions.forEach(m => {
    if (m.block_id !== block.block_id) return;
    const cur = block.clean_text.slice(m.span[0], m.span[1]);
    spans.push({ start: m.span[0], end: m.span[1], kind: "entity",
      label: `${e.canonical_source} → ${e.canonical_target}`, id: e.entity_id,
      stale: cur !== m.surface });
  }));
  return spans;
}

function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts">
      {items.map(t => (
        <div key={t.id} className={"toast tn-" + (t.tone || "info")}>
          {t.tone === "good" ? <Ic.checkCircle size={14} /> : t.tone === "bad" ? <Ic.xCircle size={14} /> : <Ic.dot size={14} />}
          <div className="toast-body"><div className="toast-msg">{t.msg}</div>{t.sub && <div className="toast-sub">{t.sub}</div>}</div>
          <button className="toast-x" onClick={() => onDismiss(t.id)}><Ic.x size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, icon: I, tone, children, onClose, actions }) {
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className={"modal-ic " + (tone || "")}>{I && <I size={16} />}</span>
          <span className="modal-title">{title}</span>
          <button className="modal-x" onClick={onClose}><Ic.x size={13} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{actions}</div>
      </div>
    </div>
  );
}

function TopBar({ docId, dirty, lastSaved, onValidate, onExport, onFreeze, freezeReady, freezeReasons }) {
  return (
    <div className="topbar">
      <div className="tb-left">
        <span className="tb-app"><span className="tb-logo">◧</span>AILAB <span className="tb-app-sub">Dataset Tool</span></span>
        <span className="tb-sep" />
        <span className="tb-doc tip" data-tip="Active document · one project folder per doc_id">
          <Ic.doc size={13} className="faint" /><span className="mono">{docId}</span>
        </span>
        <span className={"wc-badge tip"} data-tip="Working state (review_state + drafts) is separate from canonical dataset files. Freeze promotes working → canonical.">
          <span className="wc-dot" />working copy
        </span>
      </div>

      <div className="tb-right">
        <span className="autosave tip" data-tip="Autosaves to working/ on every edit">
          {dirty ? <><span className="as-spin" />saving…</> : <><Ic.check size={12} className="as-ok" />saved {lastSaved}</>}
        </span>
        <span className="tb-sep" />
        <span className="user-chip tip" data-tip="Signed in · reviewer role"><span className="ua">M</span>U2 · Mai</span>
        <span className="tb-sep" />
        <button className="btn" onClick={onValidate}><Ic.checkCircle size={13} />Validate</button>
        <button className="btn" onClick={onExport}><Ic.upload size={13} />Export</button>
        <div className="tip tip-left" data-tip={freezeReady ? "Promote working state to canonical dataset files" : "Blocked: " + freezeReasons.join(" · ")}>
          <button className="btn primary" disabled={!freezeReady} onClick={onFreeze}>
            <Ic.snow size={13} />Freeze
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [blocks, setBlocks] = useState(() => DATA.BLOCKS.map(b => ({ ...b })));
  const [glossary, setGlossary] = useState(() => DATA.GLOSSARY.map(t => ({ ...t })));
  const [entities, setEntities] = useState(() => DATA.ENTITIES.map(e => ({ ...e })));
  const [review, setReview] = useState(() => ({ blocks: { ...DATA.REVIEW.blocks } }));
  const [errors, setErrors] = useState(() => DATA.VALIDATION.map(e => ({ ...e })));
  const [selectedId, setSelectedId] = useState("b0004");
  const [filters, setFilters] = useState(new Set());
  const [rightActive, setRightActive] = useState("glossary");
  const [editing, setEditing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState("just now");
  const savedAt = useRef(Date.now());

  const block = blocks.find(b => b.block_id === selectedId) || blocks[0];

  /* ---- autosave simulation ---- */
  const touch = useCallback(() => {
    setDirty(true);
    savedAt.current = Date.now();
    setTimeout(() => setDirty(false), 750);
    setLastSaved("just now");
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.round((Date.now() - savedAt.current) / 1000);
      setLastSaved(s < 3 ? "just now" : s < 60 ? s + "s ago" : Math.floor(s / 60) + "m ago");
    }, 4000);
    return () => clearInterval(t);
  }, []);

  function toast(msg, tone, sub) {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, tone, sub }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }
  const dismiss = id => setToasts(t => t.filter(x => x.id !== id));

  /* ---- derived: annotation set, spans, counts, stats ---- */
  const annoSet = useMemo(() => {
    const s = new Set();
    glossary.forEach(t => t.occurrences.forEach(o => s.add(o.block_id)));
    entities.forEach(e => e.mentions.forEach(m => s.add(m.block_id)));
    return s;
  }, [glossary, entities]);

  const spans = useMemo(() => buildSpans(block, glossary, entities), [block, glossary, entities]);

  const blockTerms = useMemo(() => glossary.filter(t => t.occurrences.some(o => o.block_id === block.block_id)), [glossary, block]);
  const blockEntities = useMemo(() => entities.filter(e => e.mentions.some(m => m.block_id === block.block_id)
    || block.discourse && [block.discourse.speaker_entity_id, block.discourse.addressee_entity_id].includes(e.entity_id)), [entities, block]);
  const summary = DATA.SUMMARIES.find(s => s.chapter_id === block.chapter_id);

  const filterCounts = useMemo(() => ({
    unreviewed: blocks.filter(b => !review.blocks[b.block_id]?.reviewed).length,
    dialogue: blocks.filter(b => b.block_type === "dialogue").length,
    flag: blocks.filter(b => b.quality_flags.some(f => f !== "ok")).length,
    opening: blocks.filter(b => b.is_chapter_opening).length,
    annotation: blocks.filter(b => annoSet.has(b.block_id)).length,
  }), [blocks, review, annoSet]);

  const visibleBlocks = useMemo(() => blocks.filter(b => {
    if (filters.has("unreviewed") && review.blocks[b.block_id]?.reviewed) return false;
    if (filters.has("dialogue") && b.block_type !== "dialogue") return false;
    if (filters.has("flag") && !b.quality_flags.some(f => f !== "ok")) return false;
    if (filters.has("opening") && !b.is_chapter_opening) return false;
    if (filters.has("annotation") && !annoSet.has(b.block_id)) return false;
    return true;
  }), [blocks, filters, review, annoSet]);

  const stats = useMemo(() => {
    const reviewed = blocks.filter(b => review.blocks[b.block_id]?.reviewed).length;
    return {
      reviewed, totalBlocks: blocks.length,
      glossary: glossary.length, glossaryDone: glossary.filter(t => t.status !== "proposed").length,
      entities: entities.length, entitiesDone: entities.filter(e => e.canonical_target).length,
      summaries: DATA.SUMMARIES.filter(s => s.summary_source).length, totalChapters: DATA.CHAPTERS.length,
      refs: DATA.REFERENCES.length, refReviewed: DATA.REFERENCES.filter(r => r.status === "reviewed").length,
      valTotal: 5, valClean: 5 - errors.filter(e => e.severity === "error").length,
    };
  }, [blocks, glossary, entities, review, errors]);

  /* ---- freeze gating ---- */
  const errorCount = errors.filter(e => e.severity === "error").length;
  const unreviewed = blocks.filter(b => !review.blocks[b.block_id]?.reviewed).length;
  const freezeReasons = [];
  if (errorCount > 0) freezeReasons.push(`${errorCount} validation error${errorCount > 1 ? "s" : ""}`);
  if (unreviewed > 0) freezeReasons.push(`${unreviewed} block${unreviewed > 1 ? "s" : ""} unreviewed`);
  const freezeReady = freezeReasons.length === 0;

  /* ---- right-panel badges ---- */
  const rpCounts = {
    glossary: { text: blockTerms.length || null },
    entities: { text: blockEntities.length || null },
    summary: { text: summary?.summary_source ? null : "empty", tone: summary?.summary_source ? "" : "warn" },
    reference: { text: (DATA.REFERENCES.find(r => r.block_id === block.block_id)?.status) || null },
    validate: { text: errorCount || null, tone: errorCount ? "bad" : "" },
    progress: { text: `${stats.reviewed}/${stats.totalBlocks}` },
  };

  /* ---- actions ---- */
  function selectBlock(id) { setSelectedId(id); setEditing(false); }
  function toggleFilter(id) { setFilters(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  function updateBlock(patch) { setBlocks(bs => bs.map(b => b.block_id === selectedId ? { ...b, ...patch } : b)); touch(); }

  function changeType(t) { updateBlock({ block_type: t }); toast(`block_type → ${t}`, "info"); }
  function toggleOpening() { updateBlock({ is_chapter_opening: !block.is_chapter_opening }); }
  function toggleFlag(f) {
    let flags;
    if (f === "ok") flags = ["ok"];
    else {
      flags = block.quality_flags.includes(f) ? block.quality_flags.filter(x => x !== f) : [...block.quality_flags.filter(x => x !== "ok"), f];
      if (!flags.length) flags = ["ok"];
    }
    updateBlock({ quality_flags: flags });
  }
  function markReviewed() {
    setReview(r => ({ blocks: { ...r.blocks, [selectedId]: { reviewed: !r.blocks[selectedId]?.reviewed, reviewed_by: "U2 · Mai" } } }));
    touch();
    if (!review.blocks[selectedId]?.reviewed) toast(`${selectedId} marked reviewed`, "good");
  }

  function commitClean(text) {
    const before = block.clean_text;
    updateBlock({ clean_text: text });
    setEditing(false);
    // stale detection toast
    const newSpans = buildSpans({ ...block, clean_text: text }, glossary, entities);
    const broke = newSpans.filter(s => s.stale).length;
    if (broke > 0) toast(`Clean text saved · ${broke} annotation span${broke > 1 ? "s" : ""} no longer match`, "bad", "Re-tag from the right panel to clear the warning.");
    else toast("Clean text saved", "good");
  }

  function addGlossary(sel) {
    setRightActive("glossary");
    const term_id = "g_" + sel.text.toLowerCase().replace(/[^a-z]+/g, "_").slice(0, 16) + "_" + Math.random().toString(36).slice(2, 5);
    setGlossary(g => [{ term_id, doc_id: DATA.DOC.doc_id, source_term: sel.text.trim(),
      expected_target: "", allowed_variants: [], forbidden_variants: [], chapter_scope: "global",
      status: "proposed", confidence: 0.5, occurrences: [{ block_id: selectedId, span: [sel.start, sel.end] }] }, ...g]);
    touch();
    toast(`Added glossary occurrence “${sel.text.trim()}”`, "good", "Set expected_target in the Glossary tab.");
  }
  function addEntity(sel) {
    setRightActive("entities");
    // try to attach to existing entity by surface, else create
    const existing = entities.find(e => e.canonical_source.toLowerCase().includes(sel.text.trim().toLowerCase()) || sel.text.trim().toLowerCase().includes(e.canonical_source.toLowerCase()));
    if (existing) {
      setEntities(es => es.map(e => e.entity_id === existing.entity_id
        ? { ...e, mentions: [...e.mentions, { block_id: selectedId, surface: sel.text.trim(), span: [sel.start, sel.end] }] } : e));
      toast(`Linked mention to ${existing.canonical_source}`, "good");
    } else {
      const entity_id = "e_" + sel.text.toLowerCase().replace(/[^a-z]+/g, "_").slice(0, 16) + "_" + Math.random().toString(36).slice(2, 4);
      setEntities(es => [{ entity_id, doc_id: DATA.DOC.doc_id, canonical_source: sel.text.trim(), canonical_target: "",
        entity_type: "person", gender: "", aliases_source: [], aliases_target: [], pronoun_policy: "",
        mentions: [{ block_id: selectedId, surface: sel.text.trim(), span: [sel.start, sel.end] }] }, ...es]);
      toast(`Created entity “${sel.text.trim()}”`, "good", "Set canonical_target & pronoun policy.");
    }
    touch();
  }

  function deleteTerm(t) {
    // block if referenced (occurrences across >1 block OR locked)
    const refCount = t.occurrences.length;
    if (t.status === "locked" || refCount > 1) {
      setModal({ kind: "delete-blocked", term: t, refCount });
      return;
    }
    setGlossary(g => g.filter(x => x.term_id !== t.term_id));
    touch();
    toast(`Deleted term “${t.source_term}”`, "info");
  }

  function runValidate() {
    setRightActive("validate");
    toast(`Validation: ${errorCount} error${errorCount !== 1 ? "s" : ""}, ${errors.filter(e => e.severity === "warning").length} warning`, errorCount ? "bad" : "good");
  }
  function jumpTo(e) { if (e.block_id) { selectBlock(e.block_id); toast(`Jumped to ${e.block_id}`, "info"); } }

  function doExport() {
    setModal({ kind: "export" });
  }
  function doFreeze() { setModal({ kind: "freeze" }); }

  /* keyboard: cmd+enter mark reviewed */
  useEffect(() => {
    function onKey(ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && !editing) { ev.preventDefault(); markReviewed(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="app">
      <TopBar docId={DATA.DOC.doc_id} dirty={dirty} lastSaved={lastSaved}
        onValidate={runValidate} onExport={doExport} onFreeze={doFreeze}
        freezeReady={freezeReady} freezeReasons={freezeReasons} />
      <div className="workspace">
        <LeftSidebar blocks={visibleBlocks} chapters={DATA.CHAPTERS} review={review}
          annoSet={annoSet} selectedId={selectedId} onSelect={selectBlock}
          filters={filters} onToggleFilter={toggleFilter} counts={filterCounts} total={blocks.length} />
        <CenterEditor block={block} reviewed={!!review.blocks[selectedId]?.reviewed} spans={spans}
          editing={editing} onEdit={() => setEditing(true)} onCommitClean={commitClean} onCancelEdit={() => setEditing(false)}
          onChangeType={changeType} onToggleOpening={toggleOpening} onToggleFlag={toggleFlag} onMarkReviewed={markReviewed}
          onAddGlossary={addGlossary} onAddEntity={addEntity} />
        <RightPanel active={rightActive} onSetActive={setRightActive} counts={rpCounts}
          ctx={{ terms: blockTerms, entities: blockEntities, block, summary, errors, stats,
            onDeleteTerm: deleteTerm, onJump: jumpTo }} />
      </div>

      <Toasts items={toasts} onDismiss={dismiss} />

      {modal?.kind === "delete-blocked" && (
        <Modal title="Cannot delete term" icon={Ic.lock} tone="bad" onClose={() => setModal(null)}
          actions={<button className="btn" onClick={() => setModal(null)}>Close</button>}>
          <p>The term <b className="mono">{modal.term.source_term}</b> {modal.term.status === "locked"
            ? <>is <b>locked</b> and part of the canonical glossary.</>
            : <>is still referenced by <b>{modal.refCount} occurrences</b> across the document.</>}
          </p>
          <p className="muted">Remove its occurrences first, or change status from <span className="mono">locked</span>, before deleting. This protects canonical dataset integrity.</p>
        </Modal>
      )}

      {modal?.kind === "export" && (
        <Modal title="Export dataset" icon={Ic.upload} onClose={() => setModal(null)}
          actions={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { setModal(null); toast("Exported working copy (non-canonical)", "info"); }}>Export working copy</button></>}>
          <p>Writes the current canonical files to <span className="mono">export/{DATA.DOC.doc_id}/</span>:</p>
          <ul className="file-list">
            {["document.json","glossary.jsonl","entities.jsonl","chapter_summaries.jsonl","manual_reference_subset.jsonl"].map(f =>
              <li key={f}><Ic.file size={12} /><span className="mono">{f}</span></li>)}
          </ul>
          <p className="muted">{errorCount > 0 ? <><Ic.alert size={11} /> {errorCount} validation error(s) present — export will be marked non-canonical.</> : "All checks pass."}</p>
        </Modal>
      )}

      {modal?.kind === "freeze" && (
        <Modal title="Freeze dataset" icon={Ic.snow} onClose={() => setModal(null)}
          actions={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { setModal(null); toast("Dataset frozen → canonical", "good", "Working copy is now read-only for this revision."); }}><Ic.snow size={12} />Freeze to canonical</button></>}>
          <p>Freezing promotes the working copy to a <b>canonical, read-only</b> revision. Reviewed references, glossary, entities and summaries become the dataset of record.</p>
          <div className="freeze-checks">
            <div className="fc-row ok"><Ic.checkCircle size={13} />Validation passes</div>
            <div className="fc-row ok"><Ic.checkCircle size={13} />All blocks reviewed</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
