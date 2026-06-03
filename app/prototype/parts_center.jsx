/* ===== CENTER: block editor + continuous chapter stream ===== */

/* compute char offsets of current selection within a container element */
function selectionOffsets(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const text = range.toString();
  if (!text.trim()) return null;
  return { start, end: start + text.length, text };
}

/* split text into segments by spans (non-overlapping; later spans skipped if overlapping) */
function segmentize(text, spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const segs = [];
  let cur = 0;
  for (const s of sorted) {
    if (s.start < cur || s.start >= text.length) continue;
    if (s.start > cur) segs.push({ text: text.slice(cur, s.start) });
    segs.push({ text: text.slice(s.start, Math.min(s.end, text.length)), span: s });
    cur = Math.min(s.end, text.length);
  }
  if (cur < text.length) segs.push({ text: text.slice(cur) });
  return segs;
}

function ModeToggle({ mode, onModeChange }) {
  const items = [
    { id: "block", label: "Block" },
    { id: "chapter", label: "Chapter" },
    { id: "book", label: "Book" },
  ];
  return (
    <div className="mode-toggle" role="group" aria-label="Center view mode">
      {items.map(item => (
        <button
          key={item.id}
          className={"mode-btn" + (mode === item.id ? " on" : "")}
          onClick={() => onModeChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function EditorToolbar({
  block, reviewed, mode, onModeChange, streamLabel, streamCount, onNextUnreviewed,
  onChangeType, onToggleOpening, onToggleFlag, onMarkReviewed
}) {
  const [typeOpen, setTypeOpen] = React.useState(false);
  const [flagOpen, setFlagOpen] = React.useState(false);
  const qualityFlags = block.quality_flags || [];
  const flags = qualityFlags.filter(f => f !== "ok");
  return (
    <div className="ed-toolbar">
      <div className="ed-tb-left">
        <ModeToggle mode={mode} onModeChange={onModeChange} />

        <span className="toolbar-chapter-meta">
          {mode === "block" ? block.block_id : `${streamLabel} · ${streamCount || 0} blocks`}
        </span>

        {/* block_type dropdown */}
        <div className="dd">
          <button className="dd-btn" onClick={() => { setTypeOpen(o => !o); setFlagOpen(false); }}>
            <span className={"tag tag-" + block.block_type}>{block.block_type}</span>
            <Ic.chevDown size={11} className="faint" />
          </button>
          {typeOpen && (<>
            <div className="menu-scrim" onClick={() => setTypeOpen(false)} />
            <div className="dd-menu">
              {DATA.BLOCK_TYPES.map(t => (
                <button key={t} className={"dd-item" + (t === block.block_type ? " cur" : "")}
                  onClick={() => { onChangeType(t); setTypeOpen(false); }}>
                  <span className={"tag tag-" + t}>{t}</span>
                  {t === block.block_type && <Ic.check size={12} className="dd-cur" />}
                </button>
              ))}
            </div>
          </>)}
        </div>

        {/* chapter opening toggle */}
        <button className={"tog" + (block.is_chapter_opening ? " on" : "")} onClick={onToggleOpening}>
          <span className="tog-sw"><span className="tog-knob" /></span>
          <Ic.bolt size={12} />chapter opening
        </button>

        {/* quality flags */}
        <div className="dd">
          <button className="dd-btn flags-btn" onClick={() => { setFlagOpen(o => !o); setTypeOpen(false); }}>
            <Ic.flag size={12} className={flags.length ? "flag-on" : "faint"} />
            {flags.length === 0
              ? <span className="faint" style={{ fontSize: 12 }}>no flags</span>
              : flags.map(f => <span key={f} className="flag-chip">{f}</span>)}
            <Ic.chevDown size={11} className="faint" />
          </button>
          {flagOpen && (<>
            <div className="menu-scrim" onClick={() => setFlagOpen(false)} />
            <div className="dd-menu wide">
              <div className="dd-menu-head">quality_flags</div>
              {DATA.QUALITY_FLAGS.map(f => {
                const on = f === "ok" ? flags.length === 0 : qualityFlags.includes(f);
                return (
                  <button key={f} className={"dd-check" + (on ? " on" : "")} onClick={() => onToggleFlag(f)}>
                    <span className="dd-box">{on && <Ic.checkSmall size={10} />}</span>
                    <span className="mono">{f}</span>
                  </button>
                );
              })}
            </div>
          </>)}
        </div>
      </div>

      <div className="ed-tb-right">
        {mode !== "block" && (
          <button className="btn sm" onClick={onNextUnreviewed}>
            <Ic.arrowRight size={13} />Next unreviewed
          </button>
        )}
        <button className={"btn sm reviewed-btn" + (reviewed ? " is-on" : "")} onClick={onMarkReviewed}>
          <Ic.checkCircle size={13} />{reviewed ? "Reviewed" : "Mark reviewed"}
        </button>
      </div>
    </div>
  );
}

function MetaBar({ block, docInfo }) {
  const schemaVersion = docInfo?.schema_version ? `schema ${docInfo.schema_version}` : "";
  const pipelineVersion = docInfo?.metadata?.pipeline_version ? `pipeline ${docInfo.metadata.pipeline_version}` : "";
  const items = [
    ["block_id", block.block_id],
    ["chapter_id", block.chapter_id],
    ["order_index", String(block.order_index)],
    ["provenance", [schemaVersion, pipelineVersion].filter(Boolean).join(" / ") || "extracted"],
  ];
  return (
    <div className="metabar">
      {items.map(([k, v]) => (
        <span key={k} className="lockfield tip" data-tip={"Read-only · set by extraction pipeline"}>
          <span className="lf-k"><Ic.lock size={10} />{k}</span>
          <span className="lf-v">{v}</span>
        </span>
      ))}
    </div>
  );
}

function SelectionPopover({ rect, onGlossary, onEntity }) {
  if (!rect) return null;
  return (
    <div
      className="sel-pop"
      style={{ top: rect.top, left: rect.left }}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={e => e.stopPropagation()}
    >
      <button className="sel-pop-btn" onClick={onGlossary}><Ic.tag size={12} />Add glossary term</button>
      <div className="sel-pop-div" />
      <button className="sel-pop-btn" onClick={onEntity}><Ic.users size={12} />Add entity mention</button>
    </div>
  );
}

function CleanTextSurface({ block, spans = [], editing, draft, onDraft, onMouseUp, cleanRef, taRef, onAddGlossary, onAddEntity, selection }) {
  if (editing) {
    return (
      <textarea className="clean-edit mono" ref={taRef} value={draft}
        onChange={e => onDraft(e.target.value)} spellCheck={false} />
    );
  }
  return (
    <div className="clean-text" ref={cleanRef} onMouseUp={onMouseUp}>
      {segmentize(block.clean_text || "", spans).map((seg, i) =>
        seg.span
          ? <mark key={i} className={"hl hl-" + seg.span.kind + (seg.span.stale ? " hl-stale" : "")}
              title={seg.span.label}>{seg.text}</mark>
          : <span key={i}>{seg.text}</span>
      )}
      <SelectionPopover rect={selection?.rect}
        onGlossary={onAddGlossary}
        onEntity={onAddEntity} />
    </div>
  );
}

function ChapterBlockRow({
  block, spans, reviewed, active, onSelectBlock, onCommitClean,
  onMarkReviewed, onAddGlossary, onAddEntity
}) {
  const cleanRef = React.useRef(null);
  const taRef = React.useRef(null);
  const [sel, setSel] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(block.clean_text || "");

  React.useEffect(() => { setDraft(block.clean_text || ""); }, [block.block_id, block.clean_text]);
  React.useEffect(() => { if (editing && taRef.current) taRef.current.focus(); }, [editing]);

  function clearSelection() {
    setSel(null);
    const current = window.getSelection();
    if (current) current.removeAllRanges();
  }

  function handleMouseUp() {
    if (editing) return;
    const c = cleanRef.current;
    if (!c) return;
    const off = selectionOffsets(c);
    if (!off) { setSel(null); return; }
    onSelectBlock(block.block_id);
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const host = c.getBoundingClientRect();
    const popoverWidth = 258;
    const top = r.bottom - host.top + 8;
    const left = Math.min(
      Math.max(8, r.left - host.left + r.width / 2 - popoverWidth / 2),
      Math.max(8, c.clientWidth - popoverWidth - 8)
    );
    setSel({ ...off, rect: { top, left } });
  }

  const staleCount = (spans || []).filter(s => s.stale).length;
  const flags = (block.quality_flags || []).filter(f => f !== "ok");

  return (
    <article
      className={"chapter-block-row" + (active ? " active" : "") + (reviewed ? " reviewed" : "")}
      data-block-id={block.block_id}
      onMouseDown={() => onSelectBlock(block.block_id)}
    >
      <div className="cbr-head">
        <div className="cbr-meta">
          <span className="mono cbr-id">{block.block_id}</span>
          <span className={"tag tag-" + block.block_type}>{block.block_type}</span>
          {reviewed && <span className="mini-badge good"><Ic.check size={10} />reviewed</span>}
          {flags.map(f => <span key={f} className="mini-badge bad"><Ic.flag size={10} />{f}</span>)}
          {staleCount > 0 && (
            <span className="stale-warn tip" data-tip="A glossary/entity span no longer matches this block text. Re-tag this row.">
              <Ic.alert size={11} />{staleCount} span{staleCount > 1 ? "s" : ""} need re-tag
            </span>
          )}
        </div>
        <div className="cbr-actions">
          <button className="btn sm ghost" onClick={e => { e.stopPropagation(); setSourceOpen(v => !v); }}>
            <Ic.eye size={12} />{sourceOpen ? "Hide source" : "Source"}
          </button>
          {!editing ? (
            <button className="btn sm" onClick={e => { e.stopPropagation(); clearSelection(); setEditing(true); }}>
              <Ic.pencil size={11} />Edit
            </button>
          ) : (
            <>
              <button className="btn sm" onClick={e => { e.stopPropagation(); setDraft(block.clean_text || ""); setEditing(false); }}>Cancel</button>
              <button className="btn sm primary" onClick={e => { e.stopPropagation(); setEditing(false); onCommitClean(block.block_id, draft); }}>
                <Ic.check size={11} />Save
              </button>
            </>
          )}
          <button className={"btn sm reviewed-btn" + (reviewed ? " is-on" : "")}
            onClick={e => { e.stopPropagation(); onMarkReviewed(block.block_id); }}>
            <Ic.checkCircle size={13} />{reviewed ? "Reviewed" : "Review"}
          </button>
        </div>
      </div>

      {sourceOpen && (
        <div className="chapter-source">
          <div className="field-head compact">
            <span className="fh-title"><Ic.lock size={11} />Source (EN)</span>
            <span className="fh-meta">read-only · source_text</span>
          </div>
          <div className="src-text compact">{block.source_text || ""}</div>
        </div>
      )}

      <CleanTextSurface
        block={block}
        spans={spans}
        editing={editing}
        draft={draft}
        onDraft={setDraft}
        cleanRef={cleanRef}
        taRef={taRef}
        selection={sel}
        onMouseUp={handleMouseUp}
        onAddGlossary={() => { onAddGlossary(block.block_id, sel); clearSelection(); }}
        onAddEntity={() => { onAddEntity(block.block_id, sel); clearSelection(); }}
      />
    </article>
  );
}

function SingleBlockView({
  block, docInfo, reviewed, spans, editing, onEdit, onCommitClean, onCancelEdit,
  onAddGlossary, onAddEntity
}) {
  const cleanRef = React.useRef(null);
  const taRef = React.useRef(null);
  const [sel, setSel] = React.useState(null);
  const [draft, setDraft] = React.useState(block.clean_text || "");

  React.useEffect(() => { setDraft(block.clean_text || ""); }, [block.block_id, block.clean_text]);
  React.useEffect(() => { if (editing && taRef.current) { taRef.current.focus(); } }, [editing]);

  function clearSelection() {
    setSel(null);
    const current = window.getSelection();
    if (current) current.removeAllRanges();
  }

  function handleMouseUp() {
    if (editing) return;
    const c = cleanRef.current;
    if (!c) return;
    const off = selectionOffsets(c);
    if (!off) { setSel(null); return; }
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const host = c.getBoundingClientRect();
    const popoverWidth = 258;
    const top = r.bottom - host.top + 8;
    const left = Math.min(
      Math.max(8, r.left - host.left + r.width / 2 - popoverWidth / 2),
      Math.max(8, c.clientWidth - popoverWidth - 8)
    );
    setSel({ ...off, rect: { top, left } });
  }

  const staleCount = (spans || []).filter(s => s.stale).length;

  return (
    <>
      <MetaBar block={block} docInfo={docInfo} />
      <div className="ed-scroll" onMouseDown={() => sel && setSel(null)}>
        <div className="ed-inner">
          <div className="field-block">
            <div className="field-head">
              <span className="fh-title"><Ic.lock size={11} />Source (EN)</span>
              <span className="fh-meta">read-only · source_text · extracted</span>
            </div>
            <div className="src-text">{block.source_text || ""}</div>
          </div>

          <div className="field-block">
            <div className="field-head">
              <span className="fh-title editable-title"><Ic.pencil size={11} />Clean text</span>
              <span className="fh-actions">
                {staleCount > 0 && !editing && (
                  <span className="stale-warn tip" data-tip="A glossary/entity span no longer matches the edited text. Re-tag from the right panel.">
                    <Ic.alert size={11} />{staleCount} span{staleCount > 1 ? "s" : ""} need re-tag
                  </span>
                )}
                {!editing
                  ? <button className="btn sm" onClick={() => { setSel(null); onEdit(); }}><Ic.pencil size={11} />Edit</button>
                  : <>
                      <button className="btn sm" onClick={() => { setDraft(block.clean_text || ""); onCancelEdit(); }}>Cancel</button>
                      <button className="btn sm primary" onClick={() => onCommitClean(block.block_id, draft)}><Ic.check size={11} />Save text</button>
                    </>}
              </span>
            </div>

            <CleanTextSurface
              block={block}
              spans={spans}
              editing={editing}
              draft={draft}
              onDraft={setDraft}
              cleanRef={cleanRef}
              taRef={taRef}
              selection={sel}
              onMouseUp={handleMouseUp}
              onAddGlossary={() => { onAddGlossary(block.block_id, sel); clearSelection(); }}
              onAddEntity={() => { onAddEntity(block.block_id, sel); clearSelection(); }}
            />

            {!editing && (
              <div className="clean-hint">
                <Ic.tag size={11} />Select text to add a glossary occurrence or entity mention.
                <span className="hint-keys"><span className="kbd">⌘</span><span className="kbd">↵</span> mark reviewed</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ChapterStream({
  blocks = [], chapters = [], selectedId, review, getSpansForBlock, onSelectBlock, onCommitClean,
  onMarkReviewed, onAddGlossary, onAddEntity
}) {
  const rows = blocks || [];
  const chapterLookup = React.useMemo(() => {
    const map = {};
    (chapters || []).forEach(ch => { map[ch.chapter_id] = ch; });
    return map;
  }, [chapters]);
  const chapterCounts = React.useMemo(() => {
    const map = {};
    rows.forEach(row => { map[row.chapter_id] = (map[row.chapter_id] || 0) + 1; });
    return map;
  }, [rows]);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const row = Array.from(scrollRef.current.querySelectorAll("[data-block-id]"))
      .find(el => el.dataset.blockId === selectedId);
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedId, rows.length]);

  return (
    <div className="ed-scroll" ref={scrollRef}>
      <div className="chapter-stream">
        {rows.map((row, index) => {
          const prev = rows[index - 1];
          const startsChapter = index === 0 || prev?.chapter_id !== row.chapter_id;
          const chapter = chapterLookup[row.chapter_id] || {};
          const title = chapter.title || chapter.chapter_title || row.chapter_id;
          const count = chapterCounts[row.chapter_id] || 0;
          return (
            <React.Fragment key={row.block_id}>
              {startsChapter && (
                <div className="chapter-divider" data-chapter-id={row.chapter_id}>
                  <span className="chapter-divider-rule" />
                  <span className="chapter-divider-title">{title}</span>
                  <span className="chapter-divider-meta mono">{row.chapter_id} · {count} blocks</span>
                </div>
              )}
              <ChapterBlockRow
                block={row}
                spans={getSpansForBlock(row)}
                reviewed={!!review?.blocks?.[row.block_id]?.reviewed}
                active={row.block_id === selectedId}
                onSelectBlock={onSelectBlock}
                onCommitClean={onCommitClean}
                onMarkReviewed={onMarkReviewed}
                onAddGlossary={onAddGlossary}
                onAddEntity={onAddEntity}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function CenterEditor({
  block, docInfo, reviewed, spans, editing, mode, onModeChange, chapter, chapters, chapterBlocks, allBlocks,
  review, selectedId, getSpansForBlock, onSelectBlock, onNextUnreviewed,
  onEdit, onCommitClean, onCancelEdit,
  onChangeType, onToggleOpening, onToggleFlag, onMarkReviewed,
  onAddGlossary, onAddEntity,
}) {
  const chapterTitle = chapter?.title || chapter?.chapter_title || block.chapter_id;
  const streamBlocks = mode === "book" ? (allBlocks || []) : (chapterBlocks || []);
  const streamLabel = mode === "book" ? (docInfo?.metadata?.title || docInfo?.doc_id || "Full book") : chapterTitle;
  const streamCount = mode === "book" ? (allBlocks?.length || 0) : (chapterBlocks?.length || 0);

  return (
    <div className="col col-center">
      <EditorToolbar block={block} reviewed={reviewed} mode={mode} onModeChange={onModeChange}
        streamLabel={streamLabel} streamCount={streamCount} onNextUnreviewed={onNextUnreviewed}
        onChangeType={onChangeType} onToggleOpening={onToggleOpening}
        onToggleFlag={onToggleFlag} onMarkReviewed={() => onMarkReviewed(block.block_id)} />

      {mode !== "block" ? (
        <ChapterStream
          blocks={streamBlocks}
          chapters={chapters}
          selectedId={selectedId}
          review={review}
          getSpansForBlock={getSpansForBlock}
          onSelectBlock={onSelectBlock}
          onCommitClean={onCommitClean}
          onMarkReviewed={onMarkReviewed}
          onAddGlossary={onAddGlossary}
          onAddEntity={onAddEntity}
        />
      ) : (
        <SingleBlockView
          block={block}
          docInfo={docInfo}
          reviewed={reviewed}
          spans={spans}
          editing={editing}
          onEdit={onEdit}
          onCommitClean={onCommitClean}
          onCancelEdit={onCancelEdit}
          onAddGlossary={onAddGlossary}
          onAddEntity={onAddEntity}
        />
      )}
    </div>
  );
}

window.CenterEditor = CenterEditor;
