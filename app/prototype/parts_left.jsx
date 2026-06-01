/* ===== LEFT SIDEBAR: project, source status, filters, chapter→block tree ===== */

function ProjectSelector({ onOpenProjectSource }) {
  const [open, setOpen] = React.useState(false);
  function openProjectSource() {
    setOpen(false);
    if (onOpenProjectSource) onOpenProjectSource();
  }
  return (
    <div className="proj">
      <button className="proj-pick" onClick={() => setOpen(o => !o)}>
        <Ic.folder size={14} className="muted" />
        <span className="proj-name">austen_pp_en</span>
        <Ic.chevUpDown size={12} className="faint" />
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="proj-menu">
            <div className="proj-menu-sec">Recent projects</div>
            {[["austen_pp_en","Pride and Prejudice","14 blocks"],
              ["dickens_gx_en","Great Expectations","312 blocks"],
              ["shelley_fr_en","Frankenstein","—  not extracted"]].map(([id,t,m],i)=>(
              <button key={id} className={"proj-menu-item"+(i===0?" cur":"")} onClick={()=>setOpen(false)}>
                <Ic.doc size={13} className="faint" />
                <span className="pm-id mono">{id}</span>
                <span className="pm-meta">{m}</span>
                {i===0 && <Ic.check size={13} className="pm-cur-ic" />}
              </button>
            ))}
            <div className="divider" />
            <button className="proj-menu-item" onClick={openProjectSource}><Ic.folder size={13} className="faint" /><span>Open project folder...</span></button>
            <button className="proj-menu-item" onClick={openProjectSource}><Ic.plus size={13} className="faint" /><span>New project from source...</span></button>
          </div>
        </>
      )}
      <div className="proj-actions">
        <button className="btn sm tip" data-tip="Open source/project setup" onClick={openProjectSource}><Ic.folder size={12} />Open</button>
        <button className="btn sm tip" data-tip="Write working state to disk"><Ic.save size={12} />Save</button>
        <span className="resume tip" data-tip="Session restored from working/review_state.json">
          <span className="resume-dot" />resumed
        </span>
      </div>
    </div>
  );
}

function SourceStatus() {
  const rows = [
    { k: "source", label: "Source", val: "austen_pp.epub", ok: true, tip: "Uploaded · 612 KB · sha 9f2c…b71a" },
    { k: "extract", label: "Extracted", val: "14 blocks · 2 ch", ok: true, tip: "ailab-extract · pipeline 1.4.0 · 2026-05-28" },
    { k: "valid", label: "Validation", val: "2 errors", ok: false, tip: "Run Validate to see grouped issues" },
  ];
  return (
    <div className="srcstat">
      {rows.map(r => (
        <div key={r.k} className="srcstat-row tip" data-tip={r.tip}>
          <span className={"ss-dot " + (r.ok ? "ok" : "bad")} />
          <span className="ss-label">{r.label}</span>
          <span className={"ss-val mono" + (r.ok ? "" : " bad")}>{r.val}</span>
        </div>
      ))}
    </div>
  );
}

const FILTERS = [
  { id: "unreviewed", label: "Unreviewed" },
  { id: "dialogue", label: "Dialogue" },
  { id: "flag", label: "Has flag" },
  { id: "opening", label: "Chapter opening" },
  { id: "annotation", label: "Has annotation" },
];

function FilterChips({ active, onToggle, counts }) {
  return (
    <div className="filters">
      {FILTERS.map(f => (
        <button key={f.id}
          className={"chip" + (active.has(f.id) ? " active" : "")}
          onClick={() => onToggle(f.id)}>
          {f.label}
          <span className="count">{counts[f.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function BlockRow({ block, reviewed, hasAnno, selected, onSelect }) {
  const flagged = block.quality_flags.some(f => f !== "ok");
  return (
    <button className={"blockrow" + (selected ? " sel" : "")} onClick={() => onSelect(block.block_id)}>
      <span className={"br-check" + (reviewed ? " on" : "")}>
        {reviewed ? <Ic.checkSmall size={11} /> : null}
      </span>
      <span className="br-id mono">{block.block_id}</span>
      <span className={"tag tag-" + block.block_type}>{block.block_type}</span>
      <span className="br-spacer" />
      {hasAnno && <span className="br-anno tip" data-tip="Has glossary / entity annotations"><Ic.tag size={11} /></span>}
      {flagged && <span className="br-flag tip" data-tip={block.quality_flags.join(", ")}><Ic.flag size={11} /></span>}
      {block.is_chapter_opening && <span className="br-open tip" data-tip="Chapter opening"><Ic.bolt size={11} /></span>}
    </button>
  );
}

function ChapterTree({ chapters, blocks, review, annoSet, selectedId, onSelect }) {
  const [collapsed, setCollapsed] = React.useState({});
  return (
    <div className="tree">
      {chapters.map(ch => {
        const chBlocks = blocks.filter(b => b.chapter_id === ch.chapter_id);
        if (!chBlocks.length) return null;
        const isCol = collapsed[ch.chapter_id];
        const done = chBlocks.filter(b => review.blocks[b.block_id]?.reviewed).length;
        return (
          <div key={ch.chapter_id} className="tree-ch">
            <button className="ch-head" onClick={() => setCollapsed(c => ({ ...c, [ch.chapter_id]: !c[ch.chapter_id] }))}>
              <Ic.chevRight size={12} className="ch-caret" style={{ transform: isCol ? "none" : "rotate(90deg)" }} />
              <span className="ch-title">{ch.title}</span>
              <span className="ch-prog mono">{done}/{chBlocks.length}</span>
            </button>
            {!isCol && chBlocks.map(b => (
              <BlockRow key={b.block_id} block={b}
                reviewed={!!review.blocks[b.block_id]?.reviewed}
                hasAnno={annoSet.has(b.block_id)}
                selected={selectedId === b.block_id}
                onSelect={onSelect} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LeftSidebar({ blocks, chapters, review, annoSet, selectedId, onSelect, filters, onToggleFilter, counts, total, onOpenProjectSource }) {
  return (
    <div className="col col-left">
      <ProjectSelector onOpenProjectSource={onOpenProjectSource} />
      <div className="divider" />
      <SourceStatus />
      <div className="divider" />
      <div className="sec-head"><Ic.filter size={12} />Filters</div>
      <FilterChips active={filters} onToggle={onToggleFilter} counts={counts} />
      <div className="divider" />
      <div className="sec-head">
        <Ic.list size={12} />Blocks
        <span className="sec-count mono">{blocks.length}{blocks.length !== total ? `/${total}` : ""}</span>
      </div>
      <div className="tree-scroll">
        <ChapterTree chapters={chapters} blocks={blocks} review={review}
          annoSet={annoSet} selectedId={selectedId} onSelect={onSelect} />
        {blocks.length === 0 && <div className="tree-empty">No blocks match the active filters.</div>}
      </div>
    </div>
  );
}

window.LeftSidebar = LeftSidebar;
