/* ===== RIGHT PANEL: accordion of 6 tabs, one expanded at a time ===== */

function StatusPill({ status }) {
  const map = {
    locked: ["Locked", "pill-lock"], proposed: ["Proposed", "pill-amber"],
    human_verified: ["Verified", "pill-green"], draft: ["Draft", "pill-amber"],
    reviewed: ["Reviewed", "pill-green"],
  };
  const [label, cls] = map[status] || [status, "pill-grey"];
  return <span className={"pill " + cls}>{label}</span>;
}

function MiniField({ label, children, locked }) {
  return (
    <div className="mf">
      <div className="mf-label">{locked && <Ic.lock size={9} />}{label}</div>
      <div className="mf-val">{children}</div>
    </div>
  );
}

/* ---------- GLOSSARY ---------- */
function GlossaryTab({ terms, onDeleteTerm }) {
  const [expanded, setExpanded] = React.useState(terms[0]?.term_id);
  if (!terms.length) return <Empty icon={Ic.tag} text="No glossary terms for this block." sub="Select text in Clean text → Add glossary term." />;
  return (
    <div className="tab-body">
      {terms.map(t => {
        const open = expanded === t.term_id;
        return (
          <div key={t.term_id} className={"card" + (open ? " open" : "")}>
            <button className="card-head" onClick={() => setExpanded(open ? null : t.term_id)}>
              <Ic.chevRight size={11} className="card-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
              <span className="card-title mono">{t.source_term}</span>
              <span className="card-arrow"><Ic.arrowRight size={11} /></span>
              <span className="card-target">{t.expected_target}</span>
              <span className="card-spacer" />
              <StatusPill status={t.status} />
            </button>
            {open && (
              <div className="card-body">
                <MiniField label="expected_target">{t.expected_target}</MiniField>
                <MiniField label="allowed_variants">
                  {t.allowed_variants.length ? t.allowed_variants.map(v => <span key={v} className="var ok">{v}</span>) : <span className="faint">none</span>}
                </MiniField>
                <MiniField label="forbidden_variants">
                  {t.forbidden_variants.length ? t.forbidden_variants.map(v => <span key={v} className="var bad">{v}</span>) : <span className="faint">none</span>}
                </MiniField>
                <div className="card-meta-row">
                  <span className="lockfield"><span className="lf-k"><Ic.lock size={9} />scope</span><span className="lf-v">{t.chapter_scope}</span></span>
                  <span className="lockfield"><span className="lf-k">conf</span><span className="lf-v">{t.confidence.toFixed(2)}</span></span>
                  <span className="lockfield"><span className="lf-k">occ</span><span className="lf-v">{t.occurrences.length}</span></span>
                  <button className="card-del tip tip-left" data-tip="Delete term" onClick={() => onDeleteTerm(t)}><Ic.trash size={12} /></button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ENTITIES ---------- */
function EntitiesTab({ entities, block }) {
  const [expanded, setExpanded] = React.useState(entities[0]?.entity_id);
  if (!entities.length) return <Empty icon={Ic.users} text="No entities mentioned in this block." sub="Select text in Clean text → Add entity mention." />;
  const isDialogue = block.block_type === "dialogue";
  return (
    <div className="tab-body">
      {isDialogue && (
        <div className="discourse">
          <div className="discourse-head"><Ic.quote size={11} />dialogue · speaker / addressee</div>
          <div className="discourse-row">
            <DiscSelect label="speaker" entities={entities} value={block.discourse?.speaker_entity_id} />
            <DiscSelect label="addressee" entities={entities} value={block.discourse?.addressee_entity_id} />
          </div>
        </div>
      )}
      {entities.map(e => {
        const open = expanded === e.entity_id;
        const mentions = e.mentions.filter(m => m.block_id === block.block_id);
        return (
          <div key={e.entity_id} className={"card" + (open ? " open" : "")}>
            <button className="card-head" onClick={() => setExpanded(open ? null : e.entity_id)}>
              <Ic.chevRight size={11} className="card-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
              <span className={"ent-type ent-" + e.entity_type}>{e.entity_type[0]}</span>
              <span className="card-title">{e.canonical_source}</span>
              <span className="card-arrow"><Ic.arrowRight size={11} /></span>
              <span className="card-target">{e.canonical_target}</span>
              <span className="card-spacer" />
              {mentions.length > 0 && <span className="ment-count mono">{mentions.length}×</span>}
            </button>
            {open && (
              <div className="card-body">
                <MiniField label="canonical_target">{e.canonical_target}</MiniField>
                <MiniField label="aliases_source">
                  {e.aliases_source.length ? e.aliases_source.map(a => <span key={a} className="var">{a}</span>) : <span className="faint">none</span>}
                </MiniField>
                <MiniField label="pronoun_policy"><span className="mono pron">{e.pronoun_policy}</span></MiniField>
                {mentions.length > 0 && (
                  <MiniField label="mentions in this block">
                    {mentions.map((m, i) => <span key={i} className="var mono">“{m.surface}” [{m.span[0]},{m.span[1]}]</span>)}
                  </MiniField>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function DiscSelect({ label, entities, value }) {
  return (
    <label className="disc-field">
      <span className="disc-label">{label}</span>
      <div className="disc-sel">
        <select defaultValue={value || ""}>
          <option value="">—</option>
          {entities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.canonical_source}</option>)}
        </select>
        <Ic.chevDown size={11} className="faint" />
      </div>
    </label>
  );
}

/* ---------- SUMMARY ---------- */
function SummaryTab({ summary, entities }) {
  if (!summary || !summary.summary_source) {
    return (
      <div className="tab-body">
        <Empty icon={Ic.doc} text="No summary for this chapter yet." sub="" />
        <button className="btn sm full"><Ic.plus size={12} />Write chapter summary</button>
      </div>
    );
  }
  return (
    <div className="tab-body">
      <div className="sum-meta">
        <span className="lockfield"><span className="lf-k">chapter</span><span className="lf-v">{summary.chapter_id}</span></span>
        <span className="lockfield"><span className="lf-k">source</span><span className="lf-v">{summary.source}</span></span>
        <span className="lockfield"><span className="lf-k">conf</span><span className="lf-v">{summary.confidence.toFixed(2)}</span></span>
      </div>
      <div className="sum-text">{summary.summary_source}</div>
      <div className="sum-grid">
        <MiniField label="setting">{summary.setting}</MiniField>
        <MiniField label="emotional_tone"><span className="var">{summary.emotional_tone}</span></MiniField>
      </div>
      <MiniField label="characters_present">
        {summary.characters_present.map(id => {
          const e = entities.find(x => x.entity_id === id);
          return <span key={id} className="var mono">{e ? e.canonical_source : id}</span>;
        })}
      </MiniField>
    </div>
  );
}

/* ---------- REFERENCE ---------- */
function ReferenceTab({ refs, block }) {
  const blockRef = refs.find(r => r.block_id === block.block_id);
  return (
    <div className="tab-body">
      <div className="ref-explain">
        <Ic.layers size={12} />
        <span><b>Drafts</b> are working state. Only <b>Reviewed</b> references are promoted to the canonical <span className="mono">manual_reference_subset.jsonl</span>.</span>
      </div>
      {!blockRef ? (
        <Empty icon={Ic.book} text="No reference translation for this block." sub="This block is not in the reference subset stratum." />
      ) : (
        <div className={"ref-card status-" + blockRef.status}>
          <div className="ref-card-head">
            <span className="ref-stratum mono">{blockRef.stratum}</span>
            <span className="card-spacer" />
            <StatusPill status={blockRef.status} />
            {blockRef.canonical && <span className="pill pill-lock"><Ic.lock size={9} />canonical</span>}
          </div>
          <div className="ref-vi" contentEditable={blockRef.status !== "reviewed"} suppressContentEditableWarning={true}>{blockRef.reference_vi}</div>
          <div className="ref-foot">
            <span className="lockfield"><span className="lf-k">by</span><span className="lf-v">{blockRef.translated_by}</span></span>
            {blockRef.reviewed_by && <span className="lockfield"><span className="lf-k">reviewed</span><span className="lf-v">{blockRef.reviewed_by}</span></span>}
            {blockRef.ai_model && <span className="lockfield"><span className="lf-k"><Ic.sparkle size={9} />model</span><span className="lf-v">{blockRef.ai_model}</span></span>}
          </div>
          {blockRef.status === "draft" && (
            <div className="ref-actions">
              <button className="btn sm">Save draft</button>
              <button className="btn sm primary"><Ic.checkCircle size={12} />Promote to reviewed</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- VALIDATE ---------- */
function ValidateTab({ errors, onJump }) {
  const byFile = {};
  errors.forEach(e => { (byFile[e.file] = byFile[e.file] || []).push(e); });
  const files = Object.keys(byFile);
  if (!files.length) return <Empty icon={Ic.checkCircle} text="No validation errors." sub="All checks pass — ready to freeze." good />;
  return (
    <div className="tab-body">
      {files.map(f => (
        <div key={f} className="val-group">
          <div className="val-file"><Ic.file size={12} />{f}<span className="val-count mono">{byFile[f].length}</span></div>
          {byFile[f].map((e, i) => (
            <button key={i} className={"val-row sev-" + e.severity} onClick={() => onJump(e)}>
              <span className={"val-sev sev-" + e.severity}>{e.severity === "error" ? <Ic.xCircle size={12} /> : <Ic.alert size={12} />}</span>
              <span className="val-text">
                <span className="val-msg">{e.message}</span>
                <span className="val-loc mono">{e.block_id || e.chapter_id} · {e.location}</span>
              </span>
              {e.block_id && <span className="val-jump">jump <Ic.arrowRight size={11} /></span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- PROGRESS ---------- */
function Bar({ label, done, total, tone }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="prog-row">
      <div className="prog-top"><span className="prog-label">{label}</span><span className="prog-num mono">{done}/{total}</span></div>
      <div className="prog-track"><div className={"prog-fill " + (tone || "")} style={{ width: pct + "%" }} /></div>
    </div>
  );
}
function ProgressTab({ stats }) {
  return (
    <div className="tab-body">
      <Bar label="Blocks reviewed" done={stats.reviewed} total={stats.totalBlocks} />
      <Bar label="Glossary terms" done={stats.glossaryDone} total={stats.glossary} tone="alt" />
      <Bar label="Entities resolved" done={stats.entitiesDone} total={stats.entities} tone="alt" />
      <Bar label="Chapter summaries" done={stats.summaries} total={stats.totalChapters} tone="alt" />
      <Bar label="Reference subset reviewed" done={stats.refReviewed} total={stats.refs} tone="alt" />
      <Bar label="Validation clean" done={stats.valClean} total={stats.valTotal} tone={stats.valClean === stats.valTotal ? "good" : "bad"} />
      <div className="prog-note">
        <Ic.snow size={12} />
        <span>Freeze is enabled when validation passes and all required reviews are complete.</span>
      </div>
    </div>
  );
}

function Empty({ icon: I, text, sub, good }) {
  return (
    <div className={"empty" + (good ? " good" : "")}>
      <I size={20} className="empty-ic" />
      <div className="empty-text">{text}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}

const TABS = [
  { id: "glossary", label: "Glossary", icon: Ic.tag },
  { id: "entities", label: "Entities", icon: Ic.users },
  { id: "summary", label: "Summary", icon: Ic.doc },
  { id: "reference", label: "Reference", icon: Ic.book },
  { id: "validate", label: "Validate", icon: Ic.checkCircle },
  { id: "progress", label: "Progress", icon: Ic.layers },
];

function RightPanel({ active, onSetActive, counts, ctx }) {
  return (
    <div className="col col-right">
      <div className="rp-accordion">
        {TABS.map(t => {
          const open = active === t.id;
          const I = t.icon;
          const badge = counts[t.id];
          return (
            <div key={t.id} className={"rp-sec" + (open ? " open" : "")}>
              <button className="rp-head" onClick={() => onSetActive(t.id)}>
                <Ic.chevRight size={12} className="rp-caret" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                <I size={13} className="rp-ic" />
                <span className="rp-label">{t.label}</span>
                <span className="rp-spacer" />
                {badge != null && badge.text && (
                  <span className={"rp-badge" + (badge.tone ? " " + badge.tone : "")}>{badge.text}</span>
                )}
              </button>
              {open && (
                <div className="rp-content">
                  {t.id === "glossary" && <GlossaryTab terms={ctx.terms} onDeleteTerm={ctx.onDeleteTerm} />}
                  {t.id === "entities" && <EntitiesTab entities={ctx.entities} block={ctx.block} />}
                  {t.id === "summary" && <SummaryTab summary={ctx.summary} entities={DATA.ENTITIES} />}
                  {t.id === "reference" && <ReferenceTab refs={DATA.REFERENCES} block={ctx.block} />}
                  {t.id === "validate" && <ValidateTab errors={ctx.errors} onJump={ctx.onJump} />}
                  {t.id === "progress" && <ProgressTab stats={ctx.stats} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.RightPanel = RightPanel;
