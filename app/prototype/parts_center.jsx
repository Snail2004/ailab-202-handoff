/* ===== CENTER: block editor with read-only EN, editable clean_text, selection→annotate ===== */

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

function EditorToolbar({ block, reviewed, onChangeType, onToggleOpening, onToggleFlag, onMarkReviewed }) {
  const [typeOpen, setTypeOpen] = React.useState(false);
  const [flagOpen, setFlagOpen] = React.useState(false);
  const flags = block.quality_flags.filter(f => f !== "ok");
  return (
    <div className="ed-toolbar">
      <div className="ed-tb-left">
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
                const on = f === "ok" ? flags.length === 0 : block.quality_flags.includes(f);
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
        <button className={"btn sm reviewed-btn" + (reviewed ? " is-on" : "")} onClick={onMarkReviewed}>
          <Ic.checkCircle size={13} />{reviewed ? "Reviewed" : "Mark reviewed"}
        </button>
      </div>
    </div>
  );
}

function MetaBar({ block }) {
  const items = [
    ["block_id", block.block_id],
    ["chapter_id", block.chapter_id],
    ["order_index", String(block.order_index)],
    ["provenance", "pipeline 1.4.0"],
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

function SelectionPopover({ rect, onGlossary, onEntity, onClose }) {
  if (!rect) return null;
  return (
    <div className="sel-pop" style={{ top: rect.top, left: rect.left }} onMouseDown={e => e.preventDefault()}>
      <button className="sel-pop-btn" onClick={onGlossary}><Ic.tag size={12} />Add glossary term</button>
      <div className="sel-pop-div" />
      <button className="sel-pop-btn" onClick={onEntity}><Ic.users size={12} />Add entity mention</button>
    </div>
  );
}

function CenterEditor({
  block, reviewed, spans, editing, onEdit, onCommitClean, onCancelEdit,
  onChangeType, onToggleOpening, onToggleFlag, onMarkReviewed,
  onAddGlossary, onAddEntity,
}) {
  const cleanRef = React.useRef(null);
  const taRef = React.useRef(null);
  const [sel, setSel] = React.useState(null); // {start,end,text,rect}
  const [draft, setDraft] = React.useState(block.clean_text);

  React.useEffect(() => { setDraft(block.clean_text); }, [block.block_id, block.clean_text]);
  React.useEffect(() => { if (editing && taRef.current) { taRef.current.focus(); } }, [editing]);

  function handleMouseUp() {
    if (editing) return;
    const c = cleanRef.current;
    if (!c) return;
    const off = selectionOffsets(c);
    if (!off) { setSel(null); return; }
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const wrap = c.closest(".ed-scroll").getBoundingClientRect();
    setSel({ ...off, rect: { top: r.top - wrap.top - 44, left: Math.max(8, r.left - wrap.left + r.width / 2 - 92) } });
  }

  const staleCount = spans.filter(s => s.stale).length;

  return (
    <div className="col col-center">
      <EditorToolbar block={block} reviewed={reviewed}
        onChangeType={onChangeType} onToggleOpening={onToggleOpening}
        onToggleFlag={onToggleFlag} onMarkReviewed={onMarkReviewed} />
      <MetaBar block={block} />
      <div className="ed-scroll" onMouseDown={() => sel && setSel(null)}>
        <div className="ed-inner">
          {/* SOURCE EN — read only */}
          <div className="field-block">
            <div className="field-head">
              <span className="fh-title"><Ic.lock size={11} />Source (EN)</span>
              <span className="fh-meta">read-only · source_text · extracted</span>
            </div>
            <div className="src-text">{block.source_text}</div>
          </div>

          {/* CLEAN TEXT — editable */}
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
                      <button className="btn sm" onClick={() => { setDraft(block.clean_text); onCancelEdit(); }}>Cancel</button>
                      <button className="btn sm primary" onClick={() => onCommitClean(draft)}><Ic.check size={11} />Save text</button>
                    </>}
              </span>
            </div>

            {!editing ? (
              <div className="clean-text" ref={cleanRef} onMouseUp={handleMouseUp}>
                {segmentize(block.clean_text, spans).map((seg, i) =>
                  seg.span
                    ? <mark key={i} className={"hl hl-" + seg.span.kind + (seg.span.stale ? " hl-stale" : "")}
                        title={seg.span.label}>{seg.text}</mark>
                    : <span key={i}>{seg.text}</span>
                )}
                <SelectionPopover rect={sel?.rect}
                  onGlossary={() => { onAddGlossary(sel); setSel(null); window.getSelection().removeAllRanges(); }}
                  onEntity={() => { onAddEntity(sel); setSel(null); window.getSelection().removeAllRanges(); }} />
              </div>
            ) : (
              <textarea className="clean-edit mono" ref={taRef} value={draft}
                onChange={e => setDraft(e.target.value)} spellCheck={false} />
            )}

            {!editing && (
              <div className="clean-hint">
                <Ic.tag size={11} />Select text to add a glossary occurrence or entity mention.
                <span className="hint-keys"><span className="kbd">⌘</span><span className="kbd">↵</span> mark reviewed</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.CenterEditor = CenterEditor;
