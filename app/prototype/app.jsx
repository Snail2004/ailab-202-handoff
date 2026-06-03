/* ===== APP: real backend wiring, state adapter, interactions ===== */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const API = window.AILAB_API;
const STORAGE_DOC = "ailab.doc_id";
const STORAGE_USER = "ailab.user";
const STORAGE_CENTER_MODE = "ailab.center_mode";
const DEFAULT_USER = "U2 · Mai";
const EDITABLE_META = new Set(["title", "author", "domain", "genre", "source_format", "license", "source_url", "contamination_risk"]);

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentUser() {
  return localStorage.getItem(STORAGE_USER) || DEFAULT_USER;
}

function errorMessage(err) {
  const first = err?.errors?.[0] || err?.payload?.errors?.[0];
  return first?.message || err?.message || "Request failed.";
}

function firstError(err) {
  return err?.errors?.[0] || err?.payload?.errors?.[0] || {};
}

function describeExternalRef(ref) {
  if (ref.block_id) return `${ref.kind || "ref"} · ${ref.block_id} · ${ref.field || ""}`;
  if (ref.chapter_id) return `${ref.kind || "ref"} · ${ref.chapter_id} · ${ref.field || ""}`;
  return `${ref.kind || "ref"} · ${ref.field || ""}`;
}

function normalizeErrors(report) {
  if (!report) return [];
  const errors = (report.errors || []).map(e => ({ severity: "error", ...e }));
  const warnings = (report.warnings || []).map(w => ({ severity: "warning", ...w }));
  return [...errors, ...warnings];
}

function docInfoFromDocument(document) {
  const metadata = { ...(document?.metadata || {}) };
  const provenance = {
    raw_sha256: metadata.raw_sha256 || "",
    extraction_tool: metadata.extraction_tool || "",
    pipeline_version: metadata.pipeline_version || "",
    retrieved_at: metadata.retrieved_at || "",
  };
  return {
    doc_id: document?.doc_id || "",
    schema_version: document?.schema_version || "",
    metadata,
    provenance,
  };
}

function mergeReferences(dataset) {
  const canonical = (dataset.references || []).map(row => ({ ...row, canonical: true }));
  const canonicalIds = new Set(canonical.map(row => row.reference_id));
  const draftRows = Object.values(dataset.reference_drafts?.references || {})
    .filter(row => (row.status || "draft") === "draft")
    .map(row => ({
      ...row,
      status: "draft",
      canonical: false,
      reference_vi: row.reference_vi || row.draft_vi || "",
    }))
    .filter(row => !canonicalIds.has(row.reference_id));
  return [...canonical, ...draftRows];
}

function adaptDataset(dataset) {
  return {
    docInfo: docInfoFromDocument(dataset.document),
    chapters: dataset.chapters || [],
    blocks: dataset.blocks || [],
    glossary: dataset.glossary || [],
    entities: dataset.entities || [],
    summaries: dataset.summaries || [],
    references: mergeReferences(dataset),
    review: dataset.review_state || { blocks: {}, references: {}, summaries: {} },
    jobs: dataset.jobs || [],
    history: dataset.history_state || { can_undo: false, can_redo: false, undo_top: null, redo_top: null, recent: [] },
  };
}

/* build annotation spans for a block from glossary + entities, with stale detection */
function buildSpans(block, glossary, entities) {
  if (!block) return [];
  const spans = [];
  glossary.forEach(t => (t.occurrences || []).forEach(o => {
    if (o.block_id !== block.block_id) return;
    const cur = block.clean_text.slice(o.span[0], o.span[1]);
    spans.push({
      start: o.span[0],
      end: o.span[1],
      kind: "glossary",
      label: `${t.source_term} -> ${t.expected_target || "target needed"}`,
      id: t.term_id,
      stale: cur !== String(t.source_term || ""),
    });
  }));
  entities.forEach(e => (e.mentions || []).forEach(m => {
    if (m.block_id !== block.block_id) return;
    const cur = block.clean_text.slice(m.span[0], m.span[1]);
    spans.push({
      start: m.span[0],
      end: m.span[1],
      kind: "entity",
      label: `${e.canonical_source} -> ${e.canonical_target || "target needed"}`,
      id: e.entity_id,
      stale: cur !== m.surface,
    });
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

function historyTip(prefix, event) {
  return event?.label ? `${prefix}: ${event.label}` : `${prefix} unavailable`;
}

function joinLocalPath(root, ...parts) {
  if (!root) return "";
  const sep = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts].filter(Boolean).join(sep);
}

function TopBar({ docId, dirty, lastSaved, onValidate, onExport, onFreeze, onUndo, onRedo, history, freezeReady, freezeReasons }) {
  const canUndo = !!history?.can_undo && !dirty;
  const canRedo = !!history?.can_redo && !dirty;
  return (
    <div className="topbar">
      <div className="tb-left">
        <span className="tb-app"><span className="tb-logo">▧</span>AILAB <span className="tb-app-sub">Dataset Tool</span></span>
        <span className="tb-sep" />
        <span className="tb-doc tip" data-tip="Active document · one local project folder per doc_id">
          <Ic.doc size={13} className="faint" /><span className="mono">{docId}</span>
        </span>
        <span className="wc-badge tip" data-tip="Autosaved working state and canonical dataset files via backend API.">
          <span className="wc-dot" />working copy
        </span>
      </div>

      <div className="tb-right">
        <span className="autosave tip" data-tip="Writes go through the Flask backend. Freeze creates a validated versioned snapshot.">
          {dirty ? <><span className="as-spin" />saving...</> : <><Ic.check size={12} className="as-ok" />saved {lastSaved}</>}
        </span>
        <span className="tb-sep" />
        <div className="undo-group">
          <button className="btn icon-only tip" disabled={!canUndo} data-tip={dirty ? "Wait for current save to finish" : historyTip("Undo", history?.undo_top)} onClick={onUndo} aria-label="Undo">
            <Ic.undo size={13} />
          </button>
          <button className="btn icon-only tip" disabled={!canRedo} data-tip={dirty ? "Wait for current save to finish" : historyTip("Redo", history?.redo_top)} onClick={onRedo} aria-label="Redo">
            <Ic.redo size={13} />
          </button>
        </div>
        <span className="tb-sep" />
        <span className="user-chip tip" data-tip="Current local user"><span className="ua">M</span>{currentUser()}</span>
        <span className="tb-sep" />
        <button className="btn" onClick={onValidate}><Ic.checkCircle size={13} />Validate</button>
        <button className="btn" onClick={onExport}><Ic.upload size={13} />Export</button>
        <div className="tip tip-left" data-tip={freezeReady ? "Create a versioned snapshot after validation and review gates pass" : "Blocked: " + freezeReasons.join(" · ")}>
          <button className="btn primary" disabled={!freezeReady} onClick={onFreeze}>
            <Ic.snow size={13} />Freeze
          </button>
        </div>
      </div>
    </div>
  );
}

function StartupState({ title, message, action, onAction, secondary }) {
  return (
    <div className="project-screen">
      <div className="project-wrap" style={{ maxWidth: 760 }}>
        <div className="project-headline">
          <div>
            <div className="project-kicker">AILAB Dataset Tool</div>
            <h1>{title}</h1>
            <p>{message}</p>
            {secondary && <p className="muted">{secondary}</p>}
          </div>
          {action && <button className="btn primary" onClick={onAction}>{action}</button>}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState(() => window.location.hash === "#project" ? "project" : "workspace");
  const [projects, setProjects] = useState([]);
  const [docInfo, setDocInfo] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [glossary, setGlossary] = useState([]);
  const [entities, setEntities] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [references, setReferences] = useState([]);
  const [review, setReview] = useState({ blocks: {}, references: {}, summaries: {} });
  const [historyState, setHistoryState] = useState({ can_undo: false, can_redo: false, undo_top: null, redo_top: null, recent: [] });
  const [errors, setErrors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState(new Set());
  const [rightOpenTabs, setRightOpenTabs] = useState(["glossary"]);
  const [editing, setEditing] = useState(false);
  const [centerMode, setCenterModeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_CENTER_MODE);
    return ["block", "chapter", "book"].includes(saved) ? saved : "chapter";
  });
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState("just now");
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [activeDocId, setActiveDocId] = useState(localStorage.getItem(STORAGE_DOC) || "");
  const savedAt = useRef(Date.now());
  const saveTimers = useRef({});

  const refreshProjects = useCallback(async () => {
    const list = await API.listProjects();
    setProjects(list);
    return list;
  }, []);

  const loadDataset = useCallback(async (docId, opts = {}) => {
    if (!docId) return null;
    if (!opts.silent) setLoading(true);
    const dataset = await API.getDataset(docId);
    const adapted = adaptDataset(dataset);
    setDocInfo(adapted.docInfo);
    setChapters(adapted.chapters);
    setBlocks(adapted.blocks);
    setGlossary(adapted.glossary);
    setEntities(adapted.entities);
    setSummaries(adapted.summaries);
    setReferences(adapted.references);
    setReview(adapted.review);
    setHistoryState(adapted.history);
    setActiveDocId(adapted.docInfo.doc_id);
    localStorage.setItem(STORAGE_DOC, adapted.docInfo.doc_id);
    setSelectedId(prev => adapted.blocks.some(b => b.block_id === prev) ? prev : adapted.blocks[0]?.block_id || null);
    setBootError(null);
    setLoading(false);
    return adapted;
  }, []);

  async function boot() {
    setLoading(true);
    setBootError(null);
    try {
      const list = await refreshProjects();
      const remembered = localStorage.getItem(STORAGE_DOC);
      const chosen = list.find(p => p.doc_id === remembered && p.status === "available")
        || list.find(p => p.status === "available")
        || list[0];
      if (!chosen) {
        setDocInfo({ doc_id: "", metadata: {}, provenance: {} });
        setView("project");
        setLoading(false);
        return;
      }
      setActiveDocId(chosen.doc_id);
      if (chosen.status === "available") {
        await loadDataset(chosen.doc_id);
      } else {
        setDocInfo({ doc_id: chosen.doc_id, metadata: {}, provenance: {} });
        setView("project");
        setLoading(false);
      }
    } catch (err) {
      setBootError(errorMessage(err));
      setLoading(false);
    }
  }

  useEffect(() => { boot(); }, []);

  const block = blocks.find(b => b.block_id === selectedId) || blocks[0] || null;

  function setCenterMode(mode) {
    setCenterModeState(mode);
    localStorage.setItem(STORAGE_CENTER_MODE, mode);
  }

  function toggleRightTab(tabId) {
    setRightOpenTabs(tabs => (
      tabs.includes(tabId)
        ? tabs.filter(id => id !== tabId)
        : [...tabs, tabId]
    ));
  }

  function openRightTab(tabId) {
    setRightOpenTabs(tabs => tabs.includes(tabId) ? tabs : [...tabs, tabId]);
  }

  const touchStart = useCallback(() => {
    setDirty(true);
    savedAt.current = Date.now();
    setLastSaved("just now");
  }, []);

  const touchDone = useCallback(() => {
    savedAt.current = Date.now();
    setDirty(false);
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

  async function mutate(action, { refresh = true, success, fail } = {}) {
    if (!activeDocId) return null;
    touchStart();
    try {
      const result = await action();
      if (refresh) await loadDataset(activeDocId, { silent: true });
      touchDone();
      if (success) toast(success, "good");
      return result;
    } catch (err) {
      touchDone();
      toast(fail || "Action failed", "bad", errorMessage(err));
      return null;
    }
  }

  function queueSave(key, action) {
    touchStart();
    clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      try {
        await action();
        await loadDataset(activeDocId, { silent: true });
        touchDone();
      } catch (err) {
        touchDone();
        toast("Save failed", "bad", errorMessage(err));
      }
    }, 650);
  }

  const annoSet = useMemo(() => {
    const s = new Set();
    glossary.forEach(t => (t.occurrences || []).forEach(o => s.add(o.block_id)));
    entities.forEach(e => (e.mentions || []).forEach(m => s.add(m.block_id)));
    return s;
  }, [glossary, entities]);

  const spans = useMemo(() => buildSpans(block, glossary, entities), [block, glossary, entities]);
  const getSpansForBlock = useCallback((targetBlock) => buildSpans(targetBlock, glossary, entities), [glossary, entities]);
  const allSpans = useMemo(() => blocks.flatMap(b => buildSpans(b, glossary, entities).map(s => ({ ...s, block_id: b.block_id }))), [blocks, glossary, entities]);
  const staleCount = allSpans.filter(s => s.stale).length;

  const linkIndex = useMemo(() => {
    const blockById = {};
    const chapterById = {};
    blocks.forEach(b => { blockById[b.block_id] = b; });
    chapters.forEach(ch => { chapterById[ch.chapter_id] = ch; });

    const chapterLabel = (chapterId) => {
      const ch = chapterById[chapterId] || {};
      return ch.title || ch.chapter_title || chapterId || "";
    };

    const entityLinks = {};
    entities.forEach(entity => {
      const mentions = entity.mentions || [];
      const mentionsByBlock = {};
      const blockIds = new Set();
      const chapterIds = new Set();
      mentions.forEach(m => {
        if (!mentionsByBlock[m.block_id]) mentionsByBlock[m.block_id] = [];
        mentionsByBlock[m.block_id].push(m);
        blockIds.add(m.block_id);
        const b = blockById[m.block_id];
        if (b?.chapter_id) chapterIds.add(b.chapter_id);
      });

      const speakerBlocks = [];
      const addresseeBlocks = [];
      blocks.forEach(b => {
        if (b.discourse?.speaker_entity_id === entity.entity_id) speakerBlocks.push(b.block_id);
        if (b.discourse?.addressee_entity_id === entity.entity_id) addresseeBlocks.push(b.block_id);
      });

      const summaryChapters = [];
      summaries.forEach(s => {
        if ((s.characters_present || []).includes(entity.entity_id)) {
          summaryChapters.push({
            chapter_id: s.chapter_id,
            title: chapterLabel(s.chapter_id),
          });
        }
      });

      entityLinks[entity.entity_id] = {
        item: entity,
        mentions,
        mentionsByBlock,
        blockIds: [...blockIds],
        chapters: [...chapterIds].map(chapter_id => ({ chapter_id, title: chapterLabel(chapter_id) })),
        speakerBlocks,
        addresseeBlocks,
        summaryChapters,
      };
    });

    const glossaryLinks = {};
    glossary.forEach(term => {
      const occurrences = term.occurrences || [];
      const occurrencesByBlock = {};
      const blockIds = new Set();
      const chapterIds = new Set();
      occurrences.forEach(o => {
        if (!occurrencesByBlock[o.block_id]) occurrencesByBlock[o.block_id] = [];
        occurrencesByBlock[o.block_id].push(o);
        blockIds.add(o.block_id);
        const b = blockById[o.block_id];
        if (b?.chapter_id) chapterIds.add(b.chapter_id);
      });
      glossaryLinks[term.term_id] = {
        item: term,
        occurrences,
        occurrencesByBlock,
        blockIds: [...blockIds],
        chapters: [...chapterIds].map(chapter_id => ({ chapter_id, title: chapterLabel(chapter_id) })),
      };
    });

    return { entities: entityLinks, glossary: glossaryLinks, blockById, chapterById };
  }, [blocks, chapters, glossary, entities, summaries]);

  const activeChapter = useMemo(() => {
    if (!block) return null;
    return chapters.find(ch => ch.chapter_id === block.chapter_id) || null;
  }, [chapters, block]);

  const chapterBlocks = useMemo(() => {
    if (!block) return [];
    const rows = blocks.filter(b => b.chapter_id === block.chapter_id);
    return rows.length ? rows : [block];
  }, [blocks, block]);

  const blockTerms = useMemo(() => block ? glossary.filter(t => (t.occurrences || []).some(o => o.block_id === block.block_id)) : [], [glossary, block]);
  const blockEntities = useMemo(() => block ? entities.filter(e => (e.mentions || []).some(m => m.block_id === block.block_id)
    || (block.discourse && [block.discourse.speaker_entity_id, block.discourse.addressee_entity_id].includes(e.entity_id))) : [], [entities, block]);
  const summary = useMemo(() => block ? (summaries.find(s => s.chapter_id === block.chapter_id) || { doc_id: docInfo?.doc_id, chapter_id: block.chapter_id, summary_source: "", source: "" }) : null, [summaries, block, docInfo]);

  const filterCounts = useMemo(() => ({
    unreviewed: blocks.filter(b => !review.blocks?.[b.block_id]?.reviewed).length,
    dialogue: blocks.filter(b => b.block_type === "dialogue").length,
    flag: blocks.filter(b => (b.quality_flags || []).some(f => f !== "ok")).length,
    opening: blocks.filter(b => b.is_chapter_opening).length,
    annotation: blocks.filter(b => annoSet.has(b.block_id)).length,
  }), [blocks, review, annoSet]);

  const visibleBlocks = useMemo(() => blocks.filter(b => {
    if (filters.has("unreviewed") && review.blocks?.[b.block_id]?.reviewed) return false;
    if (filters.has("dialogue") && b.block_type !== "dialogue") return false;
    if (filters.has("flag") && !(b.quality_flags || []).some(f => f !== "ok")) return false;
    if (filters.has("opening") && !b.is_chapter_opening) return false;
    if (filters.has("annotation") && !annoSet.has(b.block_id)) return false;
    return true;
  }), [blocks, filters, review, annoSet]);

  const stats = useMemo(() => {
    const reviewed = blocks.filter(b => review.blocks?.[b.block_id]?.reviewed).length;
    const hardErrors = errors.filter(e => e.severity === "error").length;
    return {
      reviewed,
      totalBlocks: blocks.length,
      glossary: glossary.length,
      glossaryDone: glossary.filter(t => t.status !== "candidate" && t.expected_target).length,
      entities: entities.length,
      entitiesDone: entities.filter(e => e.canonical_target).length,
      summaries: summaries.filter(s => s.summary_source && s.source).length,
      totalChapters: chapters.length,
      refs: references.length,
      refReviewed: references.filter(r => ["reviewed", "locked"].includes(r.status)).length,
      valTotal: Math.max(errors.length, 1),
      valClean: Math.max(errors.length, 1) - hardErrors,
    };
  }, [blocks, glossary, entities, summaries, references, review, errors, chapters]);

  const errorCount = errors.filter(e => e.severity === "error").length;
  const unreviewed = blocks.filter(b => !review.blocks?.[b.block_id]?.reviewed).length;
  const draftRefs = references.filter(r => r.status === "draft").length;
  const needsRetag = Object.values(review.blocks || {}).filter(v => v?.needs_retag).length;
  const missingSummaries = chapters.filter(ch => {
    const s = summaries.find(x => x.chapter_id === ch.chapter_id);
    return !s || !s.summary_source || !s.source;
  }).length;
  const requiredMissing = [];
  ["title", "author", "domain", "genre", "source_format", "license", "contamination_risk"].forEach(k => {
    if (!docInfo?.metadata?.[k]) requiredMissing.push("metadata." + k);
  });
  if (docInfo?.metadata?.extraction_tool !== "manual-synthetic" && !docInfo?.metadata?.raw_sha256) {
    requiredMissing.push("metadata.raw_sha256");
  }
  if (!docInfo?.metadata?.extraction_tool) requiredMissing.push("metadata.extraction_tool");
  if (!docInfo?.metadata?.pipeline_version) requiredMissing.push("metadata.pipeline_version");

  const freezeReasons = [];
  if (errorCount > 0) freezeReasons.push(`${errorCount} validation error${errorCount > 1 ? "s" : ""}`);
  if (unreviewed > 0) freezeReasons.push(`${unreviewed} block${unreviewed > 1 ? "s" : ""} unreviewed`);
  if (draftRefs > 0) freezeReasons.push(`${draftRefs} draft reference${draftRefs > 1 ? "s" : ""}`);
  if (staleCount + needsRetag > 0) freezeReasons.push(`${staleCount + needsRetag} stale span${staleCount + needsRetag > 1 ? "s" : ""}`);
  if (missingSummaries > 0) freezeReasons.push(`${missingSummaries} chapter summar${missingSummaries > 1 ? "ies" : "y"} missing`);
  if (requiredMissing.length > 0) freezeReasons.push(`${requiredMissing.length} required source/provenance field${requiredMissing.length > 1 ? "s" : ""} missing`);
  const freezeReady = freezeReasons.length === 0;

  const refForBlock = block ? references.find(r => r.block_id === block.block_id) : null;
  const rpCounts = {
    glossary: { text: blockTerms.length || null },
    entities: { text: blockEntities.length || null },
    summary: { text: summary?.summary_source ? null : "empty", tone: summary?.summary_source ? "" : "warn" },
    notes: { text: block?.annotations && (block.annotations.implicit_meaning || block.annotations.narrative_note || block.annotations.tone || (block.annotations.motifs || []).length) ? "set" : null },
    reference: { text: refForBlock?.status || null, tone: refForBlock?.status === "draft" ? "warn" : "" },
    validate: { text: errorCount || null, tone: errorCount ? "bad" : "" },
    progress: { text: `${stats.reviewed}/${stats.totalBlocks}` },
  };

  function selectBlock(id) { setSelectedId(id); setEditing(false); }
  function toggleFilter(id) { setFilters(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function nextUnreviewedBlock() {
    if (!blocks.length) return;
    const currentIndex = Math.max(0, blocks.findIndex(b => b.block_id === selectedId));
    const after = blocks.slice(currentIndex + 1).find(b => !review.blocks?.[b.block_id]?.reviewed);
    const before = blocks.slice(0, currentIndex + 1).find(b => !review.blocks?.[b.block_id]?.reviewed);
    const next = after || before;
    if (next) {
      selectBlock(next.block_id);
      toast(`Next unreviewed: ${next.block_id}`, "info");
    } else {
      toast("All blocks are reviewed", "good");
    }
  }

  async function selectProject(docId) {
    const chosen = projects.find(p => p.doc_id === docId);
    setActiveDocId(docId);
    localStorage.setItem(STORAGE_DOC, docId);
    if (chosen?.status === "available") {
      await loadDataset(docId);
      setView("workspace");
    } else {
      setDocInfo({ doc_id: docId, metadata: {}, provenance: {} });
      setChapters([]);
      setBlocks([]);
      setGlossary([]);
      setEntities([]);
      setSummaries([]);
      setReferences([]);
      setReview({ blocks: {}, references: {}, summaries: {} });
      setHistoryState({ can_undo: false, can_redo: false, undo_top: null, redo_top: null, recent: [] });
      setErrors([]);
      setSelectedId(null);
      setView("project");
    }
  }

  function patchDoc(patch) {
    if (patch.metadata) {
      const localMetadata = { ...(docInfo?.metadata || {}), ...patch.metadata };
      setDocInfo(d => ({ ...(d || {}), metadata: localMetadata, provenance: d?.provenance || {} }));
      const apiPatch = {};
      Object.entries(patch.metadata).forEach(([k, v]) => {
        if (EDITABLE_META.has(k)) apiPatch[k] = v;
      });
      if (Object.keys(apiPatch).length && activeDocId && blocks.length) {
        queueSave("metadata", () => API.patchMetadata(activeDocId, { ...apiPatch, user: currentUser() }));
      }
    }
  }

  async function createProject(docId, metadata) {
    try {
      const result = await API.createProject({ doc_id: docId, metadata });
      await refreshProjects();
      setDocInfo({ doc_id: result.doc_id, metadata: metadata || {}, provenance: {} });
      setChapters([]);
      setBlocks([]);
      setGlossary([]);
      setEntities([]);
      setSummaries([]);
      setReferences([]);
      setReview({ blocks: {}, references: {}, summaries: {} });
      setHistoryState({ can_undo: false, can_redo: false, undo_top: null, redo_top: null, recent: [] });
      setErrors([]);
      setSelectedId(null);
      setActiveDocId(result.doc_id);
      localStorage.setItem(STORAGE_DOC, result.doc_id);
      toast("Project created", "good", result.doc_id);
      return result;
    } catch (err) {
      toast("Create project failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function updateProjectSettings(docId, patch) {
    if (!docId) return null;
    try {
      const result = await API.patchProject(docId, { ...patch, user: currentUser() });
      await refreshProjects();
      toast("Project updated", "good");
      return result;
    } catch (err) {
      toast("Update project failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function deleteProjectById(docId, confirmDocId) {
    if (!docId) return null;
    try {
      const result = await API.deleteProject(docId, { confirm_doc_id: confirmDocId, user: currentUser() });
      const list = await refreshProjects();
      const next = list.find(p => p.status === "available") || list[0];
      if (next) {
        await selectProject(next.doc_id);
      } else {
        setActiveDocId("");
        setDocInfo({ doc_id: "", metadata: {}, provenance: {} });
        setChapters([]);
        setBlocks([]);
        setView("project");
      }
      toast("Project deleted", "good", result.doc_id);
      return result;
    } catch (err) {
      toast("Delete project failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function uploadSource(file, overwrite) {
    if (!activeDocId || !file) return null;
    try {
      const result = await API.uploadSource(activeDocId, file, overwrite);
      await refreshProjects();
      toast("Source uploaded", "good", result.filename);
      return result;
    } catch (err) {
      toast("Upload failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function runExtract(overwrite) {
    if (!activeDocId) return null;
    try {
      const job = await API.extract(activeDocId, { overwrite: !!overwrite, user: currentUser() });
      await refreshProjects();
      await loadDataset(activeDocId, { silent: true });
      setView("workspace");
      toast("Extraction complete", "good", `${job.document?.blocks || 0} blocks · ${job.document?.chapters || 0} chapters`);
      return job;
    } catch (err) {
      toast("Extraction failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function buildNormalizeCandidate() {
    if (!activeDocId) return null;
    try {
      const candidate = await API.normalizeCandidateParts(activeDocId);
      if (!candidate.paths?.candidate_parts || !candidate.paths?.agent_structure_plan) {
        try {
          const project = await API.getProject(activeDocId);
          const projectRoot = project.root || project.path || "";
          candidate.paths = {
            ...(candidate.paths || {}),
            project_root: projectRoot,
            candidate_parts: joinLocalPath(projectRoot, "working", "normalized", "candidate_parts.json"),
            agent_structure_plan: joinLocalPath(projectRoot, "working", "normalized", "agent_structure_plan.json"),
          };
        } catch (pathErr) {
          candidate.paths = {
            ...(candidate.paths || {}),
            project_root: `ailab_projects/${activeDocId}`,
            candidate_parts: `ailab_projects/${activeDocId}/working/normalized/candidate_parts.json`,
            agent_structure_plan: `ailab_projects/${activeDocId}/working/normalized/agent_structure_plan.json`,
          };
        }
      }
      await refreshProjects();
      toast("Candidate parts built", "good", `${candidate.parts?.length || 0} parts · ${candidate.source_fingerprint || ""}`);
      return candidate;
    } catch (err) {
      toast("Build candidate failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function loadNormalizeAgentPlan() {
    if (!activeDocId) return null;
    try {
      const result = await API.getNormalizeAgentPlan(activeDocId);
      toast("Agent StructurePlan loaded", "good", result.path || "working/normalized/agent_structure_plan.json");
      return result;
    } catch (err) {
      toast("Load agent StructurePlan failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function importNormalizePlan(plan) {
    if (!activeDocId) return null;
    try {
      const result = await API.importStructurePlan(activeDocId, { plan, user: currentUser() });
      const preview = result.preview || {};
      await refreshProjects();
      toast("StructurePlan valid", preview.low_confidence || preview.needs_human_check ? "info" : "good",
        `${preview.chapters?.length || 0} chapters · body ${preview.body_coverage || "n/a"}`);
      return result;
    } catch (err) {
      toast("StructurePlan invalid", "bad", errorMessage(err));
      return {
        ok: false,
        errors: err.errors || [],
        warnings: err.warnings || [],
        validation: err.payload?.data?.validation || null,
        source_fingerprint: err.payload?.data?.source_fingerprint || null,
      };
    }
  }

  async function applyNormalizePlan(options = {}) {
    if (!activeDocId) return null;
    try {
      const job = await API.applyNormalizedStructure(activeDocId, {
        approved: true,
        overwrite: !!options.overwrite,
        force: !!options.force,
        user: currentUser(),
      });
      await refreshProjects();
      await loadDataset(activeDocId, { silent: true });
      setView("workspace");
      toast("Normalized structure applied", "good", `${job.document?.blocks || 0} blocks · ${job.document?.chapters || 0} chapters`);
      return job;
    } catch (err) {
      toast("Apply normalized structure failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function buildAnnotationInput(chapterId) {
    if (!activeDocId || !chapterId) return null;
    try {
      const input = await API.buildAnnotationInput(activeDocId, {
        chapter_id: chapterId,
        user: currentUser(),
      });
      toast("Annotation input built", "good", `${input.blocks?.length || 0} blocks`);
      return input;
    } catch (err) {
      toast("Build annotation input failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function resolveAnnotationCandidate(candidate) {
    if (!activeDocId) return null;
    try {
      const result = await API.resolveAnnotationCandidate(activeDocId, {
        candidate,
        user: currentUser(),
      });
      const okEntities = (result.entities || []).filter(item => item.status === "ok").length;
      const okTerms = (result.glossary || []).filter(item => item.status === "ok").length;
      toast("Annotation candidate resolved", "good", `${okEntities} entities · ${okTerms} terms`);
      return result;
    } catch (err) {
      toast("Resolve annotation candidate failed", "bad", errorMessage(err));
      return {
        ok: false,
        errors: err.errors || [],
        warnings: err.warnings || [],
      };
    }
  }

  async function loadAnnotationAgentCandidate(chapterId) {
    if (!activeDocId || !chapterId) return null;
    try {
      const result = await API.getAnnotationAgentCandidate(activeDocId, chapterId);
      toast("Agent candidate loaded", "good", result.path || chapterId);
      return result;
    } catch (err) {
      toast("Load agent candidate failed", "bad", errorMessage(err));
      return null;
    }
  }

  async function applyAnnotationCandidate(chapterId) {
    if (!activeDocId || !chapterId) return null;
    try {
      const result = await API.applyAnnotationCandidate(activeDocId, {
        chapter_id: chapterId,
        approved: true,
        accept_all_resolved: true,
        user: currentUser(),
      });
      await loadDataset(activeDocId, { silent: true });
      const counts = result.counts || {};
      toast("Annotation candidate applied", "good", `${counts.entities || 0} entities · ${counts.glossary || 0} terms`);
      return result;
    } catch (err) {
      toast("Apply annotation candidate failed", "bad", errorMessage(err));
      return null;
    }
  }

  function findBlock(blockId) {
    return blocks.find(b => b.block_id === blockId) || null;
  }

  function changeType(t, blockId = selectedId) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    setBlocks(bs => bs.map(b => b.block_id === target.block_id ? { ...b, block_type: t } : b));
    mutate(() => API.patchBlock(activeDocId, target.block_id, { block_type: t, user: currentUser() }), { success: `block_type -> ${t}` });
  }

  function toggleOpening(blockId = selectedId) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    const next = !target.is_chapter_opening;
    setBlocks(bs => bs.map(b => b.block_id === target.block_id ? { ...b, is_chapter_opening: next } : b));
    mutate(() => API.patchBlock(activeDocId, target.block_id, { is_chapter_opening: next, user: currentUser() }));
  }

  function toggleFlag(f, blockId = selectedId) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    let flags;
    const current = target.quality_flags || ["ok"];
    if (f === "ok") flags = ["ok"];
    else {
      flags = current.includes(f) ? current.filter(x => x !== f) : [...current.filter(x => x !== "ok"), f];
      if (!flags.length) flags = ["ok"];
    }
    setBlocks(bs => bs.map(b => b.block_id === target.block_id ? { ...b, quality_flags: flags } : b));
    mutate(() => API.patchBlock(activeDocId, target.block_id, { quality_flags: flags, user: currentUser() }));
  }

  function markReviewed(blockId = selectedId) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    const next = !review.blocks?.[target.block_id]?.reviewed;
    mutate(() => API.patchReview(activeDocId, target.block_id, { reviewed: next, reviewed_by: currentUser(), user: currentUser() }), {
      success: next ? `${target.block_id} marked reviewed` : `${target.block_id} marked unreviewed`,
    });
  }

  async function commitClean(blockId, text) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    setBlocks(bs => bs.map(b => b.block_id === target.block_id ? { ...b, clean_text: text } : b));
    setEditing(false);
    const result = await mutate(() => API.patchBlock(activeDocId, target.block_id, { clean_text: text, user: currentUser() }), { refresh: true });
    const broke = result?.stale_spans?.length || 0;
    const relocated = result?.relocated_count || 0;
    if (broke > 0 && relocated > 0) {
      toast(`Clean text saved · ${relocated} span${relocated > 1 ? "s" : ""} auto-relocated, ${broke} need re-tag`, "bad", "Re-tag only the highlighted stale span(s).");
    } else if (broke > 0) {
      toast(`Clean text saved · ${broke} annotation span${broke > 1 ? "s" : ""} no longer match`, "bad", "Re-tag from the right panel to clear the warning.");
    } else if (relocated > 0) {
      toast(`Clean text saved · ${relocated} span${relocated > 1 ? "s" : ""} auto-relocated`, "good");
    } else {
      toast("Clean text saved", "good");
    }
  }

  async function addGlossary(blockId, sel) {
    const target = findBlock(blockId);
    if (!target || !sel) return;
    setSelectedId(target.block_id);
    openRightTab("glossary");
    const result = await mutate(() => API.addGlossary(activeDocId, {
      block_id: target.block_id,
      start: sel.start,
      end: sel.end,
      source_term: sel.text.trim(),
      user: currentUser(),
    }), { success: `Added glossary occurrence "${sel.text.trim()}"`, fail: "Add glossary failed" });
    if (result) toast("Set expected_target in the Glossary tab.", "info");
  }
  async function addEntity(blockId, sel) {
    const target = findBlock(blockId);
    if (!target || !sel) return;
    setSelectedId(target.block_id);
    openRightTab("entities");
    const result = await mutate(() => API.addEntity(activeDocId, {
      block_id: target.block_id,
      start: sel.start,
      end: sel.end,
      surface: sel.text.trim(),
      user: currentUser(),
    }), { success: `Added entity mention "${sel.text.trim()}"`, fail: "Add entity failed" });
    if (result) toast("Set canonical_target and pronoun policy.", "info");
  }

  function updateTerm(termId, patch) {
    setGlossary(gs => gs.map(t => t.term_id === termId ? { ...t, ...patch } : t));
    queueSave(`term:${termId}:${Object.keys(patch).join(",")}`, () => API.patchGlossary(activeDocId, termId, { ...patch, user: currentUser() }));
  }
  function updateEntity(entityId, patch) {
    setEntities(es => es.map(e => e.entity_id === entityId ? { ...e, ...patch } : e));
    queueSave(`entity:${entityId}:${Object.keys(patch).join(",")}`, () => API.patchEntity(activeDocId, entityId, { ...patch, user: currentUser() }));
  }
  function updateSummary(chapterId, patch) {
    if (!chapterId) return;
    setSummaries(ss => {
      const exists = ss.some(s => s.chapter_id === chapterId);
      if (exists) return ss.map(s => s.chapter_id === chapterId ? { ...s, ...patch } : s);
      return [...ss, { doc_id: docInfo?.doc_id, chapter_id: chapterId, ...patch }];
    });
    queueSave(`summary:${chapterId}:${Object.keys(patch).join(",")}`, () => API.patchSummary(activeDocId, chapterId, { ...patch, user: currentUser() }));
  }
  function updateBlockNotes(blockId, patch) {
    const target = findBlock(blockId);
    if (!target) return;
    setSelectedId(target.block_id);
    setBlocks(bs => bs.map(b => b.block_id === target.block_id ? {
      ...b,
      annotations: { ...(b.annotations || {}), ...patch },
    } : b));
    queueSave(`block-notes:${blockId}:${Object.keys(patch).join(",")}`, () => API.patchBlockNotes(activeDocId, blockId, { ...patch, user: currentUser() }));
  }
  function updateReference(referenceId, patch) {
    setReferences(rs => rs.map(r => r.reference_id === referenceId ? { ...r, ...patch, canonical: false } : r));
  }
  function updateDiscourse(patch) {
    if (!block) return;
    const discourse = { ...(block.discourse || {}), ...patch };
    setBlocks(bs => bs.map(b => b.block_id === block.block_id ? { ...b, discourse } : b));
    mutate(() => API.patchBlock(activeDocId, block.block_id, { discourse, user: currentUser() }), { success: "Discourse saved" });
  }
  function saveDraft(referenceId) {
    const r = references.find(x => x.reference_id === referenceId);
    if (!r) return;
    mutate(() => API.saveReferenceDraft(activeDocId, {
      reference_id: r.reference_id,
      block_id: r.block_id,
      draft_vi: r.reference_vi || r.draft_vi || "",
      reference_vi: r.reference_vi || "",
      source: r.source || "",
      translated_by: r.translated_by || currentUser(),
      ai_model: r.ai_model || "",
      prompt_id: r.prompt_id || "",
      notes: r.notes || "",
      user: currentUser(),
    }), { success: "Reference draft saved" });
  }
  function createReferenceDraft(blockId, payload) {
    mutate(() => API.saveReferenceDraft(activeDocId, {
      block_id: blockId,
      draft_vi: payload.reference_vi || "",
      reference_vi: payload.reference_vi || "",
      source: payload.source || "human",
      translated_by: currentUser(),
      ai_model: payload.ai_model || "",
      user: currentUser(),
    }), { success: "Reference draft saved", fail: "Reference draft failed" });
  }
  function markReviewedReference(referenceId) {
    const r = references.find(x => x.reference_id === referenceId);
    if (!r) return;
    mutate(() => API.reviewReference(activeDocId, referenceId, {
      reference_vi: r.reference_vi || r.draft_vi || "",
      source: r.source || "",
      reviewed_by: currentUser(),
      ai_model: r.ai_model || "",
      prompt_id: r.prompt_id || "",
      user: currentUser(),
    }), { success: "Reference marked reviewed", fail: "Reference cannot be reviewed" });
  }
  function lockReference(referenceId) {
    mutate(() => API.lockReference(activeDocId, referenceId, { user: currentUser() }), { success: "Reference locked", fail: "Only reviewed references can be locked" });
  }

  function deleteTerm(t) {
    setModal({ kind: "delete-term", term: t });
  }

  function deleteEntity(e) {
    setModal({ kind: "delete-entity", entity: e });
  }

  async function confirmDeleteTerm() {
    const term = modal?.term;
    if (!term) return;
    touchStart();
    try {
      const result = await API.deleteGlossary(activeDocId, term.term_id, { user: currentUser() });
      await loadDataset(activeDocId, { silent: true });
      touchDone();
      setModal(null);
      toast(`Deleted term "${term.source_term}"`, "good", `${result.removed_occurrences || 0} occurrence(s) removed`);
    } catch (err) {
      touchDone();
      const first = firstError(err);
      setModal({ kind: "delete-blocked", title: "Cannot delete term", message: errorMessage(err), references: first.references || [] });
      toast("Cannot delete term", "bad", errorMessage(err));
    }
  }

  async function confirmDeleteEntity() {
    const entity = modal?.entity;
    if (!entity) return;
    touchStart();
    try {
      const result = await API.deleteEntity(activeDocId, entity.entity_id, { user: currentUser() });
      await loadDataset(activeDocId, { silent: true });
      touchDone();
      setModal(null);
      toast(`Deleted entity "${entity.canonical_source || entity.entity_id}"`, "good", `${result.removed_mentions || 0} mention(s) removed`);
    } catch (err) {
      touchDone();
      const first = firstError(err);
      setModal({ kind: "delete-blocked", title: "Cannot delete entity", message: errorMessage(err), references: first.references || [] });
      toast("Cannot delete entity", "bad", errorMessage(err));
    }
  }

  async function runValidate() {
    openRightTab("validate");
    try {
      const report = await API.validate(activeDocId, { user: currentUser() });
      const items = normalizeErrors(report);
      setErrors(items);
      toast(`Validation: ${report.errors?.length || 0} error${(report.errors?.length || 0) !== 1 ? "s" : ""}, ${report.warnings?.length || 0} warning`, report.ok ? "good" : "bad");
    } catch (err) {
      setErrors((err.errors || []).map(e => ({ severity: "error", ...e })));
      toast("Validation failed", "bad", errorMessage(err));
    }
  }
  function jumpTo(e) { if (e.block_id) { selectBlock(e.block_id); toast(`Jumped to ${e.block_id}`, "info"); } }
  function doExport() { setModal({ kind: "export" }); }
  function doFreeze() { setModal({ kind: "freeze" }); }

  async function runUndo() {
    if (!historyState.can_undo || dirty) return;
    const result = await mutate(() => API.undo(activeDocId, { user: currentUser() }), { refresh: false, fail: "Undo failed" });
    if (!result) return;
    await loadDataset(activeDocId, { silent: true });
    const target = result.event?.target || {};
    if (target.block_id) setSelectedId(target.block_id);
    toast(`Undo: ${result.event?.label || "last change"}`, "good");
  }

  async function runRedo() {
    if (!historyState.can_redo || dirty) return;
    const result = await mutate(() => API.redo(activeDocId, { user: currentUser() }), { refresh: false, fail: "Redo failed" });
    if (!result) return;
    await loadDataset(activeDocId, { silent: true });
    const target = result.event?.target || {};
    if (target.block_id) setSelectedId(target.block_id);
    toast(`Redo: ${result.event?.label || "last undone change"}`, "good");
  }

  function isNativeTextUndoTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "input" || target.isContentEditable;
  }

  async function confirmExport() {
    const result = await mutate(() => API.exportProject(activeDocId, { user: currentUser() }), { refresh: false });
    if (result) {
      setModal(null);
      toast("Exported current package", "good", result.zip || result.path || "Export created.");
    }
  }
  async function confirmFreeze() {
    try {
      const result = await API.freezeProject(activeDocId, { user: currentUser() });
      setModal(null);
      await loadDataset(activeDocId, { silent: true });
      toast("Dataset snapshot frozen", "good", `${result.version || "versioned"} · ${result.zip || ""}`);
    } catch (err) {
      const first = err.errors?.[0] || {};
      setModal({ kind: "freeze", serverReasons: first.reasons || [errorMessage(err)] });
      toast("Freeze blocked", "bad", (first.reasons || []).join("; ") || errorMessage(err));
    }
  }

  useEffect(() => {
    function onKey(ev) {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && !isNativeTextUndoTarget(ev.target)) {
        const key = ev.key.toLowerCase();
        if (key === "z" && !ev.shiftKey) {
          ev.preventDefault();
          runUndo();
          return;
        }
        if (key === "y" || (key === "z" && ev.shiftKey)) {
          ev.preventDefault();
          runRedo();
          return;
        }
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter" && !editing) { ev.preventDefault(); markReviewed(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) {
    return <StartupState title="Loading backend dataset" message={`Connecting to ${API.baseUrl}...`} />;
  }
  if (bootError) {
    return (
      <>
        <StartupState title="Backend offline" message="The UI could not reach the Flask backend. Start the backend on port 5000, then retry." secondary={bootError} action="Retry" onAction={boot} />
        <Toasts items={toasts} onDismiss={dismiss} />
      </>
    );
  }

  if (view === "project") {
    return (
      <>
        <ProjectSourceScreen
          projects={projects}
          activeDocId={activeDocId}
          docInfo={docInfo || { doc_id: activeDocId, metadata: {}, provenance: {} }}
          chapters={chapters}
          blocks={blocks}
          errors={errors}
          onSelectProject={selectProject}
          onCreateProject={createProject}
          onPatchDoc={patchDoc}
          onUpdateProject={updateProjectSettings}
          onDeleteProject={deleteProjectById}
          onUploadSource={uploadSource}
          onBack={() => setView("workspace")}
          onExtract={runExtract}
          onBuildNormalizeCandidate={buildNormalizeCandidate}
          onLoadNormalizeAgentPlan={loadNormalizeAgentPlan}
          onImportNormalizePlan={importNormalizePlan}
          onApplyNormalizePlan={applyNormalizePlan}
          onBuildAnnotationInput={buildAnnotationInput}
          onLoadAnnotationAgentCandidate={loadAnnotationAgentCandidate}
          onResolveAnnotationCandidate={resolveAnnotationCandidate}
          onApplyAnnotationCandidate={applyAnnotationCandidate}
        />
        <Toasts items={toasts} onDismiss={dismiss} />
      </>
    );
  }

  if (!block || !docInfo) {
    return (
      <>
        <StartupState title="No extracted document" message="Open Project / Source, upload a TXT or EPUB file, then run Extract." action="Open Project / Source" onAction={() => setView("project")} />
        <Toasts items={toasts} onDismiss={dismiss} />
      </>
    );
  }

  return (
    <div className="app">
      <TopBar docId={docInfo.doc_id} dirty={dirty} lastSaved={lastSaved}
        onValidate={runValidate} onExport={doExport} onFreeze={doFreeze}
        onUndo={runUndo} onRedo={runRedo} history={historyState}
        freezeReady={freezeReady} freezeReasons={freezeReasons} />
      <div className="workspace">
        <LeftSidebar docInfo={docInfo} projects={projects} blocks={visibleBlocks} chapters={chapters} review={review}
          annoSet={annoSet} selectedId={selectedId} onSelect={selectBlock}
          onSelectProject={selectProject}
          filters={filters} onToggleFilter={toggleFilter} counts={filterCounts} total={blocks.length}
          errors={errors}
          onOpenProjectSource={() => setView("project")} />
        <CenterEditor block={block} docInfo={docInfo} reviewed={!!review.blocks?.[selectedId]?.reviewed} spans={spans}
          editing={editing} mode={centerMode} onModeChange={setCenterMode}
          chapter={activeChapter} chapters={chapters} chapterBlocks={chapterBlocks} allBlocks={blocks} review={review} selectedId={selectedId}
          getSpansForBlock={getSpansForBlock} linkIndex={linkIndex} onSelectBlock={selectBlock} onNextUnreviewed={nextUnreviewedBlock}
          onEdit={() => setEditing(true)} onCommitClean={commitClean} onCancelEdit={() => setEditing(false)}
          onChangeType={changeType} onToggleOpening={() => toggleOpening(selectedId)} onToggleFlag={(flag) => toggleFlag(flag, selectedId)} onMarkReviewed={markReviewed}
          onAddGlossary={addGlossary} onAddEntity={addEntity} />
        <RightPanel openTabs={rightOpenTabs} onToggleTab={toggleRightTab} counts={rpCounts}
          ctx={{ terms: blockTerms, entities: blockEntities, allEntities: entities, block, summary, references, errors, stats, freezeReasons,
            onDeleteTerm: deleteTerm, onDeleteEntity: deleteEntity, onUpdateTerm: updateTerm, onUpdateEntity: updateEntity, onUpdateSummary: updateSummary,
            onUpdateBlockNotes: updateBlockNotes,
            onUpdateReference: updateReference, onCreateReference: createReferenceDraft, onSaveDraft: saveDraft, onMarkReviewedReference: markReviewedReference,
            onLockReference: lockReference, onUpdateDiscourse: updateDiscourse, onJump: jumpTo, history: historyState }} />
      </div>

      <Toasts items={toasts} onDismiss={dismiss} />

      {modal?.kind === "export" && (
        <Modal title="Export dataset" icon={Ic.upload} onClose={() => setModal(null)}
          actions={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn primary" onClick={confirmExport}>Export package</button></>}>
          <p>Exports the current dataset package. It may still be a working package if validation or review gates are not clear.</p>
          <ul className="file-list">
            {["document.json","glossary.jsonl","entities.jsonl","chapter_summaries.jsonl","manual_reference_subset.jsonl"].map(f =>
              <li key={f}><Ic.file size={12} /><span className="mono">{f}</span></li>)}
          </ul>
          <p className="muted">{errorCount > 0 ? <><Ic.alert size={11} /> {errorCount} validation error(s) present.</> : "No validation errors in the current report."}</p>
        </Modal>
      )}

      {modal?.kind === "freeze" && (
        <Modal title="Freeze dataset" icon={Ic.snow} onClose={() => setModal(null)}
          actions={<><button className="btn" onClick={() => setModal(null)}>Close</button>
            <button className="btn primary" disabled={!freezeReady && !modal.serverReasons} onClick={confirmFreeze}><Ic.snow size={12} />Freeze snapshot</button></>}>
          <p>Freeze creates a validated, versioned snapshot. It is blocked until validation, review, references, spans, summaries, and provenance gates are clear.</p>
          <div className="freeze-checks">
            {(modal.serverReasons || freezeReasons).length ? (modal.serverReasons || freezeReasons).map(reason => (
              <div key={reason} className="fc-row bad"><Ic.xCircle size={13} />{reason}</div>
            )) : <div className="fc-row ok"><Ic.checkCircle size={13} />All freeze gates are clear.</div>}
          </div>
        </Modal>
      )}

      {modal?.kind === "delete-term" && (() => {
        const term = modal.term;
        const locked = ["locked", "human_verified"].includes(term?.status);
        const occCount = (term?.occurrences || []).length;
        const blockCount = new Set((term?.occurrences || []).map(o => o.block_id)).size;
        return (
          <Modal title="Delete glossary term" icon={Ic.trash} tone="bad" onClose={() => setModal(null)}
            actions={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn danger" disabled={locked} onClick={confirmDeleteTerm}>Delete term</button></>}>
            {locked ? (
              <p><b>{term.source_term}</b> is {term.status}. Unlock or downgrade it before deleting.</p>
            ) : (
              <>
                <p>Delete <b>{term.source_term}</b> and remove its annotation footprint from the document?</p>
                <p className="muted">{occCount} occurrence(s) across {blockCount || 0} block(s) will be removed. This is undoable.</p>
              </>
            )}
          </Modal>
        );
      })()}

      {modal?.kind === "delete-entity" && (() => {
        const entity = modal.entity;
        const mentionCount = (entity?.mentions || []).length;
        const blockCount = new Set((entity?.mentions || []).map(m => m.block_id)).size;
        return (
          <Modal title="Delete entity" icon={Ic.trash} tone="bad" onClose={() => setModal(null)}
            actions={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn danger" onClick={confirmDeleteEntity}>Delete entity</button></>}>
            <p>Delete <b>{entity.canonical_source || entity.entity_id}</b> and remove its own mention footprint from the document?</p>
            <p className="muted">{mentionCount} mention(s) across {blockCount || 0} block(s) will be removed. This is undoable.</p>
            <p className="muted">If this entity is used by discourse or chapter summary, deletion will be blocked and those references must be removed first.</p>
          </Modal>
        );
      })()}

      {modal?.kind === "delete-blocked" && (
        <Modal title={modal.title || "Delete blocked"} icon={Ic.alert} tone="bad" onClose={() => setModal(null)}
          actions={<button className="btn" onClick={() => setModal(null)}>Close</button>}>
          <p>{modal.message || "This item is still referenced."}</p>
          {(modal.references || []).length ? (
            <ul className="file-list">
              {modal.references.map((ref, index) => <li key={index}><Ic.link size={12} /><span className="mono">{describeExternalRef(ref)}</span></li>)}
            </ul>
          ) : <p className="muted">Remove related references first, then try again.</p>}
        </Modal>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
